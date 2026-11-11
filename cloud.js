import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot, serverTimestamp, runTransaction }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBRAIYyJDt9_eny-ctrRJsCTuOgwVo2zGM",
  authDomain: "rpg-superapp-5404c.firebaseapp.com",
  projectId: "rpg-superapp-5404c",
  storageBucket: "rpg-superapp-5404c.firebasestorage.app",
  messagingSenderId: "897127607194",
  appId: "1:897127607194:web:faf2c81b7081b7606da823"
};
const OWNER_UID = 'vAGFgPIuNPUQ0HUCo1H7bCieCGt1';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ===== Level-1 sync: per-item _t, per-list order time _ot, deletion markers, atomic merge ===== */
const COLS = ['party','quests','trainings','shop','categories','checklists','events'];
const SKEW = 'rpg_clock_skew';
localStorage.removeItem('rpg_item_hash_v1');   // old cache shared by all tabs: let a stale tab overwrite newer edits
if (!localStorage.getItem('rpg_device')) localStorage.setItem('rpg_device', Math.random().toString(36).slice(2));
const DEV = localStorage.getItem('rpg_device');
window.cloudDeviceId = DEV;                    // app.js reward ledger stamps grants with this id
const now = () => Date.now() + (+localStorage.getItem(SKEW) || 0);           // server-corrected clock
const hash = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(36); };
const bare = o => { const c = Object.assign({}, o); delete c._t; return JSON.stringify(c); };
const clone = o => JSON.parse(JSON.stringify(o));
const idsOf = list => (list || []).filter(x => x && x.id).map(x => x.id);
let H = null;          // THIS tab's memory of each item / list order (kept per tab on purpose)
let pending = false;   // local changes the cloud hasn't confirmed yet

/* timestamp anything that changed since last look; returns true if something did */
function stamp(silent) {
  const first = !H; if (first) H = {}; silent = silent || first;
  const t = now(), seen = {}; let changed = false, mod = false;
  if (!appState._del) { appState._del = {}; mod = true; }
  if (!appState._ot)  { appState._ot = {};  mod = true; }
  COLS.forEach(k => {
    const list = appState[k] || [];
    list.forEach(it => {
      if (!it || !it.id) return;
      const key = k + ':' + it.id, v = hash(bare(it)); seen[key] = 1;
      if (H[key] === v) return;
      H[key] = v;
      if (!silent) { it._t = t; changed = mod = true; }
      else if (!it._t) { it._t = 1; mod = true; }
    });
    const ov = hash(idsOf(list).join(','));                                    // list ORDER is data too
    if (H['#' + k] !== ov) { H['#' + k] = ov; if (!silent) { appState._ot[k] = t; changed = mod = true; } }
  });
  Object.keys(H).forEach(key => {
    if (key[0] === '$' || key[0] === '#' || seen[key]) return;
    delete H[key]; if (!silent) { appState._del[key] = t; changed = mod = true; }
  });
  const sv = hash(JSON.stringify([appState.gems, appState.settings, appState.streakBonus]));
  if (H.$s !== sv) { H.$s = sv; if (!silent) { appState._sT = t; changed = mod = true; } }
  const old = t - 60 * 864e5;
  for (const k in appState._del) if (appState._del[k] < old) { delete appState._del[k]; mod = true; }
  if (mod) localStorage.setItem(LS_KEY, JSON.stringify(appState));
  if (changed) pending = true;
  return changed;
}

/* order: the side that reordered last wins; items only the other side has keep their neighbour */
function arrange(items, winList, loseList) {
  const order = idsOf(winList), lose = idsOf(loseList), placed = new Set(order);
  lose.forEach((id, i) => {
    if (placed.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const p = order.indexOf(lose[j]); if (p !== -1) { at = p + 1; break; } }
    order.splice(at, 0, id); placed.add(id);
  });
  const pos = new Map(order.map((id, i) => [id, i]));
  const P = x => (x && x.id && pos.has(x.id) ? pos.get(x.id) : 1e9);
  return items.slice().sort((a, b) => P(a) - P(b));
}

/* L = this device, R = cloud (or another tab). Ties go to R so every device converges. */
function merge(L, R) {
  const out = Object.assign({}, L), del = Object.assign({}, R._del || {});
  for (const k in (L._del || {})) del[k] = Math.max(del[k] || 0, L._del[k]);
  out._del = del;
  const lo = L._ot || {}, ro = R._ot || {};
  out._ot = {};
  COLS.forEach(k => {
    const rm = new Map((R[k] || []).filter(x => x && x.id).map(x => [x.id, x])), res = [];
    (L[k] || []).forEach(x => {
      const r = x && rm.get(x.id); if (r) rm.delete(x.id);
      res.push(r && (r._t || 0) >= (x._t || 0) ? r : x);
    });
    rm.forEach(r => res.push(r));
    const alive = res.filter(x => !x || !x.id || !((del[k + ':' + x.id] || 0) >= (x._t || 0)));
    const rWins = (ro[k] || 0) >= (lo[k] || 0);
    out[k] = arrange(alive, rWins ? R[k] : L[k], rWins ? L[k] : R[k]);
    out._ot[k] = Math.max(lo[k] || 0, ro[k] || 0);
  });
  if ((R._sT || 0) >= (L._sT || 0)) { out.gems = R.gems; out.settings = R.settings; out.streakBonus = R.streakBonus; out._sT = R._sT; }
  out.grants = Object.assign({}, L.grants || {});                              // reward ledger: union, never lose a grant record
  for (const gk in (R.grants || {})) { const a = out.grants[gk], b = R.grants[gk]; if (!a || (b && (b.t || 0) > (a.t || 0))) out.grants[gk] = b; }
  out.activeTab = L.activeTab;
  return out;
}
const sig = s => { const c = Object.assign({}, s); delete c.activeTab; delete c.updatedAt; return JSON.stringify(c); };
function adopt(s) { applyCloudState(s); stamp(true); }

