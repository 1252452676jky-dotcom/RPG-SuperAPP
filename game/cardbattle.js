/* MONSTER LAB — Mode B card battle (CTB timeline)      file: game/cardbattle.js
   Load AFTER game/battle.js and BEFORE game/run.js.
   API: CardBattle.open(playerMons, enemyMons, opts) → Promise<{ result, action, battle, player }> (same as BattleUI) */
(function () {
  const SCALE = 4;                                   // display only: internal Pokémon-scale numbers × SCALE
  const SHOW = n => Math.round(n * SCALE);
  const ENERGY = 5, HAND = 5, CT = 1000, PRIO_STEP = 120, PRIO_CAP = 240, STEP_MS = 320;
  const TC = { normal:'#9fa19f', fire:'#e62829', water:'#2980ef', electric:'#fac000', grass:'#3fa129', ice:'#3dcef3', fighting:'#ff8000',
    poison:'#9141cb', ground:'#915121', flying:'#81b9ef', psychic:'#ef4179', bug:'#91a119', rock:'#afa981', ghost:'#704170',
    dragon:'#5060e1', dark:'#624d4e', steel:'#60a1b8', fairy:'#ef70ef' };
  const ST = { brn:'BRN', par:'PAR', psn:'PSN', tox:'TOX', slp:'SLP', frz:'FRZ' };
  const SINGLE = ['normal', 'any', 'adjacentFoe'];
  const WAIT = { id: 'ml-wait', name: 'Get ready', type: 'normal', cat: 'status', power: 0, acc: true, prio: 0, flags: {}, target: 'self' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pic = m => (window.Gacha && Gacha.img && Gacha.img(m.key)) || '';
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const cost = mv => Math.max(0, Math.min(3, mv.cost ?? 1));

  const CSS = `
  .mlc{position:fixed;inset:0;z-index:60;background:radial-gradient(ellipse at center,#1d3b2a 0%,#0e1c15 70%);color:#eee;font-family:system-ui,sans-serif;display:flex;flex-direction:column}
  .mlc-top{display:flex;align-items:center;gap:10px;padding:6px 12px;background:#0008;border-bottom:2px solid #c9a24a}
  .mlc-tl{display:flex;gap:4px;flex:1;justify-content:center}
  .mlc-tl div{width:38px;height:38px;border-radius:50%;border:2px solid #888;background:#222 center/cover;position:relative}
  .mlc-tl div.e{border-color:#e55}.mlc-tl div.p{border-color:#5ae}.mlc-tl div.now{transform:scale(1.25);box-shadow:0 0 10px #ffd34d}
  .mlc-field{flex:1;display:grid;grid-template-columns:1fr 260px 1fr;gap:10px;padding:10px;min-height:0}
  .mlc-side{display:flex;flex-direction:column;gap:8px;justify-content:center}
  .mlc-unit{display:flex;gap:8px;align-items:center;background:#0007;border:2px solid #555;border-radius:10px;padding:6px;cursor:default;position:relative}
  .mlc-unit img{width:64px;height:64px;object-fit:contain}
  .mlc-unit.now{border-color:#ffd34d;box-shadow:0 0 14px #ffd34d88}.mlc-unit.tgt{border-color:#ff5050;cursor:pointer;animation:mlcP 1s infinite}
  .mlc-unit.ko{opacity:.35}@keyframes mlcP{50%{box-shadow:0 0 16px #ff5050}}
  .mlc-hp{height:8px;background:#333;border-radius:4px;overflow:hidden;margin:3px 0}.mlc-hp i{display:block;height:100%;background:#4c4}
  .mlc-tag{font-size:11px;background:#a33;padding:1px 4px;border-radius:3px;margin-right:3px}.mlc-dim{color:#aaa;font-size:12px}
  .mlc-bench{display:flex;gap:4px}.mlc-bench img{width:34px;height:34px;object-fit:contain;background:#0006;border-radius:6px}
  .mlc-log{background:#0009;border:1px solid #c9a24a;border-radius:8px;padding:6px;overflow:auto;font-size:12px;line-height:1.4}
  .mlc-hand{background:#000a;border-top:2px solid #c9a24a;padding:8px 12px;display:flex;gap:10px;align-items:center;min-height:150px}
  .mlc-en{display:flex;gap:3px}.mlc-en i{width:14px;height:14px;border-radius:50%;background:#444;border:1px solid #888}.mlc-en i.on{background:#ffd34d}
  .mlc-card{width:120px;min-height:130px;border-radius:10px;padding:6px;background:#222;border:2px solid #777;cursor:pointer;position:relative;font-size:12px;transition:transform .12s}
  .mlc-card:hover{transform:translateY(-8px)}.mlc-card.off{opacity:.4;cursor:not-allowed}.mlc-card.sel{transform:translateY(-12px);box-shadow:0 0 12px #ffd34d}
  .mlc-cost{position:absolute;top:-8px;left:-8px;width:24px;height:24px;border-radius:50%;background:#ffd34d;color:#000;font-weight:bold;display:flex;align-items:center;justify-content:center}
  .mlc-eff{font-size:10px;margin-top:4px}.mlc-eff b{margin-right:4px}
  .mlc btn,.mlc button{background:#c9a24a;border:0;border-radius:6px;padding:6px 12px;font-weight:bold;cursor:pointer}
  .mlc-modal{position:fixed;inset:0;background:#000b;display:flex;align-items:center;justify-content:center;z-index:70}
  .mlc-modal>div{background:#1b2a22;border:2px solid #c9a24a;border-radius:12px;padding:16px;max-width:520px}`;

  function open(me, foe, opts = {}) {
    if (!document.getElementById('mlc-css')) { const s = document.createElement('style'); s.id = 'mlc-css'; s.textContent = CSS; document.head.appendChild(s); }
    return new Promise(done => {
      const b = Battle.create(me, foe); b.manual = true; b.start();
      const alive = m => m && m.hp > 0;
      const sideOf = m => b.sides[0].all.includes(m) ? 0 : 1;
      const acts = () => b.sides.flatMap(s => s.active).filter(alive);
      const speed = m => { const s = Math.max(1, b.realStat(m, 'spe')); return b.trick > 0 ? 10000 / s : s; };
      [...me, ...foe].forEach(m => { m.ct = Math.random() * 150; m.deck = shuffle(m.moves.slice()); m.hand = []; m.energy = 0; });
      let actor = null, sel = null, busy = false, shown = 0, turnsSinceField = 0, endTurnNow = null;
      const el = document.createElement('div'); el.className = 'mlc'; document.body.appendChild(el);

      /* ---- move effects: the same module battle-ui.js uses ---- */
      const fxLayer = document.createElement('div'); fxLayer.className = 'mlc-fx'; document.body.appendChild(fxLayer);
      const tintEl = document.createElement('div'); tintEl.className = 'mlb-tint'; fxLayer.appendChild(tintEl);
      const FX = BattleFX.create({ root: el, layer: () => fxLayer, board: () => el.querySelector('.mlc-field'), tintEl: () => tintEl,
        cardOf: m => { if (!m) return null; const si = sideOf(m), i = b.sides[si].active.indexOf(m);
          return i < 0 ? null : el.querySelector(`.mlc-unit[data-u="${si}:${i}"]`); },
        ms: () => STEP_MS, speed: () => 1, calm: () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches),
        tc: t => TC[t] || '#777' });
      let fxq = [], areaMv = null;
      const snapHp = () => new Map([...me, ...foe].map(m => [m, m.hp]));
      b.onEvent = ev => { fxq.push({ ev, hp: snapHp() }); };

      function forecast(n) {
        const ct = new Map(acts().map(m => [m, m.ct ?? 0])), out = [];
        for (let k = 0; k < n && ct.size; k++) {
          let best = null, bt = Infinity;
          for (const [m, c] of ct) { const t = (CT - c) / speed(m); if (t < bt) { bt = t; best = m; } }
          for (const [m, c] of ct) ct.set(m, c + speed(m) * Math.max(0, bt));
          out.push(best); ct.set(best, ct.get(best) - CT);
        }
        return out;
      }
      function nextActor() {
        let best = null, bt = Infinity;
        for (const m of acts()) { m.ct = m.ct ?? 0; const t = (CT - m.ct) / speed(m); if (t < bt) { bt = t; best = m; } }
        for (const m of acts()) m.ct += speed(m) * Math.max(0, bt);
        return best;
      }
      const refill = m => { m.deck = m.deck || shuffle(m.moves.slice()); m.hand = m.hand || [];
        while (m.hand.length < HAND && m.deck.length) m.hand.push(m.deck.pop()); };
      const effOf = (mv, t) => mv.cat === 'status' ? null : Battle.typeEff(mv.type, t.types);

      function unit(m, si) {
        if (!m) return '<div class="mlc-unit ko"><div class="mlc-dim">empty</div></div>';
        const tgt = sel && actor && alive(m) && (b.pickable(actor, sel) || []).includes(m), bo = Object.entries(m.boosts || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' ');
        return `<div class="mlc-unit ${m === actor ? 'now' : ''} ${tgt ? 'tgt' : ''} ${alive(m) ? '' : 'ko'}" data-u="${si}:${b.sides[si].active.indexOf(m)}">
          <img src="${esc(pic(m))}" alt=""><div style="flex:1"><b>${esc(m.name)}</b> <span class="mlc-dim">Lv ${m.lv}</span>
          <div class="mlc-hp"><i style="width:${Math.max(0, m.hp / m.maxhp * 100)}%;background:${m.hp / m.maxhp < .25 ? '#d33' : m.hp / m.maxhp < .5 ? '#db3' : '#4c4'}"></i></div>
          <div class="mlc-dim">${SHOW(m.hp)} / ${SHOW(m.maxhp)} HP · SPD ${SHOW(m.st.spe)}</div>
          <div>${m.status ? `<span class="mlc-tag">${ST[m.status]}</span>` : ''}${m.vol.charging ? '<span class="mlc-tag">CHARGING</span>' : ''}${m.vol.sub ? '<span class="mlc-tag">SUB</span>' : ''}<span class="mlc-dim">${esc(bo)}</span></div></div></div>`;
      }
      function draw() {
        const tl = forecast(8), si0 = b.sides[0], si1 = b.sides[1];
        const bench = s => `<div class="mlc-bench">${s.bench.map(m => `<img src="${esc(pic(m))}" title="${esc(m.name)} ${SHOW(m.hp)}/${SHOW(m.maxhp)}" style="${alive(m) ? '' : 'opacity:.3'}">`).join('')}</div>`;
        const mine = actor && sideOf(actor) === 0 && !busy;
        const foes = si1.active.filter(alive);
        el.innerHTML = `<div class="mlc-top"><b>${esc(opts.title || 'Card battle')}</b>
            <div class="mlc-tl">${tl.map((m, i) => `<div class="${sideOf(m) ? 'e' : 'p'} ${i === 0 && m === actor ? 'now' : ''}" style="background-image:url('${esc(pic(m))}')" title="${esc(m.name)}"></div>`).join('')}</div>
            <button data-a="quit">Quit</button></div>
          <div class="mlc-field">
            <div class="mlc-side">${[0, 1, 2].map(i => unit(si0.active[i], 0)).join('')}${bench(si0)}</div>
            <div class="mlc-log" id="mlc-log">${b.log.slice(-60).map(l => `<div>${esc(l)}</div>`).join('')}</div>
            <div class="mlc-side">${si1.all.length === 1 ? `<div class="mlc-boss">${unit(si1.active[0], 1)}</div>` : [0, 1, 2].map(i => unit(si1.active[i], 1)).join('') + bench(si1)}</div></div>
          <div class="mlc-hand">${mine ? `<div style="min-width:140px"><b>${esc(actor.name)}</b><div class="mlc-en">${Array.from({ length: Math.max(ENERGY, actor.energy) }, (_, i) => `<i class="${i < actor.energy ? 'on' : ''}"></i>`).join('')}</div>
              <div class="mlc-dim">${actor.energy} energy · deck ${actor.deck.length}</div><button data-a="end" style="margin-top:6px">End turn</button>
              ${sel ? '<div class="mlc-dim">Pick a glowing target (click here to cancel)</div>' : ''}</div>
              ${actor.hand.map((mv, i) => `<div class="mlc-card ${cost(mv) > actor.energy ? 'off' : ''} ${sel === mv ? 'sel' : ''}" data-c="${i}" style="border-color:${TC[mv.type] || '#777'}" title="${esc(mv.desc || '')}">
                <span class="mlc-cost">${cost(mv)}</span><b>${esc(mv.name)}</b>
                <div class="mlc-dim">${esc(mv.type)} · ${mv.cat}${mv.power ? ' · ' + SHOW(mv.power) : ''}${mv.acc === true ? '' : ' · ' + mv.acc + '%'}${mv.prio ? ' · prio ' + mv.prio : ''}</div>
                <div class="mlc-dim">${SINGLE.includes(mv.target) ? 'one foe' : mv.target === 'self' ? 'self' : /all/i.test(mv.target) ? 'all foes' : esc(mv.target)}</div>
                <div class="mlc-eff">${foes.map(f => { const e = effOf(mv, f); return e == null ? '' : `<b style="color:${e === 0 ? '#888' : e > 1 ? '#5f5' : e < 1 ? '#f88' : '#ccc'}">${esc(f.name.slice(0, 6))} ${e === 0 ? '✕' : '×' + e}</b>`; }).join('')}</div></div>`).join('')}`
            : `<div class="mlc-dim">${actor ? esc(actor.name) + ' is acting…' : ''}</div>`}</div>`;
        const lg = el.querySelector('#mlc-log'); if (lg) lg.scrollTop = 1e6;
      }
      async function flush() { const n = b.log.length - shown; shown = b.log.length; draw(); if (n > 0) await wait(Math.min(5, n) * STEP_MS); }
      /* replay the events recorded during the action, against the DOM as it is now */
      async function drainFx() {
        const q = fxq; fxq = []; if (!q.length || !window.BattleFX) return;
        for (const { ev, hp } of q) {
          try { await fxEv(ev, hp); } catch (e) { /* an effect must never break a battle */ }
        }
      }
      async function fxEv(e, hp) {
        if (!e) return;
        const who = el.querySelector('.mlc-field');
        if (e.type === 'move') {
          const u = FX; u.cast(el.querySelector(`.mlc-unit[data-u="0:${b.sides[0].active.indexOf(e.user)}"]`) ||
            el.querySelector(`.mlc-unit[data-u="1:${b.sides[1].active.indexOf(e.user)}"]`), TC[e.move.type] || '#777', e.move.cat);
          areaMv = e.move.cat !== 'status' && (e.targets || []).filter(t => t !== e.user).length > 1 ? e.move : null;
          await wait(STEP_MS * 0.35);
          return;
        }
        if (e.type === 'hit') {
          const color = TC[e.move.type] || '#777', dur = Math.max(120, STEP_MS * 0.7);
          const elOf = m => { if (!m) return null; const si = sideOf(m), i = b.sides[si].active.indexOf(m);
            return i < 0 ? null : el.querySelector(`.mlc-unit[data-u="${si}:${i}"]`); };
          const t = elOf(e.target), u = elOf(e.user), area = areaMv === e.move;
          const eff = e.move.cat === 'status' ? 1 : Battle.typeEff(e.move.type, e.target.types);
          if (!area) {
            if (e.move.power >= 90) FX.tint(color);
            if (e.move.cat === 'special') await FX.orb(e.user, e.target, color, dur);
            else { FX.lunge(e.user, e.target, dur); await wait(dur * 0.5); FX.slash(t, color); }
            FX.burst(t, color, e.crit || eff > 1 ? 14 : 8);
          }
          if (e.crit || eff > 1) FX.shake(e.crit && eff > 1);
          const before = hp && hp.get(e.target), lost = before !== undefined ? before - e.target.hp : 0;
          if (lost > 0) FX.pop(t, '−' + Math.max(1, Math.round(lost / e.target.maxhp * 100)) + '%', 'dmg' + (e.crit || eff > 1 ? ' strong' : eff < 1 ? ' weak' : ''));
          if (e.crit) FX.pop(t, 'CRIT!', 'crit');
          await wait(STEP_MS * (area ? 0.12 : 0.45));
          return;
        }
        if (e.type === 'hurt') {
          const i0 = hp && hp.get(e.mon), dv = i0 !== undefined ? e.mon.hp - i0 : 0;
          if (!dv) return;
          const si = sideOf(e.mon), i = b.sides[si].active.indexOf(e.mon);
          const node = i < 0 ? null : el.querySelector(`.mlc-unit[data-u="${si}:${i}"]`);
          FX.pop(node, (dv > 0 ? '+' : '−') + Math.max(1, Math.round(Math.abs(dv) / e.mon.maxhp * 100)) + '%', dv > 0 ? 'heal' : 'dmg');
          return;
        }
        if (e.type === 'miss') {
          const si = sideOf(e.target), i = b.sides[si].active.indexOf(e.target);
          FX.pop(i < 0 ? null : el.querySelector(`.mlc-unit[data-u="${si}:${i}"]`), 'Miss', 'miss');
          return;
        }
        if (e.type === 'eot') areaMv = null;
      }
      const over = () => { for (const [i, s] of b.sides.entries()) if (!s.all.some(alive)) { b.over = true; b.winner = 1 - i; } return b.over; };

      function pickBench(title, list) {
        return new Promise(res => {
          const md = document.createElement('div'); md.className = 'mlc-modal';
          md.innerHTML = `<div><h3>${esc(title)}</h3>${list.map((m, i) => `<button data-i="${i}" style="margin:4px">${esc(m.name)} · ${SHOW(m.hp)}/${SHOW(m.maxhp)}</button>`).join('')}</div>`;
          md.addEventListener('click', e => { const x = e.target.closest('[data-i]'); if (x) { md.remove(); res(list[+x.dataset.i]); } });
          document.body.appendChild(md);
        });
      }
      async function replaceFainted() {
        b.refill(1);                                                     // enemy bench comes in by itself
        for (const i of b.needReplace()) {
          const old = b.sides[0].active[i], inc = await pickBench(`${old.name} fainted. Who comes in?`, b.sides[0].bench.filter(alive));
          b.replace(i, inc); inc.ct = old.ct;                             // takes over its timeline slot
        }
        await flush();
      }
      async function play(m, mv, target, free) {
        if (!free) { m.energy -= cost(mv); const i = m.hand.indexOf(mv); if (i >= 0) m.hand.splice(i, 1); m.deck.push(mv); shuffle(m.deck); }
        if (mv.prio) m.prioMax = Math.abs(mv.prio) > Math.abs(m.prioMax || 0) ? mv.prio : m.prioMax;
        if (sideOf(m) === 0 && mv.id !== 'ml-wait') (m.lastUsed = m.lastUsed || {})[mv.id] = Date.now();
        b.actOne({ mon: m, move: mv, target });
        await flush();
        await drainFx();
        if (b.pendingSwitch) {                                           // U-turn & co.: you choose who comes in
          const out = b.pendingSwitch, inc = await pickBench(`${out.name} is leaving the field. Who comes in?`, b.sides[0].bench.filter(alive));
          b.switchNow(out, inc); inc.ct = out.ct; inc.energy = 0; endTurnNow = out; await flush();
        }
        over(); if (!b.over) await replaceFainted();
      }
      async function enemyTurn(m) {
        for (let g = 0; g < 5 && alive(m) && !b.over && b.sides[1].active.includes(m); g++) {
          const ok = m.hand.filter(x => cost(x) <= m.energy); if (!ok.length) break;
          const dmg = ok.filter(x => x.cat !== 'status'), pool = dmg.length && Math.random() < 0.75 ? dmg : ok;
          await play(m, pool[Math.floor(Math.random() * pool.length)], null);
        }
      }
      function playerTurn(m) {
        return new Promise(res => {
          const finish = () => { el.onclick = null; res(); };
          const check = () => { if (b.over || !alive(m) || !b.sides[0].active.includes(m) || endTurnNow === m || !m.hand.some(x => cost(x) <= m.energy)) finish(); else draw(); };
          el.onclick = async e => {
            if (busy) return;
            const a = e.target.closest('[data-a]'), c = e.target.closest('[data-c]'), u = e.target.closest('[data-u]');
            if (a && a.dataset.a === 'end') return finish();
            if (a && a.dataset.a === 'quit') { if (confirm('Leave this battle? It counts as a loss (you lose nothing).')) { b.over = true; b.winner = 1; finish(); } return; }
            if (c) {
              const mv = m.hand[+c.dataset.c]; if (!mv || cost(mv) > m.energy) return;
              const opts = b.pickable(m, mv);
              if (opts && opts.length > 1) { sel = sel === mv ? null : mv; return draw(); }
              busy = true; sel = null; await play(m, mv, opts ? opts[0] || null : b.sides[1].active.find(alive)); busy = false; return check();
            }
            if (u && sel) {
              const [si, i] = u.dataset.u.split(':').map(Number), t = b.sides[si].active[i];
              if (!alive(t) || !(b.pickable(m, sel) || []).includes(t)) return;
              const mv = sel; sel = null; busy = true; await play(m, mv, t); busy = false; return check();
            }
            if (sel && e.target.closest('.mlc-hand')) { sel = null; draw(); }
          };
          check();
        });
      }
      async function takeTurn(m) {
        b.turn++; actor = m; endTurnNow = null; m.prioMax = 0;
        m.energy = ENERGY + ((m.actions || 1) > 1 ? 3 : 0); refill(m);
        L(`— ${m.name}'s turn —`); await flush();
        let skip = false;
        if (m.vol.flinch) { L(`${m.name} flinched!`); m.vol.flinch = false; skip = true; }
        else if (m.vol.recharge) { await play(m, m.moves[0], null, true); skip = true; }               // "must recharge!"
        else if (m.vol.locked) { await play(m, m.vol.locked.mv || m.moves[0], null, true); skip = true; } // Outrage etc. play by themselves
        else {
          if (m.vol.charging) { const cm = m.moves.find(x => x.id === m.vol.charging) || m.moves[0]; await play(m, cm, null, true); }
          if (alive(m) && (m.status === 'slp' || m.status === 'frz')) { await play(m, WAIT, null, true); if (m.status === 'slp' || m.status === 'frz') skip = true; }
        }
        if (!skip && alive(m) && !b.over && b.sides[sideOf(m)].active.includes(m)) {
          if (sideOf(m) === 0) await playerTurn(m); else await enemyTurn(m);
        }
        // end of this monster's turn
        if (alive(m) && b.sides[sideOf(m)].active.includes(m)) { if (!m.vol.charging) b.residualOne(m); }
        m.ct = (m.ct ?? 0) - CT + Math.max(-PRIO_CAP, Math.min(PRIO_CAP, (m.prioMax || 0) * PRIO_STEP));
        if (endTurnNow && endTurnNow !== m) endTurnNow.ct -= CT;
        if (++turnsSinceField >= Math.max(1, acts().length)) { turnsSinceField = 0; b.fieldTick(); }
        actor = null; await flush(); await drainFx(); over(); if (!b.over) await replaceFainted();
      }
      function L(t) { b.log.push(t); }

      (async () => {
        await flush();
        while (!b.over) { const m = nextActor(); if (!m) break; await takeTurn(m); over(); }
        const win = b.winner === 0;
        const md = document.createElement('div'); md.className = 'mlc-modal';
        md.innerHTML = `<div><h2>${win ? 'Victory!' : 'Defeat'}</h2>${win ? '<button data-r="continue">Continue</button>'
          : '<p class="mlc-dim">You lose nothing.</p><button data-r="rebattle">Rebattle</button> <button data-r="end">End run</button>'}</div>`;
        md.addEventListener('click', e => { const x = e.target.closest('[data-r]'); if (!x) return;
          md.remove(); el.remove(); fxLayer.remove(); done({ result: win ? 'win' : 'lose', action: x.dataset.r, battle: b, player: me }); });

        document.body.appendChild(md);
      })();
    });
  }
  window.CardBattle = { open, SHOW };
})();
