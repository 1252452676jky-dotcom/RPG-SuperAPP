// game/game-cloud.js — syncs Monster Lab to users/{uid}/game/main (per-entry merge)
import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let app;
try { app = getApp(); } catch (e) { console.warn('game-cloud: Firebase not initialised, game stays local'); }

if (app && window.Gacha) {
  const auth = getAuth(app), db = getFirestore(app);
  const SK = 'ml.sync.v1', DEV = localStorage.getItem('rpg_device') || 'dev';
  const now = () => Date.now() + (+localStorage.getItem('rpg_clock_skew') || 0);
  const hash = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(36); };
  let M = JSON.parse(localStorage.getItem(SK) || 'null');            // { h: hashes, t: stamps, d: deletions }

  const SLOTS = ['team', 'run', 'runB', 'meta'];
  const units = s => {
    const u = {};
    Object.entries(s.box || {}).forEach(([k, v]) => u['box:' + k] = v);
    Object.entries(s.overrides || {}).forEach(([k, v]) => u['ov:' + k] = v);
    SLOTS.forEach(k => { if (s[k] != null) u[k] = s[k]; });
    return u;
  };
  const sig = s => JSON.stringify(units(s));

  function stamp(s, silent) {
    const first = !M; if (first) M = { h: {}, t: {}, d: {} }; silent = silent || first;
    const t = now(), u = units(s), seen = {};
    for (const k in u) { seen[k] = 1; const v = hash(JSON.stringify(u[k])); if (M.h[k] !== v) { M.h[k] = v; M.t[k] = silent ? (M.t[k] || 1) : t; } }
    for (const k in M.h) if (!seen[k]) { delete M.h[k]; delete M.t[k]; if (!silent) M.d[k] = t; }
    const old = t - 60 * 864e5; for (const k in M.d) if (M.d[k] < old) delete M.d[k];
    localStorage.setItem(SK, JSON.stringify(M));
  }

  function merge(L, R, Rs) {
    const lu = units(L), ru = units(R), rt = (Rs && Rs.t) || {}, d = Object.assign({}, (Rs && Rs.d) || {});
    for (const k in M.d) d[k] = Math.max(d[k] || 0, M.d[k]);
    const out = Object.assign({}, L, { box: {}, overrides: {} });
    SLOTS.forEach(k => delete out[k]);
    new Set([...Object.keys(lu), ...Object.keys(ru)]).forEach(k => {
      const a = M.t[k] || 0, b = rt[k] || 0, useL = (k in lu) && (!(k in ru) || a >= b);
      const v = useL ? lu[k] : ru[k], tt = useL ? a : b;
      if ((d[k] || 0) >= tt) return;                                  // deleted after this version
      if (k.startsWith('box:')) out.box[k.slice(4)] = v;
      else if (k.startsWith('ov:')) out.overrides[k.slice(3)] = v;
      else out[k] = v;
    });
    SLOTS.forEach(k => { if (!(k in out)) out[k] = k === 'team' ? [] : null; });
    M.d = d;
    return out;
  }
  function adopt(m) { m.updatedAt = Date.now(); Gacha.importState(m); stamp(Gacha.exportState(), true); }

  let ref = null, timer = null, lastPushed = '', unsub = null, pushing = false, again = false;
  async function push() {
    if (!ref) return;
    if (pushing) { again = true; return; }
    pushing = true;
    try {
      let s = Gacha.exportState(); stamp(s, false);
      const snap = await getDoc(ref), r = snap.exists() ? snap.data() : null;
      if (r && r.state) { const m = merge(s, r.state, r.sync); if (sig(m) !== sig(s)) { adopt(m); s = Gacha.exportState(); } }
      const key = sig(s);
      if (key === lastPushed) return;
      if (key.length > 700000) toast(`Monster Lab save is ${Math.round(key.length / 1024)} KB (limit 1024 KB) — export overrides to the repo`, 'err');
      await setDoc(ref, { state: s, sync: { t: M.t, d: M.d }, updatedAt: serverTimestamp(), by: DEV });
      lastPushed = key;
    } catch (err) { console.warn('game push failed', err); toast('Monster Lab cloud save failed: ' + err.message, 'err'); }
    finally { pushing = false; if (again) { again = false; window.cloudGamePush(); } }
  }
  window.cloudGamePush = () => { clearTimeout(timer); timer = setTimeout(push, 3000); };
  window.addEventListener('pagehide', () => { if (timer) push(); });

  onAuthStateChanged(auth, async user => {
    if (unsub) { unsub(); unsub = null; }
    ref = user ? doc(db, 'users', user.uid, 'game', 'main') : null;
    if (!ref) return;
    try {
      await push();
      unsub = onSnapshot(ref, d => {
        if (d.metadata.hasPendingWrites) return;
        const r = d.data(); if (!r || !r.state) return;
        const s = Gacha.exportState(); stamp(s, false);
        const m = merge(s, r.state, r.sync);
        if (sig(m) === sig(s)) return;
        adopt(m);
        if (r.by !== DEV) toast('Monster Lab updated from another device', 'info');
        if (sig(m) !== sig(r.state)) window.cloudGamePush();
      });
    } catch (err) { console.warn('game sync unavailable, staying local', err); }
  });
}
