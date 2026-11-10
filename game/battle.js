/* MONSTER LAB — Mode A battle engine         file: game/battle.js
   Load AFTER game/effects.js and BEFORE game/gacha.js.
   Pure logic, no DOM. A UI calls: Battle.create(), b.choose(), b.runTurn(). */
(function () {
  const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
  // super-effective (2×) / resisted (0.5×) / immune (0×) — attacker → defenders
  const SE = {fire:'grass ice bug steel',water:'fire ground rock',electric:'water flying',grass:'water ground rock',ice:'grass ground flying dragon',fighting:'normal ice rock dark steel',poison:'grass fairy',ground:'fire electric poison rock steel',flying:'grass fighting bug',psychic:'fighting poison',bug:'grass psychic dark',rock:'fire ice flying bug',ghost:'psychic ghost',dragon:'dragon',dark:'psychic ghost',steel:'ice rock fairy',fairy:'fighting dragon dark'};
  const NVE = {normal:'rock steel',fire:'fire water rock dragon',water:'water grass dragon',electric:'electric grass dragon',grass:'fire grass poison flying bug dragon steel',ice:'fire water ice steel',fighting:'poison flying psychic bug fairy',poison:'poison ground rock ghost',ground:'grass bug',flying:'electric rock steel',psychic:'psychic steel',bug:'fire fighting poison flying ghost steel fairy',rock:'fighting ground steel',ghost:'dark',dragon:'steel',dark:'fighting dark fairy',steel:'fire water electric steel',fairy:'fire poison steel'};
  const IMM = {normal:'ghost',electric:'ground',fighting:'ghost',poison:'steel',ground:'flying',psychic:'dark',ghost:'normal',dragon:'fairy'};
  const DIGI = {vaccine:'virus', virus:'data', data:'vaccine'};            // attacker beats defender
  const has = (map, a, d) => (map[a] || '').split(' ').includes(d);

  function typeEff(mt, defTypes) {
    let e = 1;
    for (const d of defTypes) {
      if (!TYPES.includes(d) || !TYPES.includes(mt)) continue;          // Digimon attributes etc. skipped here
      if (has(IMM, mt, d)) return 0;
      if (has(SE, mt, d)) e *= 2; else if (has(NVE, mt, d)) e *= 0.5;
    }
    return Math.min(e, 4);
  }
  const STAGE = s => s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
  const ACC_STAGE = s => s >= 0 ? (3 + s) / 3 : 3 / (3 - s);              // accuracy / evasion use thirds
  // moves whose power depends on the situation (Showdown lists many of them as 0)
  const posBoosts = m => Object.values(m.boosts).reduce((a, v) => a + Math.max(0, v), 0);
  const VAR = {
    gyroball: (m, t, rs) => Math.min(150, Math.floor(25 * rs(t, 'spe') / Math.max(1, rs(m, 'spe'))) + 1),
    electroball: (m, t, rs) => { const r = rs(m, 'spe') / Math.max(1, rs(t, 'spe')); return r >= 4 ? 150 : r >= 3 ? 120 : r >= 2 ? 80 : r >= 1 ? 60 : 40; },
    reversal: m => { const p = Math.floor(48 * m.hp / m.maxhp); return p <= 1 ? 200 : p <= 4 ? 150 : p <= 9 ? 100 : p <= 16 ? 80 : p <= 32 ? 40 : 20; },
    eruption: m => Math.max(1, Math.floor(150 * m.hp / m.maxhp)),
    storedpower: m => 20 + 20 * posBoosts(m),
    facade: (m, t, rs, mv) => m.status ? mv.power * 2 : mv.power,
    hex: (m, t, rs, mv) => t.status ? mv.power * 2 : mv.power,
    venoshock: (m, t, rs, mv) => t.status === 'psn' || t.status === 'tox' ? mv.power * 2 : mv.power,
    acrobatics: (m, t, rs, mv) => !m.item || m.itemUsed ? mv.power * 2 : mv.power,
    knockoff: (m, t, rs, mv) => t.item && !t.itemUsed ? mv.power * 1.5 : mv.power,
    weatherball: (m, t, rs, mv, w) => w ? 100 : mv.power,
    lowkick: () => 80, grassknot: () => 80, heavyslam: () => 80, heatcrash: () => 80,   // no weight data: middle value
    'return': () => 102, frustration: () => 102
  };
  VAR.flail = VAR.reversal; VAR.waterspout = VAR.eruption; VAR.dragonenergy = VAR.eruption; VAR.powertrip = VAR.storedpower;
  const WBALL = { sun: 'fire', rain: 'water', sand: 'rock', snow: 'ice' };
  // fixed-damage moves (ignore stats, still respect type immunity)
  const FIXED = { dragonrage: () => 40, sonicboom: () => 20, seismictoss: m => m.lv, nightshade: m => m.lv,
    superfang: (m, t) => Math.max(1, Math.floor(t.hp / 2)), naturesmadness: (m, t) => Math.max(1, Math.floor(t.hp / 2)),
    ruination: (m, t) => Math.max(1, Math.floor(t.hp / 2)), endeavor: (m, t) => Math.max(0, t.hp - m.hp),
    finalgambit: m => m.hp, psywave: m => Math.max(1, Math.floor(m.lv * (0.5 + Math.random()))) };
  // weather-dependent healing moves
  const wHeal = w => w === 'sun' ? 2 / 3 : w ? 1 / 4 : 1 / 2;
  const HEAL_W = { synthesis: wHeal, moonlight: wHeal, morningsun: wHeal, shoreup: w => w === 'sand' ? 2 / 3 : 1 / 2 };
  const PROTECT = ['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'silktrap', 'burningbulwark', 'obstruct'];
  const FX = () => window.MonsterFX || { abilities: {}, items: {} };

  /* -------- build a battler from a DB record -------- */
  function stat(base, lv, hp) {
    return hp ? Math.floor(2 * base * lv / 100) + lv + 10 : Math.floor(2 * base * lv / 100) + 5;
  }
  function makeMon(rec, lv, moves, opt = {}) {
    const a = Array.isArray(rec.base) ? rec.base : Array.isArray(rec.raw) ? rec.raw : null;   // [hp, atk, def, spa, spd, spe]
    const s = a ? { hp: a[0], atk: a[1], def: a[2], spa: a[3], spd: a[4], spe: a[5] } : (rec.stats || {});
    const mon = {
      key: rec.key, name: rec.name, types: (rec.types || []).map(t => String(t).toLowerCase()),
      attr: rec.attribute ? String(rec.attribute).toLowerCase() : null, final: !!rec.final, lv,
      maxhp: stat(s.hp || 50, lv, true) * (opt.hpMult || 1),
      st: { atk: stat(s.atk || 50, lv), def: stat(s.def || 50, lv), spa: stat(s.spa || 50, lv), spd: stat(s.spd || 50, lv), spe: stat(s.spe || 50, lv) },
      boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
      moves: (opt.allMoves ? moves : moves.slice(0, 4)).map(normMove).filter(Boolean),
      ability: opt.ability || null, item: opt.item || null, itemUsed: false,
      status: null, slpTurns: 0, toxN: 0, vol: {}, flags: {}, actions: opt.actions || 1, lock: null
    };
    mon.hp = mon.maxhp; return mon;
  }
  function normMove(m) {
    if (!m) return null;
    const cat = String(m.category || m.cat || 'physical').toLowerCase();
    const a = m.accuracy !== undefined ? m.accuracy : m.acc;             // Showdown data uses "acc"; null = never misses
    return { id: m.id || m.name, name: m.name || m.id, type: String(m.type || 'normal').toLowerCase(),
      power: +m.power || +m.basePower || 0, acc: a === true || a == null || a === '' ? true : (+a || 100),
      cat: cat.startsWith('phys') ? 'physical' : cat.startsWith('spec') ? 'special' : 'status',
      prio: +(m.priority ?? m.prio) || 0, flags: m.flags || {}, status: m.status || null, boosts: m.boosts || null,
      self: m.self || null, secondaries: m.secondaries || (m.secondary ? [m.secondary] : null),
      drain: m.drain || null, recoil: m.recoil || null, heal: m.heal || null, target: m.target || 'normal',
      weather: m.weather || null, terrain: m.terrain || null, vol: m.volatileStatus || null,
      crit: +m.critRatio || 1, willCrit: !!m.willCrit, multihit: m.multihit || null, ohko: !!m.ohko,
      selfdestruct: m.selfdestruct || null, base: m.base || null, desc: m.desc || m.shortDesc || m.description || '',
      selfSwitch: !!m.selfSwitch, side: m.sideCondition || null, pseudo: m.pseudoWeather || null, charge: !!(m.flags && m.flags.charge) };
  }

  /* -------- battle object -------- */
  function create(playerMons, enemyMons) {
    const b = {
      sides: [mkSide(playerMons), mkSide(enemyMons)], turn: 0, log: [], weather: null, wTurns: 0,
      terrain: null, tTurns: 0, trick: 0, over: false, winner: null, picks: [], rng: Math.random
    };
    function mkSide(list) { return { all: list, active: list.slice(0, 3), bench: list.slice(3), conds: {} }; }
    const L = t => b.log.push(t);
    const E = ev => b.onEvent && b.onEvent(ev);          // animation hooks used by battle-ui.js    
    const ab = m => m && FX().abilities[m.ability] || {};
    const it = m => m && !m.itemUsed && FX().items[m.item] || {};
    const sideOf = m => b.sides[0].all.includes(m) ? 0 : 1;
    const alive = m => m && m.hp > 0;
    const grounded = m => !m.types.includes('flying') && !ab(m).airborne && !it(m).airborne;

    Object.assign(b, {
      chance: p => b.rng() < p,
      hpFrac: m => m.hp / m.maxhp,
      foes: m => b.sides[1 - sideOf(m)].active.filter(alive),
      allies: m => b.sides[sideOf(m)].active.filter(alive),
      heal(m, f) { if (!alive(m)) return; const n = Math.min(m.maxhp - m.hp, Math.max(1, Math.floor(m.maxhp * f))); m.hp += n; if (n) L(`${m.name} restored ${Math.max(1, Math.round(n / m.maxhp * 100))}% HP.`); },
      damage(m, f, o = {}) { if (!alive(m)) return; if (o.indirect && ab(m).noIndirect) return; m.hp = Math.max(0, m.hp - Math.max(1, Math.floor(m.maxhp * f))); E({ type: 'hurt', mon: m }); if (!m.hp) L(`${m.name} fainted!`); },
      boost(m, ch, src, why) {
        if (!alive(m)) return; let dropped = false;
        for (const [k, v] of Object.entries(ch)) {
          if (!(k in m.boosts)) continue;
          if (v < 0 && src && src !== m) {
            const nd = ab(m).noDrop || it(m).noDrop;
            if (nd === true || (Array.isArray(nd) && nd.includes(k))) { L(`${m.name}'s ${k} can't be lowered!`); continue; }
            if (why === 'intimidate' && ab(m).noIntimidate) continue;
          }
          const old = m.boosts[k]; m.boosts[k] = Math.max(-6, Math.min(6, old + v));
          if (m.boosts[k] !== old) { L(`${m.name}'s ${k} ${v > 0 ? 'rose' : 'fell'}${Math.abs(v) > 1 ? ' sharply' : ''}!`); if (v < 0) dropped = true; }
        }
        if (dropped && src && src !== m) { ab(m).onDrop && ab(m).onDrop(m, b); useItem(m, 'onDrop'); }
      },
      status(m, s, src) {
        if (!alive(m) || m.status) return false;
        if ((ab(m).noStatus || []).includes(s)) return false;
        if ((s === 'psn' || s === 'tox') && (m.types.includes('poison') || m.types.includes('steel'))) return false;
        if (s === 'brn' && m.types.includes('fire')) return false;
        if (s === 'par' && m.types.includes('electric')) return false;
        if (s === 'frz' && m.types.includes('ice')) return false;
        if (b.terrain === 'misty' && grounded(m)) return false;
        if (s === 'slp' && b.terrain === 'electric' && grounded(m)) return false;
        m.status = s; m.toxN = 0; if (s === 'slp') m.slpTurns = 1 + Math.floor(b.rng() * 3);
        L(`${m.name} was ${{ brn: 'burned', par: 'paralyzed', psn: 'poisoned', tox: 'badly poisoned', slp: 'put to sleep', frz: 'frozen' }[s]}!`);
        useItem(m, 'statusGot'); return true;
      },
      cure(m) { if (m.status) { L(`${m.name} was cured.`); m.status = null; } },
      cureVolatile(m, v) { delete m.vol[v]; },
      confuse(m) {
        if (!alive(m) || m.vol.confusion) return;
        if ((ab(m).noVolatile || []).includes('confusion') || (b.terrain === 'misty' && grounded(m))) return;
        m.vol.confusion = 2 + Math.floor(b.rng() * 4); L(`${m.name} became confused!`); useItem(m, 'volatileGot', 'confusion');
      },
      clearDrops(m) { for (const k in m.boosts) if (m.boosts[k] < 0) m.boosts[k] = 0; },
      setWeather(w, src) { b.weather = w; b.wTurns = (src && it(src).weatherTurns && it(src).weatherTurns[w]) || 5; L(`Weather: ${w}.`); },
      setTerrain(t, src) { b.terrain = t; b.tTurns = (src && it(src).terrainTurns) || 5; L(`Terrain: ${t}.`); }
    });

    function useItem(m, hook, ...args) {
      const i = it(m); if (!i[hook]) return;
      const r = i[hook](m, ...args, b); if (r === true && i.consume) { m.itemUsed = true; L(`${m.name} used its ${m.item}.`); }
    }
    function realStat(m, k, crit) {
      const s = m.boosts[k];                         // crits ignore the attacker's drops and the defender's boosts
      let v = m.st[k] * STAGE(crit === 'atk' ? Math.max(0, s) : crit === 'def' ? Math.min(0, s) : s);
      if (k === 'spd' && b.weather === 'sand' && m.types.includes('rock')) v *= 1.5;
      if (k === 'def' && b.weather === 'snow' && m.types.includes('ice')) v *= 1.5;
      for (const src of [ab(m), it(m)]) if (src.stat) v *= (src.stat(m, b)[k] || 1);
      if (k === 'spe' && m.status === 'par' && !ab(m).ignoreParSpeed) v *= 0.5;
      if (k === 'spe' && (b.sides[sideOf(m)].conds || {}).tailwind) v *= 2;
      return v;
    }
    function switchIn(m) {                              // hazards hurt you as you come in
      const c = b.sides[sideOf(m)].conds;
      if (c && c.spikes && grounded(m) && alive(m)) { L(`${m.name} is hurt by spikes!`); b.damage(m, 0.125 * c.spikes, { indirect: true }); }
      if (c && c.stealthrock && alive(m)) { L(`${m.name} is hurt by the pointed stones!`); b.damage(m, 0.125 * Math.max(0.125, typeEff('rock', m.types)), { indirect: true }); }
      ab(m).start && ab(m).start(m, b);
    }
    function fill(s, i, n) {                         // the log line makes the screen redraw and show the newcomer
      s.bench.splice(s.bench.indexOf(n), 1, s.active[i]); s.active[i] = n;
      L(s === b.sides[0] ? `Go, ${n.name}!` : `${n.name} was sent out!`); switchIn(n);
    }

    /* --- damage --- */
    function calc(m, mv, t) {
      let type = mv.type, pm = 1;
      const sid = mv.base || mv.id;
      if (sid === 'weatherball' && WBALL[b.weather]) type = WBALL[b.weather];
      const mt = ab(m).moveType && ab(m).moveType(mv, m); if (mt) { type = mt.type; pm = mt.mult; }
      const at = ab(t);
      if (at.immune && at.immune.type === type) {
        L(`${t.name}'s ability absorbed it!`);
        if (at.immune.heal) b.heal(t, at.immune.heal); if (at.immune.boost) b.boost(t, at.immune.boost, t);
        if (at.immune.flag) t.flags[at.immune.flag] = true; return 0;
      }
      if (type === 'ground' && (it(t).airborne)) return 0;
      let eff = typeEff(type, t.types);
      if (eff === 0 && ab(m).hitsGhost && t.types.includes('ghost') && (type === 'normal' || type === 'fighting')) eff = 1;
      if (eff === 0) { L(`It doesn't affect ${t.name}...`); return 0; }
      if (m.attr && t.attr) eff *= DIGI[m.attr] === t.attr ? 1.5 : DIGI[t.attr] === m.attr ? 0.75 : 1;
      const phys = mv.cat === 'physical';
      const critStage = (ab(m).crit || 0) + (it(m).crit || 0) + (mv.crit || 1) - 1;
      const crit = !ab(t).noCrit && (mv.willCrit || b.chance([1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, critStage)]));
      const A = realStat(m, phys ? 'atk' : 'spa', crit && 'atk'), D = realStat(t, phys ? 'def' : 'spd', crit && 'def');
      let P = (VAR[sid] ? VAR[sid](m, t, realStat, mv, b.weather) : mv.power) * pm;
      for (const s of [ab(m), it(m)]) if (s.pow) P *= s.pow({ ...mv, type, power: P }, m, t, b);
      let d = (Math.floor(Math.floor(2 * m.lv / 5 + 2) * P * A / D / 50) + 2);
      if (m.types.includes(type)) d *= ab(m).stab || 1.5;
      d *= eff;
      if (b.weather === 'sun') d *= type === 'fire' ? 1.5 : type === 'water' ? 0.5 : 1;
      if (b.weather === 'rain') d *= type === 'water' ? 1.5 : type === 'fire' ? 0.5 : 1;
      if (grounded(m)) {                             // terrain boosts only work for grounded attackers
        if (b.terrain === 'electric' && type === 'electric') d *= 1.3;
        if (b.terrain === 'grassy' && type === 'grass') d *= 1.3;
        if (b.terrain === 'psychic' && type === 'psychic') d *= 1.3;
      }
      if (b.terrain === 'misty' && type === 'dragon' && grounded(t)) d *= 0.5;
      if (b.terrain === 'grassy' && ['earthquake', 'bulldoze', 'magnitude'].includes(sid) && grounded(t)) d *= 0.5;
      const dc = b.sides[sideOf(t)].conds || {};       // Reflect / Light Screen halve damage (crits ignore them)
      if (!crit && dc.reflect && phys) d *= 0.5;
      if (!crit && dc.lightscreen && !phys) d *= 0.5;
      if (crit) d *= ab(m).critMult || 1.5;
      b._crit = crit; b._eff = eff;                       // act() logs these after the hit animation
      if (phys && m.status === 'brn' && !ab(m).ignoreBurn && sid !== 'facade') d *= 0.5;
      for (const s of [ab(m), it(m)]) if (s.dmgOut) d *= s.dmgOut(mv, m, t, eff, b);
      for (const s of [ab(t), it(t)]) if (s.dmgIn) { const x = s.dmgIn({ ...mv, type }, t, m, eff, b); if (x !== 1 && it(t) === s && s.consume) { t.itemUsed = true; } d *= x; }
      if (mv.spread) d *= 0.75;
      d *= 0.85 + b.rng() * 0.15;
      return Math.max(1, Math.floor(d));
    }

    function targetsFor(m, mv, pick) {
      const foes = b.foes(m);
      if (['allAdjacentFoes', 'allAdjacent'].includes(mv.target)) { mv.spread = foes.length > 1; return mv.target === 'allAdjacent' ? foes.concat(b.allies(m).filter(x => x !== m)) : foes; }
      if (['self', 'allySide', 'allyTeam', 'all', 'foeSide'].includes(mv.target)) return [m];
      mv.spread = false;
      return [alive(pick) && foes.includes(pick) ? pick : foes[Math.floor(b.rng() * foes.length)]].filter(Boolean);
    }

    /* --- mechanics that need their own code --- */
    function selfSwitch(m, ch, mv) {                    // U-turn / Volt Switch / Baton Pass / Shed Tail
      const si = sideOf(m), bench = b.sides[si].bench.filter(alive), sid = mv && (mv.base || mv.id);
      const pass = {};                                  // Baton Pass / Shed Tail hand their effects to the newcomer
      if (sid === 'batonpass' || sid === 'shedtail') {
        if (!bench.length || !b.sides[1 - si].all.some(alive)) { L('But it failed!'); return; }
        if (sid === 'batonpass') {
          pass.boosts = { ...m.boosts };                // stat stages travel with the baton, like the games
          if (m.vol.sub) pass.sub = m.vol.sub;
        } else {                                        // Shed Tail
          if (m.hp <= Math.floor(m.maxhp / 2) || m.vol.sub) { L('But it failed!'); return; }
          m.hp -= Math.min(Math.ceil(m.maxhp / 2), m.hp - 1); E({ type: 'hurt', mon: m });
          pass.sub = { hp: Math.max(1, Math.floor(m.maxhp / 4)) };
        }
      }
      if (!bench.length || !b.sides[1 - si].all.some(alive)) return;
      delete m.vol.trapped;                             // U-turn escapes trapping, like the games
      if (si === 0 && b.manual && !(ch && ch.auto) && bench.length > 1) {
        b.pendingSwitch = m; b.pendingPass = pass; L(`${m.name} is coming back!`); return;     // the player picks; the turn pauses here
      }
      doSwitch(m, bench.sort((a, c) => c.hp / c.maxhp - a.hp / a.maxhp)[0], pass);   // Auto mode / enemies
    }
    function special(m, sid, mv, tg) {
      const t = tg.find(x => x !== m && alive(x)) || b.foes(m)[0];
      if (sid === 'haze') {
        for (const x of b.sides.flatMap(s => s.active)) x.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 };
        L('All stat changes were eliminated!'); return;
      }
      if (sid === 'bellydrum') {
        if (m.hp <= Math.floor(m.maxhp / 2) || m.boosts.atk >= 6) { L('But it failed!'); return; }
        m.hp -= Math.floor(m.maxhp / 2); m.boosts.atk = 6;
        L(`${m.name} cut its own HP and maximised its Attack!`); E({ type: 'hurt', mon: m }); return;
      }
      if (sid === 'substitute') {
        const cost = Math.floor(m.maxhp / 4);
        if (m.vol.sub) { L(`${m.name} already has a substitute!`); return; }
        if (m.hp <= cost) { L('But it failed!'); return; }
        m.hp -= cost; m.vol.sub = { hp: cost }; L(`${m.name} put in a substitute!`); E({ type: 'hurt', mon: m }); return;
      }
      if (!t) { L('But it failed!'); return; }
      if (sid === 'taunt') { t.vol.taunt = 3; L(`${t.name} fell for the Taunt!`); return; }
      if (sid === 'encore') {
        if (!t.lastMove || t.vol.encore) { L('But it failed!'); return; }
        t.vol.encore = { mv: { ...t.lastMove }, left: 3 }; L(`${t.name} received an Encore!`); return;
      }
      if (sid === 'painsplit') {
        const avg = Math.floor((m.hp + t.hp) / 2);
        m.hp = Math.min(m.maxhp, avg); t.hp = Math.min(t.maxhp, avg);
        L('The battlers shared their pain!'); E({ type: 'hurt', mon: t }); E({ type: 'hurt', mon: m }); return;
      }
      if (sid === 'curse') {
        if (m.types.includes('ghost')) {
          if (t.vol.curse) { L('But it failed!'); return; }
          m.hp = Math.max(1, m.hp - Math.floor(m.maxhp / 2)); t.vol.curse = m;
          L(`${m.name} laid a curse on ${t.name}!`); E({ type: 'hurt', mon: m }); return;
        }
        b.boost(m, { atk: 1, def: 1, spe: -1 }, m); return;
      }
      if (sid === 'roar') {
        const s = b.sides[1 - sideOf(m)], bench = s.bench.filter(alive), i = s.active.indexOf(t);
        if (!bench.length || i < 0) { L('But it failed!'); return; }
        const n = bench[Math.floor(b.rng() * bench.length)];
        s.active[i] = n; s.bench[s.bench.indexOf(n)] = t;
        t.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }; t.vol = {}; t.lock = null; t.toxN = 0;
        L(`${t.name} was dragged out!`); L(`${n.name} was sent out!`); switchIn(n); return;
      }
    }
    function act(m, ch) {
      if (!alive(m)) return;
      if (ch.switchTo) { doSwitch(m, ch.switchTo); return; }
      if (m.vol.recharge && m.vol.recharge < b.turn) { delete m.vol.recharge; L(`${m.name} must recharge!`); return; }
      const pick = m.lock || ch.move || {};
      if (m.status === 'slp') { if (m.slpTurns-- > 0) { L(`${m.name} is fast asleep.`); return; } m.status = null; L(`${m.name} woke up!`); }
      if (m.status === 'frz') {                      // 20% thaw, or a thawing move (Flame Wheel, Scald…)
        if (!b.chance(0.2) && !(pick.flags && pick.flags.defrost)) { L(`${m.name} is frozen solid!`); return; }
        m.status = null; L(`${m.name} thawed out!`);
      }
      if (m.vol.flinch) { L(`${m.name} flinched!`); return; }           // games order: flinch → confusion → paralysis
      if (m.vol.confusion) { if (--m.vol.confusion <= 0) { delete m.vol.confusion; L(`${m.name} snapped out of confusion!`); } else if (b.chance(1 / 3)) { L(`${m.name} hurt itself in confusion!`); selfHit(m); return; } }
      if (m.status === 'par' && b.chance(0.25)) { L(`${m.name} is paralyzed! It can't move!`); return; }
      let mv = { ...pick }; if (!mv.id) return;
      if (m.vol.charging && m.vol.charging !== mv.id) { const cm = m.moves.find(x => x.id === m.vol.charging); if (cm) mv = { ...cm }; }
      const chain = m.vol.locked || m.vol.encore;                     // Outrage-style lock-in / Encore
      if (chain && chain.mv) mv = { ...chain.mv };
      if (mv.cat === 'status' && it(m).noStatusMoves) { L(`${m.name} can't use status moves with its item!`); return; }
      if (mv.cat === 'status' && m.vol.taunt > 0) { L(`${m.name} can't use status moves after the Taunt!`); return; }
      const sid = mv.base || mv.id, isProt = PROTECT.includes(sid) || mv.vol === 'protect';   // edited moves behave like their base move
      if (!isProt) m.protN = 0;
      if (it(m).lock) m.lock = m.lock || ch.move;
      const tg = targetsFor(m, mv, ch.target);
      L(`${m.name} used ${mv.name}!`); E({ type: 'move', user: m, move: mv, targets: tg });
      if (mv.cat !== 'status' || true) m.lastMove = mv;               // remembered for Encore
      if (isProt) {
        if (b.chance(1 / Math.pow(3, m.protN || 0))) { m.vol.protect = true; m.protN = (m.protN || 0) + 1; L(`${m.name} protected itself!`); }
        else { m.protN = 0; L('But it failed!'); }
        return;
      }
      if (mv.charge && m.vol.charging !== mv.id && !(sid === 'solarbeam' && b.weather === 'sun')) {
        m.vol.charging = mv.id; L(`${m.name} is charging ${mv.name}!`); return;   // two-turn move: fires next turn
      }
      if (m.vol.charging) delete m.vol.charging;
      if (mv.side) {                                    // Reflect, Light Screen, Tailwind, Spikes, Stealth Rock
        const si = mv.target === 'foeSide' ? 1 - sideOf(m) : sideOf(m), sd = b.sides[si].conds;
        if (mv.side === 'spikes') sd.spikes = Math.min(3, (sd.spikes || 0) + 1);
        else sd[mv.side] = mv.side === 'tailwind' ? 4 : 5;
        L(mv.side === 'spikes' ? 'Spikes were scattered on the ground!' : mv.side === 'stealthrock' ? 'Pointed stones float in the air!'
          : mv.side === 'reflect' ? 'Reflect raised a barrier!' : mv.side === 'lightscreen' ? 'Light Screen raised a barrier!' : 'A tailwind started blowing!');
        return;
      }
      if (mv.pseudo === 'trickroom') { b.trick = 5; L('The dimensions were twisted!'); return; }
      if (['haze', 'roar', 'taunt', 'encore', 'bellydrum', 'painsplit', 'curse', 'substitute'].includes(sid)) { special(m, sid, mv, tg); return; }
      if (sid === 'rest') {                          // full heal, then sleep exactly 2 turns
        if (m.hp >= m.maxhp || (ab(m).noStatus || []).includes('slp') || (b.terrain === 'electric' && grounded(m))) { L('But it failed!'); return; }
        m.hp = m.maxhp; m.status = 'slp'; m.slpTurns = 2; m.toxN = 0; L(`${m.name} slept and became healthy!`); E({ type: 'hurt', mon: m }); return;
      }
      if (mv.weather) { b.setWeather(({ RainDance: 'rain', raindance: 'rain', sunnyday: 'sun', SunnyDay: 'sun', sandstorm: 'sand', Sandstorm: 'sand', snowscape: 'snow', Snowscape: 'snow', hail: 'snow' })[mv.weather] || String(mv.weather).toLowerCase(), m); }
      if (mv.terrain) b.setTerrain(String(mv.terrain).replace('terrain', ''), m);
      let total = 0, protectBlocked = false;   // a Protect-blocked self-switcher must not switch (games)
      for (const t of tg) {
        if (t !== m && t.vol.protect && (mv.flags.protect || !Object.keys(mv.flags).length)) { L(`${t.name} protected itself!`); if (mv.selfSwitch) protectBlocked = true; continue; }
        if (t !== m && mv.acc !== true && !ab(m).noGuard && !ab(t).noGuard) {
          let acc = mv.acc * ACC_STAGE(Math.max(-6, Math.min(6, m.boosts.accuracy - (t.boosts.evasion || 0))));
          for (const s of [ab(m), it(m)]) if (s.acc) acc *= s.acc(mv);
          if (['thunder', 'hurricane'].includes(sid)) acc = b.weather === 'rain' ? 101 : b.weather === 'sun' ? 50 : acc;
          if (sid === 'blizzard' && b.weather === 'snow') acc = 101;
          if (sid === 'toxic' && m.types.includes('poison')) acc = 101;
          if (mv.ohko) acc = 30 + m.lv - t.lv;         // OHKO: level-based, ignores accuracy stages
          if (!b.chance(acc / 100)) { E({ type: 'miss', user: m, target: t }); L(`${t.name} avoided the attack!`); continue; }
        }
        if (mv.cat === 'status') {
          if (t !== m && t.vol.sub) { L(`${t.name}'s substitute blocked it!`); continue; }
          if (t !== m) {
            if ((mv.flags.powder && t.types.includes('grass')) || (mv.status && mv.type === 'electric' && t.types.includes('ground'))) { L(`It doesn't affect ${t.name}...`); continue; }
            if (mv.status && !b.status(t, mv.status, m) && !mv.boosts) L('But it failed!');
            if (mv.vol === 'confusion') b.confuse(t);
            if (mv.vol === 'leechseed') {
              if (t.types.includes('grass') || t.vol.leechseed) L(`It doesn't affect ${t.name}...`);
              else { t.vol.leechseed = m; L(`${t.name} was seeded!`); }
            }
          }
          if (mv.boosts) b.boost(mv.target === 'self' ? m : t, mv.boosts, m);
          const hf = HEAL_W[sid] ? HEAL_W[sid](b.weather) : mv.heal ? mv.heal[0] / mv.heal[1] : 0;
          if (hf) { if (m.hp >= m.maxhp) L(`${m.name}'s HP is full!`); else b.heal(m, hf); }
          continue;
        }
        let d = 0, hits = 1;
        if (FIXED[sid]) {
          if (!typeEff(mv.type, t.types)) { L(`It doesn't affect ${t.name}...`); continue; }
          d = FIXED[sid](m, t); b._crit = false; b._eff = 1;
        } else if (mv.ohko) {
          if (t.lv > m.lv || !typeEff(mv.type, t.types)) { L(`It doesn't affect ${t.name}...`); continue; }
          d = t.hp; b._crit = false; b._eff = 1; L("It's a one-hit KO!");
        } else {
          const mh = mv.multihit;
          hits = Array.isArray(mh) ? (ab(m).maxHits ? mh[1] : mh[0] === 2 && mh[1] === 5 ? [2, 2, 3, 3, 4, 5][Math.floor(b.rng() * 6)] : mh[0] + Math.floor(b.rng() * (mh[1] - mh[0] + 1))) : (+mh || 1);
          for (let h = 0; h < hits; h++) { const x = calc(m, mv, t); if (!x) break; d += x; }
        }
        d = Math.min(t.hp, d); if (!d) continue;
        if (t.vol.sub && t !== m) {                     // a substitute takes the damage instead
          const x = Math.min(t.vol.sub.hp, d); t.vol.sub.hp -= x; total += x;
          E({ type: 'hit', user: m, target: t, move: mv, crit: false });
          L(`${t.name}'s substitute took the hit!`);
          if (!t.vol.sub.hp) { delete t.vol.sub; L(`${t.name}'s substitute faded!`); }
          continue;
        }
        const full = t.hp === t.maxhp;
        t.hp -= d; total += d;
        const hung = !t.hp && full && (ab(t).survive || it(t).survive);
        if (hung) { t.hp = 1; if (it(t).survive && it(t).consume) t.itemUsed = true; }
        E({ type: 'hit', user: m, target: t, move: mv, crit: b._crit });
        if (t.hp && t.status === 'frz' && mv.type === 'fire') { t.status = null; L(`${t.name} thawed out!`); }
        if (t.hp && it(m).flinch && !(ab(t).noVolatile || []).includes('flinch') && b.chance(it(m).flinch)) t.vol.flinch = true;
        if (b._crit) L('A critical hit!');
        if (b._eff > 1) L("It's super effective!"); else if (b._eff < 1) L("It's not very effective...");
        if (hits > 1) L(`Hit ${hits} times!`);
        if (hung) L(`${t.name} hung on!`);
        if (mv.vol === 'partiallytrapped' && t.hp && !t.vol.trapped && !t.types.includes('ghost')) {
          t.vol.trapped = { left: 4 + Math.floor(b.rng() * 2), mv: mv }; L(`${t.name} was trapped!`);
        }
        if (!t.hp) { L(`${t.name} fainted!`); ab(m).onKO && ab(m).onKO(m, b); }
        else {
          ab(t).hitBy && ab(t).hitBy(t, m, mv, 1, b); useItem(t, 'hitBy', m, mv, 1);
          if (mv.flags.contact) { ab(t).contact && ab(t).contact(t, m, b); it(t).contact && it(t).contact(t, m, b); }
          for (const sec of mv.secondaries || []) {
            if (ab(t).noSecondary || it(t).noSecondary || !b.chance(Math.min(1, (sec.chance || 100) / 100 * (ab(m).secMult || 1)))) continue;
            if (sec.status) b.status(t, sec.status, m);
            if (sec.boosts) b.boost(t, sec.boosts, m);
            if (sec.volatileStatus === 'flinch' && !(ab(t).noVolatile || []).includes('flinch')) t.vol.flinch = true;
            if (sec.volatileStatus === 'confusion') b.confuse(t);
            if (sec.self && sec.self.boosts) b.boost(m, sec.self.boosts, m);
          }
        }
      }
      if (mv.cat === 'status' && mv.self && mv.self.boosts) b.boost(m, mv.self.boosts, m);
      if (total) {
        if (mv.drain) b.heal(m, total * mv.drain[0] / mv.drain[1] / m.maxhp);
        if (mv.recoil) b.damage(m, total * mv.recoil[0] / mv.recoil[1] / m.maxhp);
        if (mv.self && mv.self.volatileStatus === 'mustrecharge') m.vol.recharge = b.turn;   // Hyper Beam, Giga Impact…
        if (mv.self && mv.self.boosts) b.boost(m, mv.self.boosts, m);
        ab(m).afterHit && ab(m).afterHit(m, null, mv, total, b); it(m).afterHit && it(m).afterHit(m, null, mv, total, b);
      }
      if (mv.selfdestruct && alive(m)) { m.hp = 0; L(`${m.name} fainted!`); }
      if (mv.selfSwitch && alive(m) && (total || (mv.cat === 'status' && !protectBlocked))) selfSwitch(m, ch, mv);   // only if it hit; status switchers always, except when Protect blocked them (games)
    }
    function selfHit(m) {                            // confusion: typeless 40-power physical hit on itself
      const d = Math.floor(Math.floor(2 * m.lv / 5 + 2) * 40 * realStat(m, 'atk') / realStat(m, 'def') / 50) + 2;
      m.hp = Math.max(0, m.hp - Math.max(1, Math.floor(d * (0.85 + b.rng() * 0.15))));
      E({ type: 'hurt', mon: m }); if (!m.hp) L(`${m.name} fainted!`);
    }
    function doSwitch(m, inc, pass) {
      const s = b.sides[sideOf(m)], i = s.active.indexOf(m), j = s.bench.indexOf(inc);
      if (i < 0 || j < 0 || !alive(inc)) return;
      if (m.vol.trapped && !m.types.includes('ghost')) { L(`${m.name} is trapped and can't switch!`); return; }
      ab(m).switchOut && ab(m).switchOut(m, b);
      m.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }; m.vol = {}; m.lock = null; m.toxN = 0;
      s.active[i] = inc; s.bench[j] = m;
      if (pass) {                                       // Baton Pass / Shed Tail: hand the effects over
        if (pass.boosts) for (const k in pass.boosts) if (pass.boosts[k]) inc.boosts[k] = pass.boosts[k];
        if (pass.sub && !inc.vol.sub) inc.vol.sub = pass.sub;
      }
      L(`${m.name} came back.`); switchIn(inc);
    }
    function endOfTurn() {
      E({ type: 'eot' });
      const all = b.sides.flatMap(s => s.active).filter(alive);
      for (const m of all) {
        m.vol.flinch = false; delete m.vol.protect;
        if (b.weather === 'sand' && !['rock', 'ground', 'steel'].some(t => m.types.includes(t)) && !ab(m).weatherImmune) b.damage(m, 1 / 16, { indirect: true });
        if (b.terrain === 'grassy' && grounded(m)) b.heal(m, 1 / 16);
        if (m.status === 'brn') b.damage(m, 1 / 16, { indirect: true });
        if (m.status === 'psn' && !ab(m).noPoisonDmg) b.damage(m, 1 / 8, { indirect: true });
        if (m.status === 'tox' && !ab(m).noPoisonDmg) b.damage(m, Math.min(15, ++m.toxN) / 16, { indirect: true });
        const sd = m.vol.leechseed;
        if (sd && alive(m)) {
          const n = Math.min(m.hp, Math.max(1, Math.floor(m.maxhp / 8)));
          b.damage(m, 1 / 8, { indirect: true });
          if (alive(sd) && b.sides.some(s => s.active.includes(sd))) sd.hp = Math.min(sd.maxhp, sd.hp + n);
          L(`${m.name}'s health is sapped by Leech Seed!`);
        }
        if (m.vol.trapped && alive(m)) {
          b.damage(m, 1 / 8, { indirect: true }); L(`${m.name} is hurt by ${m.vol.trapped.mv.name}!`);
          if (--m.vol.trapped.left <= 0) { delete m.vol.trapped; L(`${m.name} was freed!`); }
        }
        if (m.vol.curse && alive(m)) { b.damage(m, 1 / 4, { indirect: true }); L(`${m.name} is hurt by the curse!`); }
        if (m.vol.taunt > 0) m.vol.taunt--;
        if (m.vol.encore && --m.vol.encore.left <= 0) delete m.vol.encore;
        if (m.vol.locked && --m.vol.locked.left <= 0) { delete m.vol.locked; b.confuse(m); }
        ab(m).residual && ab(m).residual(m, b); it(m).residual && it(m).residual(m, b);
      }
      for (const s of b.sides) for (const k of ['reflect', 'lightscreen', 'tailwind'])
        if (s.conds[k] && --s.conds[k] <= 0) { delete s.conds[k]; L(`${k === 'tailwind' ? 'The tailwind' : k === 'reflect' ? 'Reflect' : 'Light Screen'} wore off.`); }
      if (b.trick > 0 && --b.trick <= 0) { L('The twisted dimensions returned to normal.'); b.trick = 0; }
      if (b.weather && --b.wTurns <= 0) { L('The weather cleared.'); b.weather = null; }
      if (b.terrain && --b.tTurns <= 0) { L('The terrain faded.'); b.terrain = null; }
      // enemy refills automatically; the player chooses (b.manual) through b.replace()
      for (const [si, s] of b.sides.entries()) {
        if (si === 0 && b.manual) continue;
        s.active.forEach((m, i) => { if (!alive(m)) { const n = s.bench.find(alive); if (n) fill(s, i, n); } });
      }
    }

    /* --- public --- */
    b.start = () => { b.sides.forEach(s => s.active.forEach(m => switchIn(m, true))); return b; };
    b.needReplace = () => b.over || !b.sides[0].bench.some(alive) ? []
      : b.sides[0].active.map((m, i) => alive(m) ? -1 : i).filter(i => i >= 0);
    b.replace = (i, inc) => { const s = b.sides[0];
      if (!alive(s.active[i]) && s.bench.includes(inc) && alive(inc)) { fill(s, i, inc); } };    
    b.enemyChoices = () => b.sides[1].active.filter(alive).map(m => {
      const mv = m.moves[Math.floor(b.rng() * m.moves.length)]; return { mon: m, move: mv, target: null };
    });
    // choices: [{mon, move, target}] or [{mon, switchTo}]
    b._oldRunTurn = playerChoices => {
      if (b.over) return b; b.turn++; L(`— Turn ${b.turn} —`);
      const q = [];
      for (const c of playerChoices.concat(b.enemyChoices())) for (let k = 0; k < (c.mon.actions || 1); k++)
        q.push(k && c.move && b.sides[1].all.includes(c.mon)          // Legend's 2nd action picks its own move
          ? { mon: c.mon, move: c.mon.moves[Math.floor(b.rng() * c.mon.moves.length)], target: null } : c);
      const prio = c => c.switchTo ? 7 : (c.move.prio || 0) + (ab(c.mon).prio
        ? (ab(c.mon).prankster && c.move.cat === 'status' && c.target && c.target.types.includes('dark') ? 0 : ab(c.mon).prio(c.move, c.mon))
        : 0);                                          // Prankster doesn't work on Dark-types
      q.forEach(c => { c.qc = it(c.mon).quick && b.chance(it(c.mon).quick); c.r = b.rng(); });
      const spd = m => realStat(m, 'spe') * (b.trick > 0 ? -1 : 1);   // Trick Room reverses the order
      q.sort((x, y) => prio(y) - prio(x) || (y.qc - x.qc) || spd(y.mon) - spd(x.mon) || x.r - y.r);
      for (const c of q) {
        if (b.over) break;
        if (!b.sides[sideOf(c.mon)].active.includes(c.mon)) continue;   // it left the field before its turn
        act(c.mon, c);
        for (const [i, s] of b.sides.entries()) if (!s.all.some(alive)) { b.over = true; b.winner = 1 - i; }
      }
      if (!b.over) endOfTurn();
      return b;
    };
    b.autoChoices = () => b.sides[0].active.filter(alive).map(m => {
      const foes = b.foes(m); let best = null, bs = -1;
      for (const mv of m.moves) for (const f of foes) { const s = (mv.power || 0) * typeEff(mv.type, f.types) * (m.types.includes(mv.type) ? 1.5 : 1); if (s > bs) { bs = s; best = { mon: m, move: mv, target: f }; } }
      return best || { mon: m, move: m.moves[0], target: foes[0] };
    });

    /* ---- turn runner that can pause mid-turn (player picks who comes in after U-turn) ---- */
    const prioOf = c => c.switchTo ? 7 : (c.move.prio || 0) + (ab(c.mon).prio
      ? (ab(c.mon).prankster && c.move.cat === 'status' && c.target && c.target.types.includes('dark') ? 0 : ab(c.mon).prio(c.move, c.mon)) : 0);
    b.runTurn = playerChoices => {
      if (b.over) return b;
      b.turn++; L(`— Turn ${b.turn} —`);
      const q = [];
      for (const c of playerChoices.concat(b.enemyChoices())) for (let k = 0; k < (c.mon.actions || 1); k++)
        q.push(k && c.move && b.sides[1].all.includes(c.mon)          // Legend's 2nd action picks its own move
          ? { mon: c.mon, move: c.mon.moves[Math.floor(b.rng() * c.mon.moves.length)], target: null } : c);
      q.forEach(c => { c.qc = it(c.mon).quick && b.chance(it(c.mon).quick); c.r = b.rng(); });
      const spd = m => realStat(m, 'spe') * (b.trick > 0 ? -1 : 1);
      q.sort((x, y) => prioOf(y) - prioOf(x) || y.qc - x.qc || spd(y.mon) - spd(x.mon) || x.r - y.r);
      b.queue = q; return resume();
    };
    function resume() {
      while (b.queue && b.queue.length && !b.over && !b.pendingSwitch) {
        const c = b.queue.shift();
        if (!b.sides[sideOf(c.mon)].active.includes(c.mon)) continue;
        act(c.mon, c);
        for (const [i, s] of b.sides.entries()) if (!s.all.some(alive)) { b.over = true; b.winner = 1 - i; }
      }
      if (b.over) { b.pendingSwitch = null; b.pendingPass = null; }
      if (!b.over && !b.pendingSwitch) { b.queue = null; endOfTurn(); }
      return b;
    }
    const _need = b.needReplace, _rep = b.replace, _auto = b.autoChoices;
    b.needReplace = () => b.pendingSwitch ? [b.sides[0].active.indexOf(b.pendingSwitch)] : _need();
    b.replace = (i, inc) => {
      const m = b.pendingSwitch;
      if (!m) return _rep(i, inc);
      if (b.sides[0].active[i] !== m || !b.sides[0].bench.includes(inc) || !alive(inc)) return;
      const pass = b.pendingPass; b.pendingPass = null; b.pendingSwitch = null;
      doSwitch(m, inc, pass); resume();
    };
    b.autoChoices = () => _auto().map(c => ({ ...c, auto: true }));   // Auto mode never pauses
    return b;
  }

  window.Battle = { create, makeMon, normMove, typeEff };
})();
