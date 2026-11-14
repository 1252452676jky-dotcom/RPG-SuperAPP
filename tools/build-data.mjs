// tools/build-data.mjs — builds /data/*.json for the Monster Lab tab.
// Run from the project root:  node tools/build-data.mjs
// Needs Node 18+. Raw API responses are cached (trimmed) in tools/.cache.
import vm from 'node:vm';   
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT   = path.join(ROOT, 'data');
const CACHE = path.join(ROOT, 'tools', '.cache');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sum = a => a.reduce((s, v) => s + v, 0);
const idFromUrl = u => Number(String(u).split('/').filter(Boolean).pop());
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
const prettify = s => s.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
const tierCount = recs => [1, 2, 3, 4].map(t => `T${t}:${recs.filter(r => r.tier === t).length}`).join('  ');

/* ---------- cached fetch + concurrency ---------- */
async function getJSON(url, trim = x => x, retries = 3) {
  const file = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 180) + '.json');
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'rpg-superapp-data-builder (personal, non-commercial)' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const data = trim(await res.json());
      await writeFile(file, JSON.stringify(data));
      return data;
    } catch (err) {
      if (i >= retries) throw err;
      await sleep(1500 * (i + 1));
    }
  }
}
async function mapLimit(items, limit, fn, label) {
  const out = new Array(items.length); let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (++done % 25 === 0 || done === items.length) process.stdout.write(`\r  ${label}: ${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  process.stdout.write('\n');
  return out;
}

/* ---------- stat normalisation (Pokémon = reference scale) ---------- */
function quantile(sorted, p) { const i = p * (sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
function pctRank(sorted, v) {
  let lo = 0; while (lo < sorted.length && sorted[lo] < v) lo++;
  let hi = lo; while (hi < sorted.length && sorted[hi] === v) hi++;
  return sorted.length < 2 ? 0.5 : ((lo + hi - 1) / 2) / (sorted.length - 1);
}
function normalize(recs, refBst, refMed) {
  const med = [0, 1, 2, 3, 4, 5].map(i => median(recs.map(r => r.raw[i])) || 1);
  const scaled = recs.map(r => r.raw.map((v, i) => v * refMed[i] / med[i]));  // put stats in comparable units
  const totals = scaled.map(sum);
  const sorted = [...totals].sort((a, b) => a - b);
  recs.forEach((r, k) => {
    const p = r.p ?? pctRank(sorted, totals[k]);                  // power percentile inside own franchise
    const target = quantile(refBst, p);                           // same percentile of Pokémon BSTs
    r.base = scaled[k].map(v => Math.max(5, Math.min(255, Math.round(target * v / (totals[k] || 1)))));
    r.bst = sum(r.base);
    delete r.p;
  });
}
/* =================== SHOWDOWN DATA (MIT, play.pokemonshowdown.com) =================== */
const PS = 'https://play.pokemonshowdown.com/data/';
const psId = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
async function getPS(file, exportName) {                     // .json parsed directly, .js evaluated in a sandbox
  if (file.endsWith('.json')) return getJSON(PS + file);
  const cacheFile = path.join(CACHE, 'ps_' + file.replace(/[^a-z0-9.]+/gi, '_') + '.json');
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));
  const res = await fetch(PS + file); if (!res.ok) throw new Error(`PS ${file}: HTTP ${res.status}`);
  const ctx = { exports: {} }; vm.createContext(ctx); vm.runInContext(await res.text(), ctx);
  const data = ctx.exports[exportName]; if (!data) throw new Error(`PS ${file}: no ${exportName}`);
  await writeFile(cacheFile, JSON.stringify(data));
  return data;
}
const MOVE_FIELDS = ['target', 'flags', 'secondary', 'secondaries', 'self', 'boosts', 'status', 'volatileStatus', 'weather',
  'terrain', 'sideCondition', 'pseudoWeather', 'drain', 'recoil', 'heal', 'multihit', 'critRatio', 'ohko', 'selfSwitch', 'selfdestruct', 'willCrit'];
function psMove(m, text) {
  const out = { name: m.name, type: m.type.toLowerCase(), cat: m.category.toLowerCase(), power: m.basePower || null,
    acc: m.accuracy === true ? null : m.accuracy, pp: m.pp, prio: m.priority || 0,
    desc: (text && (text.shortDesc || text.desc)) || m.shortDesc || m.desc || null,
    long: (text && text.desc && text.desc !== text.shortDesc && text.desc) || null };
  for (const f of MOVE_FIELDS) if (m[f] !== undefined && m[f] !== null) out[f] = m[f];
  return out;
}
function psLevelUp(learnset) {                               // union of all gens; level from newest gen that has it
  const out = [];
  for (const [mv, codes] of Object.entries(learnset || {})) {
    let best = null;
    for (const c of codes) { const m = /^(\d)L(\d+)$/.exec(c); if (m && (!best || +m[1] > best.g)) best = { g: +m[1], lv: +m[2] }; }
    if (best) out.push([mv, Math.max(1, best.lv)]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
}
async function loadShowdown() {
  console.log('\n== Pokémon Showdown data ==');
  const [dex, learn, moves, abil, items, text] = await Promise.all([
    getPS('pokedex.json'), getPS('learnsets.json'), getPS('moves.json'),
    getPS('abilities.js', 'BattleAbilities'), getPS('items.js', 'BattleItems'), getPS('text/en.js', 'BattleText')]);
  const en = (text && text.en) || {};
  const T = { moves: en.Moves || {}, abilities: en.Abilities || {}, items: en.Items || {} };
  console.log(`  ${Object.keys(moves).length} moves · ${Object.keys(abil).length} abilities · ${Object.keys(items).length} items`);
  console.log(`  descriptions found: moves ${Object.keys(T.moves).length} · abilities ${Object.keys(T.abilities).length} · items ${Object.keys(T.items).length}`);
  return { dex, learn, moves, abil, items, T };
}
const descOf = t => (t && (t.shortDesc || t.desc)) || '';

function buildAbilities(ps) {
  const out = {};
  for (const [id, a] of Object.entries(ps.abil)) {
    if (id === 'noability' || (a.isNonstandard && a.isNonstandard !== 'Past')) continue;
    const f = a.flags || {}, t = ps.T.abilities[id];
    out[id] = { name: a.name, desc: descOf(t), long: t && t.desc && t.desc !== t.shortDesc ? t.desc : null, rating: a.rating ?? null,
      // random pool for Pals/Digimon: no species-locked abilities, nothing with zero battle effect
      randomOk: !(f.failroleplay || f.cantsuppress || f.notransform) && (a.rating ?? 0) > 0 };
  }
  return out;
}

const ITEM_JUNK = /fossil|nugget|pearl|stardust|starpiece|cometshard|mushroom|sweet$|mint$|bottlecap|^(cracked|chipped|masterpiece|unremarkable)|relic|wing$|armorite|dynite|galarica|wishingpiece|rarebone|^honey$|^(red|blue|yellow|green)shard$/;
const ITEM_BAD_TAG = ['CAP', 'Custom', 'LGPE', 'Legends', 'Unobtainable', 'Future'];
function buildItems(ps) {
  const out = {};
  for (const [id, it] of Object.entries(ps.items)) {
    if (it.isPokeball || it.megaStone || it.zMove || it.isPrimalOrb || it.forcedForme || ITEM_BAD_TAG.includes(it.isNonstandard) || ITEM_JUNK.test(id)) continue;
    out[id] = { name: it.name, desc: descOf(ps.T.items[id]), berry: !!it.isBerry, gem: !!it.isGem, choice: !!it.isChoice,
      users: it.itemUser || null, gen: it.gen || null };
  }
  return out;
}


/* =================== POKÉMON (PokéAPI) =================== */
const STAT_ORDER = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const keepLang = (arr, codes) => (arr || []).filter(n => codes.includes(n.language.name));
const lang = (arr, ...codes) => { for (const c of codes) { const h = (arr || []).find(n => n.language.name === c); if (h && h.name) return h.name; } return null; };

const trimPokemon = p => ({
  name: p.name, is_default: p.is_default, species: p.species, forms: p.forms.slice(0, 1),
  stats: p.stats.map(s => ({ base_stat: s.base_stat, stat: { name: s.stat.name } })),
  types: p.types,
  img: p.sprites?.other?.['official-artwork']?.front_default || p.sprites?.other?.home?.front_default || p.sprites?.front_default || null,
  moves: p.moves.map(m => ({ move: m.move.name,
    d: m.version_group_details.filter(d => d.move_learn_method.name === 'level-up').map(d => [idFromUrl(d.version_group.url), d.level_learned_at]) }))
    .filter(m => m.d.length)
});
const trimSpecies = s => ({ name: s.name, id: s.id, is_legendary: s.is_legendary, is_mythical: s.is_mythical,
  evolution_chain: s.evolution_chain, varieties: s.varieties, names: keepLang(s.names, ['en', 'ja-Hrkt', 'ja']) });
const trimForm = f => ({ names: keepLang(f.names, ['en', 'ja-Hrkt', 'ja']), form_names: keepLang(f.form_names, ['en', 'ja-Hrkt', 'ja']) });
const trimMove = m => ({ names: keepLang(m.names, ['en']), type: m.type, damage_class: m.damage_class, power: m.power, accuracy: m.accuracy, pp: m.pp, priority: m.priority });

function levelUp(p) {                       // level-up moves from the newest game that has them
  let best = 0; p.moves.forEach(m => m.d.forEach(([vg]) => { if (vg > best) best = vg; }));
  const out = []; p.moves.forEach(m => m.d.forEach(([vg, lv]) => { if (vg === best) out.push([m.move, lv]); }));
  return out.sort((a, b) => a[1] - b[1]);
}

async function buildPokemon(ps) {
  console.log('\n== Pokémon (PokéAPI) ==');
  const API = 'https://pokeapi.co/api/v2';
  const list = await getJSON(`${API}/pokemon?limit=100000`);
  const pokes = (await mapLimit(list.results, 6, r => getJSON(r.url, trimPokemon), 'pokemon + forms')).filter(Boolean);
  const pokeByName = new Map(pokes.map(p => [p.name, p]));

  const speciesUrls = [...new Set(pokes.map(p => p.species.url))];
  const speciesList = (await mapLimit(speciesUrls, 6, u => getJSON(u, trimSpecies), 'species')).filter(Boolean);
  const species = new Map(speciesList.map(s => [s.name, s]));
  const defaultOf = new Map();
  speciesList.forEach(s => { const v = s.varieties.find(v => v.is_default); if (v) defaultOf.set(s.name, v.pokemon.name); });

  const chainUrls = [...new Set(speciesList.map(s => s.evolution_chain?.url).filter(Boolean))];
  const chains = (await mapLimit(chainUrls, 6, u => getJSON(u), 'evolution chains')).filter(Boolean);
  const evo = new Map();
  for (const ch of chains) {
    const rootBaby = !!ch.chain.is_baby;
    const walk = (node, depth) => {
      evo.set(node.species.name, { depth, rootBaby, next: node.evolves_to.map(n => ({ species: n.species.name, lv: (n.evolution_details[0] || {}).min_level ?? null })) });
      node.evolves_to.forEach(n => walk(n, depth + 1));
    };
    walk(ch.chain, 1);
  }

  const alt = pokes.filter(p => !p.is_default);
  const forms = await mapLimit(alt, 6, p => getJSON(p.forms[0].url, trimForm), 'alt-form names');
  const formOf = new Map(alt.map((p, i) => [p.name, forms[i]]));

  const records = [], learnsets = {}, moveNames = new Set();
  for (const p of pokes) {
    const sp = species.get(p.species.name); if (!sp) continue;
    const e = evo.get(sp.name) || { depth: 1, rootBaby: false, next: [] };
    const stage = Math.max(0, e.depth - (e.rootBaby ? 1 : 0));          // 0 = baby (Pichu)
    const raw = STAT_ORDER.map(n => (p.stats.find(s => s.stat.name === n) || {}).base_stat || 0);
    const bst = sum(raw);
    const spName = lang(sp.names, 'en') || prettify(sp.name);
    const spJa = lang(sp.names, 'ja-Hrkt', 'ja');
    const form = formOf.get(p.name);
    const name = p.is_default ? spName : (lang(form?.names, 'en') || prettify(p.name));
    const ja = p.is_default ? spJa : (lang(form?.names, 'ja-Hrkt', 'ja') || spJa);
    const special = /-(gmax|eternamax)$/.test(p.name) ? 'gmax' : /-primal$/.test(p.name) ? 'primal' : /-mega(-[a-z])?$/.test(p.name) ? 'mega' : null;
    const legendary = !!(sp.is_legendary || sp.is_mythical);
    const final = e.next.length === 0;

    let tier;
    if (legendary || special) tier = 4;
    else if (e.depth === 1 && final) tier = bst < 400 ? 1 : bst < 500 ? 2 : 3;   // single-stage: judge by power
    else tier = Math.min(3, Math.max(1, stage));

    let evoList = [];
    if (!special) {                                   // regional forms evolve into the same region's form
      const def = defaultOf.get(sp.name) || '';
      const suffix = !p.is_default && p.name.startsWith(def) ? p.name.slice(def.length) : '';
      evoList = e.next.map(n => { const b = defaultOf.get(n.species) || n.species; return { to: 'pkmn:' + (suffix && pokeByName.has(b + suffix) ? b + suffix : b), lv: n.lv ?? (stage === 0 ? 12 : stage === 1 ? 30 : 45) }; });
    }

    const psKey = ps.dex[psId(p.name)] ? psId(p.name) : psId(sp.name);   // "giratina-altered" → "giratina"
    const psEntry = ps.dex[psKey];
    const psBase = psEntry && psId(psEntry.changesFrom || psEntry.baseSpecies || '');
    let ls = psLevelUp((ps.learn[psKey] || {}).learnset);
    if (!ls.length && psBase) ls = psLevelUp((ps.learn[psBase] || {}).learnset);   // megas, cosmetic forms
    if (!ls.length) ls = levelUp(p).map(([m, lv]) => [psId(m), lv]);              // PokéAPI fallback
    ls = ls.filter(([m]) => ps.moves[m] && !ps.moves[m].isZ && !ps.moves[m].isMax && !['CAP', 'Custom', 'LGPE'].includes(ps.moves[m].isNonstandard));
    ls.forEach(([m]) => moveNames.add(m));
    learnsets['pkmn:' + p.name] = ls;
    const abilities = Object.values((psEntry || ps.dex[psBase] || {}).abilities || {}).map(psId);

    records.push({ key: 'pkmn:' + p.name, fr: 'pokemon', name, ja, spName, dex: sp.id, img: p.img,
      types: p.types.map(t => t.type.name), typesOrig: null, raw, stage, tier, final, legendary, special,
      isDefault: p.is_default, evo: evoList, abilities });
  }
  records.sort((a, b) => a.dex - b.dex || b.isDefault - a.isDefault);

  const moves = {};
  for (const id of moveNames) moves[id] = psMove(ps.moves[id], ps.T.moves[id]);
  return { records, learnsets, moves };
}

/* =================== PALWORLD (PalSphere data) =================== */
const PAL_TYPE = { neutral: 'normal', normal: 'normal', fire: 'fire', water: 'water', leaf: 'grass', grass: 'grass',
  electric: 'electric', electricity: 'electric', thunder: 'electric', ice: 'ice', earth: 'ground', ground: 'ground', dark: 'dark', dragon: 'dragon' };
const palTier = r => r >= 11 ? 4 : r >= 8 ? 3 : r >= 5 ? 2 : 1;      // tune after seeing the histogram

async function buildPalworld() {
  console.log('\n== Palworld (PalSphere data) ==');
  const data = await getJSON('https://raw.githubusercontent.com/palsphere/palsphere-data/main/data/species.json');
  const list = (data.species || []).filter(s => s.isInPaldeck && s.zukanIndex > 0);
  const hist = {}; list.forEach(s => { hist[s.rarity] = (hist[s.rarity] || 0) + 1; });
  console.log(`  ${list.length} Pals (game ${data.gameVersion}); rarity histogram:`, hist);

  const records = [], learnsets = {}, moves = {};
  for (const s of list) {
    const st = s.stats || {};
    const raw = [st.hp, st.meleeAttack, st.defense, st.shotAttack, st.defense, st.runSpeed].map(v => Math.max(1, Number(v) || 0));
    if (!(s.elements || []).length) console.warn(`  !! ${s.displayName} has no element (placeholder data) — typed as normal`);
    const typesOrig = s.elements || [];
    const types = [...new Set(typesOrig.map(t => PAL_TYPE[String(t).toLowerCase()] || 'normal'))];
    const key = 'pal:' + s.codename, tier = palTier(s.rarity);
    records.push({ key, fr: 'palworld', name: s.displayName, ja: null, spName: s.displayName,
      dex: `${s.zukanIndex}${s.zukanIndexSuffix || ''}`,
      img: `https://palsphere.app/assets/pals-lg/${s.codename.toLowerCase()}.webp`,
      types, typesOrig, raw, stage: 1, tier, final: true, legendary: tier === 4, special: null,
      isDefault: true, evo: [], rarity: s.rarity });
    learnsets[key] = (s.activeSkills || []).map(k => [k.id, k.level]);
    (s.activeSkills || []).forEach(k => { moves[k.id] = { name: k.name, type: PAL_TYPE[String(k.element).toLowerCase()] || 'normal',
      typeOrig: k.element, cat: k.category, power: k.power, cd: k.cooldown, desc: k.description }; });
  }
  return { records, learnsets, moves };
}

