/**
 * GOAT MCH v3 — patients.js
 * Patient registry view + search
 */

const PATIENTS = (() => {

  function render() {
    const q      = (UI.gv('ptq') || '').toLowerCase().trim();
    const user   = DB.getUser();
    const myFac  = (user?.facility || '').toLowerCase().trim();

    // Build set of patient IDs at this facility
    const facIDs = new Set();
    if (myFac) {
      ['an','pn','fp','rpt'].forEach(s =>
        DB.sheet(s).forEach(r => {
          if ((r['Served HC'] || '').toLowerCase().trim() === myFac && r.lady_id)
            facIDs.add(r.lady_id);
        })
      );
    }

    const pts = Object.entries(DB.patients)
      .filter(([id, p]) => {
        if (myFac && !facIDs.has(id)) return false;
        if (!q) return true;
        return id.includes(q) || (p.name || '').toLowerCase().includes(q);
      })
      .slice(0, 80);

    const el = UI.g('ptlist');
    if (!el) return;

    if (!pts.length) {
      el.innerHTML = '<div style="text-align:center;color:var(--tx2);padding:20px">No patients found</div>';
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    el.innerHTML = pts.map(([id, p]) => {
      const anR = DB.an.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts);
      const pnR = DB.pn.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts);
      const fpR = DB.fp.filter(r => r.lady_id === id).sort((a, b) => b.ts - a.ts);
      const v   = anR.length + pnR.length + fpR.length;

      const allV = [
        ...anR.map(r => ({ date: r['Date Of Registration'] || '', s: 'AN' })),
        ...pnR.map(r => ({ date: r['Date Of Registration'] || '', s: 'PN' })),
        ...fpR.map(r => ({ date: r['Date Of Registration'] || '', s: 'FP' })),
      ].sort((a, b) => b.date.localeCompare(a.date));

      const lastV   = allV[0];
      const nextApp = anR[0]?.['Next App'] || pnR[0]?.['Next app.'] || fpR[0]?.['Next app'] || '';
      const overdue = nextApp && nextApp.slice(0, 10) < today;
      const risk    = anR[0]?.['RISK SCORE'] || '';
      const rc      = risk.includes('HRP') ? '#c62828' : risk.includes('AP') ? '#f39c12' : '';
      const lastTab = lastV ? lastV.s.toLowerCase() : 'an';

      return `<div class="ptitem" onclick="PATIENTS.open('${id}','${lastTab}')">
        <div class="ptname">
          ${p.name || '—'}
          <span class="pill prpt" style="font-size:10px">${id}</span>
          ${rc ? `<span class="pill" style="background:${rc}20;color:${rc};font-size:9px">${risk.split(' ')[0]}</span>` : ''}
        </div>
        <div class="ptmeta">
          <span>📞 ${p.phone || '—'}</span>
          <span>DOB: ${UI.fmtDate(p.dob)}</span>
          ${lastV ? `<span>Last: ${UI.fmtDate(lastV.date)} <span class="pill" style="font-size:9px;background:var(--bg3)">${lastV.s}</span></span>` : ''}
          ${nextApp ? `<span style="color:${overdue ? '#c62828' : 'var(--g)'}">${overdue ? '⚠ Overdue: ' : 'Next: '}${UI.fmtDate(nextApp)}</span>` : ''}
          <span>${v} visit${v !== 1 ? 's' : ''}</span>
        </div>
      </div>`;
    }).join('');
  }

  function open(id, preferTab = 'an') {
    const tab = FORMS ? preferTab : 'an';
    UI.goTab(tab);
    const idEl = UI.g(`${tab}-id`);
    if (idEl) idEl.value = id;
    FORMS.lookup(tab, id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return { render, open };
})();
