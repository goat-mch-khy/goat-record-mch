/**
 * GOAT MCH v3 — crypto.js
 * AES-GCM 256-bit encryption for .goat backup files
 * GOAT header = device key, GOAS header = shared supervisor key
 */

const CRYPTO = (() => {

  const SHARED_KEY = 'GOAT-MCH-SHARED-UNRWA-KHY-2026-RESTORE-KEY';
  const DEVICE_KEY = 'GOAT-MCH-UNRWA-KHY-2026-SECURE';
  const SALT       = new TextEncoder().encode('GOAT-MCH-SALT-V1');
  const MAGIC_DEV  = new Uint8Array([0x47, 0x4F, 0x41, 0x54]); // GOAT
  const MAGIC_SHR  = new Uint8Array([0x47, 0x4F, 0x41, 0x53]); // GOAS

  function getInstallId() {
    let id = localStorage.getItem('_goat_iid');
    if (!id) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      id = Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('_goat_iid', id);
    }
    return id;
  }

  async function deriveKey(seed) {
    const raw = new TextEncoder().encode(seed);
    const km  = await crypto.subtle.importKey('raw', raw, { name: 'PBKDF2' }, false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: SALT, iterations: 100000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function deviceKey()  { return deriveKey(DEVICE_KEY + getInstallId()); }
  async function sharedKey()  { return deriveKey(SHARED_KEY); }

  async function encrypt(data, useShared = false) {
    const key    = useShared ? await sharedKey() : await deviceKey();
    const magic  = useShared ? MAGIC_SHR : MAGIC_DEV;
    const iv     = crypto.getRandomValues(new Uint8Array(12));
    const plain  = new TextEncoder().encode(JSON.stringify(data));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const result = new Uint8Array(4 + 12 + cipher.byteLength);
    result.set(magic, 0); result.set(iv, 4);
    result.set(new Uint8Array(cipher), 16);
    return result;
  }

  async function decrypt(bytes) {
    const h = bytes.slice(0, 4);
    let key;
    if (h[0]===0x47 && h[1]===0x4F && h[2]===0x41 && h[3]===0x54) {
      key = await deviceKey();
    } else if (h[0]===0x47 && h[1]===0x4F && h[2]===0x41 && h[3]===0x53) {
      key = await sharedKey();
    } else {
      throw new Error('Not a valid GOAT MCH backup file');
    }
    const iv     = bytes.slice(4, 16);
    const cipher = bytes.slice(16);
    const plain  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function exportBackup(useShared = false) {
    const user = DB.getUser();
    const payload = {
      version: 3, exported: new Date().toISOString(),
      facility: user?.facility || '', user: user?.name || '',
      patients: DB.patients,
      an: DB.an, pn: DB.pn, fp: DB.fp, rpt: DB.rpt, sq: DB.sq,
    };
    const encrypted = await encrypt(payload, useShared);
    const blob = new Blob([encrypted], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fac  = (user?.facility || 'MCH').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12);
    a.href = url; a.download = `goat_${fac}_${date}.goat`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    const total = DB.an.length + DB.pn.length + DB.fp.length + DB.rpt.length;
    DB.log(`Exported ${total} records (${useShared ? 'shared' : 'device'} key)`);
    return total;
  }

  async function importBackup(file) {
    const bytes = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(new Uint8Array(e.target.result));
      r.onerror = () => rej(new Error('Could not read file'));
      r.readAsArrayBuffer(file);
    });
    const payload = await decrypt(bytes);
    if (!payload?.version) throw new Error('Invalid or corrupted backup');
    let newPts = 0, newRecs = 0;

    if (payload.patients) {
      Object.entries(payload.patients).forEach(([id, p]) => {
        if (!DB.patients[id]) { DB.patients[id] = p; newPts++; }
      });
    }
    for (const s of ['an','pn','fp','rpt']) {
      if (!Array.isArray(payload[s])) continue;
      const existing = new Set(DB.sheet(s).map(r => r.visit_id).filter(Boolean));
      payload[s].forEach(r => {
        if (!r.visit_id || existing.has(r.visit_id)) return;
        r._imported = true; r._pulled = true;
        DB.sheet(s).unshift(r); newRecs++;
      });
    }
    ['an','pn','fp','rpt','patients'].forEach(k => DB.persist(k));
    DB.mirrorAll();
    DB.log(`Imported .goat: +${newRecs} records, +${newPts} patients`);
    return { records: newRecs, patients: newPts };
  }

  return { encrypt, decrypt, exportBackup, importBackup, getInstallId };
})();
