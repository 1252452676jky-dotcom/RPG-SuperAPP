/* =====================================================================
   MONSTER LAB — Run mode (Drops 4 + 5)                  file: game/run.js
   Load AFTER game/battle-ui.js.   Open with MonsterRun.open()
   localStorage:  'ml.run'  = current run (saved after every floor / change)
                  'ml.meta' = permanent: recruits, Mega/Gmax unlocks, run counts
   Test helpers:  MonsterRun.check()    MonsterRun.jump(floor)
   ===================================================================== */
(function () {
  'use strict';
  const SAVE = 'ml.run', META = 'ml.meta', FRS = ['pokemon', 'palworld', 'digimon'];
  const FR_LABEL = { pokemon: 'Pokémon', palworld: 'Palworld', digimon: 'Digimon' };
  const STARTERS = ('bulbasaur charmander squirtle chikorita cyndaquil totodile treecko torchic mudkip turtwig chimchar piplup ' +
    'snivy tepig oshawott chespin fennekin froakie rowlet litten popplio grookey scorbunny sobble sprigatito fuecoco quaxly')
    .split(' ').map(n => 'pkmn:' + n);
  const BOSS = [10, 20, 30], FINAL = 31, ITEM_FLOORS = [5, 10, 15, 20, 25, 30], START_MAX = 6, TEAM_MAX = 6;
  const EVO_FALLBACK = { friendship: 12, stone: 30, trade: 45, other: 30 };      // Pokémon evolutions with no level
  const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
  const PAL_TYPE = { neutral: 'normal', leaf: 'grass', earth: 'ground' };
  const PAL_POWER_CAP = 150;

  const Lf = f => Math.min(100, Math.max(5, Math.round(100 * f / 30)));
  const tierFor = f => f >= FINAL ? 'legend' : f > 20 ? 'late' : f > 10 ? 'mid' : 'early';
  const enemyLv = f => f >= FINAL ? 100 : Math.min(100, Lf(f) + (BOSS.includes(f) ? 3 : 0));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rand = a => a.length ? a[Math.floor(Math.random() * a.length)] : null;
  const sample = (a, n) => { const c = a.slice(), o = []; while (c.length && o.length < n) o.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]); return o; };
  const psId = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const uid = () => 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toMap = x => Array.isArray(x) ? Object.fromEntries(x.filter(o => o && o.id).map(o => [o.id, o])) : (x || {});
  const R = k => (k && window.Gacha && Gacha.mon(k)) || null;
  const nm = k => String(k).split(':').slice(1).join(':') || String(k);
  const isForm = k => /-(mega(-[a-z])?|gmax|primal|eternamax)$/.test(nm(k));
  const TIER_NAMES = ['early', 'mid', 'late', 'legend'];
  function tierOf(r) {
    if (!r) return '';
    let t = r.tier ?? r.pool ?? r.tierName ?? r.rarity;
    if (t && typeof t === 'object') t = t.name ?? t.id;
    if (typeof t === 'number') return TIER_NAMES[t >= 1 ? Math.min(3, t - 1) : 0];
    const s = String(t ?? '').toLowerCase().trim();
    if (/legend|myth|ultra|^4$/.test(s)) return 'legend';
    if (/late|^3$/.test(s)) return 'late';
    if (/mid|^2$/.test(s)) return 'mid';
    if (/early|^1$|^0$/.test(s)) return 'early';
    return s;
  }
  const evoList = r => {
    const e = r && (r.evo ?? r.evolutions ?? r.nextEvolutions);
    return Array.isArray(e) ? e : e && typeof e === 'object' ? Object.values(e) : [];
  };
  function evoTo(e, r) {
    let k = !e ? null : typeof e === 'string' ? e : (e.to ?? e.key ?? e.into ?? e.target ?? e.id ?? null);
    if (!k) return null;
    k = String(k);
    if (R(k)) return k;
    const pre = r && r.key ? r.key.split(':')[0] + ':' : '';   // "ivysaur" → "pkmn:ivysaur"
    return R(pre + k) ? pre + k : null;
  }
  const hasEvo = r => evoTargets(r).length > 0;
  const FX = () => window.MonsterFX || { abilities: {}, items: {}, randomAbilities: [], hasAbility: () => false };
  const statsOf = r => { const a = r && (Array.isArray(r.base) ? r.base : Array.isArray(r.raw) ? r.raw : null);
    return a ? { hp: a[0], atk: a[1], def: a[2], spa: a[3], spd: a[4], spe: a[5] } : (r && r.stats) || {}; };

  // move ordering: newest first, where "newest" = just learned OR most recently used
  const stamp = (() => { let last = 0; return () => (last = Math.max(Date.now(), last + 1)); })();
  const recent = (m, id) => Math.max((m.lastUsed || {})[id] || 0, (m.learnedAt || {})[id] || 0);
  // a monster keeps the move edits of everything it evolved from
  const lineOf = m => [...new Set([m.mega, m.key, ...(m.line || []).slice().reverse(), m.origin].filter(Boolean))];
  const mvOf = (m, id) => { for (const k of lineOf(m)) { const x = moveObj(R(k), id); if (x) return x; } return null; };
  /* ---------------- data ---------------- */
  let KEYS = [], LEARN = {}, MOVES = {}, ITEMTXT = {}, ABTXT = {}, loaded = false;
  const learnCache = {};
  async function load() {
    if (loaded) return;
    const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const res = await Promise.all([...FRS.flatMap(f => ['monsters', 'learnsets', 'moves'].map(n => get(`data/${n}.${f}.json`))),
      get('data/items.json'), get('data/abilities.json')]);
    FRS.forEach((f, i) => {
      const m = res[i * 3];
      const arr = Array.isArray(m) ? m : (m && (m.records || m.monsters)) || (m ? Object.values(m) : []);
      KEYS.push(...arr.filter(r => r && typeof r === 'object' && r.key).map(r => r.key));
      LEARN[f] = res[i * 3 + 1] || {}; MOVES[f] = toMap(res[i * 3 + 2]);
    });
    ITEMTXT = toMap(res[9]); ABTXT = toMap(res[10]);
    loaded = true;
  }
  function normLearn(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map(x => Array.isArray(x)
      ? (typeof x[0] === 'number' ? { lv: x[0], id: x[1] } : { id: x[0], lv: x[1] })
      : typeof x === 'string' ? { id: x, lv: 1 } : { id: x && (x.id ?? x.move ?? x.name), lv: x && (x.lv ?? x.level) })
      .filter(x => x.id).map(x => ({ id: x.id, lv: Math.max(1, +x.lv || 1) }));
    if (typeof raw === 'object') return Object.entries(raw).map(([id, v]) => ({ id,
      lv: Math.max(1, Array.isArray(v) ? Math.min(...v.map(Number).filter(n => !isNaN(n)), 100) : typeof v === 'object' ? +(v.lv ?? v.level) || 1 : +v || 1) }));
    return [];
  }
  function learnOf(key) {
    const r = R(key); if (!r) return [];
    if (learnCache[key] && !r.moveEdits) return learnCache[key];
    const L = LEARN[r.fr] || {};
    let raw = r.learnset || L[key] || L[nm(key)];
    if (!raw && r.fr === 'pokemon') {                          // forms without their own list use the default form's
      const base = KEYS.find(k => { const x = R(k); return x && x.fr === 'pokemon' && x.dex === r.dex && x.isDefault; });
      if (base) raw = L[base] || L[nm(base)];
    }
    const list = normLearn(raw);
    Object.keys(r.moveEdits || {}).forEach(id => { if (!list.some(x => x.id === id)) list.push({ id, lv: 1 }); });
    return (learnCache[key] = list.sort((a, b) => a.lv - b.lv));
  }
  function moveObj(r, id) {
    const base = r && MOVES[r.fr] && MOVES[r.fr][id], ed = r && r.moveEdits && r.moveEdits[id];
    if (!base && !ed) return null;
    const tpl = ed && ed.base && MOVES.pokemon && MOVES.pokemon[ed.base];      // editor "base move" (a Pokémon move)
    const m = tpl ? { ...tpl, name: (base && base.name) || tpl.name, ...ed } : { ...(base || {}), ...(ed || {}) };
    const c0 = String(m.category ?? m.cat ?? '').toLowerCase();
    let power = +(m.power ?? m.basePower ?? 0) || 0;
    if (r.fr === 'palworld') power = Math.min(PAL_POWER_CAP, power);
    const s = statsOf(r), best = (s.atk || 0) >= (s.spa || 0) ? 'physical' : 'special';
    const cat = /phys|melee/.test(c0) ? 'physical' : /spec|shot/.test(c0) ? 'special' : /status/.test(c0) ? 'status' : power ? best : 'status';
    if (cat === 'status' && r.fr !== 'pokemon' && !m.base && !m.status && !m.boosts && !m.weather && !m.terrain
      && !m.volatileStatus && !m.heal && !(m.self && m.self.boosts)) return null;  // text-only Pal/Digimon move
    let type = psId(m.type ?? m.element ?? 'normal'); type = PAL_TYPE[type] || type;
    return { ...m, id, name: m.name || id, type, power: cat === 'status' ? 0 : power, category: cat };
  }
  function fallbackMoves(r) {
    const s = statsOf(r), cat = (s.atk || 0) >= (s.spa || 0) ? 'physical' : 'special';
    const t = ((r && r.types) || []).map(psId).find(x => TYPES.includes(x)) || 'normal';
    const desc = "Placeholder until this monster's moves are set in the editor (Drop 6).";
    return [{ id: 'ml-strike', name: t[0].toUpperCase() + t.slice(1) + ' Strike', type: t, power: 70, accuracy: 100, category: cat, desc },
            { id: 'ml-tackle', name: 'Tackle', type: 'normal', power: 40, accuracy: 100, category: 'physical', desc }];
  }
  const abName = id => (id && ABTXT[id] && ABTXT[id].name) || id || '—';
  const abDesc = id => (id && ABTXT[id] && (ABTXT[id].desc || ABTXT[id].shortDesc)) || '';
  const itemName = id => (ITEMTXT[id] && ITEMTXT[id].name) || id;
  const itemDesc = id => (ITEMTXT[id] && (ITEMTXT[id].desc || ITEMTXT[id].shortDesc)) || '';

  /* ---------------- permanent meta + Box ---------------- */
  function metaGet() {
    let x; try { x = JSON.parse(localStorage.getItem(META)) || {}; } catch { x = {}; }
    x.recruited = x.recruited || {}; x.mega = x.mega || {}; x.runs = x.runs || 0; x.wins = x.wins || 0; return x;
  }
  const saveMeta = x => localStorage.setItem(META, JSON.stringify(x));
  function blankLike(t) {
    const o = {};
    for (const [k, v] of Object.entries(t)) {
      const timeKey = /(^at$|time|date|At$)/.test(k);
      o[k] = typeof v === 'number' ? (timeKey || v > 1e11 ? Date.now() : 1) : typeof v === 'boolean' ? false
        : Array.isArray(v) ? [] : v && typeof v === 'object' ? {} : typeof v === 'string' ? (timeKey ? new Date().toISOString() : null) : v;
    }
    return o;
  }
  function grant(keys) {
    keys = [].concat(keys || []).filter(Boolean); if (!keys.length) return;
    const M = metaGet(); keys.forEach(k => { M.recruited[k] = M.recruited[k] || Date.now(); }); saveMeta(M);
    try {
      if (typeof Gacha.grant === 'function') return keys.forEach(k => Gacha.grant(k));
      const s = Gacha.exportState(); if (!s || !s.box) return;
      const missing = keys.filter(k => !s.box[k]); if (!missing.length) return;
      const tpl = Object.values(s.box)[0];
      missing.forEach(k => { s.box[k] = tpl ? blankLike(tpl) : { n: 1, at: Date.now() }; });
      Gacha.importState(s);
    } catch (e) { console.warn('[run] could not add to Box:', keys, e); }
  }
  function healBox() {
    let box = {}; try { box = Gacha.exportState().box || {}; } catch {}
    const miss = Object.keys(metaGet().recruited).filter(k => !box[k]);
    if (miss.length) grant(miss);
  }

  /* ---------------- monsters: abilities, growth, evolution ---------------- */
  function abilityOptions(r) {
    if (r && r.fr === 'pokemon') {
      const list = Array.isArray(r.abilities) ? r.abilities : r.abilities && typeof r.abilities === 'object' ? Object.values(r.abilities) : [];
      const own = list.map(a => psId(typeof a === 'string' ? a : a && (a.id || a.name))).filter(Boolean);
      if (own.length) return [...new Set(own)];
    }
    return sample(FX().randomAbilities || [], 3);
  }
  function setAbilities(m, random) {
    const r = R(m.key);
    if (m.enemy && (!r || r.fr !== 'pokemon')) { m.abOpts = []; m.ability = null; return; }   // enemy Pals/Digimon: none
    m.abOpts = abilityOptions(r);
    const coded = m.abOpts.filter(id => FX().hasAbility(id));
    m.ability = random ? rand(m.abOpts) : (coded[0] || m.abOpts[0] || null);
  }
  const megaAbility = m => abilityOptions(R(m.mega))[0] || m.ability;
  function digiLv(stage) {
    const s = String(stage ?? '').toLowerCase(); if (!s) return null;
    if (/baby\s*(ii|2)|in-?training/.test(s)) return 5;
    if (/baby/.test(s)) return 1;
    if (/child|rookie/.test(s)) return 10;
    if (/adult|champion|armor/.test(s)) return 20;
    if (/perfect|hybrid/.test(s)) return 40;
    if (/ultimate|mega/.test(s)) return 65;
    return null;
  }
  function evoLv(r, e, t) {
    if (r.fr === 'digimon') return digiLv(t.level ?? t.stage) ?? 99;
    const n = +(e.lv ?? e.level ?? e.minLevel ?? e.min_level);
    if (n > 0) return n;
    const how = String(e.method ?? e.trigger ?? e.how ?? e.via ?? '').toLowerCase();
    return /trade/.test(how) ? EVO_FALLBACK.trade : /stone|item|use/.test(how) ? EVO_FALLBACK.stone
      : /friend|happi|affection/.test(how) ? EVO_FALLBACK.friendship : EVO_FALLBACK.other;
  }
  function pickEvo(m) {
    if (m.mega) return null;
    const r = R(m.key); if (!r) return null;
    const ok = evoTargets(r, m.enemy).filter(x => evoLv(r, x.e, R(x.to)) <= m.lv);
    return ok.length ? rand(ok).to : null;                        // branching = random among valid next-stage targets
  }
  // Digimon: Baby I→II (5) → Child (10) → Adult/Armor (20) → Perfect/Hybrid (40) → Ultimate (65), one stage at a time
  const DIGI_NEXT = { 1: 5, 5: 10, 10: 20, 20: 40, 40: 65 };
  function evoTargets(r, enemy) {
    return evoList(r).map(e => ({ e, to: evoTo(e, r) })).filter(x => {
      const t = x.to && !isForm(x.to) && R(x.to); if (!t) return false;
      if (r.fr === 'digimon') {
        const a = digiLv(r.level ?? r.stage), b = digiLv(t.level ?? t.stage);
        if (a == null || b == null || DIGI_NEXT[a] !== b) return false;     // no skipping, no same-stage swaps
        if (enemy && !t.verified) return false;                          // enemies only become Finished Digimon
      }
      return true;
    });
  }
  function learn(m) {
    const r = R(m.key), names = [];
    for (const e of learnOf(m.key)) {
      if (e.lv > m.lv || m.learned.includes(e.id)) continue;
      const mv = moveObj(r, e.id); if (mv) { m.learned.push(e.id); (m.learnedAt = m.learnedAt || {})[e.id] = stamp(); names.push(mv.name); }
    }
    return names;
  }
  function grow(m, lv) {
    const out = { from: m.lv, evo: [], learned: [] };
    m.lv = Math.min(100, Math.max(m.lv, lv));
    for (let i = 0; i < 6; i++) {
      out.learned.push(...learn(m));
      const to = pickEvo(m); if (!to) break;
      out.evo.push(R(to).name); (m.line = m.line || []).push(m.key); m.key = to; m.mega = null; setAbilities(m, true);   // evolving: random ability, changeable after
    }
    return out;
  }
  function newMon(key, lv, enemy) {
    const m = { uid: uid(), key, origin: key, lv: 1, ability: null, abOpts: [], item: null, learned: [], lastUsed: {}, mega: null, enemy: !!enemy };
    setAbilities(m, !!enemy); grow(m, lv); return m;
  }
  function formsOf(m) {
    const r = R(m.key); if (!r || r.fr !== 'pokemon') return [];
    const M = metaGet();
    return KEYS.filter(k => isForm(k) && M.mega[k]).filter(k => { const f = R(k); return f && f.dex === r.dex; });
  }
  function enemyMoves(list) {
    const recent = list.slice(-4);
    if (!recent.some(x => x.category !== 'status')) { const d = list.filter(x => x.category !== 'status').pop(); if (d) recent[0] = d; }
    return recent;
  }
  function battler(m, o = {}) {
    const k = m.mega || m.key, r = R(k);
    let moves = m.learned.map(id => mvOf(m, id)).filter(Boolean);
    if (o.enemy) moves = enemyMoves(moves);
    if (!moves.some(x => x.category !== 'status')) moves = fallbackMoves(r).concat(moves);
    const b = Battle.makeMon(r, m.lv, moves, { ability: m.mega ? megaAbility(m) : m.ability, item: m.item,
      allMoves: !o.enemy, hpMult: o.hpMult || 1, actions: o.actions || 1 });
    b.uid = m.uid; b.lastUsed = Object.assign({}, m.learnedAt, m.lastUsed); return b;
  }

  /* ---------------- pools ---------------- */
  let run = null, draft = null, screen = 'home', detail = null, endLines = [], root = null;
  const allMons = () => run ? run.team.concat(run.box) : [];
  function wildPool(tier, withDigimon, excludeRun) {
    const taken = new Set(excludeRun ? allMons().flatMap(m => [m.key, m.origin]) : []);
    return KEYS.filter(k => {
      if (taken.has(k) || isForm(k)) return false;
      const r = R(k); if (!r || tierOf(r) !== tier) return false;
      return r.fr !== 'digimon' || withDigimon || r.verified;
    });
  }
  function startPool(kind) {
    const taken = new Set(draft.picks);
    return KEYS.filter(k => {
      if (taken.has(k) || isForm(k)) return false;
      const r = R(k); if (!r || !draft.filter[r.fr]) return false;
      if (r.fr === 'palworld') return kind === 'roll' || tierOf(r) === 'early';      // free rolls: any Pal
      return tierOf(r) === 'early' && hasEvo(r);
    });
  }
  function boxStarters() {
    let box = {}; try { box = Gacha.exportState().box || {}; } catch {}
    const M = metaGet();
    return [...new Set([...Object.keys(box), ...Object.keys(M.recruited)])].filter(k => {
      const r = R(k); if (!r || isForm(k) || STARTERS.includes(k)) return false;
      return hasEvo(r) ? tierOf(r) === 'early' : !!M.recruited[k];
    });
  }
  function makeEnemies(f) {
    const n = f === FINAL ? 1 : BOSS.includes(f) ? 6 : 3, lv = enemyLv(f);
    const pool = f === FINAL
      ? KEYS.filter(k => { const r = R(k); return r && (isForm(k) || tierOf(r) === 'legend') && (r.fr !== 'digimon' || r.verified); })
      : wildPool(tierFor(f), false, false);
    if (!pool.length) console.warn('[run] enemy pool is empty for floor', f, '— run MonsterRun.check()');
    return sample(pool, n).map(k => newMon(k, lv, true));
  }

  /* ---------------- save ---------------- */
  const save = cloud => { if (run) localStorage.setItem(SAVE, JSON.stringify(run)); if (cloud && Gacha.sync) Gacha.sync(); };
  const loadRun = () => { try { return JSON.parse(localStorage.getItem(SAVE)); } catch { return null; } };

  /* ---------------- flow ---------------- */
  function newDraft() { draft = { picks: [], granted: [], offer: null, offerUsed: false, rolls: 2, msg: '', mons: [],
    filter: { pokemon: true, palworld: true, digimon: true } }; }
  function beginRun() {
    const M = metaGet(); M.runs++; saveMeta(M);
    run = { v: 1, floor: 1, team: draft.mons.slice(0, TEAM_MAX), box: draft.mons.slice(TEAM_MAX), bag: [],
      enemies: null, stage: 'hub', rewards: [], started: Date.now() };
    grant(draft.granted); draft = null; save(); screen = 'hub'; render();
  }
  async function startBattle() {
    const f = run.floor, fin = f === FINAL;
    if (!run.enemies || !run.enemies.length) return alert('No enemies could be generated for this floor. Run MonsterRun.check() in the console and send me the output.');
    const me = run.team.map(m => battler(m));
    const foe = run.enemies.map(e => battler(e, { enemy: true, hpMult: fin ? 3 : 1, actions: fin ? 2 : 1 }));
    root.style.display = 'none';
    const res = await BattleUI.open(me, foe, { title: `Floor ${f}/31${fin ? ' — LEGEND' : BOSS.includes(f) ? ' — BOSS' : ''}` });
    root.style.display = '';
    res.player.forEach(b => { const m = allMons().find(x => x.uid === b.uid); if (m && b.lastUsed) m.lastUsed = b.lastUsed; });
    save();
    if (res.result === 'win') return onWin();
    if (res.action === 'rebattle') return startBattle();
    return endRun();
  }
  function onWin() {
    const f = run.floor;
    if (f === FINAL) return finalWin();
    const lv = f >= 30 ? 100 : Lf(f + 1), lines = [];
    allMons().forEach(m => {
      const before = R(m.key).name, g = grow(m, lv);
      let t = `${before}: Lv ${g.from} → ${m.lv}`;
      if (g.evo.length) t += ` · evolved into ${g.evo.join(' → ')}!`;
      if (g.learned.length) t += ` · learned ${g.learned.slice(0, 6).join(', ')}${g.learned.length > 6 ? ` +${g.learned.length - 6} more` : ''}`;
      lines.push(t);
    });
    const tier = tierFor(f);
    run.rewards = [{ type: 'summary', lines }];
    const owned = new Set(allMons().flatMap(m => [m.key, m.origin]));
    const p3 = sample([...new Set(run.enemies.map(e => e.key))].filter(k => !owned.has(k)), 3);
    if (p3.length) run.rewards.push({ type: 'pick3', keys: p3, lv });
    if (ITEM_FLOORS.includes(f)) {                         // every 5 floors cleared: free roll + item
      const roll = rand(wildPool(tier, true, true).filter(k => !p3.includes(k)));
      if (roll) run.rewards.push({ type: 'roll', key: roll, lv });
      run.rewards.push({ type: 'item' });
    }
    run.floor = f + 1; run.enemies = null; run.stage = 'reward';
    save(BOSS.includes(f)); screen = 'reward'; render();
  }
  function recruit(key, lv) {
    const m = newMon(key, lv);
    (run.team.length < TEAM_MAX ? run.team : run.box).push(m);
    grant(key);
  }
  function nextReward() {
    run.rewards.shift();
    if (!run.rewards.length) { run.stage = 'hub'; screen = 'hub'; }
    save(); render();
  }
  function finalWin() {
    const k = run.enemies[0].key, r = R(k);
    if (isForm(k)) {
      const M = metaGet(); M.mega[k] = Date.now(); M.wins++; saveMeta(M);
      endLines = [`You beat ${r.name}!`, `Form unlocked: in future runs, once that Pokémon reaches the right stage, you can switch it to ${r.name} between battles.`];
    } else {
      grant(k); const M = metaGet(); M.wins++; saveMeta(M);
      endLines = [`You beat ${r.name}!`, `${r.name} joined your Box. You can start future runs with it.`];
    }
    Gacha.sync && Gacha.sync();localStorage.removeItem(SAVE); run = null; screen = 'victory'; render();
  }
  function endRun() {
    const f = run ? run.floor : 0;
    localStorage.removeItem(SAVE); run = null; detail = null;Gacha.sync && Gacha.sync();
    endLines = [`Run ended on floor ${f}.`, 'Everything you recruited stays in your Box. Next run starts fresh at Lv 5.'];
    screen = 'ended'; render();
  }

  /* ---------------- views ---------------- */
  function card(k, extra = '', attrs = '', cls = '', tag = '') {
    const r = R(k) || { name: k, types: [] };
    return `<div class="mlr-card ${cls}" ${attrs}>${tag ? `<span class="mlr-tag">${tag}</span>` : ''}<img src="${esc((Gacha.img && Gacha.img(k)) || r.img || '')}" alt="">
      <div class="mlr-nm">${esc(r.name)}</div><div class="mlr-sub">${esc(FR_LABEL[r.fr] || '')}${esc(extra)}</div></div>`;
  }
  const monCard = (m, tag) => card(m.mega || m.key, ` · Lv ${m.lv}${m.item ? ' · ' + itemName(m.item) : ''}`, `data-mon="${m.uid}"`, '', tag);
  function abilitySelect(m) {
    if (!m.abOpts.length) return '<span class="mlr-dim">No ability</span>';
    const opts = m.abOpts.slice().sort((a, b) => FX().hasAbility(b) - FX().hasAbility(a));
    return `<select data-ab="${m.uid}">${opts.map(id => `<option value="${esc(id)}" ${id === m.ability ? 'selected' : ''}>${esc(abName(id))}${FX().hasAbility(id) ? '' : ' (no battle effect yet)'}</option>`).join('')}</select>
      <div class="mlr-dim">${esc(abDesc(m.ability))}</div>`;
  }
  function vHome() {
    const s = loadRun(), M = metaGet();
    return `<h2>Monster Lab Run</h2><p class="mlr-dim">31 floors · Early → Mid → Late → Legend · Runs cleared: ${M.wins} / ${M.runs}</p>
      ${s ? `<div class="mlr-box"><b>Saved run — Floor ${s.floor}/31</b><div class="mlr-grid" style="margin:6px 0">${s.team.map(m => card(m.mega || m.key, ' · Lv ' + m.lv)).join('')}</div>
        <button class="big" data-act="resume">Resume</button> <button data-act="abandon">Abandon</button></div>` : ''}
      <button class="${s ? '' : 'big'}" data-act="new">${s ? 'Start new run (deletes save)' : 'Start new run'}</button> <button data-act="close">Close</button>`;
  }
  function vStart() {
    const full = draft.picks.length >= START_MAX;
    const pick = k => card(k, '', draft.picks.includes(k) ? '' : `data-info="${esc(k)}" data-ctx="pick"`, draft.picks.includes(k) ? 'sel' : '');
    const boxKeys = boxStarters();
    return `<h2>New run</h2>
      <div class="mlr-box"><h3>Your party (${draft.picks.length}/${START_MAX})</h3>
        <div class="mlr-grid">${draft.picks.map(k => card(k, ' · tap for info', `data-info="${esc(k)}" data-ctx="party"`)).join('') || '<span class="mlr-dim">Pick up to 6 below.</span>'}</div>
        <div style="margin-top:8px"><button class="big" data-act="toAbilities" ${draft.picks.length ? '' : 'disabled'}>Next: abilities →</button> <button data-act="home">Back</button></div></div>
      <div class="mlr-box"><h3>Random offers (optional)</h3>
        <div class="mlr-row">${FRS.map(f => `<label><input type="checkbox" data-flt="${f}" ${draft.filter[f] ? 'checked' : ''}> ${FR_LABEL[f]}</label>`).join(' ')}</div>
        <div class="mlr-row" style="margin-top:6px">
          <button data-act="offer3" ${draft.offerUsed || full ? 'disabled' : ''}>Pick 1 of 3 (Early)</button>
          <button data-act="roll" ${draft.rolls <= 0 || full ? 'disabled' : ''}>Free roll (${draft.rolls} left)</button>
          <span class="mlr-dim">${esc(draft.msg)}</span></div>
        ${draft.offer ? `<div class="mlr-grid" style="margin-top:6px">${draft.offer.map(k => card(k, ' · tap for info', `data-info="${esc(k)}" data-ctx="offer"`)).join('') || '<span class="mlr-dim">Nothing matched the filter.</span>'}</div>
          <button data-offer="skip">Skip</button>` : ''}</div>
      <div class="mlr-box"><h3>Starters</h3><div class="mlr-grid">${STARTERS.filter(R).map(pick).join('')}</div></div>
      <div class="mlr-box"><h3>From your Box</h3><p class="mlr-dim">Early monsters that can evolve, plus anything recruited in a run that doesn't evolve.</p>
        <div class="mlr-grid mlr-scroll">${boxKeys.map(pick).join('') || '<span class="mlr-dim">Nothing eligible yet.</span>'}</div></div>`;
  }
  function vAbilities() {
    return `<h2>Choose abilities</h2><p class="mlr-dim">You can change these between battles. "(no battle effect yet)" abilities do nothing in battle for now.</p>
      ${draft.mons.map(m => `<div class="mlr-box mlr-row">${card(m.key, ' · Lv ' + m.lv)}<div style="flex:1">${abilitySelect(m)}</div></div>`).join('')}
      <button class="big" data-act="begin">Begin floor 1</button> <button data-act="backStart">Back</button>`;
  }
  function vHub() {
    const f = run.floor;
    if (!run.enemies) { run.enemies = makeEnemies(f); save(); }
    const label = f === FINAL ? 'LEGEND FLOOR — 3× HP, acts twice' : BOSS.includes(f) ? 'BOSS FLOOR — 6 enemies' : '3 enemies';
    return `<h2>Floor ${f} / 31</h2>
      <p class="mlr-dim">${tierFor(f).toUpperCase()} pool · enemies Lv ${enemyLv(f)} · ${label}</p>
      <div class="mlr-box"><h3>Next battle</h3><div class="mlr-grid">${run.enemies.map(e => card(e.key, ' · Lv ' + e.lv, `data-info="${esc(e.key)}"`)).join('') || '<span class="mlr-dim">No enemies found.</span>'}</div></div>
      <div class="mlr-box"><h3>Team (${run.team.length}/${TEAM_MAX}) — first 3 start active · tap to manage</h3>
        <div class="mlr-grid mlr-drop" id="mlr-team">${run.team.map((m, i) => monCard(m, i < 3 ? 'ACTIVE' : '')).join('')}</div></div>
      <div class="mlr-box"><h3>Run box (${run.box.length}) — drag monsters between team and box</h3><div class="mlr-grid mlr-drop" id="mlr-boxgrid">${run.box.map(m => monCard(m)).join('')}</div></div>
      <div class="mlr-box"><h3>Bag</h3><div class="mlr-dim">${run.bag.length ? run.bag.map(itemName).map(esc).join(', ') + ' — tap a monster to give an item.' : 'Empty. You get to pick an item after floors 5, 10, 15, 20, 25 and 30.'}</div></div>
      <button class="big" data-act="fight">Fight floor ${f}</button> <button data-act="saveclose">Save & close</button> <button data-act="endrun">End run</button>
      ${detail ? vDetail(allMons().find(m => m.uid === detail)) : ''}`;
  }
  function vDetail(m) {
    if (!m) return '';
    const k = m.mega || m.key, r = R(k), inTeam = run.team.includes(m), forms = formsOf(m);
    const moves = m.learned.map(id => mvOf(m, id)).filter(Boolean)
      .sort((a, b) => recent(m, b.id) - recent(m, a.id));
    return `<div class="mlr-modal"><div class="mlr-panel">
      <div class="mlr-row">${card(k, ' · Lv ' + m.lv)}<div style="flex:1"><b>${esc(r.name)}</b>
        <div class="mlr-dim">${esc((r.types || []).join(' / '))}${r.attribute ? ' · ' + esc(r.attribute) : ''}</div></div><button data-info="${esc(k)}">Full info</button><button data-act="closeDetail">✕</button></div>
      <h3>Ability</h3>${m.mega ? `<div class="mlr-dim">This form uses ${esc(abName(megaAbility(m)))}: ${esc(abDesc(megaAbility(m)))}</div>` : abilitySelect(m)}
      <h3>Held item</h3><div class="mlr-row">${m.item ? `<b>${esc(itemName(m.item))}</b> <button data-act="unequip">Remove</button>` : '<span class="mlr-dim">None</span>'}
        ${[...new Set(run.bag)].map(id => `<button data-equip="${esc(id)}">Give ${esc(itemName(id))}</button>`).join('')}</div>
      ${m.item ? `<div class="mlr-dim">${esc(itemDesc(m.item))}</div>` : ''}
      ${forms.length || m.mega ? `<h3>Form</h3><div class="mlr-row">${forms.filter(x => x !== m.mega).map(x => `<button data-form="${esc(x)}">→ ${esc(R(x).name)}</button>`).join('')}
        ${m.mega ? '<button data-act="revert">Revert to normal form</button>' : ''}</div>` : ''}
      <h3>Position</h3><div class="mlr-row">${inTeam
        ? `<button data-act="lead">Make lead</button><button data-act="toBox" ${run.team.length <= 1 ? 'disabled' : ''}>Move to run box</button>`
        : `<button data-act="toTeam" ${run.team.length >= TEAM_MAX ? 'disabled' : ''}>Move to team</button>${run.team.length >= TEAM_MAX ? ' <span class="mlr-dim">Team is full — move someone to the box first.</span>' : ''}`}</div>
      <h3>Moves (${moves.length}) — all usable in battle, newest first (just learned or recently used)</h3>
      ${moves.map(v => `<div class="mlr-mv"><span>${esc(v.name)}</span><span class="mlr-dim">${esc(v.type)} · ${v.category}${v.power ? ' · ' + v.power : ''}</span></div>`).join('')
        || '<div class="mlr-dim">No usable moves yet — uses placeholder Strike/Tackle until the editor (Drop 6).</div>'}
    </div></div>`;
  }
  function vReward() {
    const rw = run.rewards[0];
    if (!rw) { run.stage = 'hub'; screen = 'hub'; return vHub(); }
    const head = `<h2>Floor ${run.floor - 1} cleared!</h2>`;
    if (rw.type === 'summary') return head + `<div class="mlr-box">${rw.lines.map(l => `<div style="margin:3px 0">${esc(l)}</div>`).join('')}</div>
      <button class="big" data-act="continue">Continue</button>`;
    if (rw.type === 'pick3') return head + `<h3>Recruit one — joins at Lv ${rw.lv} (may evolve right away)</h3>
      <div class="mlr-grid">${rw.keys.map(k => card(k, ' · tap for info', `data-info="${esc(k)}" data-ctx="take"`)).join('')}</div><button data-act="skip">Skip</button>`;
    if (rw.type === 'roll') return head + `<h3>Free roll!</h3><div class="mlr-grid" style="max-width:120px">${card(rw.key, ' · tap for info', `data-info="${esc(rw.key)}"`)}</div>
      <button class="big" data-take="${esc(rw.key)}">Keep</button> <button data-act="skip">Skip</button>`;
    if (rw.type === 'item') {
      const ids = Object.keys(FX().items).sort((a, b) => itemName(a).localeCompare(itemName(b)));
      return head + `<h3>Choose an item — it goes to your bag; give it to a monster from the floor screen</h3>
        <input type="text" data-filter placeholder="Search items…" style="width:100%;margin-bottom:6px">
        <div class="mlr-scroll" style="max-height:55vh">${ids.map(id => `<div class="mlr-item" data-item="${esc(id)}"><b>${esc(itemName(id))}</b><span class="mlr-dim">${esc(itemDesc(id))}</span></div>`).join('')}</div>
        <button data-act="skip">Skip</button>`;
    }
    return '';
  }
    let info = null;
  function vInfo() {
    const r = info && R(info.k); if (!r) return '';
    const s = statsOf(r), ST = [['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe']];
    const abil = r.fr === 'pokemon' ? abilityOptions(r).map(id => abName(id) + (FX().hasAbility(id) ? '' : ' (no effect yet)')).join(', ') : 'Gets 3 random abilities to choose from when it joins';
    const evos = evoTargets(r).map(x => `${R(x.to).name} (Lv ${evoLv(r, x.e, R(x.to))})`);
    const moves = learnOf(info.k).map(e => ({ lv: e.lv, mv: moveObj(r, e.id) })).filter(x => x.mv);
    const go = { pick: 'Add to party', offer: 'Take this one', party: 'Remove from party', take: 'Recruit' }[info.ctx];
    const owned = r.fr === 'pokemon' && (Gacha.exportState().box || {})[info.k];
    const skins = Array.isArray(info.cards) ? `<h3>TCG card art</h3><div class="mlr-skins"><button data-skin="">Default art</button>${info.cards.slice(-60).reverse()
      .map(c => `<img data-skin="${esc(c.img + '/high.webp')}" src="${esc(c.img)}/low.webp" loading="lazy" alt="">`).join('') || '<span class="mlr-dim">No cards found.</span>'}</div>`
      : info.cards === 'loading' ? '<div class="mlr-dim">Loading cards…</div>' : '';
    return `<div class="mlr-modal" style="z-index:30"><div class="mlr-panel">
      <div class="mlr-row">${card(info.k)}<div style="flex:1"><b>${esc(r.name)}</b><div class="mlr-dim">${esc(FR_LABEL[r.fr])} · ${esc((r.types || []).join(' / '))}${r.attribute ? ' · ' + esc(r.attribute) : ''} · ${esc(tierOf(r) || '?')} tier</div></div><button data-act="infoClose">✕</button></div>
      <h3>Base stats</h3>${ST.map(([k, l]) => `<div class="mlr-stat"><span>${l}</span><b>${s[k] ?? '?'}</b><i style="width:${Math.min(100, (s[k] || 0) / 2)}%"></i></div>`).join('')}
      <h3>Abilities</h3><div class="mlr-dim">${esc(abil)}</div>
      <h3>Evolves into</h3><div class="mlr-dim">${esc(evos.join(', ') || 'Does not evolve')}</div>
      <h3>Moves (${moves.length})</h3>${moves.map(x => `<div class="mlr-mv" title="${esc(x.mv.desc || '')}"><span>Lv ${x.lv} · ${esc(x.mv.name)}</span><span class="mlr-dim">${esc(x.mv.type)} · ${x.mv.category}${x.mv.power ? ' · ' + x.mv.power : ''}</span></div>`).join('') || '<div class="mlr-dim">No usable moves yet. Uses placeholder moves until edited.</div>'}
      ${skins}<div style="margin-top:10px">${go ? `<button class="big" data-act="infoGo">${go}</button>` : ''} ${owned ? '<button data-act="skin">Choose TCG card art</button>' : ''} ${r.fr !== 'pokemon' && window.MonsterEditor ? '<button data-act="edit">Edit types & moves</button>' : ''} <button data-act="infoClose">Close</button></div>
    </div></div>`;
  }
  function syncOrder() {
    const pool = allMons(), by = u => pool.find(m => m.uid === u);
    const ids = id => [...root.querySelectorAll('#' + id + ' [data-mon]')].map(e => e.dataset.mon);
    const t = ids('mlr-team'), bx = ids('mlr-boxgrid');
    if (t.length >= 1 && t.length <= TEAM_MAX) { run.team = t.map(by); run.box = bx.map(by); save(); }
    render();
  }
  function infoGo() {
    const { k, ctx } = info, r = R(k);
    const full = () => draft.picks.length >= START_MAX && (alert('Party is full. Remove someone first.'), true);
    if (ctx === 'pick') { if (full()) return; if (!draft.picks.includes(k)) draft.picks.push(k); }
    else if (ctx === 'offer') { if (full()) return; draft.picks.push(k); draft.granted.push(k); draft.offer = null; }
    else if (ctx === 'party') {
      const gift = draft.granted.includes(k);
      if (!confirm(`Remove ${r.name} from your party?` + (gift ? '\nIt came from a random offer or free roll, so removing it gives it up for good.' : ''))) return;
      draft.picks = draft.picks.filter(x => x !== k); draft.granted = draft.granted.filter(x => x !== k);
    }
    else if (ctx === 'take') { info = null; recruit(k, run.rewards[0].lv); return nextReward(); }
    info = null; render();
  }
  async function skinPicker(k) { info.cards = 'loading'; render(); const c = await Gacha.cards(R(k)); if (info && info.k === k) { info.cards = c; render(); } }

  function vEnd(title) {
    return `<h2>${title}</h2><div class="mlr-box">${endLines.map(l => `<div>${esc(l)}</div>`).join('')}</div><button class="big" data-act="home">Back</button>`;
  }
  function render() {
    if (!root) return;
    const body = screen === 'start' ? vStart() : screen === 'abilities' ? vAbilities() : screen === 'hub' ? vHub()
      : screen === 'reward' ? vReward() : screen === 'victory' ? vEnd('Run cleared! 🏆') : screen === 'ended' ? vEnd('Run over') : vHome();
    root.innerHTML = `<div class="mlr-wrap">${body}</div>${info ? vInfo() : ''}`;
    root.querySelectorAll('.mlr-wrap .mlr-card[data-info]').forEach(c => c.insertAdjacentHTML('beforeend', '<span class="mlr-ib" title="Info">i</span>'));
    if (screen === 'hub' && window.Sortable) ['mlr-team', 'mlr-boxgrid'].forEach(id => {
      const el = root.querySelector('#' + id);
      if (el) Sortable.create(el, { group: 'mlr', animation: 150, delay: 150, delayOnTouchOnly: true, onEnd: syncOrder });
    });
  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    const el = e.target.closest('[data-act],[data-skin],[data-info],[data-pick],[data-unpick],[data-offer],[data-mon],[data-take],[data-item],[data-equip],[data-form]');
    if (!el || !root.contains(el) || el.disabled) return;
    const d = el.dataset, a = d.act;
    if (a === 'close') return close();
    if (a === 'infoClose') { info = null; return render(); }
    if (a === 'infoGo' && info) return infoGo();
    if (a === 'skin' && info) return skinPicker(info.k);
    if (d.skin !== undefined && info) { Gacha.setSkinQuiet(info.k, d.skin); info.cards = null; return render(); }
    if (a === 'edit' && info) { const keep = info; info = null; render();
      return MonsterEditor.open(keep.k).then(() => { info = keep; render(); }); }
    if (d.info) {
      const peek = e.target.closest('.mlr-ib') || !el.querySelector('img');      // "i" badge or the "Full info" button
      if (!peek && ['pick', 'offer', 'party', 'take'].includes(d.ctx)) { info = { k: d.info, ctx: d.ctx }; return infoGo(); }
      info = { k: d.info, ctx: d.ctx || '' }; return render();
    }
    if (a === 'home') { screen = 'home'; detail = null; return render(); }
    if (a === 'new') { if (loadRun() && !confirm('Start a new run? Your saved run will be deleted.')) return; localStorage.removeItem(SAVE); run = null; newDraft(); screen = 'start'; return render(); }
    if (a === 'resume') { run = loadRun(); screen = run.stage === 'reward' && run.rewards && run.rewards.length ? 'reward' : 'hub'; return render(); }
    if (a === 'abandon') { if (confirm('Abandon this run? Recruits stay in your Box.')) { localStorage.removeItem(SAVE); run = null; render(); } return; }
    // start screen
    if (d.pick) { if (draft.picks.length < START_MAX && !draft.picks.includes(d.pick)) draft.picks.push(d.pick); return render(); }
    if (d.unpick !== undefined) { const k = draft.picks.splice(+d.unpick, 1)[0]; draft.granted = draft.granted.filter(x => x !== k); return render(); }
    if (a === 'offer3') { draft.offer = sample(startPool('offer'), 3); draft.offerUsed = true; return render(); }
    if (d.offer) { if (d.offer !== 'skip' && draft.picks.length < START_MAX) { draft.picks.push(d.offer); draft.granted.push(d.offer); } draft.offer = null; return render(); }
    if (a === 'roll') {
      const k = rand(startPool('roll'));
      if (k && draft.picks.length < START_MAX) { draft.picks.push(k); draft.granted.push(k); draft.rolls--; draft.msg = `Free roll: ${R(k).name}!`; }
      else draft.msg = 'Nothing matched the filter.';
      return render();
    }
    if (a === 'toAbilities') { draft.mons = draft.picks.map(k => newMon(k, Lf(1))); screen = 'abilities'; return render(); }
    if (a === 'backStart') { screen = 'start'; return render(); }
    if (a === 'begin') return beginRun();
    // floor screen
    if (a === 'fight') return startBattle();
    if (a === 'saveclose') { save(); return close(); }
    if (a === 'endrun') { if (confirm('End this run? Recruits stay in your Box.')) endRun(); return; }
    if (d.mon) { detail = d.mon; return render(); }
    if (a === 'closeDetail') { detail = null; return render(); }
    const m = detail && allMons().find(x => x.uid === detail);
    if (m) {
      if (a === 'toBox' && run.team.length > 1 && run.team.includes(m)) { run.team.splice(run.team.indexOf(m), 1); run.box.push(m); }
      else if (a === 'toTeam' && run.team.length < TEAM_MAX && run.box.includes(m)) { run.box.splice(run.box.indexOf(m), 1); run.team.push(m); }
      else if (a === 'lead' && run.team.includes(m)) { run.team.splice(run.team.indexOf(m), 1); run.team.unshift(m); }
      else if (a === 'unequip' && m.item) { run.bag.push(m.item); m.item = null; }
      else if (d.equip) { const i = run.bag.indexOf(d.equip); if (i >= 0) { run.bag.splice(i, 1); if (m.item) run.bag.push(m.item); m.item = d.equip; } }
      else if (d.form) m.mega = d.form;
      else if (a === 'revert') m.mega = null;
      else return;
      save(); return render();
    }
    // rewards
    if (d.take) { recruit(d.take, run.rewards[0].lv); return nextReward(); }
    if (d.item) { run.bag.push(d.item); return nextReward(); }
    if (a === 'skip' || a === 'continue') return nextReward();
  }
  function onChange(e) {
    const el = e.target;
    if (el.dataset.ab) {
      const m = (run ? allMons() : (draft ? draft.mons : [])).find(x => x.uid === el.dataset.ab);
      if (m) { m.ability = el.value; save(); render(); }
    } else if (el.dataset.flt) {
      draft.filter[el.dataset.flt] = el.checked;
      if (!FRS.some(f => draft.filter[f])) draft.filter[el.dataset.flt] = true;
      render();
    }
  }
  function onInput(e) {
    if (e.target.dataset.filter === undefined) return;
    const q = e.target.value.toLowerCase();
    root.querySelectorAll('[data-item]').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
  }

  /* ---------------- open / close / test ---------------- */
  async function open() {
    if (!window.Gacha || !Gacha.mon || !window.Battle || !window.BattleUI) return alert('Monster Lab is still loading. Open the Monster Lab tab, then try again.');
    if (!R('pkmn:bulbasaur')) return alert('Monster data has not loaded yet. Open the Monster Lab tab once, wait for it to load, then try again.');
    await load();
    healBox();
    if (!root) {
      root = document.createElement('div'); root.className = 'mlr';
      root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput);
    }
    document.body.appendChild(root);
    run = loadRun(); screen = 'home'; detail = null; info = null; render();
  }
  function close() { if (root) root.remove(); try { if (typeof window.render === 'function') window.render(); } catch {} }
  async function check() {
    await load();
    const t = {};
    KEYS.forEach(k => { const r = R(k); if (!r) return; const g = `${r.fr} · ${tierOf(r) || '(no tier)'}`; t[g] = (t[g] || 0) + 1; });
    console.table(t);
    console.log('Mega/Gmax/Primal forms found:', KEYS.filter(isForm).length);
    const c = newMon('pkmn:charmander', 40);
    console.log('Charmander grown to Lv40 →', R(c.key).name, '| moves:', c.learned.length, '| last 5:', c.learned.slice(-5), '| ability:', c.ability);
    const palKey = KEYS.find(k => R(k) && R(k).fr === 'palworld');
    if (palKey) { const p = newMon(palKey, 30); console.log('Pal test', R(palKey).name, '| moves:', p.learned.length, p.learned.slice(0, 5), '| abilities:', p.abOpts); }
    console.log('Coded items:', Object.keys(FX().items).length, '| item names found:', Object.keys(FX().items).filter(id => ITEMTXT[id]).length);
  }
  function jump(f) {
    if (!run) return console.warn('Start or resume a run first.');
    run.floor = Math.max(1, Math.min(FINAL, f));
    const lv = run.floor >= FINAL ? 100 : Lf(run.floor);
    allMons().forEach(m => grow(m, lv));
    run.enemies = null; run.rewards = []; run.stage = 'hub'; detail = null; save(); screen = 'hub'; render();
  }

  window.MonsterRun = { open, close, check, jump,
    api: { load, learnOf, baseMove: (r, id) => (r && MOVES[r.fr] && MOVES[r.fr][id]) || null } };   // used by game/editor.js
})();
