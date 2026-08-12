/**
 * GOAT MCH v3 — db.js
 * All local storage: localStorage + IndexedDB mirror
 * Single source of truth for all data access
 */

const DB = (() => {

  const EP_KEY   = 'mch_ep';
  const USER_KEY = 'mch_user';

  // ── Safe parse ─────────────────────────────────────────────────────────
  function safe(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      if (v === null || v === undefined) return fallback;
      if (Array.isArray(fallback) && !Array.isArray(v)) return fallback;
      return v;
    } catch (e) { return fallback; }
  }

  // ── State ───────────────────────────────────────────────────────────────
  const state = {
    patients: safe('mch_pts', {}),
    an:       safe('mch_an',  []),
    pn:       safe('mch_pn',  []),
    fp:       safe('mch_fp',  []),
    rpt:      safe('mch_rpt', []),
    sq:       safe('mch_sq',  []),
    log:      safe('mch_log', []),
  };

  // ── Ensure arrays are always arrays ────────────────────────────────────
  ['an','pn','fp','rpt','sq','log'].forEach(k => {
    if (!Array.isArray(state[k])) state[k] = [];
  });
  if (typeof state.patients !== 'object' || Array.isArray(state.patients)) {
    state.patients = {};
  }

  // ── IndexedDB ───────────────────────────────────────────────────────────
  let _idb = null;

  function openIDB() {
    if (_idb) return Promise.resolve(_idb);
    return new Promise(res => {
      const req = indexedDB.open('goat-mch-v3', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('data'))   db.createObjectStore('data');
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config');
      };
      req.onsuccess = e => { _idb = e.target.result; res(_idb); };
      req.onerror   = ()  => res(null);
    });
  }

  async function idbSet(key, val) {
    const db = await openIDB();
    if (!db) return;
    return new Promise(res => {
      const tx = db.transaction('data', 'readwrite');
      tx.objectStore('data').put(val, key);
      tx.oncomplete = res; tx.onerror = res;
    });
  }

  async function idbGet(key) {
    const db = await openIDB();
    if (!db) return null;
    return new Promise(res => {
      const tx  = db.transaction('data', 'readonly');
      const req = tx.objectStore('data').get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => res(null);
    });
  }

  async function idbSetConfig(key, val) {
    const db = await openIDB();
    if (!db) return;
    return new Promise(res => {
      const tx = db.transaction('config', 'readwrite');
      tx.objectStore('config').put(val, key);
      tx.oncomplete = res; tx.onerror = res;
    });
  }

  // ── Persist to localStorage + mirror to IDB ─────────────────────────────
  let _saveCount = 0;

  function persist(key) {
    const lsKey = key === 'patients' ? 'mch_pts' : `mch_${key}`;
    const val   = key === 'patients' ? state.patients : state[key];
    try { localStorage.setItem(lsKey, JSON.stringify(val)); } catch (e) {
      console.warn('[DB] localStorage write failed:', key);
    }
    idbSet(lsKey, val).catch(() => {});
    _saveCount++;
    if (_saveCount % 10 === 0) mirrorAll();
  }

  function mirrorAll() {
    ['patients','an','pn','fp','rpt','sq'].forEach(k => {
      const lsKey = k === 'patients' ? 'mch_pts' : `mch_${k}`;
      const val   = k === 'patients' ? state.patients : state[k];
      idbSet(lsKey, val).catch(() => {});
    });
  }

  // ── Recovery from IDB ───────────────────────────────────────────────────
  async function recover() {
    const keys    = ['mch_pts','mch_an','mch_pn','mch_fp','mch_rpt','mch_sq'];
    const missing = keys.filter(k => !localStorage.getItem(k));
    if (!missing.length) return false;
    let recovered = 0;
    for (const k of missing) {
      const val = await idbGet(k);
      if (val !== null) {
        try { localStorage.setItem(k, JSON.stringify(val)); recovered++; } catch (e) {}
      }
    }
    if (recovered > 0) {
      Object.assign(state.patients, safe('mch_pts', {}));
      ['an','pn','fp','rpt','sq'].forEach(k => {
        const fresh = safe(`mch_${k}`, []);
        state[k].length = 0;
        fresh.forEach(r => state[k].push(r));
      });
      console.log(`[DB] Recovered ${recovered} stores from IDB`);
      return true;
    }
    return false;
  }

  // ── Visit ID generator ──────────────────────────────────────────────────
  function makeVID(sheet) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let r = '';
    for (let i = 0; i < 8; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return `${sheet.toUpperCase()}-${r}`;
  }

  // ── Save new record ─────────────────────────────────────────────────────
  function saveRecord(sheet, row) {
    const s   = sheet === 'REPORTING' ? 'rpt' : sheet.toLowerCase();
    const vid = row.visit_id || makeVID(sheet);
    const pid = (row['National ID'] || row['ID client'] || '').trim();

    const rec = Object.assign({}, row, {
      visit_id: vid, lady_id: pid,
      sheet: sheet.toUpperCase(),
      ts: Date.now(),
      _synced: false, _edit_count: 0,
    });

    if (!Array.isArray(state[s])) state[s] = [];
    state[s].unshift(rec);
    persist(s);
    upsertPatient(pid, rec, s);

    // Add to sync queue
    state.sq.push({
      visit_id: vid, sheet: sheet.toUpperCase(),
      row: rec, attempts: 0, synced: false, queued_at: Date.now(),
    });
    persist('sq');
    return vid;
  }

  // ── Update existing record ──────────────────────────────────────────────
  function updateRecord(sheet, vid, changes) {
    const s   = sheet === 'REPORTING' ? 'rpt' : sheet.toLowerCase();
    const idx = (state[s] || []).findIndex(r => r.visit_id === vid);
    if (idx < 0) return false;

    state[s][idx] = Object.assign({}, state[s][idx], changes, {
      visit_id: vid,
      _edit_count: (state[s][idx]._edit_count || 0) + 1,
      _edited_at: Date.now(),
      _synced: false,
    });
    persist(s);

    const sqIdx = state.sq.findIndex(r => r.visit_id === vid);
    if (sqIdx >= 0) {
      state.sq[sqIdx] = Object.assign({}, state.sq[sqIdx], {
        row: state[s][idx], synced: false, attempts: 0,
      });
    } else {
      state.sq.push({
        visit_id: vid, sheet: sheet.toUpperCase(),
        row: state[s][idx], attempts: 0, synced: false, queued_at: Date.now(),
      });
    }
    persist('sq');
    return true;
  }

  // ── Upsert patient registry ─────────────────────────────────────────────
  function upsertPatient(pid, rec, sheet) {
    if (!pid) return;
    const ex = state.patients[pid] || {};
    const mf = (k, v) => { if (v && v !== '—' && !ex[k]) ex[k] = v; };

    mf('name',    rec['Pregnant Name']||rec['Name']||rec['Client name']||rec['Client Name']);
    mf('phone',   rec['Contact Number']||rec['Contact No']);
    mf('dob',     rec['DOB']||rec['DATE OF BIRTH']);
    mf('rris',    rec['RRIS family number']||rec['RRIS']);
    mf('mhr',     rec['MHR ID رقم الامومة']||rec['MHR NO']);
    mf('refugee', rec['Refugee Status']||rec['Refugee/NotRefugee']||rec['Refguee / NonRefguee']);
    mf('husband', rec['Husband name']);
    mf('hid2',    rec['National ID - Husband']);
    mf('lmp',     rec['LMP']);
    mf('status',  rec['Status']);
    mf('last_rcurr', rec['Risk Factor CURRENT PREGNANCY']||rec['Combined Risk Factors']);
    mf('last_rprev', rec['Risk Factor PREVIOUS PREGNANCIES']);

    const s = (sheet||'').toLowerCase();
    if (s==='an')  { mf('last_an_shc', rec['Served HC']); }
    if (s==='pn')  { mf('last_pn_shc', rec['Served HC']); }
    if (s==='fp')  { mf('last_fp_shc', rec['Served HC']); mf('last_fp', rec['Family planning method']); }
    if (s==='rpt') { mf('last_rpt_org', rec['Organization']); mf('last_rpt_gov', rec['Governorates']); }

    state.patients[pid] = ex;
    persist('patients');
  }

  // ── Upsert pulled row (dedup by vid + fingerprint) ──────────────────────
  function upsertRow(row, sheet, hcField, idField, dateField) {
    const s       = sheet === 'REPORTING' ? 'rpt' : sheet.toLowerCase();
    const pid     = (row[idField] || '').trim();
    const rawDate = (row[dateField] || '').trim().slice(0, 10);
    const rawHC   = (row[hcField]  || '').trim().toLowerCase();
    if (rawDate) row[dateField] = rawDate;

    const vid = row.visit_id || `${sheet}-${pid}-${rawDate}`;
    const fp  = `${pid}|${rawDate}|${rawHC}`;

    if (!Array.isArray(state[s])) state[s] = [];

    // Check both dedup indexes
    const exists = state[s].some(r =>
      r.visit_id === vid ||
      (`${r.lady_id||r[idField]||''}|${(r[dateField]||'').slice(0,10)}|${(r[hcField]||'').toLowerCase()}` === fp)
    );
    if (exists) return false;

    const rec = Object.assign({}, row, {
      visit_id: vid, lady_id: pid, sheet: sheet.toUpperCase(),
      ts: (d => {
        if (!d) return Date.now();
        const p = d.split('-');
        return p.length === 3 ? new Date(+p[0], +p[1]-1, +p[2]).getTime() : Date.now();
      })(rawDate),
      _synced: true, _pulled: true,
    });

    state[s].unshift(rec);
    upsertPatient(pid, rec, s);
    return true;
  }

  // ── Sync queue ──────────────────────────────────────────────────────────
  function getPending()      { return (state.sq || []).filter(r => !r.synced); }
  function markSynced(vid)   {
    const i = state.sq.findIndex(r => r.visit_id === vid);
    if (i >= 0) { state.sq[i].synced = true; state.sq[i].synced_at = Date.now(); }
    ['an','pn','fp','rpt'].forEach(s => {
      const j = (state[s]||[]).findIndex(r => r.visit_id === vid);
      if (j >= 0) state[s][j]._synced = true;
    });
    persist('sq');
  }
  function markFailed(vid)   {
    const i = state.sq.findIndex(r => r.visit_id === vid);
    if (i >= 0) { state.sq[i].attempts = (state.sq[i].attempts||0)+1; }
    persist('sq');
  }

  // ── Log ─────────────────────────────────────────────────────────────────
  function log(msg) {
    const ts = new Date().toLocaleTimeString();
    state.log.unshift(`[${ts}] ${msg}`);
    if (state.log.length > 200) state.log.length = 200;
    try { localStorage.setItem('mch_log', JSON.stringify(state.log)); } catch (e) {}
  }

  // ── Config ──────────────────────────────────────────────────────────────
  function getEP()    { return (localStorage.getItem(EP_KEY) || '').trim(); }
  function setEP(ep)  {
    localStorage.setItem(EP_KEY, ep.trim());
    writeSwConfig();
  }
  function getUser()  {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; }
  }
  function setUser(u) {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    writeSwConfig();
  }

  function writeSwConfig() {
    const user = getUser();
    idbSetConfig('sw_config', {
      ep:       getEP(),
      facility: user?.facility || '',
      name:     user?.name     || '',
      ts:       Date.now(),
    }).catch(() => {});
  }

  // ── Public API ──────────────────────────────────────────────────────────
  return {
    get patients() { return state.patients; },
    get an()       { return state.an; },
    get pn()       { return state.pn; },
    get fp()       { return state.fp; },
    get rpt()      { return state.rpt; },
    get sq()       { return state.sq; },
    get log()      { return state.log; },
    sheet(s)       { return state[s === 'rpt' ? 'rpt' : s.toLowerCase()] || []; },

    saveRecord, updateRecord, upsertPatient, upsertRow,
    getPending, markSynced, markFailed,
    persist, mirrorAll, recover, makeVID,
    log, getEP, setEP, getUser, setUser, writeSwConfig,
    idbGet, idbSet,
  };
})();
