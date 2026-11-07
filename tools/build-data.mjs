// tools/build-data.mjs — builds /data/*.json for the Monster Lab tab.
// Run from the project root:  node tools/build-data.mjs
// Needs Node 18+. Raw API responses are cached (trimmed) in tools/.cache.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function buildPokemon() {
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
      evoList = e.next.map(n => { const b = defaultOf.get(n.species) || n.species; return { to: 'pkmn:' + (suffix && pokeByName.has(b + suffix) ? b + suffix : b), lv: n.lv }; });
    }

    let ls = levelUp(p);
    if (!ls.length && !p.is_default) { const d = pokeByName.get(defaultOf.get(sp.name)); if (d) ls = levelUp(d); }
    ls.forEach(([m]) => moveNames.add(m));
    learnsets['pkmn:' + p.name] = ls;

    records.push({ key: 'pkmn:' + p.name, fr: 'pokemon', name, ja, spName, dex: sp.id, img: p.img,
      types: p.types.map(t => t.type.name), typesOrig: null, raw, stage, tier, final, legendary, special,
      isDefault: p.is_default, evo: evoList });
  }
  records.sort((a, b) => a.dex - b.dex || b.isDefault - a.isDefault);

  const mv = [...moveNames];
  const md = await mapLimit(mv, 6, n => getJSON(`${API}/move/${n}`, trimMove), 'moves');
  const moves = {};
  mv.forEach((n, i) => { const m = md[i]; if (m) moves[n] = { name: lang(m.names, 'en') || prettify(n), type: m.type?.name, cat: m.damage_class?.name, power: m.power, acc: m.accuracy, pp: m.pp, prio: m.priority }; });
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
    const raw = [st.hp, st.meleeAttack, st.defense, st.shotAttack, st.defense, st.runSpeed].map(v => Number(v) || 0);
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
  const total = first.pageable.totalPages || 1;
  const rest = await mapLimit(Array.from({ length: total - 1 }, (_, i) => i + 1), 3, i => getJSON(`${API}/digimon?pageSize=100&page=${i}`), 'list pages');
  const brief = [first, ...rest.filter(Boolean)].flatMap(p => p.content || []);
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
      evo: (d.nextEvolutions || []).filter(n => keyById.has(n.id)).map(n => ({ to: keyById.get(n.id), lv: null })) });

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


/* =================== MAIN =================== */
async function writeJSON(name, data, pretty) { await writeFile(path.join(OUT, name), JSON.stringify(data, null, pretty ? 2 : 0)); }

async function main() {
  await mkdir(OUT, { recursive: true }); await mkdir(CACHE, { recursive: true });
  const out = {};
  out.pokemon = await buildPokemon();                         // required: it is the reference scale
  const ref = out.pokemon.records.filter(r => r.isDefault);
  const refBst = ref.map(r => sum(r.raw)).sort((a, b) => a - b);
  const refMed = [0, 1, 2, 3, 4, 5].map(i => median(ref.map(r => r.raw[i])));
  out.pokemon.records.forEach(r => { r.base = r.raw.map(v => Math.min(255, v)); r.bst = sum(r.base); });

  for (const [fr, fn] of [['palworld', buildPalworld], ['digimon', buildDigimon]]) {
    try { out[fr] = await fn(); normalize(out[fr].records, refBst, refMed); }
    catch (e) { console.error(`  !! ${fr} failed: ${e.message}`); }
  }

  const idxFile = path.join(OUT, 'index.json');
  const old = existsSync(idxFile) ? JSON.parse(await readFile(idxFile, 'utf8')) : null;
  const index = { version: new Date().toISOString(), franchises: {} };
  console.log('\n== Writing /data ==');
  for (const fr of ['pokemon', 'palworld', 'digimon']) {
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
  await writeJSON('index.json', index, true);
  console.log('\nDone. Upload the /data folder to GitHub.');
}
main().catch(e => { console.error('\nBUILD FAILED:', e); process.exit(1); });
