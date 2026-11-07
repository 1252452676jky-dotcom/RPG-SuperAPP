import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBRAIYyJDt9_eny-ctrRJsCTuOgwVo2zGM",
  authDomain: "rpg-superapp-5404c.firebaseapp.com",
  projectId: "rpg-superapp-5404c",
  storageBucket: "rpg-superapp-5404c.firebasestorage.app",
  messagingSenderId: "897127607194",
  appId: "1:897127607194:web:faf2c81b7081b7606da823"
};
const OWNER_UID = '';            // fill in after Step 7
const SYNC_FLAG = 'rpg_synced_once';

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let docRef = null, pushTimer = null, lastPushed = null;

const statusEl = document.getElementById('syncStatus');
const msgEl    = document.getElementById('authMsg');
const setStatus = (icon, cls, title) => {
  if (statusEl) statusEl.innerHTML =
    `<i class="fa-solid fa-${icon} ${cls}" title="${title}"></i>`;
};

/* Ignore activeTab/updatedAt when deciding if anything really changed,
   so clicking between tabs doesn't burn writes. */
function dirtyKey() {
  const s = snapshotState();
  delete s.activeTab; delete s.updatedAt;
  return JSON.stringify(s);
}

async function push() {
  if (!docRef) return;
  const key = dirtyKey();
  if (key === lastPushed) return;
  setStatus('cloud-arrow-up', 'text-amber-300', 'Saving…');
  try {
    appState.updatedAt = Date.now();
    await setDoc(docRef, { state: snapshotState(), updatedAt: appState.updatedAt });
    lastPushed = key;
    setStatus('cloud', 'text-emerald-400', 'Synced');
  } catch (err) {
    console.error('cloud push failed', err);
    setStatus('triangle-exclamation', 'text-rose-400', 'Sync failed');
    toast('Cloud save failed: ' + err.message, 'err');
  }
}
window.cloudQueuePush = () => { clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500); };
window.cloudSignOut   = () => signOut(auth).then(() => location.reload());

document.getElementById('signInBtn').addEventListener('click', async () => {
  msgEl.textContent = '';
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { console.error(err); msgEl.textContent = err.code || err.message; }
});

onAuthStateChanged(auth, async user => {
  if (!user) { setStatus('cloud-arrow-down', 'text-slate-500', 'Not signed in'); return; }
  if (OWNER_UID && user.uid !== OWNER_UID) {
    msgEl.textContent = 'This app is private. Your UID: ' + user.uid;
    await signOut(auth);
    return;
  }
  docRef = doc(db, 'users', user.uid);
  setStatus('cloud-arrow-down', 'text-amber-300', 'Loading…');

  try {
    const snap = await getDoc(docRef);
    const remote = snap.exists() ? snap.data() : null;

    if (!remote || !remote.state) {
      bootApp(); await push();
    } else if (!localStorage.getItem(SYNC_FLAG) && hasLocalContent()) {
      const r = mergeCloudState(remote.state);
      toast('Merged cloud data into this device', 'info');
      console.log('merge report', r);
    } else if ((remote.updatedAt || 0) > (appState.updatedAt || 0)) {
      applyCloudState(remote.state);
    } else {
      bootApp(); await push();
    }
    localStorage.setItem(SYNC_FLAG, '1');
    lastPushed = dirtyKey();
    setStatus('cloud', 'text-emerald-400', 'Synced');
  } catch (err) {
    console.error('initial sync failed', err);
    toast('Could not reach the cloud — working locally', 'err');
    setStatus('triangle-exclamation', 'text-rose-400', 'Offline');
    bootApp();
  }

  onSnapshot(docRef, s => {
    if (!s.exists()) return;
    const d = s.data();
    if (d && d.state && (d.updatedAt || 0) > (appState.updatedAt || 0)) {
      applyCloudState(d.state);
      lastPushed = dirtyKey();
      toast('Updated from another device', 'info');
    }
  }, err => {
    console.error('listener failed', err);
    setStatus('triangle-exclamation', 'text-rose-400', 'Sync offline');
  });
});