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
  const ST = { brn:['BRN','#F08030','#fff'], par:['PAR','#F8D030','#222'], psn:['PSN','#A040A0','#fff'],
    tox:['TOX','#702070','#fff'], slp:['SLP','#8C8C8C','#fff'], frz:['FRZ','#98D8D8','#123'] };
  const VOL = [['confusion','CONF','#F85888','#fff'], ['leechseed','SEED','#78C850','#123'], ['taunt','TAUNT','#C03028','#fff'],
    ['encore','ENCORE','#A890F0','#fff'], ['trapped','TRAP','#705848','#fff'], ['curse','CURSE','#705898','#fff'],
    ['sub','SUB','#C8C8C8','#222'], ['charging','CHARGING','#6890F0','#fff'], ['recharge','RECHARGE','#666','#fff']];
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
  .mlc-modal>div{background:#1b2a22;border:2px solid #c9a24a;border-radius:12px;padding:16px;max-width:520px}
  .mlc-field{grid-template-columns:1fr 330px 1fr}
  .mlc-mid{display:flex;flex-direction:column;gap:8px;min-height:0}.mlc-mid .mlc-log{flex:1;min-height:80px}
  .mlc-det{background:#0b1611ee;border:1px solid #c9a24a;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.4;max-height:52%;overflow:auto}
  .mlc-dhead{display:flex;align-items:center;gap:8px;border-left:5px solid;padding-left:8px;margin-bottom:3px;font-size:14px}
  .mlc-cost.s{position:static;width:20px;height:20px;font-size:12px;flex-shrink:0}
  .mlc-dtext{margin:6px 0;color:#eee}.mlc-dfx{margin:4px 0 4px 16px;padding:0;color:#ffd98a}.mlc-dfx li{margin:2px 0}.mlc-deff{font-size:11px;margin-top:4px}
  .mlc-card{width:150px;min-height:150px;display:flex;flex-direction:column}
  .mlc-desc{font-size:10.5px;line-height:1.3;color:#ddd;margin-top:4px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .mlc-unit{transition:box-shadow .15s,border-color .15s}
  .mlc-unit.p{border-left:5px solid #3fa9f5}.mlc-unit.e{border-right:5px solid #f05050}
  .mlc-side-tag{position:absolute;bottom:3px;right:6px;font-size:9px;font-weight:bold;letter-spacing:1px;opacity:.75}
  .mlc-unit.p .mlc-side-tag{color:#7cc8ff}.mlc-unit.e .mlc-side-tag{color:#ff8a8a}
  .mlc-unit.act-p{border-color:#3fa9f5;box-shadow:0 0 0 3px #3fa9f5,0 0 22px #3fa9f5cc}
  .mlc-unit.act-e{border-color:#f05050;box-shadow:0 0 0 3px #f05050,0 0 22px #f05050cc}
  .mlc-unit.act-p::after,.mlc-unit.act-e::after,.mlc-unit.hitme::after{position:absolute;top:-11px;left:10px;font-size:10px;font-weight:bold;padding:1px 7px;border-radius:9px;color:#fff;pointer-events:none}
  .mlc-unit.act-p::after{content:'⚔ ATTACKING';background:#1e78c8}.mlc-unit.act-e::after{content:'⚔ ATTACKING';background:#c62828}
  .mlc-unit.hitme{outline:2px dashed #ffd34d;outline-offset:3px}.mlc-unit.hitme::after{content:'◎ TARGET';background:#8a6d00}
  .mlc-hp i{transition:width .35s ease,background .35s}
  .mlc-banner{position:fixed;top:58px;left:50%;transform:translateX(-50%);padding:6px 18px;border-radius:20px;font:600 14px system-ui,sans-serif;color:#fff;z-index:75;pointer-events:none;opacity:0;transition:opacity .15s}
  .mlc-banner.on{opacity:1}.mlc-banner.p{background:#0f4f80e6;border:2px solid #3fa9f5}.mlc-banner.e{background:#7d1414e6;border:2px solid #f05050}
  .mlc-banner b{margin-right:8px;font-size:11px;letter-spacing:1px}
  .mlc-bench img.sw{cursor:pointer;outline:2px solid #3fa9f5;outline-offset:1px}.mlc-bench img.sw:hover{transform:translateY(-3px)}
  .mlc-who{font-size:10px;font-weight:bold;padding:1px 6px;border-radius:8px;color:#fff}.mlc-who.p{background:#1e78c8}.mlc-who.e{background:#c62828}`;

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
      /* ---- Deck Spire: acting indicator, HP that waits for the hit, full card text ---- */
      let shownHp = null, hoverMv = null;                      // shownHp = HP the board shows while effects play
      const hpOf = m => shownHp && shownHp.has(m) ? shownHp.get(m) : m.hp;
      const freeze = () => { shownHp = snapHp(); };
      const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
      const nodeOf = m => { if (!m) return null; const si = sideOf(m), i = b.sides[si].active.indexOf(m);
        return i < 0 ? null : el.querySelector(`.mlc-unit[data-u="${si}:${i}"]`); };
      function paintHp() {                                     // update bars in place (a redraw would wipe the effects)
        el.querySelectorAll('.mlc-unit[data-u]').forEach(n => {
          const [si, i] = n.dataset.u.split(':').map(Number), m = b.sides[si] && b.sides[si].active[i]; if (!m) return;
          const h = hpOf(m), f = Math.max(0, h / m.maxhp), bar = n.querySelector('.mlc-hp i'), tx = n.querySelector('.mlc-hptx');
          if (bar) { bar.style.width = f * 100 + '%'; bar.style.background = f < .25 ? '#d33' : f < .5 ? '#db3' : '#4c4'; }
          if (tx) tx.textContent = `${SHOW(Math.max(0, h))} / ${SHOW(m.maxhp)} HP`;
          n.classList.toggle('ko', h <= 0);
        });
      }
      const bannerEl = document.createElement('div'); bannerEl.className = 'mlc-banner'; fxLayer.appendChild(bannerEl);
      function markActor(e) {
        clearMarks(); if (!e.user || !e.move || e.move.id === 'ml-wait') return;
        const si = sideOf(e.user), u = nodeOf(e.user);
        if (u) u.classList.add(si ? 'act-e' : 'act-p');
        (e.targets || []).filter(t => t !== e.user).forEach(t => { const n = nodeOf(t); if (n) n.classList.add('hitme'); });
        bannerEl.className = 'mlc-banner on ' + (si ? 'e' : 'p');
        bannerEl.innerHTML = `<b>${si ? 'FOE' : 'ALLY'}</b>${esc(e.user.name)} ➜ ${esc(e.move.name)}`;
      }
      function clearMarks() { el.querySelectorAll('.act-p,.act-e,.hitme').forEach(n => n.classList.remove('act-p', 'act-e', 'hitme')); bannerEl.className = 'mlc-banner'; }
      const tagH = (t, bg, fg) => `<span class="mlc-tag" style="background:${bg};color:${fg}">${t}</span>`;
      const tagsOf = m => (m.status && ST[m.status] ? tagH(...ST[m.status]) : '') + VOL.filter(([k]) => m.vol && m.vol[k]).map(([, t, bg, fg]) => tagH(t, bg, fg)).join('');
      const tgtTxt = mv => SINGLE.includes(mv.target) ? 'one foe' : mv.target === 'self' ? 'self' : mv.target === 'adjacentAlly' ? 'one ally'
        : mv.target === 'allies' ? 'your side' : mv.target === 'allAdjacentFoes' ? 'all foes' : mv.target === 'allAdjacent' ? 'everyone else'
        : /field|side/i.test(mv.target || '') ? 'field' : esc(mv.target || 'one foe');
      const SNAME = { brn: 'Burns the target', par: 'Paralyzes the target', psn: 'Poisons the target', tox: 'Badly poisons the target', slp: 'Puts the target to sleep', frz: 'Freezes the target' };
      const STATN = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness' };
      const SIDEN = { reflect: 'Reflect: halves physical damage to your side for 5 turns', lightscreen: 'Light Screen: halves special damage to your side for 5 turns',
        tailwind: "Tailwind: doubles your side's Speed for 4 turns", spikes: "Scatters Spikes on the foe's side (hurts grounded foes that switch in)",
        stealthrock: 'Stealth Rock: hurts foes that switch in, based on Rock-type effectiveness' };
      const boostTxt = (o, who) => Object.entries(o || {}).map(([k, v]) => `${v > 0 ? 'Raises' : 'Lowers'} ${who} ${STATN[k] || k} by ${Math.abs(v)} stage${Math.abs(v) > 1 ? 's' : ''}`);
      function facts(mv) {
        const f = [], pct = a => Math.round(a[0] / a[1] * 100);
        if (mv.prio > 0) f.push(`Priority +${mv.prio}: moves this monster up the timeline`);
        if (mv.prio < 0) f.push(`Priority ${mv.prio}: pushes this monster back on the timeline`);
        if (mv.multihit) f.push(Array.isArray(mv.multihit) ? `Hits ${mv.multihit[0]}–${mv.multihit[1]} times in a row` : `Hits ${mv.multihit} times in a row`);
        if (mv.willCrit) f.push('Always lands a critical hit'); else if (mv.crit > 1) f.push('High critical-hit ratio');
        if (mv.ohko) f.push('One-hit KO if it lands; fails against higher-level targets');
        if (mv.drain) f.push(`User recovers ${pct(mv.drain)}% of the damage dealt`);
        if (mv.recoil) f.push(`User takes ${pct(mv.recoil)}% of the damage dealt as recoil`);
        if (mv.heal) f.push(`Restores ${pct(mv.heal)}% of max HP`);
        if (mv.status) f.push(SNAME[mv.status] || mv.status);
        if (mv.vol === 'confusion') f.push('Confuses the target for 2–5 turns');
        if (mv.vol === 'leechseed') f.push('Seeds the target: it loses 1/8 of its max HP each turn and the user heals that much (Grass types are immune)');
        if (mv.vol === 'protect') f.push('Protects the user from most moves until its next turn; more likely to fail if used in a row');
        if (mv.boosts) f.push(...boostTxt(mv.boosts, mv.target === 'self' ? "the user's" : "the target's"));
        if (mv.self && mv.self.boosts) f.push(...boostTxt(mv.self.boosts, "the user's"));
        (mv.secondaries || []).forEach(s => {
          const c = s.chance && s.chance < 100 ? `${s.chance}% chance: ` : '';
          if (s.status) f.push(c + (SNAME[s.status] || s.status));
          if (s.volatileStatus === 'flinch') f.push(c + 'the target flinches and loses its next action');
          if (s.volatileStatus === 'confusion') f.push(c + 'confuses the target');
          if (s.boosts) boostTxt(s.boosts, "the target's").forEach(x => f.push(c + x));
          if (s.self && s.self.boosts) boostTxt(s.self.boosts, "the user's").forEach(x => f.push(c + x));
        });
        if (mv.charge) f.push('Charges on the first turn and strikes on the next');
        if (mv.selfSwitch) f.push('User switches out after using it (you choose who comes in)');
        if (mv.selfdestruct) f.push('The user faints');
        if (mv.weather) { const w = String(mv.weather); f.push(`Starts ${/rain/i.test(w) ? 'rain' : /sun/i.test(w) ? 'harsh sunlight' : /sand/i.test(w) ? 'a sandstorm' : /snow|hail/i.test(w) ? 'snow' : w} for 5 turns`); }
        if (mv.terrain) f.push(`Sets ${cap(String(mv.terrain).replace('terrain', ''))} Terrain for 5 turns`);
        if (mv.side) f.push(SIDEN[mv.side] || `Sets ${mv.side}`);
        if (mv.pseudo === 'trickroom') f.push('Trick Room: slower monsters act first for 5 turns');
        if (mv.flags && mv.flags.contact) f.push('Makes contact');
        return f;
      }
      function detHtml(mv) {
        if (!mv) return `<div class="mlc-dim">${actor && sideOf(actor) === 0 ? 'Hover a card to read it in full.' : actor ? 'Enemy turn…' : ''}</div>`;
        const fx = facts(mv), foes = b.sides[1].active.filter(alive), text = (!mv.base && mv.long) || mv.desc;
        const eff = mv.cat === 'status' ? '' : foes.map(f => { const e = effOf(mv, f);
          return `<span style="color:${e === 0 ? '#999' : e > 1 ? '#6f6' : e < 1 ? '#f99' : '#ddd'}">${esc(f.name)}: ${e === 0 ? 'no effect' : e > 1 ? 'super effective ×' + e : e < 1 ? 'resisted ×' + e : 'neutral'}</span>`; }).join(' · ');
        return `<div class="mlc-dhead" style="border-color:${TC[mv.type] || '#777'}"><span class="mlc-cost s">${cost(mv)}</span><b>${esc(mv.name)}</b></div>
          <div class="mlc-dim">${esc(cap(mv.type))} · ${cap(mv.cat)}${mv.power ? ' · Power ' + SHOW(mv.power) : ''} · ${mv.acc === true ? 'Never misses' : 'Accuracy ' + mv.acc + '%'} · Target: ${tgtTxt(mv)}</div>
          ${text ? `<p class="mlc-dtext">${esc(text)}</p>` : ''}
          ${fx.length ? `<ul class="mlc-dfx">${fx.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${eff ? `<div class="mlc-deff">${eff}</div>` : ''}`;
      }
      el.addEventListener('mouseover', e => {
        const c = e.target.closest('[data-c]'); if (!c || !actor || busy) return;
        const mv = actor.hand[+c.dataset.c]; if (!mv || mv === hoverMv) return;
        hoverMv = mv; const d = el.querySelector('#mlc-det'); if (d && !sel) d.innerHTML = detHtml(mv);
      });

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
        const h = hpOf(m), f = Math.max(0, h / m.maxhp);
        const tgt = sel && actor && alive(m) && (b.pickable(actor, sel) || []).includes(m), bo = Object.entries(m.boosts || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' ');
        return `<div class="mlc-unit ${si ? 'e' : 'p'} ${m === actor ? 'now' : ''} ${tgt ? 'tgt' : ''} ${h > 0 ? '' : 'ko'}" data-u="${si}:${b.sides[si].active.indexOf(m)}">
          <span class="mlc-side-tag">${si ? 'FOE' : 'ALLY'}</span>
          <img src="${esc(pic(m))}" alt=""><div style="flex:1;min-width:0"><b>${esc(m.name)}</b> <span class="mlc-dim">Lv ${m.lv}</span>
          <div class="mlc-hp"><i style="width:${f * 100}%;background:${f < .25 ? '#d33' : f < .5 ? '#db3' : '#4c4'}"></i></div>
          <div class="mlc-dim"><span class="mlc-hptx">${SHOW(Math.max(0, h))} / ${SHOW(m.maxhp)} HP</span> · SPD ${SHOW(m.st.spe)}</div>
          <div>${tagsOf(m)}<span class="mlc-dim">${esc(bo)}</span></div></div></div>`;
      }
      function draw() {
        const tl = forecast(8), si0 = b.sides[0], si1 = b.sides[1];
        const mine = actor && sideOf(actor) === 0 && !busy, canSw = mine && !(actor.vol && actor.vol.trapped);
        const bench = (s, si) => `<div class="mlc-bench">${s.bench.map((m, j) => { const ok = si === 0 && canSw && alive(m);
          return `<img src="${esc(pic(m))}" class="${ok ? 'sw' : ''}" ${ok ? `data-sw="${j}"` : ''} title="${esc(m.name)} ${SHOW(m.hp)}/${SHOW(m.maxhp)}${ok ? ' · click to switch in' : ''}" style="${alive(m) ? '' : 'opacity:.3'}">`; }).join('')}</div>`;
        const foes = si1.active.filter(alive);
        if (hoverMv && !(mine && actor.hand.includes(hoverMv))) hoverMv = null;
        el.innerHTML = `<div class="mlc-top"><b>${esc(opts.title || 'Card battle')}</b>
            <div class="mlc-tl">${tl.map((m, i) => `<div class="${sideOf(m) ? 'e' : 'p'} ${i === 0 && m === actor ? 'now' : ''}" style="background-image:url('${esc(pic(m))}')" title="${esc(m.name)}"></div>`).join('')}</div>
            <button data-a="quit">Quit</button></div>
          <div class="mlc-field">
            <div class="mlc-side">${[0, 1, 2].map(i => unit(si0.active[i], 0)).join('')}${bench(si0, 0)}</div>
            <div class="mlc-mid"><div class="mlc-det" id="mlc-det">${detHtml(mine ? (sel || hoverMv) : null)}</div>
              <div class="mlc-log" id="mlc-log">${b.log.slice(Math.max(0, shown - 60), shown).map(l => `<div>${esc(l)}</div>`).join('')}</div></div>
            <div class="mlc-side">${si1.all.length === 1 ? `<div class="mlc-boss">${unit(si1.active[0], 1)}</div>` : [0, 1, 2].map(i => unit(si1.active[i], 1)).join('') + bench(si1, 1)}</div></div>
          <div class="mlc-hand">${mine ? `<div style="min-width:150px"><b>${esc(actor.name)}</b><div class="mlc-en">${Array.from({ length: Math.max(ENERGY, actor.energy) }, (_, i) => `<i class="${i < actor.energy ? 'on' : ''}"></i>`).join('')}</div>
              <div class="mlc-dim">${actor.energy} energy · deck ${actor.deck.length}</div><button data-a="end" style="margin-top:6px">End turn</button>
              ${canSw && si0.bench.some(alive) ? '<div class="mlc-dim" style="margin-top:4px">⇄ Tap a bench monster to switch (ends this turn)</div>' : actor.vol && actor.vol.trapped ? '<div class="mlc-dim">Trapped: can\'t switch</div>' : ''}
              ${sel ? '<div class="mlc-dim">Pick a glowing target (click here to cancel)</div>' : ''}</div>
              ${actor.hand.map((mv, i) => `<div class="mlc-card ${cost(mv) > actor.energy ? 'off' : ''} ${sel === mv ? 'sel' : ''}" data-c="${i}" style="border-color:${TC[mv.type] || '#777'}">
                <span class="mlc-cost">${cost(mv)}</span><b>${esc(mv.name)}</b>
                <div class="mlc-dim">${esc(mv.type)} · ${mv.cat}${mv.power ? ' · ' + SHOW(mv.power) : ''}${mv.acc === true ? '' : ' · ' + mv.acc + '%'}${mv.prio ? ' · prio ' + mv.prio : ''}</div>
                <div class="mlc-dim">${tgtTxt(mv)}</div>
                <div class="mlc-desc">${esc(mv.desc || facts(mv).join('. ') || 'No description.')}</div>
                <div class="mlc-eff">${foes.map(f => { const e = effOf(mv, f); return e == null ? '' : `<b style="color:${e === 0 ? '#888' : e > 1 ? '#5f5' : e < 1 ? '#f88' : '#ccc'}">${esc(f.name.slice(0, 6))} ${e === 0 ? '✕' : '×' + e}</b>`; }).join('')}</div></div>`).join('')}`
            : `<div class="mlc-dim">${actor ? `<span class="mlc-who ${sideOf(actor) ? 'e' : 'p'}">${sideOf(actor) ? 'FOE' : 'ALLY'}</span> ${esc(actor.name)} is acting…` : ''}</div>`}</div>`;
        const lg = el.querySelector('#mlc-log'); if (lg) lg.scrollTop = 1e6;
      }async function flush() { const n = b.log.length - shown; shown = b.log.length; draw(); if (n > 0) await wait(Math.min(5, n) * STEP_MS); }
      /* play the recorded effects; each target's HP drops when its hit lands, not before */
      async function drainFx() {
        const q = fxq; fxq = [];
        if (q.length && window.BattleFX) for (let i = 0; i < q.length; i++) {
          const { ev, hp } = q[i];
          try { await fxEv(ev, hp); } catch (e) { /* an effect must never break a battle */ }
          if (shownHp && ev && ev.type !== 'move') { shownHp = i + 1 < q.length ? q[i + 1].hp : null; paintHp(); }
        }
        shownHp = null; paintHp(); clearMarks();
      }async function fxEv(e, hp) {
        if (!e) return;
        const who = el.querySelector('.mlc-field');
        if (e.type === 'move') { markActor(e);
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
        freeze(); b.actOne({ mon: m, move: mv, target });
        draw();                                  // the hand updates now; HP bars and the log wait for the animation
        await drainFx();
        await flush();
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
            const sw = e.target.closest('[data-sw]');
            if (sw) {                                            // switch: uses this monster's turn, like Pokémon
              const inc = b.sides[0].bench[+sw.dataset.sw];
              if (!alive(inc) || m.vol.trapped) return;
              if (!confirm(`Switch ${m.name} out for ${inc.name}? This ends ${m.name}'s turn.`)) return;
              busy = true; sel = null; freeze();
              b.switchNow(m, inc); inc.ct = (m.ct ?? 0) - CT; inc.energy = 0;   // newcomer waits a full turn
              draw(); await drainFx(); await flush(); busy = false; return finish();
            }            if (c) {
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
        freeze();
        if (alive(m) && b.sides[sideOf(m)].active.includes(m)) { if (!m.vol.charging) b.residualOne(m); }
        m.ct = (m.ct ?? 0) - CT + Math.max(-PRIO_CAP, Math.min(PRIO_CAP, (m.prioMax || 0) * PRIO_STEP));
        if (endTurnNow && endTurnNow !== m) endTurnNow.ct -= CT;
        if (++turnsSinceField >= Math.max(1, acts().length)) { turnsSinceField = 0; b.fieldTick(); }
        actor = null; draw(); await drainFx(); await flush(); over(); if (!b.over) await replaceFainted();
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
