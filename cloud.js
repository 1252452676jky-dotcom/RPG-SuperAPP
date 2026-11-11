import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBRAIYyJDt9_eny-ctrRJsCTuOgwVo2zGM",
  authDomain: "rpg-superapp-5404c.firebaseapp.com",
  projectId: "rpg-superapp-5404c",
  storageBucket: "rpg-superapp-5404c.firebasestorage.app",
  messagingSenderId: "897127607194",
  appId: "1:897127607194:web:faf2c81b7081b7606da823"
};
const OWNER_UID = 'vAGFgPIuNPUQ0HUCo1H7bCieCGt1';            // paste your UID from Firebase → Authentication → Users

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ===== Level-1 sync: per-item _t, item-by-item merge, deletion markers ===== */
const COLS = ['party','quests','trainings','shop','categories','checklists','events'];
const HKEY = 'rpg_item_hash_v1', SKEW = 'rpg_clock_skew';
if (!localStorage.getItem('rpg_device')) localStorage.setItem('rpg_device', Math.random().toString(36).slice(2));
const DEV = localStorage.getItem('rpg_device');
const now = () => Date.now() + (+localStorage.getItem(SKEW) || 0);           // server-corrected clock
const hash = s => { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(36); };
const bare = o => { const c = Object.assign({}, o); delete c._t; return JSON.stringify(c); };
const clone = o => JSON.parse(JSON.stringify(o));
let H = JSON.parse(localStorage.getItem(HKEY) || 'null');

/* give every changed item a fresh _t; record deletions */
function stamp(silent) {
  const first = !H; if (first) H = {}; silent = silent || first;
  const t = now(), seen = {};
  appState._del = appState._del || {};
  COLS.forEach(k => (appState[k] || []).forEach(it => {
    if (!it || !it.id) return;
    const key = k + ':' + it.id, v = hash(bare(it)); seen[key] = 1;
    if (H[key] !== v) { H[key] = v; it._t = silent ? (it._t || 1) : t; }
  }));
  Object.keys(H).forEach(key => {
    if (key[0] === '$' || seen[key]) return;
    delete H[key]; if (!silent) appState._del[key] = t;
  });
  const sv = hash(JSON.stringify([appState.gems, appState.settings, appState.streakBonus]));
  if (H.$s !== sv) { H.$s = sv; if (!silent) appState._sT = t; }
  const old = t - 60 * 864e5;
  for (const k in appState._del) if (appState._del[k] < old) delete appState._del[k];
  localStorage.setItem(HKEY, JSON.stringify(H));
  localStorage.setItem(LS_KEY, JSON.stringify(appState));
}

function merge(L, R) {
  const out = Object.assign({}, L), del = Object.assign({}, R._del || {});
  for (const k in (L._del || {})) del[k] = Math.max(del[k] || 0, L._del[k]);
  out._del = del;
  COLS.forEach(k => {
    const rm = new Map((R[k] || []).filter(x => x && x.id).map(x => [x.id, x])), res = [];
    (L[k] || []).forEach(x => {
      const r = x && rm.get(x.id); if (r) rm.delete(x.id);
      res.push(r && (r._t || 0) > (x._t || 0) ? r : x);
    });
    rm.forEach(r => res.push(r));                                  // items only the other device has
    out[k] = res.filter(x => !x || !x.id || !((del[k + ':' + x.id] || 0) >= (x._t || 0)));
  });
  if ((R._sT || 0) > (L._sT || 0)) { out.gems = R.gems; out.settings = R.settings; out.streakBonus = R.streakBonus; out._sT = R._sT; }
  out.activeTab = L.activeTab;
  return out;
}
const sig = s => { const c = Object.assign({}, s); delete c.activeTab; delete c.updatedAt; return JSON.stringify(c); };
function adopt(s) { applyCloudState(s); stamp(true); }

let docRef = null, pushTimer = null, lastPushed = null, pushing = false, again = false, lastPushAt = 0;

const statusEl = document.getElementById('syncStatus');
const msgEl    = document.getElementById('authMsg');
const setStatus = (icon, cls, title) => {
  if (statusEl) statusEl.innerHTML = `<i class="fa-solid fa-${icon} ${cls}" title="${title}"></i>`;
};

async function push() {
  if (!docRef) return;
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    stamp(false);
    const snap = await getDoc(docRef);                                         // read first, never blind-overwrite
    const remote = snap.exists() && snap.data().state;
    if (remote) { const m = merge(snapshotState(), migrate(clone(remote))); if (sig(m) !== sig(appState)) adopt(m); }
    const state = snapshotState(); delete state.activeTab;
    const key = sig(state);
    if (key === lastPushed) return;
    if (key.length > 700000) toast(`Cloud save is ${Math.round(key.length / 1024)} KB — the limit is 1024 KB`, 'err');
    setStatus('cloud-arrow-up', 'text-amber-300', 'Saving…');
    lastPushAt = Date.now();
    await setDoc(docRef, { state, updatedAt: serverTimestamp(), by: DEV });
    lastPushed = key;
    setStatus('cloud', 'text-emerald-400', 'Synced');
  } catch (err) {
    console.error('cloud push failed', err);
    setStatus('triangle-exclamation', 'text-rose-400', 'Sync failed');
    toast('Cloud save failed: ' + err.message, 'err');
  } finally {
    pushing = false;
    if (again) { again = false; window.cloudQueuePush(); }
  }
}
window.cloudQueuePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500); };
window.cloudSignOut   = () => signOut(auth).then(() => location.reload());
window.addEventListener('pagehide', () => { if (pushTimer) push(); });        // flush when the tab closes

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
    setStatus('cloud', 'text-emerald-400', 'Synced');
  } catch (err) {
    console.error('initial sync failed', err);
    toast('Could not reach the cloud — working locally', 'err');
    setStatus('triangle-exclamation', 'text-rose-400', 'Offline');
    bootApp();
  }

  onSnapshot(docRef, s => {
    if (!s.exists() || s.metadata.hasPendingWrites) return;
    const d = s.data();
    if (d.by === DEV && d.updatedAt && lastPushAt) {                           // measure clock offset vs server
      localStorage.setItem(SKEW, String(d.updatedAt.toMillis() - lastPushAt)); lastPushAt = 0;
    }
    if (!d.state) return;
    stamp(false);
    const m = merge(snapshotState(), migrate(clone(d.state)));
    if (sig(m) === sig(appState)) return;
    adopt(m);
    if (d.by !== DEV) toast('Updated from another device', 'info');
    if (sig(m) !== sig(d.state)) window.cloudQueuePush();                      // we had things the cloud lacked
  }, err => {
    console.error('listener failed', err);
    setStatus('triangle-exclamation', 'text-rose-400', 'Sync offline');
  });
});
