/* =====================================================================
   MONSTER LAB — Phase 1 gacha test bed                 file: game/gacha.js
   Load AFTER app.js. Reuses app.js globals: appState, save, render, toast,
   escapeHtml, escapeAttr, openModal, closeModal, uid, todayStr, fixedTabs.
   Game data has its own localStorage key and its own Firestore document.
   ===================================================================== */
(function () {
  const GAME_KEY = 'rpg_gacha_v1';
  const DATA_DIR = 'data/';
  const TCG = 'https://api.tcgdex.net/v2/en';
  const CACHE_DAYS = 7;
  const FR = {
    pokemon:  { label: 'Pokémon',  color: '#dc2626', raw: ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'] },
    palworld: { label: 'Palworld', color: '#0d9488', raw: ['HP', 'Melee', 'Def', 'Shot', 'Def', 'Run'] },
    digimon:  { label: 'Digimon',  color: '#ea580c', raw: null }   // generated stats
  };
  const TIERS = { 1: 'Early', 2: 'Mid', 3: 'Late', 4: 'Legend / Special' };
  const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
  const TYPE_COLOR = { normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c', grass: '#7ac74c', ice: '#96d9d6',
    fighting: '#c22e28', poison: '#a33ea1', ground: '#e2bf65', flying: '#a98ff3', psychic: '#f95587', bug: '#a6b91a',
    rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc', dark: '#705746', steel: '#b7b7ce', fairy: '#d685ad' };
  const statAt = (base, lv) => Math.round(1000 * base / 255 * (0.2 + 0.8 * lv / 100));   // 255 base @ Lv100 = 1000
  const pick = a => a[Math.floor(Math.random() * a.length)];

  /* ---------- game state (local first, cloud optional) ---------- */
  const defaultGame = () => ({ v: 1, box: {}, team: [], overrides: {}, updatedAt: 0, ui: { fr: Object.keys(FR), tiers: [1], last: null } });

  let game = loadGame();
  function loadGame() {
    try {
      const raw = localStorage.getItem(GAME_KEY);
      if (raw) { const g = JSON.parse(raw); return Object.assign(defaultGame(), g, { ui: Object.assign(defaultGame().ui, g.ui || {}) }); }
    } catch (e) { console.warn('gacha load failed', e); }
    return defaultGame();
  }
  function saveGame(cloud) {                 // cloud=false for UI-only changes (filters etc.)
    if (cloud) game.updatedAt = Date.now();
    localStorage.setItem(GAME_KEY, JSON.stringify(game));
    if (cloud && window.cloudGamePush) window.cloudGamePush();
  }

  /* ---------- tiny IndexedDB key-value store ---------- */
  let idbP = null;
  const idb = () => idbP || (idbP = new Promise((res, rej) => {
    const q = indexedDB.open('rpg_gacha', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
  async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
  async function cacheGet(k) { try { const c = await idbGet(k); return c && Date.now() - c.t < CACHE_DAYS * 864e5 ? c.v : null; } catch (e) { return null; } }
  async function cacheSet(k, v) { try { await idbSet(k, { t: Date.now(), v }); } catch (e) { } }

  /* ---------- monster data (static JSON → IndexedDB) ---------- */
  let DB = null, loading = null, BASE_OV = {};      // BASE_OV = data/overrides.json (optional, committed edits)
  function setDB(pack) { DB = { version: pack.version, list: pack.list, byKey: new Map(pack.list.map(r => [r.key, r])) }; return DB; }
  /* ---------- the ONE accessor: base data merged with my corrections ---------- */
  function mon(key) {
    const r = DB && DB.byKey.get(key); if (!r) return null;
    const o = (BASE_OV[key] || game.overrides[key]) ? Object.assign({}, BASE_OV[key], game.overrides[key]) : null; if (!o) return r;
    const m = Object.assign({}, r, { edited: true });
    if (o.types) m.types = o.types;
    if (o.moveEdits) m.moveEdits = o.moveEdits;
    if ('verified' in o) m.verified = o.verified;
    if (o.base) { m.base = o.base.slice(); m.bst = m.base.reduce((s, v) => s + v, 0); }
    return m;
  }
  function moveOf(fr, key, id, moves) {                       // per-monster move override wins
    const o = game.overrides[key];
    return Object.assign({ name: id }, moves[id] || {}, (o && o.moves && o.moves[id]) || {});
  }
  function setOverride(key, patch) {
    const cur = game.overrides[key] || {};
    const next = Object.assign({}, cur, patch);
    if (patch.moves) next.moves = Object.assign({}, cur.moves, patch.moves);
    game.overrides[key] = next; saveGame(true);
  }
  function resetOverride(key) { delete game.overrides[key]; saveGame(true); }

  function loadData() {
    if (DB) return Promise.resolve(DB);
    if (loading) return loading;
    loading = (async () => {
      let index = null;
      try { const ov = await fetch(DATA_DIR + 'overrides.json', { cache: 'no-cache' }); if (ov.ok) BASE_OV = await ov.json(); } catch (e) { /* no file yet */ }
      try { const res = await fetch(DATA_DIR + 'index.json', { cache: 'no-cache' }); if (res.ok) index = await res.json(); } catch (e) { /* offline */ }
      const cached = await idbGet('monsters').catch(() => null);
      if (cached && (!index || cached.version === index.version)) return setDB(cached);
      if (!index) throw new Error('No monster data found. Run tools/build-data.mjs and upload the /data folder.');
      const list = [];
      for (const info of Object.values(index.franchises)) {
        const res = await fetch(DATA_DIR + info.file);
        if (!res.ok) throw new Error('Could not load ' + info.file);
        list.push(...await res.json());
      }
      const pack = { version: index.version, list };
      idbSet('monsters', pack).catch(() => { });
      return setDB(pack);
    })();
    loading.catch(() => { loading = null; });
    return loading;
  }
  /* ---------- one-time migration: digi:<number> → digi:<name> ---------- */
  function migrateLegacyKeys() {
    if (!DB) return false;
    const byDex = new Map(DB.list.filter(r => r.fr === 'digimon').map(r => [String(r.dex), r.key]));
    let changed = false;
    const fix = k => {
      const m = /^digi:(\d+)$/.exec(k || ''); if (!m) return k;
      const nk = byDex.get(m[1]); if (nk !== k) changed = true;
      return nk || null;                                   // null = Digimon no longer exists → dropped
    };
    const box = {};
    for (const [k, v] of Object.entries(game.box)) { const nk = fix(k); if (nk && !box[nk]) box[nk] = v; }
    const team = [...new Set(game.team.map(fix).filter(Boolean))];
    const last = fix(game.ui.last);
    if (changed) { game.box = box; game.team = team; game.ui.last = last; }
    return changed;
  }

  /* ---------- rolling ---------- */
  const pool = () => DB.list.filter(r => game.ui.fr.includes(r.fr) && game.ui.tiers.includes(r.tier) && !game.box[r.key]);
  function roll() {
    const p = pool();
    if (!p.length) { toast('Nothing left in this pool — widen the filters', 'err'); return; }
    const fr = pick([...new Set(p.map(r => r.fr))]);           // pick franchise first, then monster
    const r = pick(p.filter(x => x.fr === fr));
    game.box[r.key] = { lv: 1, xp: 0, skin: null, got: todayStr(), t: Date.now() };
    game.ui.last = r.key;
    saveGame(true); render();
    toast(`You got ${r.name}! (${FR[r.fr].label})`);
  }

  /* ---------- small renderers ---------- */
  const typeBadge = t => `<span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded text-white" style="background:${TYPE_COLOR[t] || '#64748b'}">${escapeHtml(t)}</span>`;
  const frBadge = fr => `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style="background:${FR[fr].color}">${FR[fr].label}</span>`;
  const portrait = (r, cls) => {
    const own = game.box[r.key], src = (own && own.skin) || r.img || 'icons/icon-512.png';
    return `<img src="${escapeAttr(src)}" loading="lazy" class="${cls} object-contain" onerror="this.onerror=null;this.src='icons/icon-512.png';this.style.opacity=.3">`;
  };

  function view() {
    const u = game.ui, owned = Object.keys(game.box).length, poolN = pool().length;
    const frs = Object.keys(FR).filter(f => DB.list.some(r => r.fr === f));
    const frChecks = frs.map(f => `<label class="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" ${u.fr.includes(f) ? 'checked' : ''} onchange="Gacha.toggleFr('${f}',this.checked)"> ${FR[f].label}</label>`).join('');
    const tierChecks = Object.entries(TIERS).map(([t, l]) => `<label class="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" ${u.tiers.includes(+t) ? 'checked' : ''} onchange="Gacha.toggleTier(${t},this.checked)"> ${l}</label>`).join('');
    const last = u.last && game.box[u.last] && mon(u.last);
    const team = Array.from({ length: 6 }, (_, i) => {
      const r = mon(game.team[i]);
      return r ? `<div onclick="Gacha.open('${r.key}')" class="w-20 bg-slate-800 border border-amber-500/60 rounded p-1 text-center cursor-pointer">${portrait(r, 'w-full h-14')}<div class="text-[10px] truncate">${escapeHtml(r.name)}</div></div>`
               : `<div class="w-20 h-[78px] border-2 border-dashed border-slate-600 rounded flex items-center justify-center text-slate-600"><i class="fa-solid fa-plus"></i></div>`;
    }).join('');
    const boxHtml = Object.entries(game.box).sort((a, b) => b[1].t - a[1].t).map(([k]) => mon(k)).filter(Boolean).map(r => `
      <div class="gbox bg-slate-800 border border-slate-600 hover:border-indigo-400 rounded p-2 cursor-pointer text-center" data-name="${escapeAttr((r.name + ' ' + (r.ja || '')).toLowerCase())}" onclick="Gacha.open('${r.key}')">
        ${portrait(r, 'w-full h-20')}
        <div class="text-xs font-bold truncate mt-1">${escapeHtml(r.name)}</div>
        <div class="flex justify-center gap-1 mt-1">${frBadge(r.fr)}${game.team.includes(r.key) ? '<i class="fa-solid fa-star text-amber-400 text-xs"></i>' : ''}</div>
      </div>`).join('');
    return `
    <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
      <h2 class="text-xl font-bold"><i class="fa-solid fa-dragon"></i> Monster Lab <span class="text-xs text-slate-500 font-normal">Phase 1 test bed</span></h2>
      <div class="text-sm text-slate-400">Collected <b class="text-slate-100">${owned}</b> / ${DB.list.length}</div>
    </div>
    <div class="bg-slate-800 border border-slate-600 rounded p-3 mb-4 text-sm space-y-2">
      <div class="flex flex-wrap items-center gap-3"><span class="text-slate-400 w-20">Franchise</span>${frChecks}</div>
      <div class="flex flex-wrap items-center gap-3"><span class="text-slate-400 w-20">Pool</span>${tierChecks}</div>
      <div class="flex items-center gap-3 pt-1">
        <button onclick="Gacha.roll()" ${poolN ? '' : 'disabled'} class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-4 py-2 rounded font-bold"><i class="fa-solid fa-dice"></i> Roll</button>
        <span class="text-xs text-slate-400">${poolN} left in this pool</span>
      </div>
    </div>
    ${last ? `
    <div onclick="Gacha.open('${last.key}')" class="bg-gradient-to-r from-indigo-900/60 to-slate-800 border-2 border-indigo-500 rounded-lg p-3 mb-5 flex items-center gap-4 cursor-pointer">
      ${portrait(last, 'w-24 h-24 shrink-0')}
      <div class="min-w-0">
        <div class="text-[10px] text-indigo-300 uppercase tracking-wider">Latest pull</div>
        <div class="text-lg font-bold">${escapeHtml(last.name)}</div>
        ${last.ja ? `<div class="text-xs text-slate-400">${escapeHtml(last.ja)}</div>` : ''}
        <div class="flex gap-1 flex-wrap mt-1">${frBadge(last.fr)}${last.types.map(typeBadge).join('')}</div>
        <div class="text-xs text-slate-400 mt-1">${TIERS[last.tier]} · Base total ${last.bst}</div>
      </div>
    </div>` : ''}
    <h3 class="font-bold text-amber-300 mb-2"><i class="fa-solid fa-star"></i> Team (${game.team.length}/6)</h3>
    <div class="flex gap-2 mb-5 flex-wrap">${team}</div>
    <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <h3 class="font-bold text-indigo-300"><i class="fa-solid fa-box-archive"></i> Box</h3>
      <input oninput="Gacha.filterBox(this.value)" placeholder="Search…" class="bg-slate-700 rounded px-2 py-1 text-sm w-40">
    </div>
    <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2 mb-6">${boxHtml || '<p class="col-span-full text-slate-500 text-sm">Empty — roll something!</p>'}</div>
    <div class="flex gap-2 flex-wrap text-xs">
      <button onclick="Gacha.exportGame()" class="bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded"><i class="fa-solid fa-download"></i> Export game JSON</button>
      <button onclick="Gacha.exportEdits()" class="bg-fuchsia-800 hover:bg-fuchsia-700 px-2 py-1 rounded"><i class="fa-solid fa-file-export"></i> Export edits (overrides.json)</button>
      <button onclick="Gacha.resetBox()" class="bg-red-800 hover:bg-red-700 px-2 py-1 rounded"><i class="fa-solid fa-rotate-left"></i> Reset collection</button>
    </div>
    <p class="text-[10px] text-slate-500 mt-4"><span class="mlr-launch"><button type="button" onclick="MonsterRun.open()">▶ Monster Lab Run</button></span>Data: PokéAPI · Pokémon Showdown (MIT) · TCGdex · PalSphere (palsphere.app) · DAPI / Wikimon. Unofficial fan project; all monsters © their owners. Data build ${escapeHtml(DB.version)}</p>`;
  }

  /* ---------- detail modal ---------- */
  function open(key) {
    const r = mon(key); if (!r) return;
    const own = game.box[key], lv = own ? own.lv : 1, rawL = FR[r.fr].raw;
    const rows = STATS.map((s, i) => `<tr class="border-b border-slate-700">
      <td class="pr-2 text-slate-400">${s}</td>
      <td class="pr-2 text-slate-500 whitespace-nowrap">${rawL ? `${r.raw[i]} <span class="text-[9px]">${rawL[i]}</span>` : 'gen'}</td>
      <td class="w-full pr-2"><div class="bg-slate-700 h-2 rounded"><div class="bg-emerald-500 h-2 rounded" style="width:${Math.round(r.base[i] / 255 * 100)}%"></div></div></td>
      <td class="pr-2 text-right">${r.base[i]}</td><td class="pr-2 text-right text-sky-300">${statAt(r.base[i], lv)}</td><td class="text-right text-amber-300">${statAt(r.base[i], 100)}</td></tr>`).join('');
    const evo = r.evo.map(e => { const t = mon(e.to); return t ? `${escapeHtml(t.name)}${e.lv ? ` (Lv ${e.lv})` : ''}` : null; }).filter(Boolean).join(', ') || (r.final ? 'Final form' : '—');
    const meta = [['Dex #', r.dex], ['Pool', TIERS[r.tier]], ['Stage', r.stage],
      r.typesOrig && r.typesOrig.length ? ['Original type', r.typesOrig.join(' / ')] : null,
      r.attribute ? ['Attribute', r.attribute] : null, r.level ? ['Digimon level', r.level] : null,
      r.rarity ? ['Pal rarity', r.rarity] : null, r.special ? ['Special form', r.special] : null,
      ['Evolves to', evo], own ? ['Pulled', own.got] : null].filter(Boolean)
      .map(([k, v]) => `<div class="flex justify-between gap-3 border-b border-slate-700 py-0.5"><span class="text-slate-400">${k}</span><span class="text-right">${typeof v === 'string' && k === 'Evolves to' ? v : escapeHtml(String(v))}</span></div>`).join('');
    const inTeam = game.team.includes(key);
    openModal(`
      <div class="flex items-start gap-4 mb-3">
        ${portrait(r, 'w-32 h-32 shrink-0 bg-slate-900 rounded')}
        <div class="min-w-0 flex-1">
          <h3 class="text-xl font-bold">${escapeHtml(r.name)}</h3>
          ${r.ja ? `<div class="text-sm text-slate-400">${escapeHtml(r.ja)}</div>` : ''}
          <div class="flex gap-1 flex-wrap mt-1">${frBadge(r.fr)}${r.types.map(typeBadge).join('')}${r.edited ? '<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-700 text-white">Edited</span>' : ''}</div>
          <div class="text-xs text-slate-400 mt-2">Lv ${lv} · Base total ${r.bst}</div>
        </div>
      </div>
      <table class="w-full text-xs mb-1"><thead><tr class="text-slate-500"><th class="text-left">Stat</th><th class="text-left">Raw</th><th></th><th class="text-right">Base</th><th class="text-right">Lv ${lv}</th><th class="text-right">Lv100</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="text-[10px] text-slate-500 mb-3">Base is on Pokémon's 0–255 scale; Lv columns are the unified 1,000-cap values.</p>
      <div class="text-xs mb-4">${meta}</div>
      <div id="moveWrap" data-key="${key}" class="mb-4"></div>
      <div id="tcgWrap" class="mb-4"></div>
      <div class="flex gap-2 justify-end flex-wrap">
        ${own ? `
        <button onclick="Gacha.release('${key}')" class="bg-red-600 hover:bg-red-500 px-3 py-1 rounded text-sm">Release</button>
        <button onclick="Gacha.promote('${key}')" class="bg-sky-700 hover:bg-sky-600 px-3 py-1 rounded text-sm"><i class="fa-solid fa-users"></i> Promote to Party</button>
        <button onclick="Gacha.toggleTeam('${key}')" class="bg-amber-600 hover:bg-amber-500 px-3 py-1 rounded text-sm"><i class="fa-solid fa-star"></i> ${inTeam ? 'Remove from Team' : 'Add to Team'}</button>` : ''}
        ${r.fr !== 'pokemon' && window.MonsterEditor ? `<button onclick="Gacha.edit('${key}')" class="bg-fuchsia-700 hover:bg-fuchsia-600 px-3 py-1 rounded text-sm"><i class="fa-solid fa-pen"></i> Edit types & moves</button>` : ''}
        <button onclick="closeModal()" class="bg-slate-600 px-3 py-1 rounded text-sm">Close</button>
      </div>`);
    loadMoves(r);
    if (r.fr === 'pokemon' && own) loadCostumes(r);
  }

  /* ---------- TCG costumes (TCGdex) ---------- */
  async function tcgJSON(url) { const res = await fetch(url); if (!res.ok) throw new Error(res.status); return res.json(); }
  let pocketSets = null;
  async function getPocketSets() {
    if (pocketSets) return pocketSets;
    let ids = await cacheGet('tcgp_sets');
    if (!ids) { try { ids = ((await tcgJSON(`${TCG}/series/tcgp`)).sets || []).map(s => s.id); await cacheSet('tcgp_sets', ids); } catch (e) { ids = []; } }
    return (pocketSets = new Set(ids));
  }
  async function getCards(r) {
    const ck = 'tcg_' + r.dex;
    const hit = await cacheGet(ck); if (hit) return hit;
    let cards = [];
    try { cards = await tcgJSON(`${TCG}/cards?dexId=eq:${r.dex}`); } catch (e) { }
    if (!Array.isArray(cards) || !cards.length || cards.length > 1500) {        // fallback: name match
      const nm = r.spName.toLowerCase();
      try { cards = (await tcgJSON(`${TCG}/cards?name=${encodeURIComponent(r.spName)}`)).filter(c => { const n = (c.name || '').toLowerCase(); return n === nm || n.startsWith(nm + ' '); }); }
      catch (e) { cards = []; }
    }
    cards = cards.filter(c => c.image).map(c => ({ id: c.id, n: c.name, img: c.image }));
    await cacheSet(ck, cards);
    return cards;
  }
  async function loadCostumes(r) {
    const wrap = document.getElementById('tcgWrap'); if (!wrap) return;
    wrap.innerHTML = '<p class="text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Loading TCG costumes…</p>';
    const [cards, psets] = await Promise.all([getCards(r), getPocketSets()]);
    const el = document.getElementById('tcgWrap'); if (!el) return;            // modal was closed
    const setOf = id => id.slice(0, id.lastIndexOf('-'));
    const skin = (game.box[r.key] || {}).skin;
    const tile = c => { const hi = c.img + '/high.webp';
      return `<button onclick="Gacha.setSkin('${r.key}','${hi}')" title="${escapeAttr(c.n + ' · ' + c.id)}" class="shrink-0 rounded border-2 ${skin === hi ? 'border-amber-400' : 'border-transparent hover:border-indigo-400'}"><img src="${c.img}/low.webp" loading="lazy" class="h-28 rounded"></button>`; };
    const strip = (title, list) => list.length ? `<h5 class="text-xs font-bold text-slate-300 mt-2 mb-1">${title} (${list.length}${list.length > 40 ? ', newest 40 shown' : ''})</h5>
      <div class="flex gap-2 overflow-x-auto pb-2">${list.slice(-40).reverse().map(tile).join('')}</div>` : '';
    const pocket = cards.filter(c => psets.has(setOf(c.id))), paper = cards.filter(c => !psets.has(setOf(c.id)));
    el.innerHTML = `<div class="flex items-center justify-between"><h4 class="font-bold text-indigo-300 text-sm"><i class="fa-solid fa-shirt"></i> Costumes</h4>
      ${skin ? `<button onclick="Gacha.setSkin('${r.key}','')" class="text-xs text-slate-400 hover:text-white underline">Use default art</button>` : ''}</div>
      ${strip('TCG Pocket', pocket)}${strip('Pokémon TCG', paper)}${cards.length ? '' : '<p class="text-xs text-slate-500">No cards found.</p>'}`;
  }
  /* ---------- attacks (lazy-loaded per franchise) ---------- */
  const moveData = {};
  function getMoveData(fr) {
    if (!moveData[fr]) moveData[fr] = Promise.all(['learnsets', 'moves'].map(n =>
      fetch(`${DATA_DIR}${n}.${fr}.json`).then(res => res.ok ? res.json() : {}).catch(() => ({}))))
      .then(([learnsets, moves]) => ({ learnsets, moves }));
    return moveData[fr];
  }
  async function loadMoves(r) {
    const { learnsets, moves } = await getMoveData(r.fr);
    const el = document.getElementById('moveWrap');
    if (!el || el.dataset.key !== r.key) return;            // modal closed or switched
    const list = learnsets[r.key] || [];
    const rows = list.map(([id, lv]) => {
      const m = moveOf(r.fr, r.key, id, moves);
      return `<div class="border-b border-slate-700 py-1">
        <div class="flex items-center gap-2 flex-wrap">
          ${lv != null ? `<span class="text-slate-500 w-10">Lv ${lv}</span>` : ''}
          <span class="font-semibold">${escapeHtml(m.name || id)}</span>
          ${m.jp ? `<span class="text-slate-500">${escapeHtml(m.jp)}</span>` : ''}
          ${m.type ? typeBadge(m.type) : ''}
          ${m.power ? `<span class="text-amber-300">${m.power} pow</span>` : ''}
        </div>
        ${m.desc ? `<div class="text-slate-400 mt-0.5">${escapeHtml(m.desc)}</div>` : ''}
      </div>`;
    }).join('');
    el.innerHTML = `<h4 class="font-bold text-indigo-300 text-sm mb-1"><i class="fa-solid fa-burst"></i> Attacks (${list.length})</h4>
      <div class="text-xs max-h-48 overflow-y-auto">${rows || '<p class="text-slate-500">No attack data.</p>'}</div>`;
  }

  /* ---------- actions ---------- */
  function setSkin(key, url) { const own = game.box[key]; if (!own) return; own.skin = url || null; saveGame(true); render(); open(key); toast(url ? 'Costume equipped' : 'Default art restored'); }
  function toggleTeam(key) {
    const i = game.team.indexOf(key);
    if (i >= 0) game.team.splice(i, 1);
    else if (game.team.length >= 6) { toast('Team is full (6)', 'err'); return; }
    else game.team.push(key);
    saveGame(true); render(); open(key);
  }
  function promote(key) {
    const r = mon(key), own = game.box[key]; if (!r || !own) return;
    if (appState.party.some(m => m.attributes && m.attributes['Monster ID'] === key) && !confirm(`${r.name} is already in your Party. Add another copy?`)) return;
    const attributes = { Franchise: FR[r.fr].label, Type: r.types.join(' / ') };
    if (r.ja) attributes.Japanese = r.ja;
    attributes['Monster ID'] = key;
    appState.party.push({ id: uid(), name: r.name, level: 1, xp: 0, attributes, img: own.skin || r.img || '' });
    save(); toast(`${r.name} joined your Party`);
  }
  function release(key) {
    const r = mon(key);
    if (!confirm(`Release ${r ? r.name : 'this monster'}? It goes back into the pool.`)) return;
    delete game.box[key]; game.team = game.team.filter(k => k !== key);
    if (game.ui.last === key) game.ui.last = null;
    saveGame(true); closeModal(); render(); toast('Released', 'info');
  }
  function resetBox() {
    if (!confirm('Release EVERY monster and empty the team?')) return;
    game.box = {}; game.team = []; game.ui.last = null;
    saveGame(true); render(); toast('Collection reset', 'err');
  }
  function exportEdits() {
    const out = JSON.parse(JSON.stringify(Object.assign({}, BASE_OV, game.overrides)));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'overrides.json' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Saved overrides.json. Put it in /data and commit it to make these edits the default.');
  }
  function exportGame() {
    const blob = new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `monster-lab-${todayStr()}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function toggleList(arr, v, on) { const s = new Set(arr); on ? s.add(v) : s.delete(v); return [...s]; }

  function renderTab(el) {
    if (DB) { el.innerHTML = view(); return; }
    el.innerHTML = '<p class="text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Loading monster data…</p>';
    loadData().then(() => {
      if (migrateLegacyKeys()) { saveGame(true); toast('Your Digimon were moved to the new name-based IDs', 'info'); }
      if (appState.activeTab === 'gacha') render();
    })
      .catch(err => { if (appState.activeTab === 'gacha') el.innerHTML = `<div class="bg-red-900/50 border border-red-500 rounded p-3 text-sm">${escapeHtml(err.message)}</div>`; });
  }

  /* ---------- public API ---------- */
  window.Gacha = {
    roll, open, setSkin, toggleTeam, promote, release, resetBox, exportGame, exportEdits,
    edit: key => { closeModal(); MonsterEditor.open(key).then(() => { render(); open(key); }); },
    toggleFr: (f, on) => { game.ui.fr = toggleList(game.ui.fr, f, on); saveGame(false); render(); },
    toggleTier: (t, on) => { game.ui.tiers = toggleList(game.ui.tiers, t, on); saveGame(false); render(); },
    filterBox: q => { q = q.trim().toLowerCase(); document.querySelectorAll('.gbox').forEach(el => { el.style.display = el.dataset.name.includes(q) ? '' : 'none'; }); },
    // used by game-cloud.js
    exportState: () => { const j = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
      return { v: game.v, box: game.box, team: game.team, overrides: game.overrides, updatedAt: game.updatedAt, run: j('ml.run'), runB: j('ml.runB'), meta: j('ml.meta') }; },
    importState: s => {
      if (!s) return;
      game.box = s.box || {}; game.team = s.team || []; game.updatedAt = s.updatedAt || 0;
      if (s.overrides) game.overrides = s.overrides;     // older cloud docs have no overrides → keep local ones
      if ('run' in s) s.run ? localStorage.setItem('ml.run', JSON.stringify(s.run)) : localStorage.removeItem('ml.run');
      if ('runB' in s) s.runB ? localStorage.setItem('ml.runB', JSON.stringify(s.runB)) : localStorage.removeItem('ml.runB');
      if (s.meta) localStorage.setItem('ml.meta', JSON.stringify(s.meta));
      if (game.ui.last && !game.box[game.ui.last]) game.ui.last = null;
      saveGame(migrateLegacyKeys());   // converts old keys arriving from another device
      if (appState.activeTab === 'gacha') render();
    },
    mon, moveOf, setOverride, resetOverride, load: loadData, list: () => DB ? DB.list.map(r => mon(r.key)) : [], owned: k => !!game.box[k],
    img: key => { const r = mon(key), o = game.box[key]; return (o && o.skin) || (r && r.img) || ''; },
    cards: r => getCards(r),
    setSkinQuiet: (key, url) => { if (game.box[key]) { game.box[key].skin = url || null; saveGame(true); } },
    grant: key => { if (!game.box[key] && DB && DB.byKey.has(key)) { game.box[key] = { lv: 1, xp: 0, skin: null, got: todayStr(), t: Date.now() }; saveGame(true); } },
    sync: () => saveGame(true),
    localUpdatedAt: () => game.updatedAt || 0,
    hasContent: () => Object.keys(game.box).length > 0
  };

  /* ---------- register the tab ---------- */
  if (!fixedTabs.some(t => t.id === 'gacha')) fixedTabs.push({ id: 'gacha', label: 'Monster Lab', icon: 'fa-dragon' });
  window.GameTabs = Object.assign(window.GameTabs || {}, { gacha: renderTab });
})();