/* =================== DIGIMON (DAPI, stats generated) =================== */
const DIGI_LEVEL = {           // [stage, tier, power percentile]
  'Baby I': [0, 1, 0.05], 'Baby II': [0, 1, 0.12], 'Child': [1, 1, 0.28], 'Adult': [2, 2, 0.48], 'Armor': [2, 2, 0.52],
  'Perfect': [3, 3, 0.70], 'Hybrid': [3, 3, 0.66], 'Ultimate': [4, 4, 0.90], 'Unknown': [2, 2, 0.45] };
const DIGI_KEYWORD = [
  [/fire|flame|volcan|lava/i, 'fire'], [/water|aquatic|sea |fish|mollusk|amphibian/i, 'water'], [/plant|vegetation|flower|wood/i, 'grass'],
  [/insect|bug/i, 'bug'], [/ice|snow/i, 'ice'], [/thunder|electric|lightning/i, 'electric'], [/machine|cyborg|android|mech|metal/i, 'steel'],
  [/holy|angel|seraph|cherub|god/i, 'fairy'], [/demon|evil|fallen|dark/i, 'dark'], [/undead|ghost|ghoul|vampire|skeleton/i, 'ghost'],
  [/bird|avian|winged/i, 'flying'], [/dragon|dinosaur|reptile/i, 'dragon'], [/rock|mineral|crystal|stone/i, 'rock'],
  [/poison|mutant/i, 'poison'], [/puppet|wizard|magic|mystic/i, 'psychic'], [/beast|mammal|animal/i, 'normal'] ];
