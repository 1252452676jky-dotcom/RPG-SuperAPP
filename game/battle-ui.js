/* MONSTER LAB — battle screen (card-game board)      file: game/battle-ui.js
   Load AFTER game/battle.js.
   API: BattleUI.open(playerMons, enemyMons, opts) → Promise<{ result, action, battle, player }>
          result 'win'|'lose'   action 'continue'|'rebattle'|'end'   opts { title, auto }
        BattleUI.test() → demo battle */
(function () {
  const SPEEDS = [{ label: '1×', ms: 700 }, { label: '2×', ms: 340 }, { label: '4×', ms: 120 }];
  const TYPE_COLOR = { normal:'#9fa19f', fire:'#e62829', water:'#2980ef', electric:'#fac000', grass:'#3fa129', ice:'#3dcef3',
    fighting:'#ff8000', poison:'#9141cb', ground:'#915121', flying:'#81b9ef', psychic:'#ef4179', bug:'#91a119', rock:'#afa981',
    ghost:'#704170', dragon:'#5060e1', dark:'#624d4e', steel:'#60a1b8', fairy:'#ef70ef' };
  const STATUS_LABEL = { brn:'BRN', par:'PAR', psn:'PSN', tox:'TOX', slp:'SLP', frz:'FRZ' };
  const STAT_LABEL = { atk:'Atk', def:'Def', spa:'SpA', spd:'SpD', spe:'Spe', accuracy:'Acc' };
  const SINGLE = ['normal', 'any', 'adjacentFoe'];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tc = t => TYPE_COLOR[t] || '#777';
  const imgOf = m => (window.Gacha && (Gacha.img ? Gacha.img(m.key) : (Gacha.mon(m.key) || {}).img)) || '';
  let abilityText = null, itemText = null;
  async function loadText() {
    if (abilityText) return;
    const get = u => fetch(u).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    [abilityText, itemText] = await Promise.all([get('data/abilities.json'), get('data/items.json')]);
  }
  async function open(player, enemy, opts = {}) { await loadText(); return new Promise(res => run(player, enemy, opts, res)); }

  function run(player, enemy, opts, resolve) {
    const b = Battle.create(player, enemy); b.manual = true;
    const all = [...player, ...enemy], idx = m => all.indexOf(m), alive = m => m && m.hp > 0;
    const frames = [];
    const snap = () => ({ hp: all.map(m => m.hp), st: all.map(m => m.status), bo: all.map(m => ({ ...m.boosts })),
      act: b.sides.map(s => s.active.slice()), weather: b.weather, terrain: b.terrain });
    b.log.push = function (t) { Array.prototype.push.call(this, t); frames.push({ t, ...snap() }); return this.length; };
    b.onEvent = ev => frames.push({ ev, ...snap() });

    let speed = +(localStorage.getItem('ml.bspeed') || 0) % SPEEDS.length;
    let autoOn = !!opts.auto, busy = false, finished = false, closed = false, result = 'lose';
    let chosen = new Map(), lastChoices = null, targeting = null, pop = null, shown = 0, layoutKey = '', prev = null;
    const ms = () => SPEEDS[speed].ms;

    const root = document.createElement('div');
    root.className = 'mlb';
    root.innerHTML = `
      <div class="mlb-weather"></div>
      <div class="mlb-top"><span class="mlb-title">${esc(opts.title || 'Battle')}</span><span class="mlb-turn"></span><span class="mlb-field"></span>
        <button class="mlb-btn" data-act="speed"></button><button class="mlb-btn" data-act="auto">Auto</button>
        <button class="mlb-btn" data-act="log">Log</button><button class="mlb-btn" data-act="quit">✕</button></div>
      <div class="mlb-board">
        <div class="mlb-side foe"><div class="mlb-bench" data-side="1"></div><div class="mlb-row mlb-foe"></div></div>
        <div class="mlb-ticker"></div>
        <div class="mlb-side me"><div class="mlb-row mlb-me"></div><div class="mlb-bench" data-side="0"></div></div>
      </div>
      <div class="mlb-cmd"></div><div class="mlb-log"></div><div class="mlb-fx"></div>`;
    document.body.appendChild(root);
    const $ = s => root.querySelector(s);
    const cardEl = m => m && root.querySelector(`.mlb-card[data-i="${idx(m)}"]`);
    const restart = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
    const typeChips = m => m.types.map(t => `<span class="mlb-type" style="background:${tc(t)}">${esc(t)}</span>`).join('') + (m.attr ? `<span class="mlb-type mlb-attr">${esc(m.attr)}</span>` : '');
    const boostText = m => Object.entries(m.boosts).filter(([, v]) => v).map(([k, v]) => ` · ${STAT_LABEL[k]} ${v > 0 ? '+' : ''}${v}`).join('');
    const bigArt = m => `<div class="mlb-bigart" style="--t1:${tc(m.types[0])};--t2:${tc(m.types[1] || m.types[0])}"><img src="${esc(imgOf(m))}" alt=""></div>`;

    function labels() { $('[data-act="speed"]').textContent = '⏩ ' + SPEEDS[speed].label; $('[data-act="auto"]').classList.toggle('on', autoOn); }

    /* ---------- board ---------- */
    function card(m, side) {
      if (!m) return '<div class="mlb-card mlb-empty"></div>';
      const ab = m.ability && abilityText[m.ability], it = m.item && itemText[m.item];
      return `<div class="mlb-card mlb-enter" data-i="${idx(m)}" data-side="${side}" style="--t1:${tc(m.types[0])};--t2:${tc(m.types[1] || m.types[0])}">
        <div class="mlb-cardtop"><span class="mlb-name">${esc(m.name)}</span><span class="mlb-lv">Lv${m.lv}</span></div>
        <div class="mlb-art"><img src="${esc(imgOf(m))}" alt=""></div>
        <div class="mlb-types">${typeChips(m)}</div>
        <div class="mlb-hp"><div class="mlb-hpfill"></div></div>
        <div class="mlb-sub"><span class="mlb-hptext"></span><span class="mlb-status"></span></div>
        <div class="mlb-boosts"></div>
        ${m.ability || m.item ? `<div class="mlb-ab">${esc((ab && ab.name) || m.ability || '')}${m.item ? ' · ' + esc((it && it.name) || m.item) : ''}</div>` : ''}
        ${side === 0 ? '<div class="mlb-choice"></div>' : ''}</div>`;
    }
    function draw(f) {
      const key = f.act.map(a => a.map(idx).join(',')).join('|');
      if (key !== layoutKey) {
        layoutKey = key;
        $('.mlb-foe').innerHTML = f.act[1].map(m => card(m, 1)).join('');
        $('.mlb-me').innerHTML = f.act[0].map(m => card(m, 0)).join('');
      }
      [0, 1].forEach(si => { root.querySelector(`.mlb-bench[data-side="${si}"]`).innerHTML = b.sides[si].all.filter(m => !f.act[si].includes(m))
        .map(m => `<span class="mlb-mini ${f.hp[idx(m)] <= 0 ? 'out' : ''}" title="${esc(m.name)}"><img src="${esc(imgOf(m))}" alt=""></span>`).join(''); });
      root.querySelectorAll('.mlb-card[data-i]').forEach(el => {
        const i = +el.dataset.i, m = all[i], hp = f.hp[i], pct = Math.max(0, hp / m.maxhp * 100);
        const fill = el.querySelector('.mlb-hpfill');
        fill.style.width = pct + '%'; fill.className = 'mlb-hpfill' + (pct <= 20 ? ' red' : pct <= 50 ? ' yellow' : '');
        el.querySelector('.mlb-hptext').textContent = el.dataset.side === '0' ? `${hp}/${m.maxhp}` : `${Math.ceil(pct)}%`;
        const s = f.st[i], se = el.querySelector('.mlb-status');
        se.textContent = s ? STATUS_LABEL[s] : ''; se.className = 'mlb-status' + (s ? ' s-' + s : '');
        el.querySelector('.mlb-boosts').innerHTML = Object.entries(f.bo[i]).filter(([, v]) => v)
          .map(([k, v]) => `<span class="${v > 0 ? 'up' : 'down'}">${STAT_LABEL[k]} ${v > 0 ? '+' : ''}${v}</span>`).join('');
        el.classList.toggle('fainted', hp <= 0);
        if (prev) {
          const d = hp - prev.hp[i];
          if (d) { float(el, (d > 0 ? '+' : '−') + Math.max(1, Math.round(Math.abs(d) / m.maxhp * 100)) + '%', d > 0 ? 'heal' : 'dmg'); if (d < 0) restart(el, 'mlb-hit'); }
          if (s && s !== prev.st[i]) float(el, STATUS_LABEL[s], 's-' + s);
          for (const [k, v] of Object.entries(f.bo[i])) { const dv = v - (prev.bo[i][k] || 0); if (dv) float(el, `${STAT_LABEL[k]} ${dv > 0 ? '+' : ''}${dv}`, dv > 0 ? 'up' : 'down'); }
        }
      });
      $('.mlb-weather').className = 'mlb-weather' + (f.weather ? ' w-' + f.weather : '');
      root.dataset.terrain = f.terrain || '';
      $('.mlb-field').innerHTML = [f.weather, f.terrain && f.terrain + ' terrain'].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('');
      prev = f; badges();
    }

    /* ---------- effects ---------- */
    function float(el, text, cls) {
      const d = document.createElement('div');
      d.className = 'mlb-float ' + cls; d.textContent = text; d.style.top = (30 + el.querySelectorAll('.mlb-float').length * 16) + '%';
      el.appendChild(d); setTimeout(() => d.remove(), 1300);
    }
    async function orb(from, to, color, dur) {
      const a = cardEl(from), c = cardEl(to); if (!a || !c) return;
      const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect(), o = document.createElement('div');
      o.className = 'mlb-orb'; o.style.setProperty('--fx', color);
      o.style.left = (ra.left + ra.width / 2) + 'px'; o.style.top = (ra.top + ra.height / 2) + 'px';
      $('.mlb-fx').appendChild(o);
      o.animate([{ transform: 'translate(-50%,-50%) scale(.6)' },
        { transform: `translate(calc(-50% + ${rc.left - ra.left}px), calc(-50% + ${rc.top - ra.top}px)) scale(1.4)` }], { duration: dur, easing: 'ease-in' });
      await sleep(dur); o.remove();
    }
    function lunge(m, t, dur) {
      const a = cardEl(m), c = cardEl(t); if (!a) return;
      const ra = a.getBoundingClientRect(), rc = c ? c.getBoundingClientRect() : ra;
      const dx = (rc.left - ra.left) * .3, dy = (rc.top - ra.top) * .3 || (a.dataset.side === '0' ? -30 : 30);
      a.animate([{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(1.07)` }, { transform: 'none' }], { duration: dur, easing: 'ease-in-out' });
    }
    function banner(text) {
      if (speed === 2) return;
      const d = document.createElement('div'); d.className = 'mlb-banner'; d.textContent = text;
      root.appendChild(d); setTimeout(() => d.remove(), 900);
    }
    function logLine(t) {
      const log = $('.mlb-log'), d = document.createElement('div');
      if (/^— Turn/.test(t)) d.className = 'turn';
      d.textContent = t; log.appendChild(d);
      while (log.children.length > 200) log.firstChild.remove();
      log.scrollTop = log.scrollHeight;
      if (!/^— Turn/.test(t)) { const tk = $('.mlb-ticker'); tk.textContent = t; restart(tk, 'pulse'); }
    }
    async function animate(f) {
      const e = f.ev;
      if (e.type === 'move') {
        const el = cardEl(e.user);
        if (el) { el.style.setProperty('--fx', tc(e.move.type)); restart(el, e.move.cat === 'status' ? 'mlb-buff' : 'mlb-cast'); }
        return sleep(ms() * 0.4);
      }
      if (e.type === 'hit') {
        const color = tc(e.move.type), dur = Math.max(120, ms() * 0.7), t = cardEl(e.target);
        if (e.move.cat === 'special') await orb(e.user, e.target, color, dur);
        else { lunge(e.user, e.target, dur); await sleep(dur * 0.5); }
        if (t) { t.style.setProperty('--fx', color); if (e.crit) float(t, 'CRIT!', 'crit'); }
        draw(f); return sleep(ms() * 0.5);
      }
      if (e.type === 'hurt') { draw(f); return sleep(ms() * 0.45); }
      if (e.type === 'miss') { const t = cardEl(e.target); if (t) float(t, 'Miss', 'miss'); return sleep(ms() * 0.4); }
    }
    async function play() {
      while (shown < frames.length && !closed) {
        const f = frames[shown++];
        if (f.ev) { await animate(f); continue; }
        const turn = /^— Turn (\d+)/.exec(f.t);
        logLine(f.t); draw(f);
        if (turn) { $('.mlb-turn').textContent = 'Turn ' + turn[1]; banner('Turn ' + turn[1]); await sleep(ms() * 0.6); }
        else await sleep(ms());
      }
    }

    /* ---------- choosing ---------- */
    const myActive = () => b.sides[0].active.filter(alive);
    const autoFor = m => b.autoChoices().find(c => c.mon === m);
    function sortedMoves(m) {
      const lu = m.lastUsed || {};
      return m.moves.filter(mv => !m.lock || mv.id === m.lock.id).map((mv, i) => ({ mv, i }))
        .sort((a, c) => (lu[c.mv.id] || 0) - (lu[a.mv.id] || 0) || a.i - c.i).map(x => x.mv);
    }
    function effOf(mv, m, f) {
      const beats = { vaccine: 'virus', virus: 'data', data: 'vaccine' };
      let e = Battle.typeEff(mv.type, f.types);
      if (e && m.attr && f.attr) e *= beats[m.attr] === f.attr ? 1.5 : beats[f.attr] === m.attr ? 0.75 : 1;
      return e;
    }
    const effKey = e => e === 0 ? 'no' : e > 1 ? 'up' : e < 1 ? 'down' : 'n';
    const clearEff = () => root.querySelectorAll('[data-eff]').forEach(el => delete el.dataset.eff);
    const clearTargets = () => { targeting = null; root.querySelectorAll('.targetable').forEach(el => el.classList.remove('targetable')); };
    function moveBtn(mv, m, c) {
      const vs = mv.cat === 'status' ? '' : b.foes(m).map(f => { const e = effOf(mv, m, f), k = effKey(e);
        return `<span class="mlb-vs ${k}">${esc(f.name)} ${k === 'no' ? 'immune' : '×' + +e.toFixed(2)}</span>`; }).join('');
      return `<button class="mlb-move ${c && c.move === mv ? 'sel' : ''}" data-mv="${esc(mv.id)}" style="--t:${tc(mv.type)}">
        <span class="mlb-mvname">${esc(mv.name)}</span>
        <span class="mlb-mvinfo">${esc(mv.type)} · ${mv.cat}${mv.power ? ' · ' + mv.power : ''}${mv.acc === true ? '' : ' · ' + mv.acc + '%'}</span>
        ${vs ? `<span class="mlb-vsrow">${vs}</span>` : ''}<span class="mlb-desc">${esc(mv.desc || 'No description.')}</span></button>`;
    }
    function badges() {
      root.querySelectorAll('.mlb-me .mlb-card[data-i]').forEach(el => {
        const m = all[+el.dataset.i], c = chosen.get(m), slot = el.querySelector('.mlb-choice'); if (!slot) return;
        el.classList.toggle('ready', !!c);
        el.classList.toggle('pickme', !c && !busy && !finished && !pop && !targeting && alive(m));
        slot.innerHTML = !c ? '' : c.switchTo ? '⇄ ' + esc(c.switchTo.name)
          : esc(c.move.name) + (c.target && SINGLE.includes(c.move.target) && b.foes(m).length > 1 ? ' → ' + esc(c.target.name) : '');
        slot.style.setProperty('--t', c && c.move ? tc(c.move.type) : '#4f6bff');
      });
    }
    function bar() {
      if (finished) return;
      const act = myActive(), n = act.filter(m => chosen.has(m)).length;
      $('.mlb-cmd').innerHTML = busy ? '<div class="mlb-wait">…</div>'
        : targeting ? `<div class="mlb-hint"><b>${esc(targeting.mv.name)}</b>: tap an enemy card. Tap anywhere else to cancel.</div>`
        : `<div class="mlb-hint">Tap your monsters to choose moves, in any order (${n}/${act.length} ready)</div>
           <div class="mlb-actions">${lastChoices ? '<button class="mlb-btn" data-act="repeat">Repeat last</button>' : ''}
           <button class="mlb-btn" data-act="autoturn">Auto turn</button>${n ? '<button class="mlb-btn" data-act="clear">Clear</button>' : ''}
           <button class="mlb-btn go" data-act="fight" ${n === act.length && n ? '' : 'disabled'}>Fight!</button></div>`;
      badges();
    }
    function openPop(html, o = {}) {
      closePop();
      pop = document.createElement('div'); pop.className = 'mlb-pop' + (o.forced ? ' forced' : '');
      pop.innerHTML = `<div class="mlb-popin">${html}</div>`;
      root.appendChild(pop); root.classList.toggle('menu', !!o.menu); badges();
    }
    function closePop() { if (pop) { pop.remove(); pop = null; } root.classList.remove('menu'); clearEff(); badges(); }
    function moveMenu(m) {
      const ab = m.ability && abilityText[m.ability], it = m.item && itemText[m.item], c = chosen.get(m);
      const taken = [...chosen.entries()].filter(([x, ch]) => x !== m && ch.switchTo).map(([, ch]) => ch.switchTo);
      const bench = b.sides[0].bench.filter(x => alive(x) && !taken.includes(x));
      openPop(`<div class="mlb-pophead">${bigArt(m)}<div>
          <div class="mlb-popname">${esc(m.name)} <span>Lv${m.lv}</span></div><div class="mlb-types">${typeChips(m)}</div>
          <div class="mlb-dim">HP ${m.hp}/${m.maxhp}${m.status ? ' · ' + STATUS_LABEL[m.status] : ''}${boostText(m)}</div>
          ${ab ? `<div class="mlb-dim"><b>${esc(ab.name)}</b>: ${esc(ab.desc || '')}</div>` : ''}
          ${it ? `<div class="mlb-dim"><b>${esc(it.name)}</b>: ${esc(it.desc || '')}</div>` : ''}
          <div class="mlb-dim">Tap outside this box to go back.</div></div></div>
        <div class="mlb-moves">${sortedMoves(m).map(mv => moveBtn(mv, m, c)).join('')}</div>
        ${bench.length ? `<div class="mlb-sec">Switch out (uses this monster's turn)</div><div class="mlb-swrow">${bench.map(x =>
          `<button class="mlb-sw" data-sw="${idx(x)}"><img src="${esc(imgOf(x))}" alt=""><span>${esc(x.name)}<br>${Math.ceil(x.hp / x.maxhp * 100)}%</span></button>`).join('')}</div>` : ''}`, { menu: true });
      pop.dataset.mon = idx(m);
    }
    function foeInfo(m) {
      const ab = m.ability && abilityText[m.ability];
      openPop(`<div class="mlb-pophead">${bigArt(m)}<div>
        <div class="mlb-popname">${esc(m.name)} <span>Lv${m.lv}</span></div><div class="mlb-types">${typeChips(m)}</div>
        <div class="mlb-dim">HP ${Math.ceil(m.hp / m.maxhp * 100)}%${m.status ? ' · ' + STATUS_LABEL[m.status] : ''}${boostText(m)}</div>
        <div class="mlb-dim">${ab ? `<b>${esc(ab.name)}</b>: ${esc(ab.desc || '')}` : 'No ability'}</div>
        <div class="mlb-dim">Tap outside to go back.</div></div></div>`);
    }
    function askReplace(i) {
      const gone = b.sides[0].active[i], bench = b.sides[0].bench.filter(alive);
      $('.mlb-cmd').innerHTML = '<div class="mlb-hint">Choose who comes in.</div>';
      openPop(`<div class="mlb-popname">${esc(gone.name)} fainted. Who comes in?</div><div class="mlb-swrow" style="margin-top:8px">${bench.map(x =>
        `<button class="mlb-sw big" data-rep="${i}:${idx(x)}"><img src="${esc(imgOf(x))}" alt=""><span><b>${esc(x.name)}</b> Lv${x.lv}<br>${Math.ceil(x.hp / x.maxhp * 100)}% HP</span></button>`).join('')}</div>`, { forced: true });
    }
    async function doReplace(v) {
      const [i, j] = v.split(':').map(Number);
      closePop(); b.replace(i, all[j]); busy = true; bar(); await play(); busy = false; beginChoose();
    }
    function beginChoose() {
      if (b.over) return finish();
      const need = b.needReplace();
      if (need.length) return askReplace(need[0]);          // asks you even in Auto mode
      if (autoOn) return go(b.autoChoices());
      chosen = new Map(); clearTargets(); bar();
    }
    async function go(choices) {
      busy = true; clearTargets(); closePop();
      choices = choices.filter(c => c && alive(c.mon));
      choices.forEach(c => { if (c.move) (c.mon.lastUsed = c.mon.lastUsed || {})[c.move.id] = Date.now(); });
      lastChoices = choices; chosen = new Map(); bar();
      b.runTurn(choices); await play(); busy = false;
      if (!closed && !finished) beginChoose();
    }
    function finish() {
      if (finished) return; finished = true;
      const win = b.winner === 0 && !b.sides[1].all.some(alive); result = win ? 'win' : 'lose';
      $('.mlb-cmd').innerHTML = '';
      openPop(`<div class="mlb-result ${result}">${win ? 'VICTORY' : 'DEFEAT'}</div>
        <div class="mlb-dim" style="text-align:center">${win ? `Cleared in ${b.turn} turns` : 'Nothing is lost.'}</div>
        <div class="mlb-actions center">${win ? '<button class="mlb-btn go big" data-act="continue">Continue</button>'
          : '<button class="mlb-btn go big" data-act="rebattle">Rebattle</button><button class="mlb-btn big" data-act="end">End run</button>'}</div>`, { forced: true });
    }
    function close(action) { closed = true; root.remove(); resolve({ result, action, battle: b, player }); }

    /* ---------- input ---------- */
    root.addEventListener('click', e => {
      if (pop && !e.target.closest('.mlb-popin')) { if (!pop.classList.contains('forced')) closePop(); return; }   // tap outside = back
      const el = e.target.closest('[data-act],[data-mv],[data-sw],[data-rep],.mlb-card[data-i]');
      if (el && el.disabled) return;
      const a = el && el.dataset.act;
      if (a === 'speed') { speed = (speed + 1) % SPEEDS.length
        ; localStorage.setItem('ml.bspeed', speed); return labels(); }
      if (a === 'auto') { autoOn = !autoOn; labels(); if (autoOn && !busy && !finished && !pop) go(b.autoChoices()); return; }
      if (a === 'log') return void root.classList.toggle('showlog');
      if (a === 'quit') { if (!finished && confirm('Leave this battle? It counts as a loss (you lose nothing).')) { b.over = true; b.winner = 1; closePop(); finish(); } return; }
      if (a === 'continue' || a === 'rebattle' || a === 'end') return close(a);
      if (busy || finished) return;
      if (el && el.dataset.rep) return doReplace(el.dataset.rep);
      if (targeting) {                                       // picking a target for a single-target move
        const c = el && el.closest('.mlb-card[data-i]');
        if (c && c.classList.contains('targetable')) chosen.set(targeting.m, { mon: targeting.m, move: targeting.mv, target: all[+c.dataset.i] });
        clearTargets(); return bar();
      }
      if (!el) return;
      if (a === 'fight') { const act = myActive(); if (act.length && act.every(m => chosen.has(m))) go(act.map(m => chosen.get(m))); return; }
      if (a === 'clear') { chosen = new Map(); return bar(); }
      if (a === 'autoturn') return go(b.autoChoices());
      if (a === 'repeat') return go(myActive().map(x => { const p = lastChoices.find(c => c.mon === x && c.move);
        return p ? { mon: x, move: p.move, target: alive(p.target) ? p.target : null } : autoFor(x); }));
      if (el.dataset.mv && pop) {
        const m = all[+pop.dataset.mon], mv = m.moves.find(v => String(v.id) === el.dataset.mv); if (!mv) return;
        const foes = b.foes(m); closePop();
        if (SINGLE.includes(mv.target) && foes.length > 1) {
          targeting = { m, mv }; foes.forEach(f => { const c = cardEl(f); if (c) c.classList.add('targetable'); }); return bar();
        }
        chosen.set(m, { mon: m, move: mv, target: foes[0] || null }); return bar();
      }
      if (el.dataset.sw && pop) { const m = all[+pop.dataset.mon]; closePop(); chosen.set(m, { mon: m, switchTo: all[+el.dataset.sw] }); return bar(); }
      if (el.classList.contains('mlb-card')) {
        const m = all[+el.dataset.i]; if (!alive(m)) return;
        return el.dataset.side === '0' ? moveMenu(m) : foeInfo(m);
      }
    });
    root.addEventListener('mouseover', e => {                // hover a move → enemy cards show SUPER / RESIST / IMMUNE
      clearEff();
      const btn = e.target.closest('.mlb-move'); if (!btn || !pop || busy || finished) return;
      const m = all[+pop.dataset.mon], mv = m && m.moves.find(v => String(v.id) === btn.dataset.mv);
      if (!mv || mv.cat === 'status') return;
      b.foes(m).forEach(f => { const c = cardEl(f); if (c) c.dataset.eff = effKey(effOf(mv, m, f)); });
    });

    (async () => {
      labels(); draw({ t: '', ...snap() });
      b.start(); busy = true; bar(); await play(); busy = false;
      beginChoose();
    })();
  }

  /* ---------- demo ---------- */
  async function test() {
    const mv = await fetch('data/moves.pokemon.json').then(r => r.json());
    const M = ids => ids.map(i => mv[i] && { ...mv[i], id: i }).filter(Boolean);
    const mk = (k, ids, o = {}) => Battle.makeMon(Gacha.mon(k), 50, M(ids), o);
    const me = [
      mk('pkmn:charizard', ['flamethrower','heatwave','airslash','dragonpulse','willowisp','roost'], { ability: 'blaze', item: 'lifeorb', allMoves: true }),
      mk('pkmn:blastoise', ['surf','icebeam','scald','flashcannon'], { ability: 'torrent', item: 'leftovers', allMoves: true }),
      mk('pkmn:venusaur', ['gigadrain','sludgebomb','earthpower','sleeppowder'], { ability: 'overgrow', allMoves: true }),
      mk('pkmn:pikachu', ['thunderbolt','quickattack','thunderwave','irontail'], { ability: 'static', allMoves: true })];
    const foe = [
      mk('pkmn:gyarados', ['waterfall','earthquake','crunch','icefang'], { ability: 'intimidate' }),
      mk('pkmn:snorlax', ['bodyslam','earthquake','crunch','heavyslam'], { ability: 'thickfat' }),
      mk('pkmn:gengar', ['shadowball','sludgebomb','hypnosis','thunderbolt']),
      mk('pkmn:lucario', ['aurasphere','flashcannon','closecombat','extremespeed'], { ability: 'innerfocus' })];
    const res = await open(me, foe, { title: 'Test battle' });
    if (res.action === 'rebattle') return test();
    return res;
  }

  window.BattleUI = { open, test };
})();
