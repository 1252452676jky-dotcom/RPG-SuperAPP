/* MONSTER LAB — shared move VFX                        file: game/vfx.js
   Load AFTER game/battle.js, BEFORE battle-ui.js and cardbattle.js.
   One implementation of the move effects for both battle screens:
     const fx = BattleFX.create({ root, layer, board, tintEl, cardOf, ms, speed, calm, tc, restart });
       layer()   → fixed, full-screen effect container
       board()   → element to shake on a big hit
       tintEl()  → element flashed by heavy moves
       cardOf(m) → the DOM node standing in for a monster
       restart(el, cls) → replay a CSS animation class
       ms() → current step duration     speed() → 0/1/2 (2 = fastest, skips banners) */
(function () {
  function create(host) {
    const layer = () => host.layer && host.layer();
    const board = () => host.board && host.board();
    const tintEl = () => host.tintEl && host.tintEl();
    const ms = () => (host.ms ? host.ms() : 700);
    const calm = () => (host.calm ? host.calm() : false);
    const tc = t => (host.tc ? host.tc(t) : '#777');
    const restart = (el, cls) => { if (!el) return; if (host.restart) return host.restart(el, cls);
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
    const sleep = t => new Promise(r => setTimeout(r, t));

    function float(el, text, cls) {                       // damage / status numbers over a card
      if (!el) return;
      const d = document.createElement('div'); d.className = 'mlb-float ' + cls; d.textContent = text;
      d.style.top = (30 + el.querySelectorAll('.mlb-float').length * 16) + '%';
      el.appendChild(d); setTimeout(() => d.remove(), 1300);
    }
    function pop(el, text, cls) {                         // same numbers, but safe when the list redraws
      const L = layer(); if (!L) return;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      const d = document.createElement('div'); d.className = 'mlb-float ' + (cls || ''); d.textContent = text;
      d.style.position = 'fixed';
      d.style.left = (r ? r.left + r.width / 2 : window.innerWidth / 2) + 'px';
      d.style.top = (r ? r.top + r.height / 2 : window.innerHeight / 2) + 'px';
      L.appendChild(d); setTimeout(() => d.remove(), 1300);
    }
    async function orb(from, to, color, dur) {
      const a = host.cardOf && host.cardOf(from), c = host.cardOf && host.cardOf(to);
      const L = layer(); if (!a || !c || !L) return;
      const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect(), o = document.createElement('div');
      o.className = 'mlb-orb'; o.style.setProperty('--fx', color);
      o.style.left = (ra.left + ra.width / 2) + 'px'; o.style.top = (ra.top + ra.height / 2) + 'px';
      L.appendChild(o);
      o.animate([{ transform: 'translate(-50%,-50%) scale(.6)' },
        { transform: `translate(calc(-50% + ${rc.left - ra.left}px), calc(-50% + ${rc.top - ra.top}px)) scale(1.5)` }],
        { duration: dur, easing: 'ease-in' });
      await sleep(dur); o.remove();
    }
    function lunge(m, t, dur) {
      const a = host.cardOf && host.cardOf(m), c = host.cardOf && host.cardOf(t); if (!a) return;
      const ra = a.getBoundingClientRect(), rc = c ? c.getBoundingClientRect() : ra;
      const side = a.dataset.side;
      const dx = (rc.left - ra.left) * .3, dy = (rc.top - ra.top) * .3 || (side === '0' ? -30 : 30);
      a.animate([{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(1.07)` }, { transform: 'none' }],
        { duration: dur, easing: 'ease-in-out' });
    }
    // one sweep that hits every target at the same time
    async function areaFx(user, targets, mv, dur) {
      const color = tc(mv.type), los = (targets || []).filter(Boolean);
      const els = los.map(host.cardOf).filter(Boolean); if (!els.length) return;
      if (mv.cat === 'special') await Promise.all(los.map(t => orb(user, t, color, dur)));
      else {
        const a = host.cardOf && host.cardOf(user);
        if (a) {
          const ra = a.getBoundingClientRect(), rs = els.map(x => x.getBoundingClientRect());
          const cx = rs.reduce((s, r) => s + r.left + r.width / 2, 0) / rs.length;
          const cy = rs.reduce((s, r) => s + r.top + r.height / 2, 0) / rs.length;
          const dx = (cx - ra.left - ra.width / 2) * .3, dy = (cy - ra.top - ra.height / 2) * .3;
          a.animate([{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(1.1)` }, { transform: 'none' }],
            { duration: dur, easing: 'ease-in-out' });
        }
        await sleep(dur * 0.5);
        els.forEach(x => slash(x, color));
      }
      new Set(els.map(x => x.parentElement)).forEach(row => { if (row) { row.style.setProperty('--fx', color); restart(row, 'mlb-wave'); } });
      els.forEach(x => burst(x, color, 8));
      shake(false);
    }
    function burst(el, color, n) {
      if (!el || calm()) return;
      const L = layer(); if (!L) return;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (let k = 0; k < n; k++) {
        const p = document.createElement('i'); p.className = 'mlb-spark';
        p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.setProperty('--fx', color);
        L.appendChild(p);
        const ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 70;
        p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(.2)`, opacity: 0 }],
          { duration: 420 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
      }
    }
    function slash(el, color) {
      if (!el) return;
      const s = document.createElement('i'); s.className = 'mlb-slash'; s.style.setProperty('--fx', color);
      el.appendChild(s); setTimeout(() => s.remove(), 420);
    }
    function shake(big) { if (!calm()) restart(board(), big ? 'mlb-shake-big' : 'mlb-shake'); }
    function tint(color) {
      const t = tintEl(); if (!t) return;
      t.style.setProperty('--fx', color); restart(t, 'on');
    }
    function banner(text) {
      if (host.speed && host.speed() === 2) return;
      const d = document.createElement('div'); d.className = 'mlb-banner'; d.textContent = text;
      (host.root || document.body).appendChild(d); setTimeout(() => d.remove(), 1000);
    }
    function cast(el, color, cat) {                        // the user glows while it uses a move
      if (!el) return;
      el.style.setProperty('--fx', color);
      restart(el, cat === 'status' ? 'mlb-buff' : 'mlb-cast');
    }
    return { float, pop, orb, lunge, areaFx, burst, slash, shake, tint, banner, cast, ms, sleep };
  }
  window.BattleFX = { create };
})();