let docRef = null, pushTimer = null, pushing = false, again = false, lastPushAt = 0;

const statusEl = document.getElementById('syncStatus');
const msgEl    = document.getElementById('authMsg');
const setStatus = (icon, cls, title) => {
  if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-${icon} ${cls}" title="${title}"></i>`;
};

/* read + merge + write as ONE transaction: a write from another device in between makes it retry */
async function push() {
  pushTimer = null;
  if (!docRef) return;
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    stamp(false);
    pending = false;
    let merged = null, wrote = false;
    setStatus('cloud-arrow-up', 'text-amber-300', 'Saving…');
    lastPushAt = Date.now();
    await runTransaction(db, async tx => {
      const snap = await tx.get(docRef);
      const remote = snap.exists() && snap.data().state ? migrate(clone(snap.data().state)) : null;
      merged = remote ? merge(snapshotState(), remote) : snapshotState();
      wrote = !remote || sig(merged) !== sig(remote);
      if (!wrote) return;                                                    // cloud already has everything
      const state = Object.assign({}, merged); delete state.activeTab;
      tx.set(docRef, { state, updatedAt: serverTimestamp(), by: DEV });
    });
    if (!wrote) lastPushAt = 0;
    if (merged && sig(merged) !== sig(appState)) adopt(merged);
    if (wrote) {
      const kb = Math.round(JSON.stringify(merged).length / 1024);
      if (kb > 700) toast(`Cloud save is ${kb} KB — the limit is 1024 KB`, 'err');
    }
    setStatus('cloud', 'text-emerald-400', 'Synced');
  } catch (err) {
    pending = true;
    console.error('cloud push failed', err);
    setStatus('triangle-exclamation', 'text-rose-400', 'Sync failed — retrying');
    if (navigator.onLine) toast('Cloud save failed: ' + err.message, 'err');
    setTimeout(() => window.cloudQueuePush(true), 20000);
  } finally {
    pushing = false;
    if (again) { again = false; window.cloudQueuePush(true); }
  }
}
/* save() calls this on every change: timestamp NOW, upload 1.5 s later (only if something changed) */
window.cloudQueuePush = force => {
  stamp(false);
  if (!docRef || (!pending && force !== true)) return;
  clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500);
};
window.cloudSignOut = () => signOut(auth).then(() => location.reload());
window.addEventListener('pagehide', () => { if (pushTimer) push(); });
window.addEventListener('online', () => window.cloudQueuePush(true));
document.addEventListener('visibilitychange', () => {                       // tablet/phone waking up: re-check the cloud
  if (document.visibilityState === 'visible') window.cloudQueuePush(true);
});
/* other tabs on this device (index.html + game.html share the habit data) */
window.addEventListener('storage', e => {
  if (e.key !== LS_KEY || !e.newValue || !docRef) return;
  let other; try { other = migrate(JSON.parse(e.newValue)); } catch (_) { return; }
  stamp(false);
  const m = merge(snapshotState(), other);
  if (sig(m) !== sig(appState)) adopt(m);
});

document.getElementById('signInBtn').addEventListener('click', async () => {
  msgEl.textContent = '';
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { console.error(err); msgEl.textContent = err.code || err.message; }
});

onAuthStateChanged(auth, async user => {
  if (!user) { setStatus('cloud-arrow-down', 'text-slate-500', 'Not signed in'); return; }
  if (OWNER_UID && user.uid !== OWNER_UID) {
    msgEl.textContent = 'This app is private. Your UID: ' + user.uid;
    await signOut(auth); return;
  }
  docRef = doc(db, 'users', user.uid);
  setStatus('cloud-arrow-down', 'text-amber-300', 'Loading…');
  try {
    stamp(false);
    const snap = await getDoc(docRef);
    const remote = snap.exists() && snap.data().state;
    if (remote) adopt(merge(snapshotState(), migrate(clone(remote)))); else bootApp();
    await push();
  } catch (err) {
    console.error('initial sync failed', err);
    toast('Could not reach the cloud — working locally', 'err');
    setStatus('triangle-exclamation', 'text-rose-400', 'Offline');
    bootApp();
  }

  onSnapshot(docRef, s => {
    if (!s.exists() || s.metadata.hasPendingWrites) return;
    const d = s.data();
    if (d.by === DEV && d.updatedAt && lastPushAt) {                         // measure clock offset vs server
      localStorage.setItem(SKEW, String(d.updatedAt.toMillis() - lastPushAt)); lastPushAt = 0;
    }
    if (!d.state) return;
    stamp(false);
    const remote = migrate(clone(d.state));
    const m = merge(snapshotState(), remote);
    if (sig(m) !== sig(appState)) {
      adopt(m);
      if (d.by !== DEV) toast('Updated from another device', 'info');
    }
    if (sig(m) !== sig(remote)) window.cloudQueuePush(true);                 // we have newer things the cloud lacks
  }, err => {
    console.error('listener failed', err);
    setStatus('triangle-exclamation', 'text-rose-400', 'Sync offline');
  });
});
