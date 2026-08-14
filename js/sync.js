/**
 * GOAT MCH v3 — sync.js
 * Push: Apps Script POST
 * Pull: Apps Script GET (getData action)
 */

const SYNC = (() => {

  const SHEET_ID = '11pD_HK5IX1e_ojtpV7aAMQXeZqGCKxCYxJjSaIOMnL0';
  const TIMEOUT  = 30000;
  const MW_COLS  = ['MW Name','MW. Name','MW name','Name Of midwife'];

  let _online   = false;
  let _syncing  = false;
  let _probed   = false;
  let _onStatus = null;

  // ── Normalize any date to YYYY-MM-DD ─────────────────────────────────────
  function normDate(v) {
    if (!v) return '';
    const s = String(v).trim();
    if (!s || s === 'null') return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    return '';
  }

  // ── Fetch GET — XHR first (more compatible with iOS Safari + gviz) ────────
  function fetchURL(url, timeout) {
    timeout = timeout || TIMEOUT;
    return new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = timeout;
      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) return;
        if (xhr.status === 0 && !xhr.responseText) {
          rej(new Error('Network error or blocked by browser'));
          return;
        }
        res({ ok: xhr.status < 400 || xhr.status === 0, status: xhr.status, text: xhr.responseText });
      };
      xhr.ontimeout = () => rej(new Error(`Timeout after ${timeout/1000}s`));
      xhr.onerror   = () => {
        // Try fetch() as fallback
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), timeout);
        fetch(url, { method:'GET', cache:'no-store', signal: ctrl.signal })
          .then(r => r.text().then(text => { clearTimeout(tid); res({ ok: r.ok, status: r.status, text }); }))
          .catch(e => { clearTimeout(tid); rej(new Error('Both XHR and fetch failed: ' + e.message)); });
      };
      xhr.send();
    });
  }

  // ── POST JSON ─────────────────────────────────────────────────────────────
  async function postJSON(url, body) {
    return new Promise((res, rej) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = TIMEOUT;
      xhr.onload    = () => { try { res(JSON.parse(xhr.responseText)); } catch(e) { rej(e); } };
      xhr.onerror   = () => rej(new Error('Network error'));
      xhr.ontimeout = () => rej(new Error('Timeout'));
      xhr.send(JSON.stringify(body));
    });
  }

  // ── Probe (fast 3s) ───────────────────────────────────────────────────────
  async function probe(ep) {
    if (!ep) { _probed = true; notifyStatus(); return false; }
    try {
      const res  = await fetchURL(`${ep}?action=health&_t=${Date.now()}`, 3000);
      const data = JSON.parse(res.text);
      _online = data.status === 'ok' || data.status === 'online';
    } catch(e) {
      _online = false;
    }
    _probed = true;
    notifyStatus();
    return _online;
  }

  // ── Push pending records via Apps Script POST ─────────────────────────────
  async function push(ep, onProgress) {
    if (_syncing || !ep) return { ok:0, fail:0 };
    const pending = DB.getPending();
    if (!pending.length) return { ok:0, fail:0 };
    _syncing = true; notifyStatus();
    DB.log(`Syncing ${pending.length} record(s)...`);
    let ok = 0, fail = 0;
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (onProgress) onProgress(i+1, pending.length);
      try {
        const result = await postJSON(ep, { sheet: item.sheet, row: item.row });
        if (result && result.status === 'ok') { DB.markSynced(item.visit_id); ok++; DB.log(`✓ ${item.visit_id}`); }
        else { DB.markFailed(item.visit_id); fail++; DB.log(`✗ ${item.visit_id}: ${result?.message||'error'}`); }
      } catch(e) {
        DB.markFailed(item.visit_id); fail++;
        DB.log(`✗ ${item.visit_id}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    _syncing = false; notifyStatus();
    DB.log(`Sync done — ${ok} OK, ${fail} failed`);
    return { ok, fail };
  }

  // ── Pull via gviz (direct from Google Sheets — no Apps Script needed) ────
  async function pull(ep, facility, mwName, onProgress) {
    const cfgs = [
      { sheet:'AN',        local:'an',  idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC' },
      { sheet:'PN',        local:'pn',  idF:'ID client',   dateF:'Date Of Registration', hcF:'Served HC' },
      { sheet:'FP',        local:'fp',  idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC' },
      { sheet:'REPORTING', local:'rpt', idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC' },
    ];

    const facNorm = (facility || '').toLowerCase().trim();
    const mwNorm  = (mwName   || '').toLowerCase().replace(/\s+/g,' ').trim();
    let totalNew  = 0, errors = [];

    for (let i = 0; i < cfgs.length; i++) {
      const cfg = cfgs[i];
      if (onProgress) onProgress(cfg.sheet, i, cfgs.length);
      DB.log(`[Pull] Fetching ${cfg.sheet}...`);

      try {
        // Use gviz — sheet is public (Anyone with link can view)
        // headers=2 skips rows 1-2, uses row 3 as column headers, data starts row 4
        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(cfg.sheet)}&headers=2&_t=${Date.now()}`;
        const res = await fetchURL(url, 45000);
        if (!res.text || res.text.length < 10) throw new Error(`Empty response (${res.status}) from Google Sheets`);
        DB.log(`[Pull] ${cfg.sheet}: response ${res.text.length} chars`);
        const allRows = parseGviz(res.text);
        DB.log(`[Pull] ${cfg.sheet}: ${allRows.length} total rows`);

        // Filter: facility OR own MW name (Option C)
        const myRows = allRows.filter(row => {
          const hc = (row[cfg.hcF] || '').toLowerCase().trim();
          if (hc === facNorm) return true;
          for (const col of MW_COLS) {
            const mw = (row[col] || '').toLowerCase().replace(/\s+/g,' ').trim();
            if (mw && mw === mwNorm) return true;
          }
          return false;
        });

        DB.log(`[Pull] ${cfg.sheet}: ${myRows.length} rows match`);
        let sheetNew = 0;

        myRows.forEach(row => {
          if (DB.upsertRow(row, cfg.sheet, cfg.hcF, cfg.idF, cfg.dateF)) {
            sheetNew++; totalNew++;
          }
        });

        DB.persist(cfg.local);
        DB.persist('patients');
        DB.log(`[Pull] ${cfg.sheet}: +${sheetNew} new`);
        if (onProgress) onProgress(cfg.sheet, i+1, cfgs.length, sheetNew);

      } catch(e) {
        DB.log(`[Pull] ${cfg.sheet} error: ${e.message}`);
        errors.push(`${cfg.sheet}: ${e.message}`);
        if (onProgress) onProgress(cfg.sheet, i+1, cfgs.length, 0);
      }
    }

    DB.mirrorAll();
    DB.log(`[Pull] Done — +${totalNew} new records`);
    return { totalNew, errors };
  }

  // ── Online/offline listeners ──────────────────────────────────────────────
  function initListeners(ep) {
    window.addEventListener('online', async () => {
      _online = true; notifyStatus();
      await new Promise(r => setTimeout(r, 1000));
      if (DB.getPending().length > 0 && ep) push(ep);
    });
    window.addEventListener('offline', () => { _online = false; notifyStatus(); });
  }

  function notifyStatus() {
    if (_onStatus) _onStatus({ online: _online, syncing: _syncing, probed: _probed });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    probe, push, pull, initListeners, normDate,
    onStatus(cb) { _onStatus = cb; },
    get online()  { return _online;  },
    set online(v) { _online = v; notifyStatus(); },
    get syncing() { return _syncing; },
    get probed()  { return _probed;  },
  };
})();
