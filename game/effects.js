/* =====================================================================
   MONSTER LAB — hand-coded ability & item effects      file: game/effects.js
   Load BEFORE game/gacha.js. Pure data + small functions: no DOM, no saved state.
   Keys are Showdown ids (same keys as data/abilities.json and data/items.json).
   Anything NOT listed here shows "No battle effect yet" and does nothing in battle.

   HOOKS the battle engine calls (every one is optional):
     start(me,b)                      on switch-in
     stat(me,b) → {atk:1.5,…}         multipliers on real stats (atk def spa spd spe)
     pow(mv,me,foe,b) → ×             attacker's power multiplier
     dmgOut(mv,me,foe,eff,b) → ×      attacker's final damage multiplier (eff = type effectiveness)
     dmgIn(mv,me,src,eff,b) → ×       defender's final damage multiplier
     immune: {type, heal?, boost?, flag?}   blocks that move type completely
     moveType(mv,me) → {type,mult}|null     Pixilate-style type change
     residual(me,b)                   end of turn
     contact(me,src,b)                I was hit by a contact move
     afterHit(me,foe,mv,dmg,b)        I dealt damage (once per move use, dmg = total)
     hitBy(me,src,mv,eff,b)           I took damage and survived (mv = null for indirect damage)
     statusGot(me,b) / volatileGot(me,v,b)   I just got a status / volatile
     onKO(me,b)  onDrop(me,b)  switchOut(me,b)
   FLAGS:
     noStatus:[…] noVolatile:[…] noDrop:true|[stats] noIntimidate noSecondary
     crit:+n noCrit critMult acc(mv)→× prio(mv,me)→+n secMult maxHits stab
     survive (full HP → lives at 1 HP)  noIndirect  weatherImmune  airborne  hitsGhost  noGuard
     ignoreBurn  ignoreParSpeed  noPoisonDmg
   ITEM-ONLY FLAGS:
     consume: used up the first time a hook returns true or a multiplier ≠ 1
              (or when survive triggers). Comes back next battle.
     lock (Choice)  noStatusMoves  hazardImmune  quick (chance)  flinch (chance)
     weatherTurns:{rain:8}  terrainTurns  screenTurns
   ENGINE HELPERS on b:
     boost(m,{atk:1},src,why) heal(m,frac) damage(m,frac,{indirect}) status(m,id,src) cure(m)
     cureVolatile(m,v) clearDrops(m) setWeather(w) setTerrain(t) foes(m) chance(p) hpFrac(m)
     b.weather: 'sun'|'rain'|'sand'|'snow'|null    b.terrain: 'electric'|'grassy'|'psychic'|'misty'|null
   ===================================================================== */
