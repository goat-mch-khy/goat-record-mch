/**
 * GOAT MCH v3 — sync.js
 * Push records to Google Sheets via Apps Script
 * Pull records directly from Google Sheets via gviz
 */

const SYNC = (() => {

  const SHEET_ID = '11pD_HK5IX1e_ojtpV7aAMQXeZqGCKxCYxJjSaIOMnL0';
  const TIMEOUT  = 20000;
  const MW_COLS  = ['MW Name','MW. Name','MW name','Name Of midwife'];

  let _online  = false;
  let _syncing = false;
  let _probed  = false;
  let _onStatus = null;

  // ── Normalize any date value to YYYY-MM-DD ──────────────────────────────
  function normDate(val) {
    if (!val && val !== 0) return '';
    // Already a proper date string
    if (typeof val === 'string') {
      const s = val.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
      // DD/MM/YYYY
      const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
      // Parse any other string — but use local date components to avoid UTC offset
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      return '';
    }
    // Date object from gviz
    if (val instanceof Date) {
      return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
    }
    return '';
  }

  // ── Fetch with timeout + XHR fallback ───────────────────────────────────
  async function fetchURL(url, timeout) {
    timeout = timeout || TIMEOUT;
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), timeout);
      const resp = await fetch(url, { method:'GET', mode:'cors', cache:'no-store', redirect:'follow', signal: ctrl.signal });
      clearTimeout(tid);
      return { ok: resp.ok, status: resp.status, text: await resp.text() };
    } catch (fe) {
      if (fe.name === 'AbortError') throw new Error(`Timeout after ${timeout/1000}s`);
      // XHR fallback
      return new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.timeout = timeout;
        xhr.onload    = () => res({ ok: xhr.status < 400, status: xhr.status, text: xhr.responseText });
        xhr.onerror   = () => rej(new Error('Network error'));
        xhr.ontimeout = () => rej(new Error(`Timeout after ${timeout/1000}s`));
        xhr.send();
      });
    }
  }

  // ── POST with XHR fallback ───────────────────────────────────────────────
  async function postJSON(url, body) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), TIMEOUT);
      const resp = await fetch(url, {
        method:'POST', mode:'cors', redirect:'follow',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      clearTimeout(tid);
      return JSON.parse(await resp.text());
    } catch (fe) {
      return new Promise((res, rej) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type','application/json');
        xhr.timeout = TIMEOUT;
        xhr.onload    = () => { try { res(JSON.parse(xhr.responseText)); } catch(e) { rej(e); } };
        xhr.onerror   = () => rej(new Error('Network error'));
        xhr.ontimeout = () => rej(new Error('Timeout'));
        xhr.send(JSON.stringify(body));
      });
    }
  }

  // ── Parse gviz response ──────────────────────────────────────────────────
  function parseGviz(raw) {
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}') + 1;
    if (start < 0 || end <= start) throw new Error('Invalid gviz response');
    const data = JSON.parse(raw.slice(start, end));
    if (data.status === 'error') {
      const msg = (data.errors || []).map(e => e.detailed_message || e.message).join('; ');
      throw new Error('Sheets error: ' + (msg || 'unknown'));
    }
    const table = data.table || {};
    const cols  = (table.cols || []).map(c => (c.label || c.id || '').trim());
    return (table.rows || []).map(row => {
      const obj = {};
      (row.c || []).forEach((cell, i) => {
        if (!cols[i]) return;
        let val = cell ? (cell.v !== null && cell.v !== undefined ? cell.v : '') : '';
        // Normalize dates — handles Date objects, strings with GMT, ISO strings
        const nd = normDate(val);
        if (nd) {
          obj[cols[i]] = nd;
        } else {
          obj[cols[i]] = String(val === null || val === undefined ? '' : val).trim();
        }
      });
      return obj;
    });
  }

  // ── Fetch one sheet via gviz ─────────────────────────────────────────────
  // headers=2 → skip rows 1-2, use row 3 as headers, data from row 4
  async function fetchSheet(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&headers=2&_t=${Date.now()}`;
    const res = await fetchURL(url, 45000);
    if (!res.text) throw new Error('Empty response');
    return parseGviz(res.text);
  }

  // ── Probe connectivity (fast — 3s timeout) ───────────────────────────────
  async function probe(ep) {
    if (!ep) { _probed = true; notifyStatus(); return false; }
    try {
      const res  = await fetchURL(`${ep}?action=health&_t=${Date.now()}`, 3000);
      const data = JSON.parse(res.text);
      _online = data.status === 'ok' || data.status === 'online';
    } catch (e) {
      _online = false;
    }
    _probed = true;
    notifyStatus();
    return _online;
  }

  // ── Push pending records ─────────────────────────────────────────────────
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
        if (result && result.status === 'ok') { DB.markSynced(item.visit_id); ok++; }
        else { DB.markFailed(item.visit_id); fail++; }
      } catch (e) {
        DB.markFailed(item.visit_id); fail++;
        DB.log(`✗ ${item.visit_id}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    _syncing = false; notifyStatus();
    DB.log(`Sync done — ${ok} OK, ${fail} failed`);
    return { ok, fail };
  }

  // ── Pull from Google Sheets (gviz) ───────────────────────────────────────
  async function pull(facility, mwName, onProgress) {
    const cfgs = [
      { sheet:'AN',        local:'an',  idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC' },
      { sheet:'PN',        local:'pn',  idF:'ID client',   dateF:'Date Of Registration', hcF:'Served HC' },
      { sheet:'FP',        local:'fp',  idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC' },
      { sheet:'REPORTING', local:'rpt', idF:'National ID', dateF:'Date Of Registration', hcF:'Served HC' },
    ];
    const facNorm = (facility || '').toLowerCase().trim();
    const mwNorm  = (mwName   || '').toLowerCase().replace(/\s+/g,' ').trim();
    let totalNew = 0, errors = [];

    for (let i = 0; i < cfgs.length; i++) {
      const cfg = cfgs[i];
      if (onProgress) onProgress(`Loading ${cfg.sheet}...`, i, cfgs.length);
      DB.log(`[Pull] Fetching ${cfg.sheet}...`);
      try {
        const allRows = await fetchSheet(cfg.sheet);
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
      } catch (e) {
        DB.log(`[Pull] ${cfg.sheet} error: ${e.message}`);
        errors.push(`${cfg.sheet}: ${e.message}`);
      }
    }
    DB.mirrorAll();
    DB.log(`[Pull] Done — +${totalNew} new records`);
    return { totalNew, errors };
  }

  // ── Online/offline listeners ─────────────────────────────────────────────
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

  return {
    probe, push, pull, initListeners, fetchSheet, parseGviz,
    onStatus(cb) { _onStatus = cb; },
    get online()  { return _online;  },
    set online(v) { _online = v; notifyStatus(); },
    get syncing() { return _syncing; },
    get probed()  { return _probed;  },
  };
})();
