// game/game-cloud.js — syncs Monster Lab to users/{uid}/game/main
import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let app;
try { app = getApp(); } catch (e) { console.warn('game-cloud: Firebase not initialised, game stays local'); }

if (app && window.Gacha) {
  const auth = getAuth(app), db = getFirestore(app);
  let ref = null, timer = null, lastPushed = '', unsub = null;

  async function push() {
    if (!ref) return;
    const s = Gacha.exportState(), key = JSON.stringify([s.box, s.team, s.overrides, s.run, s.meta]);
    if (key === lastPushed) return;                    // nothing really changed
    try { await setDoc(ref, { state: s, updatedAt: s.updatedAt }); lastPushed = key; }
    catch (err) { console.warn('game push failed', err); }
  }
  window.cloudGamePush = () => { clearTimeout(timer); timer = setTimeout(push, 5000); };

  onAuthStateChanged(auth, async user => {
    if (unsub) { unsub(); unsub = null; }
    ref = user ? doc(db, 'users', user.uid, 'game', 'main') : null;
    if (!ref) return;
    try {
      const snap = await getDoc(ref);
      const remote = snap.exists() ? snap.data() : null;
      if (remote && (remote.updatedAt || 0) > Gacha.localUpdatedAt()) Gacha.importState(remote.state);
      else if (Gacha.hasContent()) await push();         // local is newer → upload it
      unsub = onSnapshot(ref, d => {
        const r = d.data();
        if (r && (r.updatedAt || 0) > Gacha.localUpdatedAt()) { Gacha.importState(r.state); toast('Monster Lab updated from another device', 'info'); }
      });
    } catch (err) { console.warn('game sync unavailable, staying local', err); }
  });
}