(function () {
  const ALL_STATUS = ['brn', 'par', 'psn', 'tox', 'slp', 'frz'];
  const lowHP = me => me.hp <= me.maxhp / 3;
  const hasFlag = (mv, f) => !!(mv && mv.flags && mv.flags[f]);
  const pinch = type => ({ pow: (mv, me) => mv.type === type && lowHP(me) ? 1.5 : 1 });
  const flagPow = (f, x) => ({ pow: mv => hasFlag(mv, f) ? x : 1 });
  const typePow = (type, x) => ({ pow: mv => mv.type === type ? x : 1 });
  const absorb = (type, extra) => ({ immune: Object.assign({ type }, extra || {}) });
  const setW = w => ({ start: (me, b) => b.setWeather(w) });
  const setT = t => ({ start: (me, b) => b.setTerrain(t) });
  const block = (...s) => ({ noStatus: s });
  const contactStatus = s => ({ contact: (me, src, b) => { if (b.chance(0.3)) b.status(src, s, me); } });
  const chip = frac => ({ contact: (me, src, b) => b.damage(src, frac, { indirect: true }) });
  const skin = t => ({ moveType: mv => mv.type === 'normal' && mv.cat !== 'status' ? { type: t, mult: 1.2 } : null });
  const wSpeed = w => ({ stat: (me, b) => b.weather === w ? { spe: 2 } : {} });
  const onDropBoost = s => ({ onDrop: (me, b) => b.boost(me, { [s]: 2 }, me) });

  /* ---------------- ABILITIES (108) ---------------- */
  const A = {
    // switch-in: weather / terrain / Intimidate
    intimidate: { start: (me, b) => b.foes(me).forEach(f => b.boost(f, { atk: -1 }, me, 'intimidate')) },
    drizzle: setW('rain'), drought: setW('sun'), sandstream: setW('sand'), snowwarning: setW('snow'),
    electricsurge: setT('electric'), grassysurge: setT('grassy'), psychicsurge: setT('psychic'), mistysurge: setT('misty'),

    // type immunities & absorbs
    levitate: { immune: { type: 'ground' }, airborne: true },
    flashfire: Object.assign(absorb('fire', { flag: 'flashfire' }), { pow: (mv, me) => mv.type === 'fire' && me.flags && me.flags.flashfire ? 1.5 : 1 }),
    voltabsorb: absorb('electric', { heal: 0.25 }), waterabsorb: absorb('water', { heal: 0.25 }), eartheater: absorb('ground', { heal: 0.25 }),
    lightningrod: absorb('electric', { boost: { spa: 1 } }), stormdrain: absorb('water', { boost: { spa: 1 } }),
    sapsipper: absorb('grass', { boost: { atk: 1 } }), motordrive: absorb('electric', { boost: { spe: 1 } }),
    dryskin: Object.assign(absorb('water', { heal: 0.25 }), {
      dmgIn: mv => mv.type === 'fire' ? 1.25 : 1,
      residual: (me, b) => { if (b.weather === 'rain') b.heal(me, 1 / 8); else if (b.weather === 'sun') b.damage(me, 1 / 8, { indirect: true }); } }),

    // defensive
    thickfat: { dmgIn: mv => mv.type === 'fire' || mv.type === 'ice' ? 0.5 : 1 },
    heatproof: { dmgIn: mv => mv.type === 'fire' ? 0.5 : 1 },
    filter: { dmgIn: (mv, me, src, eff) => eff > 1 ? 0.75 : 1 },
    solidrock: { dmgIn: (mv, me, src, eff) => eff > 1 ? 0.75 : 1 },
    multiscale: { dmgIn: (mv, me) => me.hp === me.maxhp ? 0.5 : 1 },
    furcoat: { stat: () => ({ def: 2 }) },
    icescales: { dmgIn: mv => mv.cat === 'special' ? 0.5 : 1 },
    fluffy: { dmgIn: mv => (mv.type === 'fire' ? 2 : 1) * (hasFlag(mv, 'contact') ? 0.5 : 1) },
    purifyingsalt: { dmgIn: mv => mv.type === 'ghost' ? 0.5 : 1, noStatus: ALL_STATUS },
    waterbubble: { dmgIn: mv => mv.type === 'fire' ? 0.5 : 1, pow: mv => mv.type === 'water' ? 2 : 1, noStatus: ['brn'] },
    marvelscale: { stat: me => me.status ? { def: 1.5 } : {} },
    sturdy: { survive: true },
    battlearmor: { noCrit: true }, shellarmor: { noCrit: true },
    magicguard: { noIndirect: true },
    overcoat: { weatherImmune: true },

    // offensive
    hugepower: { stat: () => ({ atk: 2 }), rand: false },      // too strong to hand out at random
    purepower: { stat: () => ({ atk: 2 }), rand: false },
    guts: { stat: me => me.status ? { atk: 1.5 } : {}, ignoreBurn: true },
    hustle: { stat: () => ({ atk: 1.5 }), acc: mv => mv.cat === 'physical' ? 0.8 : 1 },
    blaze: pinch('fire'), torrent: pinch('water'), overgrow: pinch('grass'), swarm: pinch('bug'),
    technician: { pow: mv => mv.power && mv.power <= 60 ? 1.5 : 1 },
    ironfist: flagPow('punch', 1.2), strongjaw: flagPow('bite', 1.5), toughclaws: flagPow('contact', 1.3),
    megalauncher: flagPow('pulse', 1.5), sharpness: flagPow('slicing', 1.5),
    punkrock: Object.assign(flagPow('sound', 1.3), { dmgIn: mv => hasFlag(mv, 'sound') ? 0.5 : 1 }),
    reckless: { pow: mv => mv.recoil ? 1.2 : 1 },
    steelworker: typePow('steel', 1.5), dragonsmaw: typePow('dragon', 1.5), transistor: typePow('electric', 1.3), rockypayload: typePow('rock', 1.5),
    sandforce: { pow: (mv, me, foe, b) => b.weather === 'sand' && ['rock', 'ground', 'steel'].includes(mv.type) ? 1.3 : 1, weatherImmune: true },
    adaptability: { stab: 2 },
    tintedlens: { dmgOut: (mv, me, foe, eff) => eff > 0 && eff < 1 ? 2 : 1 },
    sniper: { critMult: 1.5 }, superluck: { crit: 1 },
    compoundeyes: { acc: () => 1.3 }, noguard: { noGuard: true },
    pixilate: skin('fairy'), aerilate: skin('flying'), refrigerate: skin('ice'), galvanize: skin('electric'),
    scrappy: { hitsGhost: true, noIntimidate: true },
    serenegrace: { secMult: 2 }, skilllink: { maxHits: true },
    prankster: { prio: mv => mv.cat === 'status' ? 1 : 0 },       // engine: Dark-type targets ignore the boosted move
    galewings: { prio: (mv, me) => mv.type === 'flying' && me.hp === me.maxhp ? 1 : 0 },

    // speed
    swiftswim: wSpeed('rain'), chlorophyll: wSpeed('sun'), slushrush: wSpeed('snow'),
    sandrush: Object.assign(wSpeed('sand'), { weatherImmune: true }),
    quickfeet: { stat: me => me.status ? { spe: 1.5 } : {}, ignoreParSpeed: true },
    speedboost: { residual: (me, b) => b.boost(me, { spe: 1 }, me) },

    // status & stat-drop protection
    immunity: block('psn', 'tox'), limber: block('par'), insomnia: block('slp'), vitalspirit: block('slp'),
    waterveil: block('brn'), magmaarmor: block('frz'),
    owntempo: { noVolatile: ['confusion'], noIntimidate: true },
    oblivious: { noVolatile: ['attract', 'taunt'], noIntimidate: true },
    innerfocus: { noVolatile: ['flinch'], noIntimidate: true },
    clearbody: { noDrop: true }, whitesmoke: { noDrop: true },
    hypercutter: { noDrop: ['atk'] }, keeneye: { noDrop: ['accuracy'] },

    // end of turn
    raindish: { residual: (me, b) => { if (b.weather === 'rain') b.heal(me, 1 / 16); } },
    icebody: { residual: (me, b) => { if (b.weather === 'snow') b.heal(me, 1 / 16); } },
    poisonheal: { noPoisonDmg: true, residual: (me, b) => { if (me.status === 'psn' || me.status === 'tox') b.heal(me, 1 / 8); } },
    shedskin: { residual: (me, b) => { if (me.status && b.chance(1 / 3)) b.cure(me); } },
    hydration: { residual: (me, b) => { if (me.status && b.weather === 'rain') b.cure(me); } },

    // switching out
    naturalcure: { switchOut: (me, b) => b.cure(me) },
    regenerator: { switchOut: (me, b) => b.heal(me, 1 / 3) },

    // contact punishment
    static: contactStatus('par'), flamebody: contactStatus('brn'), poisonpoint: contactStatus('psn'),
    roughskin: chip(1 / 8), ironbarbs: chip(1 / 8),
    poisontouch: { afterHit: (me, foe, mv, dmg, b) => { if (hasFlag(mv, 'contact') && b.chance(0.3)) b.status(foe, 'psn', me); } },

    // reactions
    moxie: { onKO: (me, b) => b.boost(me, { atk: 1 }, me) },
    justified: { hitBy: (me, src, mv, eff, b) => { if (mv && mv.type === 'dark') b.boost(me, { atk: 1 }, me); } },
    stamina: { hitBy: (me, src, mv, eff, b) => { if (mv) b.boost(me, { def: 1 }, me); } },
    defiant: onDropBoost('atk'), competitive: onDropBoost('spa')
  };

  /* ---------------- ITEMS (81) ---------------- */
  const statusBerry = (...s) => ({ consume: true, statusGot: (me, b) => s.includes(me.status) && (b.cure(me), true) });
  const pinchBerry = stat => ({ consume: true, hitBy: (me, src, mv, eff, b) => b.hpFrac(me) <= 0.25 && (b.boost(me, { [stat]: 1 }, me), true) });
  const resist = t => ({ consume: true, dmgIn: (mv, me, src, eff) => mv.type === t && (eff > 1 || t === 'normal') ? 0.5 : 1 });
  const orb = s => ({ residual: (me, b) => { if (!me.status) b.status(me, s, me); } });

  const I = {
    leftovers: { residual: (me, b) => b.heal(me, 1 / 16) },
    blacksludge: { residual: (me, b) => me.types.includes('poison') ? b.heal(me, 1 / 16) : b.damage(me, 1 / 8, { indirect: true }) },
    lifeorb: { dmgOut: () => 1.3, afterHit: (me, foe, mv, dmg, b) => b.damage(me, 1 / 10, { indirect: true }) },
    choiceband: { stat: () => ({ atk: 1.5 }), lock: true },
    choicespecs: { stat: () => ({ spa: 1.5 }), lock: true },
    choicescarf: { stat: () => ({ spe: 1.5 }), lock: true },
    assaultvest: { stat: () => ({ spd: 1.5 }), noStatusMoves: true },
    eviolite: { stat: me => me.final ? {} : { def: 1.5, spd: 1.5 } },
    expertbelt: { dmgOut: (mv, me, foe, eff) => eff > 1 ? 1.2 : 1 },
    muscleband: { pow: mv => mv.cat === 'physical' ? 1.1 : 1 },
    wiseglasses: { pow: mv => mv.cat === 'special' ? 1.1 : 1 },
    focussash: { survive: true, consume: true },
    rockyhelmet: chip(1 / 6),
    shellbell: { afterHit: (me, foe, mv, dmg, b) => b.heal(me, dmg / 8 / me.maxhp) },
    scopelens: { crit: 1 }, razorclaw: { crit: 1 },
    widelens: { acc: () => 1.1 },
    quickclaw: { quick: 0.2 },
    kingsrock: { flinch: 0.1 }, razorfang: { flinch: 0.1 },
    toxicorb: orb('tox'), flameorb: orb('brn'),
    heavydutyboots: { hazardImmune: true },
    airballoon: { immune: { type: 'ground' }, airborne: true, consume: true, hitBy: (me, src, mv) => !!mv },
    weaknesspolicy: { consume: true, hitBy: (me, src, mv, eff, b) => !!mv && eff > 1 && (b.boost(me, { atk: 2, spa: 2 }, me), true) },
    whiteherb: { consume: true, onDrop: (me, b) => (b.clearDrops(me), true) },
    covertcloak: { noSecondary: true },
    clearamulet: { noDrop: true },
    lightclay: { screenTurns: 8 }, terrainextender: { terrainTurns: 8 },
    damprock: { weatherTurns: { rain: 8 } }, heatrock: { weatherTurns: { sun: 8 } },
    smoothrock: { weatherTurns: { sand: 8 } }, icyrock: { weatherTurns: { snow: 8 } },
    sitrusberry: { consume: true, hitBy: (me, src, mv, eff, b) => b.hpFrac(me) <= 0.5 && (b.heal(me, 0.25), true) },
    lumberry: { consume: true, statusGot: (me, b) => (b.cure(me), true),
      volatileGot: (me, v, b) => v === 'confusion' && (b.cureVolatile(me, v), true) },
    persimberry: { consume: true, volatileGot: (me, v, b) => v === 'confusion' && (b.cureVolatile(me, v), true) },
    cheriberry: statusBerry('par'), chestoberry: statusBerry('slp'), pechaberry: statusBerry('psn', 'tox'),
    rawstberry: statusBerry('brn'), aspearberry: statusBerry('frz'),
    liechiberry: pinchBerry('atk'), petayaberry: pinchBerry('spa'), salacberry: pinchBerry('spe')
  };
  Object.entries({ charcoal: 'fire', mysticwater: 'water', miracleseed: 'grass', magnet: 'electric', nevermeltice: 'ice',
    blackbelt: 'fighting', poisonbarb: 'poison', softsand: 'ground', sharpbeak: 'flying', twistedspoon: 'psychic',
    silverpowder: 'bug', hardstone: 'rock', spelltag: 'ghost', dragonfang: 'dragon', blackglasses: 'dark',
    metalcoat: 'steel', silkscarf: 'normal', fairyfeather: 'fairy' }).forEach(([id, t]) => { I[id] = typePow(t, 1.2); });
  Object.entries({ occaberry: 'fire', passhoberry: 'water', wacanberry: 'electric', rindoberry: 'grass', yacheberry: 'ice',
    chopleberry: 'fighting', kebiaberry: 'poison', shucaberry: 'ground', cobaberry: 'flying', payapaberry: 'psychic',
    tangaberry: 'bug', chartiberry: 'rock', kasibberry: 'ghost', habanberry: 'dragon', colburberry: 'dark',
    babiriberry: 'steel', roseliberry: 'fairy', chilanberry: 'normal' }).forEach(([id, t]) => { I[id] = resist(t); });

  window.MonsterFX = {
    abilities: A, items: I,
    randomAbilities: Object.keys(A).filter(id => A[id].rand !== false),   // pool for Pals / Digimon
    hasAbility: id => !!A[id], hasItem: id => !!I[id]
  };
})();