const DIGI_FIELD = { 'Nature Spirits': 'ground', 'Deep Savers': 'water', 'Nightmare Soldiers': 'ghost', 'Wind Guardians': 'flying',
  'Metal Empire': 'steel', 'Virus Busters': 'fairy', "Dragon's Roar": 'dragon', 'Jungle Troopers': 'bug', 'Dark Area': 'dark', 'Unknown': 'normal' };
const ATTR_BIAS = { Vaccine: [0, 0, .25, 0, .25, 0], Virus: [0, .25, 0, .15, 0, 0], Data: [0, 0, 0, .25, 0, .15] };

function rng(seed) {                         // deterministic: same Digimon → same stats every build
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  let a = h >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const ELEMENT_WORDS = [
  ['fire',     /fire|flame|blaze|burn|heat|magma|lava|inferno|volcan|pyro|solar|meteor/],
  ['water',    /water|aqua|tidal|wave|bubble|torrent|ocean|\bsea\b|hydro|splash|fish/],
  ['ice',      /\bice|frost|freez|snow|blizzard|glacier|cold/],
  ['electric', /thunder|lightning|electr|spark|volt|shock|plasma/],
  ['grass',    /plant|leaf|flower|vine|petal|thorn|pollen|seed|forest|wood|vegetation/],
  ['poison',   /poison|toxic|venom|acid|sludge|mutant/],
  ['ground',   /earth|ground|\bsand|quake|\bmud/],
  ['rock',     /\brock|stone|boulder|crystal|mineral/],
  ['flying',   /\bwind|gale|tornado|feather|\bwing|\bsky|avian|bird/],
  ['psychic',  /psychic|\bmind|telepath|illusion|magic|wizard|mystic/],
  ['ghost',    /ghost|\bsoul|curse|undead|phantom|grave|vampire|skeleton/],
  ['dark',     /\bdark|shadow|\bevil|demon|nightmare|abyss|fallen/],
  ['fairy',    /holy|angel|heaven|divine|sacred|seraph|cherub|\blight\b/],
  ['steel',    /metal|steel|machine|cyborg|android|\bmech|missile|cannon|laser/],
  ['dragon',   /dragon|dinosaur/],
  ['fighting', /punch|\bkick|\bfist|martial|brawl/],
  ['bug',      /insect|\bbug|sting|beetle|larva/],
];
function digiTypes(d) {
  const score = {};
  const bump = (type, w) => { if (type) score[type] = (score[type] || 0) + w; };
  const elementHits = text => { const t = String(text || '').toLowerCase();
    return ELEMENT_WORDS.filter(([, re]) => re.test(t)).map(([type]) => type); };

  // 1. Attacks: strongest signal
  (d.skills || []).forEach(s => elementHits(`${s.translation || ''} ${s.skill || ''} ${s.description || ''}`).forEach(t => bump(t, 3)));

  // 2. Species text: ELEMENT_WORDS first, DIGI_KEYWORD only adds types it didn't already find
  (d.types || []).forEach(({ type }) => {
    const hits = new Set(elementHits(type));
    hits.forEach(t => bump(t, 2));
    DIGI_KEYWORD.forEach(([re, t]) => { if (re.test(type) && !hits.has(t)) { bump(t, 1); hits.add(t); } });
  });

  // 3. Fields: weak tie-breaker
  (d.fields || []).forEach(f => { const t = DIGI_FIELD[f.field]; if (t && t !== 'normal') bump(t, 1); });

  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return ['normal'];
  const out = [ranked[0][0]];
  const second = ranked[1];
  if (second && second[0] !== 'normal' && second[1] >= 2 && second[1] >= ranked[0][1] * 0.6) out.push(second[0]);
  return out;
}


const slug = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

async function buildDigimon() {
  console.log('\n== Digimon (DAPI) ==');
  const API = 'https://digi-api.com/api/v1';
  const first = await getJSON(`${API}/digimon?pageSize=100&page=0`);
  if (!first?.content || !first?.pageable) throw new Error('Unexpected DAPI list format: ' + Object.keys(first || {}).join(','));
  // DAPI's totalPages can't be trusted (looks like a last-index, not a count) → keep paging until a page is empty
  const pages = [first];
  for (let i = 1; i < 100; i++) {
    const p = await getJSON(`${API}/digimon?pageSize=100&page=${i}`);
    if (!p || !(p.content || []).length) break;
    pages.push(p);
  }
  const brief = [...new Map(pages.flatMap(p => p.content || []).map(b => [b.id, b])).values()];
  const expected = first.pageable.totalElements;
  console.log(`  list: ${brief.length} Digimon (DAPI says ${expected ?? '?'})`);
  if (expected && brief.length < expected) console.warn(`  !! still missing ${expected - brief.length} — check DAPI paging`);
  const details = (await mapLimit(brief, 4, b => getJSON(`${API}/digimon/${b.id}`), 'digimon'))
    .filter(Boolean).sort((a, b) => a.id - b.id);              // stable order → stable keys

  // name-based keys; on a clash the later entry gets its DAPI number appended
  const keyById = new Map(), used = new Set(), clashes = [];
  for (const d of details) {
    let k = 'digi:' + slug(d.name);
    if (used.has(k)) { clashes.push(d.name); k += '-' + d.id; }
    used.add(k); keyById.set(d.id, k);
  }
  if (clashes.length) console.log(`  ${clashes.length} name clashes got a number suffix, e.g.: ${clashes.slice(0, 8).join(', ')}`);
  const levelById = new Map(details.map(d => [d.id, ((d.levels || [])[0] || {}).level || 'Unknown']));
  const EVO_LV = { 'Baby II': 5, Child: 10, Adult: 20, Armor: 20, Perfect: 40, Hybrid: 40, Ultimate: 65, Unknown: 30 };

  const records = [], learnsets = {}, moves = {};
  for (const d of details) {
    const key = keyById.get(d.id);
    const level = ((d.levels || [])[0] || {}).level || 'Unknown';
    const [stage, tier, p0] = DIGI_LEVEL[level] || DIGI_LEVEL.Unknown;
    const r = rng('digi:' + d.name);
    const attribute = ((d.attributes || [])[0] || {}).attribute || 'Free';
    const bias = ATTR_BIAS[attribute] || [.1, 0, 0, 0, 0, 0];
    const raw = bias.map(b => Math.round(100 * (1 + b) * (0.75 + 0.5 * r())));
    records.push({ key, fr: 'digimon', name: d.name, ja: null, spName: d.name, dex: d.id,
      img: ((d.images || [])[0] || {}).href || null, types: digiTypes(d),
      typesOrig: (d.types || []).map(t => t.type), fields: (d.fields || []).map(f => f.field), attribute, level,
      raw, p: Math.min(0.99, Math.max(0.01, p0 + (r() - 0.5) * 0.08)),
      stage, tier, final: !(d.nextEvolutions || []).length, legendary: tier === 4, special: null, isDefault: true,
      evo: (d.nextEvolutions || []).filter(n => keyById.has(n.id))
        .filter(n => (DIGI_LEVEL[levelById.get(n.id)] || DIGI_LEVEL.Unknown)[0] >= stage)     // no de-evolution
        .map(n => ({ to: keyById.get(n.id), lv: EVO_LV[levelById.get(n.id)] ?? 30 })) });     // Armor & Jogress included

    learnsets[key] = (d.skills || []).map((s, i) => {
      const name = s.translation || s.skill;
      if (!name) return null;
      const id = s.id != null ? 'ds' + s.id : `${key}#${i}`;     // per-Digimon, so each keeps its own description
      moves[id] = { name, jp: s.translation && s.skill && s.skill !== s.translation ? s.skill : null, desc: s.description || null };
      return [id, null];
    }).filter(Boolean);
  }
  return { records, learnsets, moves };
}


/* =================== ANIIMO (official wiki pages saved by tools/scrape-aniimo.mjs) =================== */
const ANII_DIRS = [path.join(ROOT, 'tools', 'aniimo'), path.join(CACHE, 'aniimo')];
const ANII_POWER = 1.4;                      // Aniimo skill power ~30–70 → ×1.4 ≈ Pokémon scale (cap 150)
const ANII_EVO_LV = { 2: 16, 3: 36 };         // wiki lists no evolution levels → Pokémon-like defaults
const ANII_TYPE = { fire: 'fire', water: 'water', grass: 'grass', plant: 'grass', wind: 'flying', ice: 'ice', dark: 'dark',
  holy: 'fairy', light: 'fairy', thunder: 'electric', electric: 'electric', lightning: 'electric', earth: 'ground', ground: 'ground',
  rock: 'rock', metal: 'steel', steel: 'steel', poison: 'poison', normal: 'normal', psychic: 'psychic', dragon: 'dragon',
  bug: 'bug', fighting: 'fighting', ghost: 'ghost' };
const ANII_CAT = { '1': 'physical', '2': 'special' };   // wiki skill "Type" ids — check the build printout, swap if wrong
const ANII_ROLE = { dps: 'DPS', break: 'Breaker', heal: 'Healer', sup: 'Support', energy: 'Energy' };

async function walkJson(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkJson(p, out); else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}
// Nuxt _payload.json is "devalue" format: one flat array, values point to other indices
function unflatten(arr) {
  const memo = new Map();
  const H = i => {
    if (typeof i !== 'number') return i;
    if (i < 0) return i === -3 ? NaN : i === -4 ? Infinity : i === -5 ? -Infinity : i === -6 ? -0 : undefined;
    if (memo.has(i)) return memo.get(i);
    const v = arr[i];
    if (v === null || typeof v !== 'object') { memo.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {                         // type tags: ShallowReactive, Reactive, Ref, Date, Set, Map, null
        const t = v[0];
        if (t === 'Date') return v[1];
        if (t === 'Set') { const o = []; memo.set(i, o); v.slice(1).forEach(j => o.push(H(j))); return o; }
        if (t === 'Map') { const o = {}; memo.set(i, o); for (let n = 1; n < v.length; n += 2) o[String(H(v[n]))] = H(v[n + 1]); return o; }
        if (t === 'null') { const o = {}; memo.set(i, o); for (let n = 1; n < v.length; n += 2) o[v[n]] = H(v[n + 1]); return o; }
        const o = v.length > 1 ? H(v[1]) : undefined; memo.set(i, o); return o;
      }
      const o = []; memo.set(i, o); v.forEach(j => o.push(H(j))); return o;
    }
    const o = {}; memo.set(i, o); for (const [k, j] of Object.entries(v)) o[k] = H(j); return o;
  };
  return H(0);
}
function walkNodes(x, fn, seen = new Set()) {
  if (!x || typeof x !== 'object' || seen.has(x)) return;
  seen.add(x); fn(x);
  for (const v of Array.isArray(x) ? x : Object.values(x)) walkNodes(v, fn, seen);
}
function aniDetail(json) {
  if (json && !Array.isArray(json) && json.directories) return { tup: [], d: json };      // already-unpacked page
  const root = Array.isArray(json) && json[0] && typeof json[0] === 'object' && 'data' in json[0] ? unflatten(json) : json;
  const data = root && typeof root === 'object' ? (root.data || root) : null;
  if (!data || typeof data !== 'object') return null;
  for (const k of Object.keys(data)) if (k.startsWith('aniimo-detail-') && data[k]) {
    let tup = []; try { tup = JSON.parse(k.slice('aniimo-detail-'.length)); } catch { }   // [id, "001", "Basic Form", "en"]
    return { tup, d: data[k] };
  }
  return null;
}
function aniParse(d) {
  let info = null, tree = null; const skills = [], traits = [];
  walkNodes(d.directories || d, n => {
    const p = n.props || {};
    if (n.type === 'aniimoInfo' && p.formData) info = p.formData;
    if (n.type === 'evolution' && p.data) tree = p.data;
    if (p.title === 'Skill Details' && Array.isArray(p.tabs))
      p.tabs.forEach(tab => (tab.children || []).forEach(c => c && c.props && c.props.descTitle && skills.push({ ...c.props, innate: /innate/i.test(tab.title || '') })));
    if (p.title === 'Aniimo Traits')
      (n.children || []).forEach(c => c && c.props && c.props.descTitle && traits.push({ name: c.props.descTitle, desc: c.props.descContent || '' }));
  });
  return { info, tree, skills, traits };
}

async function buildAniimo() {
  console.log('\n== Aniimo (official wiki pages in tools/aniimo) ==');
  const files = (await Promise.all(ANII_DIRS.map(d => walkJson(d)))).flat();
  const pages = new Map();
  for (const f of files) {
    let j; try { j = JSON.parse(await readFile(f, 'utf8')); } catch { continue; }
    const hit = aniDetail(j); if (!hit) continue;
    const x = aniParse(hit.d); if (!x.info || !x.info.name) continue;
    const serial = String(x.info.serialNumber ?? hit.tup[1] ?? '').trim();
    const form = String(hit.tup[2] || x.info.currentMorphology || 'Basic Form');
    if (!pages.has(serial + '|' + form)) pages.set(serial + '|' + form, { serial, form, ...x, card: hit.d.searchKey || {} });
  }
  if (!pages.size) throw new Error('no Aniimo wiki pages found in tools/aniimo/ (run node tools/scrape-aniimo.mjs first)');
  console.log(`  ${pages.size} form pages (from ${files.length} json files)`);

  const elsOf = p => (p.info.attributes || []).map(a => String(a).replace(/^attributes-/, '').toLowerCase());
  const skEl = s => [].concat((s.source || {}).attributes || [])[0];
  // skill element ids → element names, learned from single-element Aniimo (each id and each element used once)
  const cnt = {};
  for (const p of pages.values()) { const e = elsOf(p); if (e.length !== 1) continue;
    for (const s of p.skills) { const a = skEl(s); if (a != null) cnt[a + '|' + e[0]] = (cnt[a + '|' + e[0]] || 0) + 1; } }
  const EL = {}, takenEl = new Set();
  Object.entries(cnt).map(([k, n]) => [...k.split('|'), n]).sort((a, b) => b[2] - a[2])
    .forEach(([a, e]) => { if (!(a in EL) && !takenEl.has(e)) { EL[a] = e; takenEl.add(e); } });
  console.log('  skill element ids:', Object.entries(EL).map(([a, e]) => `${a}=${e}`).join('  '));
  const catHist = {};
  const catOf = s => { const t = String([].concat((s.source || {}).type || [])[0] ?? ''); catHist[t] = (catHist[t] || 0) + 1;
    return ANII_CAT[t] || (/phys/i.test(t) ? 'physical' : /mag|spec/i.test(t) ? 'special' : ''); };

  // evolution trees (every page carries its whole family tree)
  const kids = new Map(), stageOf = new Map(), hasParent = new Set();
  const walkTree = n => {
    if (!n || !n.name) return;
    if (n.stage != null && !stageOf.has(n.name)) stageOf.set(n.name, +n.stage || 1);
    for (const c of n.children || []) {
      if (!c || !c.name) continue;
      if (!kids.has(n.name)) kids.set(n.name, new Map());
      kids.get(n.name).set(c.name, +c.stage || 0); hasParent.add(c.name); walkTree(c);
    }
  };
  for (const p of pages.values()) walkTree(p.tree);

  // keys: anii:emberpup, anii:emberpup-highland, anii:glameep-prismana; a renamed Prismana (Inferlupa) is its own monster
  const list = [...pages.values()].sort((a, b) => (+a.serial || 0) - (+b.serial || 0)
    || (a.form === 'Basic Form' ? -1 : b.form === 'Basic Form' ? 1 : a.form.localeCompare(b.form)));
  const basicName = new Map();
  list.forEach(p => { if (p.form === 'Basic Form' && !basicName.has(p.serial)) basicName.set(p.serial, p.info.name); });
  const used = new Set(), keyByName = new Map();
  for (const p of list) {
    p.short = p.form.replace(/\s*form$/i, '').trim();
    p.variant = p.form !== 'Basic Form' && basicName.get(p.serial) === p.info.name;
    let k = 'anii:' + slug(p.info.name) + (p.variant ? '-' + slug(p.short) : '');
    if (used.has(k)) k += '-' + slug(p.short);
    if (used.has(k)) k += '-' + slug(p.serial);
    used.add(k); p.key = k;
    if (!p.variant && !keyByName.has(p.info.name)) keyByName.set(p.info.name, k);
  }

  const records = [], learnsets = {}, moves = {}, unknownEl = new Set();
  for (const p of list) {
    const st = p.info, base = p.variant ? basicName.get(p.serial) : st.name, els = elsOf(p);
    els.forEach(e => { if (!ANII_TYPE[e]) unknownEl.add(e); });
    const types = [...new Set(els.map(e => ANII_TYPE[e] || 'normal'))].slice(0, 2);
    const raw = [st.hp, st.physicalAttack, st.physicalDefense, st.physicalAttack, st.magicDefense, st.haste].map(v => Math.max(1, +v || 0));
    const stage = stageOf.get(base) || +st.currentStage || 1;
    const prismana = p.variant && /prismana/i.test(p.form), serialN = +p.serial || 0;
    const evo = [];
    if (!prismana) for (const [child, cst] of kids.get(base) || []) {
      const ck = keyByName.get(child); if (!ck) continue;
      const alt = p.variant && used.has(ck + '-' + slug(p.short)) ? ck + '-' + slug(p.short) : ck;   // Highland → Highland
      evo.push({ to: alt, lv: ANII_EVO_LV[cst] || ANII_EVO_LV[stage + 1] || 30 });
    }
    const role = (st.position || []).map(x => { const s = String(x).replace(/^position-/, ''); return ANII_ROLE[s] || s; }).join(' / ') || null;
    records.push({ key: p.key, fr: 'aniimo', name: st.name + (prismana ? ' (Prismana)' : p.variant ? ` (${p.short})` : ''),
      ja: null, spName: base, dex: serialN, img: st.maleImage || st.noGenderImage || st.femaleImage || p.card.imageUrl || null,
      types: types.length ? types : ['normal'], typesOrig: els, raw, stage, tier: 0, final: !evo.length,
      legendary: serialN >= 900, special: prismana ? 'prismana' : null, isDefault: !p.variant, evo,
      form: p.form, role, desc: st.desc || p.card.description || null, traits: p.traits.slice(0, 4), _root: !hasParent.has(base) });

    const seen = new Set(), ls = [], start = { 1: 1, 2: 16, 3: 36 }[stage] || 1; let i = 0;
    for (const s of p.skills.slice().sort((a, b) => b.innate - a.innate)) {
      const name = String(s.descTitle || '').trim(); if (!name || seen.has(name)) continue; seen.add(name);
      const src = s.source || {}, pw = +src.power || 0, el = EL[skEl(s)] || null;
      let id = 'ani-' + slug(name);
      if (moves[id] && moves[id].powerRaw !== pw) id += '-' + pw;               // same name, different numbers
      if (!moves[id]) moves[id] = { name, type: ANII_TYPE[el] || types[0] || 'normal', typeOrig: el, cat: pw ? catOf(s) : 'status',
        power: pw ? Math.min(150, Math.max(20, Math.round(pw * ANII_POWER))) : null, powerRaw: pw, ep: +src.consume || 0,
        innate: !!s.innate, desc: s.descContent || null, icon: s.icon || null };
      ls.push([id, s.innate ? 1 : Math.min(70, start + 4 * i++)]);
    }
    learnsets[p.key] = ls;
  }
  // pools: stage 1/2/3 → Early/Mid/Late; never-evolving → by stat total; wiki no. ≥ 900 and Prismana variants → Legend
  const totals = records.filter(r => !r.special && !r.legendary).map(r => sum(r.raw)).sort((a, b) => a - b);
  for (const r of records) {
    if (r.legendary || r.special) r.tier = 4;
    else if (r.stage <= 1 && r.final && r._root) { const q = pctRank(totals, sum(r.raw)); r.tier = q < 0.4 ? 1 : q < 0.8 ? 2 : 3; }
    else r.tier = Math.min(3, Math.max(1, r.stage));
    delete r._root;
  }
  console.log('  skill category ids:', Object.entries(catHist).map(([t, n]) => `"${t}"×${n}→${ANII_CAT[t] || '?'}`).join('  '));
  const ex = records[0];
  if (ex) console.log(`  check ${ex.name}:`, (learnsets[ex.key] || []).map(([id]) => `${moves[id].name}=${moves[id].cat}/${moves[id].type}`).join(', '));
  if (unknownEl.size) console.warn('  !! elements with no Pokémon type yet (typed normal):', [...unknownEl].join(', '));
  return { records, learnsets, moves };
}

/* =================== MAIN =================== */
async function writeJSON(name, data, pretty) { await writeFile(path.join(OUT, name), JSON.stringify(data, null, pretty ? 2 : 0)); }

async function main() {
  await mkdir(OUT, { recursive: true }); await mkdir(CACHE, { recursive: true });
  const ps = await loadShowdown();

  const out = {};
  out.pokemon = await buildPokemon(ps);                       // required: it is the reference scale
  const ref = out.pokemon.records.filter(r => r.isDefault);
  const refBst = ref.map(r => sum(r.raw)).sort((a, b) => a - b);
  const refMed = [0, 1, 2, 3, 4, 5].map(i => median(ref.map(r => r.raw[i])));
  out.pokemon.records.forEach(r => { r.base = r.raw.map(v => Math.min(255, v)); r.bst = sum(r.base); });

  for (const [fr, fn] of [['palworld', buildPalworld], ['digimon', buildDigimon], ['aniimo', buildAniimo]]) {
    try { out[fr] = await fn(); normalize(out[fr].records, refBst, refMed); }
    catch (e) { console.error(`  !! ${fr} failed: ${e.message}`); }
  }

  const idxFile = path.join(OUT, 'index.json');
  const old = existsSync(idxFile) ? JSON.parse(await readFile(idxFile, 'utf8')) : null;
  const index = { version: new Date().toISOString(), franchises: {} };
  console.log('\n== Writing /data ==');
  for (const fr of ['pokemon', 'palworld', 'digimon', 'aniimo']) {
    if (out[fr]) {
      await writeJSON(`monsters.${fr}.json`, out[fr].records);
      await writeJSON(`learnsets.${fr}.json`, out[fr].learnsets);
      if (out[fr].moves) await writeJSON(`moves.${fr}.json`, out[fr].moves);
      index.franchises[fr] = { file: `monsters.${fr}.json`, count: out[fr].records.length };
      console.log(`  ${fr.padEnd(9)} ${String(out[fr].records.length).padStart(5)} monsters   ${tierCount(out[fr].records)}`);
    } else if (old?.franchises?.[fr]) {
      index.franchises[fr] = old.franchises[fr];
      console.log(`  ${fr.padEnd(9)} kept previous file (build failed this time)`);
    }
  }

  const abilities = buildAbilities(ps), items = buildItems(ps);
  await writeJSON('abilities.json', abilities);
  await writeJSON('items.json', items);
  console.log(`  abilities ${Object.keys(abilities).length} (random-pool OK: ${Object.values(abilities).filter(a => a.randomOk).length})`);
  console.log(`  items     ${Object.keys(items).length} battle items`);

  await writeJSON('index.json', index, true);
  console.log('\nDone. Upload the /data folder to GitHub.');
}
main().catch(e => { console.error('\nBUILD FAILED:', e); process.exit(1); });
