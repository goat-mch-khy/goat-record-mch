/**
 * GOAT MCH v3 — appointments.js
 * Appointment logic: Active/Late/Defaulter/Closed/Today/Upcoming
 */

const APPTS = (() => {

  const GRACE = 14; // days after appointment that counts as attended

  function _build() {
    const user    = DB.getUser();
    const myFac   = (user?.facility || '').toLowerCase().trim();
    const today   = new Date().toISOString().slice(0, 10);

    // Latest visit date per patient (across all sheets)
    const latestVisit = {};
    [
      { arr: DB.an,  idF: 'National ID' },
      { arr: DB.pn,  idF: 'ID client'   },
      { arr: DB.fp,  idF: 'National ID' },
      { arr: DB.rpt, idF: 'National ID' },
    ].forEach(({ arr, idF }) => {
      arr.forEach(r => {
        const pid  = (r[idF] || '').trim();
        const date = (r['Date Of Registration'] || '').slice(0, 10);
        if (pid && date && (!latestVisit[pid] || date > latestVisit[pid])) {
          latestVisit[pid] = date;
        }
      });
    });

    // Latest AN record per patient for case status
    const latestAN = {};
    DB.an.forEach(r => {
      if (r.lady_id && (!latestAN[r.lady_id] || r._date > (latestAN[r.lady_id]._date || ''))) {
        latestAN[r.lady_id] = r;
      }
    });

    // Latest record per patient per service
    const cfgs = [
      { arr: DB.an,  s:'AN', idF:'National ID', nxtF:'Next App',  nameF:'Pregnant Name' },
      { arr: DB.pn,  s:'PN', idF:'ID client',   nxtF:'Next app.', nameF:'Name'          },
      { arr: DB.fp,  s:'FP', idF:'National ID', nxtF:'Next app',  nameF:'Client name'   },
    ];

    const latestRec = {};
    cfgs.forEach(cfg => {
      cfg.arr.forEach(r => {
        const pid  = (r[cfg.idF] || '').trim();
        const date = (r['Date Of Registration'] || '').slice(0, 10);
        const key  = `${pid}|${cfg.s}`;
        const exD  = latestRec[key] ? (latestRec[key].r['Date Of Registration'] || '').slice(0, 10) : '';
        if (!latestRec[key] || date > exD) latestRec[key] = { r, cfg };
      });
    });

    const appts = [];

    Object.values(latestRec).forEach(({ r, cfg }) => {
      const pid = (r[cfg.idF] || '').trim();
      const hc  = (r['Served HC'] || '').trim();

      // Facility filter
      if (myFac && hc.toLowerCase() !== myFac) return;

      // Case status from latest AN record
      const anRec = latestAN[pid];
      const cs    = anRec?.['Case Status'] || 'Active';

      // Closed cases never show in appointments
      if (cs.includes('Closed')) return;

      // Next appointment date
      const nxt = (r[cfg.nxtF] || '').trim().slice(0, 10);
      if (!nxt || nxt.length < 10) return;

      // Fulfilled check
      const lv = latestVisit[pid] || '';
      let fulfilled = false;
      if (lv >= nxt) {
        const diff = Math.floor((new Date(lv) - new Date(nxt)) / 86400000);
        fulfilled  = diff <= GRACE;
      }
      if (fulfilled) return;

      // Classify
      let status;
      if (cs === 'Defaulter')  status = 'defaulter';
      else if (nxt < today)    status = 'late';
      else if (nxt === today)  status = 'today';
      else                     status = 'upcoming';

      appts.push({
        s: cfg.s, pid,
        name:        r[cfg.nameF] || '—',
        phone:       r['Contact Number'] || r['Contact No'] || DB.patients[pid]?.phone || '',
        hc, mw:      r['MW Name'] || '—',
        nxtDate:     nxt,
        lastVisit:   (r['Date Of Registration'] || '').slice(0, 10),
        risk:        anRec?.['RISK SCORE'] || '',
        muac:        r['MUAC'] || '',
        caseStatus:  cs, status,
        defCallDate: anRec?.['Defaulter Call Date']    || '',
        defCalls:    anRec?.['Defaulter Call Attempts'] || '',
        defReason:   anRec?.['Defaulter Reason']       || '',
      });
    });

    return appts;
  }

  let _filter = 'defaulter';

  function render() {
    const el  = UI.g('appt-list');
    const lbl = UI.g('appt-lbl');
    if (!el) return;

    const all     = _build();
    const today   = new Date().toISOString().slice(0, 10);
    const nDef    = all.filter(a => a.status === 'defaulter').length;
    const nLate   = all.filter(a => a.status === 'late').length;
    const nToday  = all.filter(a => a.status === 'today').length;
    const nUp     = all.filter(a => a.status === 'upcoming').length;

    UI.se('cnt-def',  nDef);
    UI.se('cnt-late', nLate);
    UI.se('cnt-today',nToday);
    UI.se('cnt-up',   nUp);

    let filtered, label;

    if (_filter === 'defaulter') {
      filtered = all.filter(a => a.status === 'defaulter').sort((a,b) => a.nxtDate.localeCompare(b.nxtDate));
      label = `🔴 Defaulters — called, no response (${filtered.length})`;
    } else if (_filter === 'late') {
      filtered = all.filter(a => a.status === 'late').sort((a,b) => a.nxtDate.localeCompare(b.nxtDate));
      label = `🟡 Late — missed, not yet called (${filtered.length})`;
    } else if (_filter === 'today') {
      filtered = all.filter(a => a.status === 'today');
      label = `📅 Today's appointments (${filtered.length})`;
    } else if (_filter === 'upcoming') {
      filtered = all.filter(a => a.status === 'upcoming').sort((a,b) => a.nxtDate.localeCompare(b.nxtDate));
      label = `🕐 Upcoming appointments (${filtered.length})`;
    } else {
      const order = { defaulter:0, late:1, today:2, upcoming:3 };
      filtered = all.sort((a,b) => (order[a.status]||0) - (order[b.status]||0) || a.nxtDate.localeCompare(b.nxtDate));
      label = `All active appointments (${filtered.length})`;
    }

    if (lbl) lbl.textContent = label;

    if (!filtered.length) {
      el.innerHTML = '<div style="text-align:center;color:var(--tx2);padding:30px"><i class="ti ti-calendar-check" style="font-size:32px;display:block;margin-bottom:8px;opacity:.3"></i>No appointments found</div>';
      return;
    }

    const sCol = { AN:'#1565c0', PN:'#880e4f', FP:'#e65100' };

    el.innerHTML = filtered.map(a => {
      let badge, sbg, sbd, textCol;
      if (a.status === 'defaulter') {
        const daysAgo = Math.round((new Date(today) - new Date(a.nxtDate)) / 86400000);
        badge = `🔴 Defaulter — ${daysAgo} day${daysAgo!==1?'s':''} overdue`;
        sbg = '#ffebee'; sbd = '#ef9a9a'; textCol = '#c62828';
      } else if (a.status === 'late') {
        const daysLate = Math.round((new Date(today) - new Date(a.nxtDate)) / 86400000);
        badge = `🟡 Late — ${daysLate} day${daysLate!==1?'s':''} past appointment`;
        sbg = '#fff8e1'; sbd = '#ffcc80'; textCol = '#f57f17';
      } else if (a.status === 'today') {
        badge = '📅 Today'; sbg = '#D6EFEF'; sbd = 'var(--gb)'; textCol = 'var(--gd)';
      } else {
        const left = Math.round((new Date(a.nxtDate) - new Date(today)) / 86400000);
        badge = `🕐 In ${left} day${left!==1?'s':''}`;
        sbg = '#e3f2fd'; sbd = '#90caf9'; textCol = '#1565c0';
      }

      const riskHtml = a.risk
        ? ` <span style="background:${a.risk.includes('HRP')?'#ffebee':a.risk.includes('AP')?'#fff8e1':'var(--gl)'};color:${a.risk.includes('HRP')?'#c62828':a.risk.includes('AP')?'#f57f17':'var(--gd)'};padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700">${a.risk}</span>`
        : '';

      const defDetails = (a.status === 'defaulter' && (a.defCallDate || a.defCalls || a.defReason))
        ? `<div style="margin-top:6px;padding:6px 10px;background:#ffcdd2;border-radius:var(--r);font-size:10px;color:#b71c1c"><i class="ti ti-phone-off"></i> ${[a.defCalls&&`${a.defCalls} call attempt${a.defCalls!=='1'?'s':''}`, a.defCallDate&&`Last: ${a.defCallDate}`, a.defReason].filter(Boolean).join(' · ')}</div>`
        : '';

      const lateHint = a.status === 'late'
        ? `<div style="margin-top:6px;padding:6px 10px;background:#fff3e0;border-radius:var(--r);font-size:10px;color:#e65100"><i class="ti ti-phone"></i> Call patient — if no response, update Case Status to Defaulter in AN form</div>`
        : '';

      return `<div style="background:var(--bg);border:1px solid ${sbd};border-left:4px solid ${sbd};border-radius:var(--r);padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <div style="font-weight:700;font-size:13px">${a.name} <span style="font-family:monospace;font-size:10px;color:var(--tx3);font-weight:400">${a.pid}</span>${riskHtml}</div>
          <span style="background:${sbg};border:1px solid ${sbd};color:${textCol};padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap">${badge}</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--tx2)">
          <span><span class="pill" style="background:${sCol[a.s]||'#546e7a'};color:#fff;font-size:9px;padding:1px 6px">${a.s}</span></span>
          ${a.phone ? `<span><a href="tel:${a.phone}" style="color:var(--g);font-weight:700;text-decoration:none"><i class="ti ti-phone"></i> ${a.phone}</a></span>` : ''}
          <span>📅 Appt: <strong>${a.nxtDate}</strong></span>
          <span>🏥 ${a.hc}</span>
          <span>👤 ${a.mw}</span>
          <span>Last: ${a.lastVisit}</span>
          ${a.muac ? `<span>MUAC: ${a.muac}mm</span>` : ''}
        </div>
        ${defDetails}${lateHint}
      </div>`;
    }).join('');
  }

  function setFilter(f) { _filter = f; render(); }

  function searchDate() {
    const d = (UI.gv('appt-date-search') || '').trim();
    if (!d) { render(); return; }
    _filter = 'date';
    const all = _build().filter(a => a.nxtDate === d);
    const el  = UI.g('appt-list');
    const lbl = UI.g('appt-lbl');
    if (lbl) lbl.textContent = `Appointments on ${d} (${all.length})`;
    if (el) el.innerHTML = all.length ? '...' : '<div style="text-align:center;color:var(--tx2);padding:20px">No appointments on this date</div>';
    render();
  }

  function updateBadge() {
    const all   = _build();
    const count = all.filter(a => a.status === 'defaulter' || a.status === 'late' || a.status === 'today').length;
    const btn   = document.querySelector('.tb[data-tab="appts"]');
    if (!btn) return;
    let badge = btn.querySelector('.tab-badge');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'tab-badge'; btn.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : String(count);
    } else if (badge) {
      badge.remove();
    }
  }

  return { render, setFilter, searchDate, updateBadge };
})();
