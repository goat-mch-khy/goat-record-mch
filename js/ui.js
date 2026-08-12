/**
 * GOAT MCH v3 — ui.js
 * DOM helpers, navigation, notifications, dropdowns, date utils
 */

const UI = (() => {

  // ── DOM ─────────────────────────────────────────────────────────────────
  const g   = id => document.getElementById(id);
  const gv  = id => { const e = g(id); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };
  const sv  = (id, v) => { const e = g(id); if (e && v !== undefined && v !== null) e.value = v; };
  const se  = (id, v) => { const e = g(id); if (e) e.textContent = v; };
  const show = (id, cls = 'show') => g(id)?.classList.add(cls);
  const hide = (id, cls = 'show') => g(id)?.classList.remove(cls);

  function setOpt(id, val) {
    const el = g(id);
    if (!el || !val) return;
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].value === val || el.options[i].text === val) {
        el.selectedIndex = i; return;
      }
    }
  }

  function getMulti(id) {
    const el = g(id);
    if (!el) return [];
    return Array.from(el.selectedOptions).map(o => o.value).filter(Boolean);
  }

  function setMulti(id, vals) {
    const el = g(id);
    if (!el || !Array.isArray(vals)) return;
    for (let i = 0; i < el.options.length; i++) {
      el.options[i].selected = vals.includes(el.options[i].value);
    }
  }

  // ── Notification toast ──────────────────────────────────────────────────
  let _toastTimer = null;
  function notify(msg, type = '') {
    let el = g('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--gd);color:#fff;padding:10px 20px;border-radius:20px;font-size:12px;font-weight:700;box-shadow:0 4px 20px rgba(13,115,119,.3);opacity:0;transition:all .3s;z-index:9999;pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = type === 'err' ? '#c62828' : 'var(--gd)';
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
    }, 3000);
  }

  // ── Tab navigation ──────────────────────────────────────────────────────
  const TABS = ['home','an','pn','fp','rpt','appts','pts','sync'];
  let _tab = 'home';

  function goTab(t) {
    if (!TABS.includes(t)) return;
    _tab = t;
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('act', p.id === `p-${t}`));
    document.querySelectorAll('.tb').forEach(b => b.classList.toggle('act', b.dataset.tab === t));
    if (['an','pn','fp','rpt'].includes(t)) applyDefaults(t);
  }

  // ── Status bar ──────────────────────────────────────────────────────────
  function updateBar(status) {
    const { online, syncing, probed } = status;
    const pending = DB.getPending().length;
    const dot = g('sdot'), txt = g('stxt');
    const chip = g('cnchip'), qchip = g('qchip'), sbtn = g('sync-now-btn');

    if (syncing) {
      if (dot)  dot.className  = 'sd sy';
      if (txt)  txt.textContent = `Syncing ${pending} record(s)...`;
    } else if (online) {
      if (dot)  dot.className  = 'sd on';
      if (txt)  txt.textContent = DB.getEP() ? 'Online — synced' : 'Online — no endpoint';
    } else {
      if (dot)  dot.className  = 'sd off';
      if (txt)  txt.textContent = probed ? 'Offline — saved locally' : 'Checking...';
    }

    if (chip)  { chip.textContent = online ? 'Online' : 'Offline'; chip.className = `chip ${online ? 'on' : 'off'}`; }
    if (qchip) { qchip.style.display = pending ? 'inline-block' : 'none'; qchip.textContent = `${pending} pending`; }
    if (sbtn)  { sbtn.style.display  = pending && DB.getEP() ? 'flex' : 'none'; }
  }

  // ── Apply defaults to form ──────────────────────────────────────────────
  function applyDefaults(s) {
    const user  = DB.getUser();
    const today = new Date().toISOString().slice(0, 10);
    const dateEl = g(`${s}-date`);
    if (dateEl && !dateEl.value) dateEl.value = today;
    if (!user) return;
    const mwEl = g(`${s}-mw`);
    if (mwEl && !mwEl.value) mwEl.value = user.name || '';
    const shcEl = g(`${s}-shc`);
    if (shcEl && !shcEl.value && user.facility) setOpt(`${s}-shc`, user.facility);
    if (s === 'rpt') { const ge = g('rpt-gender'); if (ge && !ge.value) ge.value = 'Female'; }
  }

  // ── Clear form ──────────────────────────────────────────────────────────
  function clearForm(s) {
    document.querySelectorAll(`[id^="${s}-"]`).forEach(el => {
      if (el.readOnly || el.disabled) return;
      if (el.tagName === 'SELECT' && el.multiple) {
        Array.from(el.options).forEach(o => o.selected = false);
      } else if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        el.value = '';
      }
    });
    [`${s}-found`,`${s}-new`,`${s}-edit`,`${s}-hrp`].forEach(id => {
      g(id)?.classList.remove('show');
    });
    const clinEl = g(`${s}-clin`);   if (clinEl) clinEl.innerHTML = '';
    const tlEl   = g(`${s}-timeline`); if (tlEl)   tlEl.innerHTML   = '';
    const vidEl  = g(`${s}-vid`);    if (vidEl)  vidEl.textContent = '—';
    applyDefaults(s);
  }

  // ── Populate all dropdowns ──────────────────────────────────────────────
  function populateDropdowns() {
    const allFacs = CONFIG.ALL_FACS;

    // Facility selects
    ['an-shc','an-ohc','pn-shc','pn-ohc','fp-shc','fp-ohc','rpt-shc',
     'set-fac','su-fac'].forEach(id => {
      const el = g(id);
      if (!el) return;
      el.innerHTML = '<option value="">Select facility...</option>';
      allFacs.forEach(f => el.innerHTML += `<option>${f}</option>`);
    });

    // Standard dropdowns
    const map = {
      'an-case':    CONFIG.OPTS.caseType,    'an-refugee': CONFIG.OPTS.refugee,
      'an-status':  CONFIG.OPTS.status,      'an-pres':    CONFIG.OPTS.presentation,
      'an-oedema':  CONFIG.OPTS.oedema,      'an-gbv':     CONFIG.OPTS.gbv,
      'an-sti':     CONFIG.OPTS.sti,         'an-dis':     CONFIG.OPTS.disability,
      'an-cs':      CONFIG.OPTS.caseStatus,
      'an-def-calls':  CONFIG.OPTS.defCalls, 'an-def-reason': CONFIG.OPTS.defReason,
      'pn-case':    CONFIG.OPTS.caseType,    'pn-refugee': CONFIG.OPTS.refugee,
      'pn-status':  CONFIG.OPTS.status,      'pn-place':   CONFIG.OPTS.delivPlace,
      'pn-type':    CONFIG.OPTS.delivType,   'pn-by':      CONFIG.OPTS.delivBy,
      'pn-twin':    CONFIG.OPTS.yn,          'pn-sex1':    CONFIG.OPTS.gender,
      'pn-sex2':    CONFIG.OPTS.gender,      'pn-sti':     CONFIG.OPTS.sti,
      'pn-dis':     CONFIG.OPTS.disability,  'pn-gbv':     CONFIG.OPTS.gbv,
      'fp-case':    CONFIG.OPTS.caseType,    'fp-refugee': CONFIG.OPTS.refugee,
      'fp-status':  CONFIG.OPTS.status,      'fp-method':  CONFIG.OPTS.fpMethod,
      'fp-lam':     CONFIG.OPTS.lam,         'fp-dis':     CONFIG.OPTS.disability,
      'fp-sti':     CONFIG.OPTS.sti,         'fp-mhpss':   CONFIG.OPTS.yn,
      'fp-gbv':     CONFIG.OPTS.gbv,
      'rpt-org':    CONFIG.OPTS.org,         'rpt-gov':    CONFIG.OPTS.gov,
      'rpt-month':  CONFIG.OPTS.month,       'rpt-gender': CONFIG.OPTS.gender,
      'rpt-rn':     CONFIG.OPTS.rn,          'rpt-pwd':    CONFIG.OPTS.yn,
      'set-role':   ['Midwife','Doctor','Nurse','Health Educator','Supervisor','Other'],
      'su-role':    ['Midwife','Doctor','Nurse','Health Educator','Supervisor','Other'],
    };

    Object.entries(map).forEach(([id, vals]) => {
      const el = g(id);
      if (!el) return;
      const cur = el.value;
      el.innerHTML = '<option value="">Select...</option>';
      vals.forEach(v => el.innerHTML += `<option>${v}</option>`);
      if (cur) setOpt(id, cur);
    });

    // Multi-selects
    const multiMap = {
      'an-rcurr': CONFIG.OPTS.riskCurr,
      'an-rprev': CONFIG.OPTS.riskPrev,
      'rpt-svc':  CONFIG.OPTS.services,
    };
    Object.entries(multiMap).forEach(([id, vals]) => {
      const el = g(id);
      if (!el) return;
      el.innerHTML = vals.map(v => `<option value="${v}">${v}</option>`).join('');
    });
  }

  // ── Date utilities ──────────────────────────────────────────────────────
  function normDate(v) {
    if (!v) return '';
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    return '';
  }

  function fmtDate(raw) {
    const s = normDate(raw);
    if (!s) return '—';
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const p  = s.split('-');
    return p.length === 3 ? `${p[2]} ${mo[+p[1]-1]} ${p[0]}` : s;
  }

  function calcEDD() {
    const lmpEl = g('an-lmp');
    if (!lmpEl?.value) return;
    const lmp = new Date(lmpEl.value);
    if (isNaN(lmp)) return;
    lmp.setDate(lmp.getDate() + 280);
    const eddEl = g('an-edd');
    if (eddEl) eddEl.value = lmp.toISOString().slice(0, 10);
    calcGA();
  }

  function calcGA() {
    const lmpEl = g('an-lmp');
    if (!lmpEl?.value) return;
    const [y, m, d] = lmpEl.value.split('-').map(Number);
    const lmp  = new Date(y, m-1, d);
    const diff = Math.floor((Date.now() - lmp) / 86400000);
    if (diff < 0) return;
    const weeks = Math.floor(diff / 7), days = diff % 7;
    const gaEl = g('an-ga');
    if (gaEl) gaEl.value = `${weeks}+${days}`;
    const trimEl = g('an-trim');
    if (trimEl) trimEl.textContent = weeks < 14 ? '1st trimester' : weeks < 28 ? '2nd trimester' : '3rd trimester';
  }

  function calcBMI() {
    const wt = parseFloat(gv('an-wt')), ht = parseFloat(gv('an-ht'));
    const el = g('an-bmi');
    if (el && wt && ht) el.value = (wt / ((ht / 100) ** 2)).toFixed(1);
  }

  function calcRisk() {
    const curr = getMulti('an-rcurr'), prev = getMulti('an-rprev');
    const all  = [...curr, ...prev];
    let score  = all.length === 0 ? 'NP — Normal' : all.length <= 2 ? 'AP — At Risk' : 'HRP — High Risk';
    const re = g('an-risk'), de = g('an-riskdetail');
    if (re) re.value = score;
    if (de) de.value = all.join(' | ');
  }

  function calcAge(dob) {
    if (!dob) return '';
    const d = new Date(normDate(dob));
    if (isNaN(d)) return '';
    return Math.floor((Date.now() - d) / (365.25 * 86400000));
  }

  function showMUAC(inputId, barId) {
    const val = parseFloat(gv(inputId));
    const bar = g(barId);
    if (!bar || isNaN(val)) return;
    if (val >= 230)       { bar.style.background = '#4caf50'; bar.style.width = '100%'; }
    else if (val >= 210)  { bar.style.background = '#ff9800'; bar.style.width = `${((val-210)/20)*50+50}%`; }
    else                  { bar.style.background = '#f44336'; bar.style.width = `${Math.max(10,(val-150)/60*50)}%`; }
  }

  function caseStatusChange() {
    const cs = gv('an-cs');
    const defDiv = g('an-def-details');
    const clsDiv = g('an-close-details');
    if (defDiv) defDiv.style.display = cs === 'Defaulter' ? 'block' : 'none';
    if (clsDiv) clsDiv.style.display = cs?.includes('Closed') ? 'block' : 'none';
  }

  // ── Change facility modal ───────────────────────────────────────────────
  function showChangeFacility() {
    const current = DB.getUser()?.facility || '—';
    g('cf-modal-current').textContent = current;
    const sel = g('cf-modal-sel');
    if (sel) {
      sel.innerHTML = '<option value="">— select —</option>';
      CONFIG.ALL_FACS.forEach(f => sel.innerHTML += `<option>${f}</option>`);
    }
    g('cf-modal').style.display = 'flex';
  }

  function confirmFacilityChange() {
    const val = gv('cf-modal-sel');
    if (!val) { notify('Please select a facility', 'err'); return; }
    const user = DB.getUser() || {};
    const old  = user.facility || '—';
    user.facility = val;
    DB.setUser(user);
    g('cf-modal').style.display = 'none';
    notify(`Facility: ${old} → ${val}`);
    DB.log(`Facility changed to: ${val}`);
    // Update all form HC fields
    ['an','pn','fp','rpt'].forEach(s => setOpt(`${s}-shc`, val));
    const pfn = g('pull-fac-name'); if (pfn) pfn.textContent = val;
  }

  // ── Public ──────────────────────────────────────────────────────────────
  return {
    g, gv, sv, se, show, hide, setOpt, getMulti, setMulti,
    notify, goTab, updateBar, applyDefaults, clearForm,
    populateDropdowns, normDate, fmtDate,
    calcEDD, calcGA, calcBMI, calcRisk, calcAge, showMUAC,
    caseStatusChange, showChangeFacility, confirmFacilityChange,
    get tab() { return _tab; },
  };
})();

// Global aliases for inline HTML handlers
const g          = UI.g;
const gv         = UI.gv;
const notify     = (m, t) => UI.notify(m, t);
const goTab      = t => UI.goTab(t);
const calcEDD    = () => UI.calcEDD();
const calcGA     = () => UI.calcGA();
const calcBMI    = () => UI.calcBMI();
const calcRisk   = () => UI.calcRisk();
const fmtDate    = v => UI.fmtDate(v);
