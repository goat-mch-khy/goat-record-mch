/**
 * GOAT MCH v3 — forms.js
 * Lookup, autofill, save, edit for AN / PN / FP / RPT
 */

const FORMS = (() => {

  let _editVID = null;
  let _editSheet = null;
  let _debounce = null;

  // ── Sheet config ─────────────────────────────────────────────────────────
  const SHEETS = {
    an:  { remote:'AN',        idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC', nameF:'Pregnant Name', nxtF:'Next App'  },
    pn:  { remote:'PN',        idF:'ID client',   dateF:'Date Of Registration', hcF:'Served HC', nameF:'Name',          nxtF:'Next app.' },
    fp:  { remote:'FP',        idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC', nameF:'Client name',   nxtF:'Next app'  },
    rpt: { remote:'REPORTING', idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC', nameF:'Client Name',   nxtF:null        },
  };

  // ── ID input → debounced lookup ──────────────────────────────────────────
  function onIdInput(s) {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => {
      const id = (UI.gv(`${s}-id`) || '').trim();
      if (id.length >= 6) lookup(s, id);
    }, 600);
  }

  // ── Lookup ───────────────────────────────────────────────────────────────
  async function lookup(s, id) {
    if (!id) return;
    const cfg = SHEETS[s];
    // Set the hidden ID field
    const hidEl = UI.g(`${s}-${cfg.idF === 'ID client' ? 'idcl' : 'natid'}`);
    if (hidEl) hidEl.value = id;

    const pt = DB.patients[id];
    if (pt) {
      _autofill(s, id, pt);
      return;
    }

    // Try live Sheets lookup if online
    if (SYNC.online && SYNC.probed) {
      const fmEl = UI.g(`${s}-fm`);
      if (fmEl) fmEl.innerHTML = '<i class="ti ti-loader" style="animation:spin 1s linear infinite;display:inline-block"></i> Searching...';
      UI.g(`${s}-found`)?.classList.add('show');
      await _liveSearch(s, id);
    } else {
      _showNew(s);
    }
  }

  async function _liveSearch(s, id) {
    const cfg = SHEETS[s];
    try {
      const rows = await SYNC.fetchSheet(cfg.remote);
      rows.filter(r => (r[cfg.idF] || '').trim() === id)
          .forEach(r => DB.upsertRow(r, cfg.remote, cfg.hcF, cfg.idF, cfg.dateF));
      DB.persist(s); DB.persist('patients');
      const pt = DB.patients[id];
      if (pt) _autofill(s, id, pt, true);
      else    { _showNew(s); UI.notify('Patient not found — new patient'); }
    } catch (e) {
      _showNew(s);
      DB.log(`Lookup error (${s}): ${e.message}`);
    }
  }

  // ── Autofill ─────────────────────────────────────────────────────────────
  function _autofill(s, id, pt, fromSheets = false) {
    const sv = UI.sv, so = UI.setOpt;

    // Common patient fields
    sv(`${s}-name`,  pt.name);   sv(`${s}-phone`, pt.phone);
    sv(`${s}-dob`,   pt.dob);    sv(`${s}-rris`,  pt.rris);
    sv(`${s}-mhr`,   pt.mhr);    sv(`${s}-status`,pt.status);
    so(`${s}-refugee`, pt.refugee);

    const anRecs = DB.an.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts);
    const pnRecs = DB.pn.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts);
    const fpRecs = DB.fp.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts);
    const total  = anRecs.length + pnRecs.length + fpRecs.length;

    // AN-specific
    if (s === 'an') {
      sv('an-husband', pt.husband); sv('an-hid2', pt.hid2);
      if (pt.lmp) {
        const lmpNorm = UI.normDate(pt.lmp);
        if (lmpNorm) { UI.g('an-lmp').value = lmpNorm; UI.calcEDD(); }
      }
      if (pt.last_rcurr) UI.setMulti('an-rcurr', pt.last_rcurr.split(' | '));
      if (pt.last_rprev) UI.setMulti('an-rprev', pt.last_rprev.split(' | '));
      UI.calcRisk();
      const lastAN = anRecs[0];
      if (lastAN) {
        so('an-ohc', lastAN['Original HC']); so('an-shc', lastAN['Served HC']);
      } else if (pt.last_an_shc) {
        so('an-shc', pt.last_an_shc);
      }
      if (anRecs.length > 0) so('an-case', 'Follow Up');
    }

    // PN-specific
    if (s === 'pn') {
      const lastPN = pnRecs[0];
      if (lastPN) { so('pn-ohc', lastPN['Original HC']); so('pn-shc', lastPN['Served HC']); }
      else if (pt.last_pn_shc) so('pn-shc', pt.last_pn_shc);
      if (pnRecs.length > 0) so('pn-case', 'Follow Up');
    }

    // FP-specific
    if (s === 'fp') {
      const lastFP = fpRecs[0];
      if (lastFP) { so('fp-ohc', lastFP['Original HC']); so('fp-shc', lastFP['Served HC']); }
      else if (pt.last_fp_shc) so('fp-shc', pt.last_fp_shc);
      if (pt.last_fp) so('fp-method', pt.last_fp);
      if (fpRecs.length > 0) so('fp-case', 'Follow Up');
    }

    // RPT-specific
    if (s === 'rpt') {
      const rptHC = pt.last_an_shc || pt.last_pn_shc || pt.last_fp_shc || '';
      if (rptHC) so('rpt-shc', rptHC);
      if (pt.last_rpt_org) so('rpt-org', pt.last_rpt_org);
      if (pt.dob) { const ae = UI.g('rpt-age'); if (ae) ae.value = UI.calcAge(pt.dob); }
      const ge = UI.g('rpt-gender'); if (ge) ge.value = 'Female';
      const rS = an => { const e = UI.g(`rpt-${an}st`); if (e) e.value = e._v; };
      const _set = (id, v) => { const e = UI.g(id); if (e) e.value = v; };
      _set('rpt-anst', anRecs.length ? `${anRecs.length} visit(s) · Last: ${anRecs[0]['Date Of Registration']||'—'}` : 'No ANC record');
      _set('rpt-pnst', pnRecs.length ? `${pnRecs.length} visit(s) · Last: ${pnRecs[0]['Date Of Registration']||'—'}` : 'No PN record');
      _set('rpt-fpst', fpRecs.length ? `${fpRecs.length} visit(s) · Method: ${fpRecs[0]['Family planning method']||'—'}` : 'No FP record');
    }

    // HRP alert
    _showHRP(s, id);

    // Visit timeline
    _showTimeline(s, id, anRecs, pnRecs, fpRecs);

    // Clinical summary
    _showClinSum(s, anRecs[0], pnRecs[0], fpRecs[0]);

    // Found banner
    const fmEl = UI.g(`${s}-fm`);
    if (fmEl) fmEl.innerHTML = `<strong>${pt.name || id}</strong> — <span class="pill pok">${total} visit${total!==1?'s':''}${fromSheets?' (from Sheets)':''}</span> · ${pt.phone || 'no phone'}`;
    UI.g(`${s}-found`)?.classList.add('show');
    UI.g(`${s}-new`)?.classList.remove('show');
  }

  function _showNew(s) {
    UI.g(`${s}-found`)?.classList.remove('show');
    UI.g(`${s}-new`)?.classList.add('show');
  }

  // ── HRP alert ────────────────────────────────────────────────────────────
  function _showHRP(s, id) {
    const el = UI.g(`${s}-hrp`);
    if (!el) return;
    const lastAN = DB.an.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts)[0];
    if (lastAN && (lastAN['RISK SCORE']||'').includes('HRP')) {
      const risks = lastAN['Combined Risk Factors'] || lastAN['Risk Factor CURRENT PREGNANCY'] || '';
      el.innerHTML = `<div class="bhrp show"><i class="ti ti-alert-triangle" style="font-size:20px;flex-shrink:0"></i><div><div style="font-weight:800">HIGH RISK PREGNANCY</div>${risks ? `<div style="font-size:11px;opacity:.9;margin-top:2px">${risks.slice(0,120)}</div>` : ''}</div></div>`;
    } else {
      el.innerHTML = '';
    }
  }

  // ── Visit timeline ────────────────────────────────────────────────────────
  function _showTimeline(s, id, anRecs, pnRecs, fpRecs) {
    const el = UI.g(`${s}-timeline`);
    if (!el) return;
    const all = [
      ...anRecs.map(r => ({ s:'AN', date:r['Date Of Registration']||'', hc:r['Served HC']||'', mw:r['MW Name']||'', risk:r['RISK SCORE']||'', col:'#1565c0' })),
      ...pnRecs.map(r => ({ s:'PN', date:r['Date Of Registration']||'', hc:r['Served HC']||'', mw:r['MW Name']||'', type:r['Type Delivery']||'', col:'#880e4f' })),
      ...fpRecs.map(r => ({ s:'FP', date:r['Date Of Registration']||'', hc:r['Served HC']||'', mw:r['MW Name']||'', method:r['Family planning method']||'', col:'#e65100' })),
    ].sort((a, b) => b.date.localeCompare(a.date));

    if (!all.length) { el.innerHTML = ''; return; }

    el.innerHTML = `<div style="font-size:10px;font-weight:700;color:var(--tx2);text-transform:uppercase;margin:10px 0 6px">Visit history (${all.length})</div>`
      + `<div class="timeline">`
      + all.slice(0, 10).map(v => {
          const parts = [];
          if (v.risk) parts.push(`<span style="color:${v.col};font-weight:700">${v.risk}</span>`);
          if (v.type)   parts.push(v.type);
          if (v.method) parts.push(v.method);
          return `<div class="tl-item"><div class="tl-dot" style="background:${v.col}"></div>`
            + `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">`
            + `<span class="pill" style="background:${v.col};color:#fff;font-size:9px;padding:1px 6px">${v.s}</span>`
            + `<strong style="font-size:11px">${v.date}</strong>`
            + `<span style="font-size:10px;color:var(--tx2)">${v.hc}</span>`
            + `</div>${parts.length ? `<div style="font-size:10px;color:var(--tx2);margin-top:2px">${parts.join(' · ')}</div>` : ''}</div>`;
        }).join('')
      + (all.length > 10 ? `<div style="font-size:10px;color:var(--tx3);margin-top:4px">+${all.length-10} earlier</div>` : '')
      + '</div>';
  }

  // ── Clinical summary ──────────────────────────────────────────────────────
  function _showClinSum(s, lastAN, lastPN, lastFP) {
    const el = UI.g(`${s}-clin`);
    if (!el) return;
    if (!lastAN && !lastPN && !lastFP) { el.innerHTML = ''; return; }
    let html = '<div class="clinsum">';
    if (lastAN) {
      const rc = (lastAN['RISK SCORE']||'').includes('HRP') ? '#c62828' : (lastAN['RISK SCORE']||'').includes('AP') ? '#f39c12' : 'var(--g)';
      html += `<div class="sh">Last ANC — ${lastAN['Date Of Registration']||'—'}</div>`
        + `<div class="clinsum-row"><span>BP: <b>${lastAN['BP']||'—'}</b></span><span>Wt: <b>${lastAN['Weight']||'—'}kg</b></span><span>MUAC: <b>${lastAN['MUAC']||'—'}mm</b></span><span>GA: <b>${lastAN['GA']||'—'}</b></span><span>EDD: <b>${lastAN['EDD']||'—'}</b></span><span style="color:${rc}">Risk: <b>${lastAN['RISK SCORE']||'—'}</b></span></div>`;
    }
    if (lastPN) html += `<div class="sh" style="margin-top:10px">Last PN — ${lastPN['Date Of Registration']||'—'}</div><div class="clinsum-row"><span>Type: <b>${lastPN['Type Delivery']||'—'}</b></span><span>Place: <b>${lastPN['Place Delivery']||'—'}</b></span></div>`;
    if (lastFP)  html += `<div class="sh" style="margin-top:10px">Last FP — ${lastFP['Date Of Registration']||'—'}</div><div class="clinsum-row"><span>Method: <b>${lastFP['Family planning method']||'—'}</b></span></div>`;
    html += '</div>';
    el.innerHTML = html;
  }

  // ── Build row from form ───────────────────────────────────────────────────
  function _buildRow(s) {
    const row = {};
    document.querySelectorAll(`[data-sheet="${s}"][data-key]`).forEach(el => {
      const key = el.dataset.key;
      if (el.multiple) {
        row[key] = Array.from(el.selectedOptions).map(o => o.value).filter(Boolean).join(s === 'rpt' ? ', ' : ' | ');
      } else {
        const v = el.value;
        if (v) row[key] = v;
      }
    });
    return row;
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  function save(s) {
    const cfg  = SHEETS[s];
    const id   = (UI.gv(`${s}-id`) || '').trim();
    const date = UI.gv(`${s}-date`);
    const hc   = UI.gv(`${s}-shc`);

    if (s !== 'rpt' && !id)  { UI.notify('Please enter the patient ID', 'err'); return; }
    if (!date)                { UI.notify('Please select the visit date', 'err'); return; }
    if (!hc)                  { UI.notify('Please select the facility', 'err');   return; }

    // Edit mode
    if (_editVID && _editSheet === s) { _applyEdit(s); return; }

    // Duplicate check
    const arr  = DB.sheet(s);
    const dup  = arr.find(r =>
      (r.lady_id || r[cfg.idF] || '') === id &&
      (r[cfg.dateF] || '').slice(0, 10) === date.slice(0, 10) &&
      (r[cfg.hcF]   || '').toLowerCase() === hc.toLowerCase()
    );
    if (dup) { UI.notify('Duplicate — this visit already exists', 'err'); return; }

    const row  = _buildRow(s);
    if (id) row[cfg.idF] = id;

    const vid  = DB.saveRecord(cfg.remote, row);
    DB.log(`Saved ${s.toUpperCase()}: ${vid}`);
    UI.notify(`Saved · ${s.toUpperCase()}`);
    UI.clearForm(s);

    // Trigger push if online
    const ep = DB.getEP();
    if (SYNC.online && ep) {
      setTimeout(() => SYNC.push(ep), 500);
    }

    // Update badge
    APPTS.updateBadge();
  }

  // ── Edit ─────────────────────────────────────────────────────────────────
  function startEdit(s, vid) {
    const arr = DB.sheet(s);
    const rec = arr.find(r => r.visit_id === vid);
    if (!rec) { UI.notify('Record not found', 'err'); return; }
    if (rec._pulled || rec._imported) { UI.notify('Pulled records are view-only', 'err'); return; }
    if (Date.now() - (rec.ts || 0) > CONFIG.EDIT_WINDOW_MS) { UI.notify('Edit window expired (24h)', 'err'); return; }

    _editVID   = vid;
    _editSheet = s;

    // Fill form from record
    document.querySelectorAll(`[data-sheet="${s}"][data-key]`).forEach(el => {
      const v = rec[el.dataset.key] || '';
      if (el.multiple) {
        UI.setMulti(el.id, v.split(/[|,]/).map(x => x.trim()).filter(Boolean));
      } else {
        el.value = v;
      }
    });

    const cfg = SHEETS[s];
    UI.sv(`${s}-id`, rec[cfg.idF] || rec.lady_id || '');
    if (s === 'an') { UI.calcEDD(); UI.calcRisk(); }

    UI.g(`${s}-edit`)?.classList.add('show');
    const lbl = UI.g(`${s}-edit-vid`);
    if (lbl) lbl.textContent = vid;
    UI.notify(`Edit mode — ${Math.max(0, Math.ceil((CONFIG.EDIT_WINDOW_MS - (Date.now() - (rec.ts||0))) / 3600000))}h left`);
  }

  function _applyEdit(s) {
    const changes = _buildRow(s);
    const ok = DB.updateRecord(SHEETS[s].remote, _editVID, changes);
    UI.notify(ok ? `Updated · ${s.toUpperCase()}` : 'Update failed', ok ? '' : 'err');
    cancelEdit(s);
    const ep = DB.getEP();
    if (SYNC.online && ep) setTimeout(() => SYNC.push(ep), 500);
  }

  function cancelEdit(s) {
    _editVID = null; _editSheet = null;
    UI.g(`${s}-edit`)?.classList.remove('show');
    UI.clearForm(s);
  }

  // ── Public ──────────────────────────────────────────────────────────────
  return { onIdInput, lookup, save, startEdit, cancelEdit };
})();
