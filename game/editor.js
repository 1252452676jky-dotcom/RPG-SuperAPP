/* MONSTER LAB — Digimon / Pal move editor        file: game/editor.js
   Load AFTER game/run.js. Opened from info panels ("Edit types & moves").
   Each move can copy a Pokémon "base move" (keeps its priority, flags, multi-hit, Protect, fixed damage…)
   and you change anything on top. Saves into game.overrides[key].moveEdits[moveId] via Gacha.setOverride. */
(function () {
  const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
  const STS = ['', 'brn', 'par', 'psn', 'tox', 'slp', 'frz'];
  const STN = { brn: 'burn', par: 'paralysis', psn: 'poison', tox: 'bad poison', slp: 'sleep', frz: 'freeze' };
  const WS = ['', 'sun', 'rain', 'sand', 'snow'], TS = ['', 'electric', 'grassy', 'psychic', 'misty'];
  const WMAP = { raindance: 'rain', sunnyday: 'sun', sandstorm: 'sand', snowscape: 'snow', hail: 'snow' };
  const PAL = { neutral: 'normal', leaf: 'grass', earth: 'ground' };
  const BST = [['atk', 'Atk'], ['def', 'Def'], ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe'], ['accuracy', 'Acc'], ['evasion', 'Eva']];
  const BL = Object.fromEntries(BST);
  const NUM = ['power', 'acc', 'prio', 'stCh', 'conf', 'flinch', 'foeCh', 'meCh', 'drain', 'recoil', 'heal'];
  const SPECIAL = /^(dragonrage|sonicboom|seismictoss|nightshade|superfang|naturesmadness|ruination|endeavor|finalgambit|psywave|synthesis|moonlight|morningsun|shoreup|protect|detect|kingsshield|spikyshield|banefulbunker|silktrap|burningbulwark|obstruct)$/;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const opt = (list, v) => list.map(x => { const [val, txt] = Array.isArray(x) ? x : [x, x];
    return `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(txt)}</option>`; }).join('');
  const cur = key => { try { return (Gacha.exportState().overrides || {})[key] || {}; } catch { return {}; } };
  let PK = null;
  async function loadPK() { if (!PK) PK = await fetch('data/moves.pokemon.json').then(r => r.ok ? r.json() : {}).catch(() => ({})); return PK; }
  const pct = a => Array.isArray(a) && a[1] ? Math.round(a[0] / a[1] * 100) : 0;
  const tgtOf = t => /^(self|allySide|allyTeam|all|adjacentAllyOrSelf)$/.test(t || '') ? 'self' : /^allAdjacent/.test(t || '') ? 'allAdjacentFoes' : 'normal';
  const btxt = o => Object.entries(o).map(([k, v]) => `${BL[k] || k} ${v > 0 ? '+' : '−'}${Math.abs(v)}`).join(', ');
  const cleanB = o => { const x = {}; for (const [k, v] of Object.entries(o || {})) if (+v) x[k] = Math.max(-6, Math.min(6, +v)); return Object.keys(x).length ? x : null; };
  const cap = s => s[0].toUpperCase() + s.slice(1);

  /* ---- base-move picker ---- */
  const TC = { normal:'#9fa19f', fire:'#e62829', water:'#2980ef', electric:'#fac000', grass:'#3fa129', ice:'#3dcef3', fighting:'#ff8000',
    poison:'#9141cb', ground:'#915121', flying:'#81b9ef', psychic:'#ef4179', bug:'#91a119', rock:'#afa981', ghost:'#704170',
    dragon:'#5060e1', dark:'#624d4e', steel:'#60a1b8', fairy:'#ef70ef' };
  const CAT = { physical: 'Phys', special: 'Spec', status: 'Status' };
  const pk = { q: '', ty: '', cat: '', hi: 0, list: [] };          // picker state
  const catOf = m => String(m.cat || m.category || '').toLowerCase();
  const tyOf = m => String(m.type || 'normal').toLowerCase();
  const accTxt = m => { const a = m.acc ?? m.accuracy; return a === true || a == null ? 'sure hit' : a + '%'; };
  function searchPK(q, ty, cat) {
    q = q.trim().toLowerCase(); const qn = q.replace(/[^a-z0-9]/g, ''), out = [];
    for (const [id, m] of Object.entries(PK || {})) {
      if (ty && tyOf(m) !== ty) continue;
      if (cat && catOf(m) !== cat) continue;
      const n = String(m.name || id).toLowerCase();
      const s = !q ? 3 : n.startsWith(q) ? 0 : n.split(/[\s-]/).some(w => w.startsWith(q)) ? 1
        : (n.includes(q) || (qn && id.includes(qn))) ? 2 : (q.length > 2 && String(m.desc || '').toLowerCase().includes(q)) ? 4 : -1;
      if (s >= 0) out.push([s, n, id]);
    }
    return out.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).slice(0, 60).map(x => x[2]);
  }
  const pkOpt = (id, hi, cls = '') => {
    const m = PK[id]; if (!m) return '';
    const t = tyOf(m), c = catOf(m);
    return `<div class="mle-opt ${hi ? 'hi' : ''} ${cls}" ${cls ? '' : `data-pickid="${esc(id)}"`}>
      <span class="mle-ty" style="background:${TC[t] || '#777'}">${esc(t)}</span>
      <span class="mle-cat mle-${c}">${CAT[c] || esc(c)}</span>
      <b>${esc(m.name || id)}</b>
      <span class="mle-st">${m.power ? m.power + ' pw' : '—'} · ${accTxt(m)}${m.prio ? ' · prio ' + (m.prio > 0 ? '+' : '') + m.prio : ''}</span>
      <div class="mle-od">${esc(m.desc || '')}</div></div>`;
  };

  /* any move object (Pokémon base, Pal/Digimon original, or a saved edit) → editor fields */
  function toForm(src, fbType) {
    src = src || {};
    const c = String(src.category ?? src.cat ?? '').toLowerCase(), power = +(src.power ?? src.basePower) || 0;
    const cat = /phys|melee/.test(c) ? 'physical' : /spec|shot/.test(c) ? 'special' : /status/.test(c) ? 'status' : power ? 'physical' : 'status';
    const a = src.accuracy !== undefined ? src.accuracy : src.acc;
    let type = String(src.type ?? src.element ?? '').toLowerCase(); type = PAL[type] || type; if (!TYPES.includes(type)) type = fbType;
    const w = String(src.weather || '').toLowerCase(), tr = String(src.terrain || '').toLowerCase().replace('terrain', '');
    const f = { name: src.name || '', base: src.base || '', type, cat, power, acc: a === true || a === null ? 0 : (+a || 100),
      prio: +(src.priority ?? src.prio) || 0, crit: src.willCrit ? 'always' : (+src.critRatio || 1) > 1 ? 'high' : 'normal',
      target: tgtOf(src.target), st: '', stCh: 100, conf: 0, flinch: 0, foe: {}, foeCh: 100, me: {}, meCh: 100,
      drain: pct(src.drain), recoil: pct(src.recoil), heal: pct(src.heal),
      weather: WMAP[w] || (WS.includes(w) ? w : ''), terrain: TS.includes(tr) ? tr : '', cost: src.cost ?? '' };
    if (cat === 'status') {
      f.st = src.status || '';
      if (src.volatileStatus === 'confusion') f.conf = 100;
      if (src.boosts) Object.assign(f.target === 'self' ? f.me : f.foe, src.boosts);
    }
    for (const s of src.secondaries || (src.secondary ? [src.secondary] : [])) {
      if (!s) continue;
      if (s.status) { f.st = s.status; f.stCh = s.chance || 100; }
      if (s.volatileStatus === 'confusion') f.conf = s.chance || 100;
      if (s.volatileStatus === 'flinch') f.flinch = s.chance || 100;
      if (s.boosts) { Object.assign(f.foe, s.boosts); f.foeCh = s.chance || 100; }
      if (s.self && s.self.boosts) { Object.assign(f.me, s.self.boosts); f.meCh = s.chance || 100; }
    }
    if (src.self && src.self.boosts) Object.assign(f.me, src.self.boosts);
    return f;
  }

  /* editor fields → saved edit (everything explicit, so the base move's old effects don't leak through) */
  function fromForm(f) {
    const tpl = f.base && PK && PK[f.base];
    const e = { name: f.name || (tpl && tpl.name) || 'Move', type: f.type, category: f.cat,
      power: f.cat === 'status' ? 0 : Math.max(0, +f.power || 0), accuracy: +f.acc ? Math.min(100, +f.acc) : true,
      priority: +f.prio || 0, critRatio: f.crit === 'high' ? 2 : 1, willCrit: f.cat !== 'status' && f.crit === 'always',
      target: f.target, status: null, volatileStatus: null, boosts: null, self: null, secondaries: [],
      drain: null, recoil: null, heal: null, weather: f.weather || null, terrain: f.terrain || null };
    if (f.base) e.base = f.base;
    if (f.cost !== '' && f.cost != null) e.cost = Math.max(0, Math.min(3, +f.cost));   // blank = auto (level formula)
    const foe = cleanB(f.foe), me = cleanB(f.me);
    if (f.cat === 'status') {
      if (f.st) e.status = f.st;
      const tv = tpl && tpl.volatileStatus;
      e.volatileStatus = +f.conf ? 'confusion' : (tv && tv !== 'confusion' ? tv : null);    // keeps Leech Seed, Protect…
      if (foe) e.boosts = foe;
      if (me) e.self = { boosts: me };
      if (+f.heal) e.heal = [+f.heal, 100];
    } else {
      if (f.st) e.secondaries.push({ chance: +f.stCh || 100, status: f.st });
      if (+f.conf) e.secondaries.push({ chance: +f.conf, volatileStatus: 'confusion' });
      if (+f.flinch) e.secondaries.push({ chance: +f.flinch, volatileStatus: 'flinch' });
      if (foe) e.secondaries.push({ chance: +f.foeCh || 100, boosts: foe });
      if (me) { if ((+f.meCh || 100) >= 100) e.self = { boosts: me }; else e.secondaries.push({ chance: +f.meCh, self: { boosts: me } }); }
      if (+f.drain) e.drain = [+f.drain, 100];
      if (+f.recoil) e.recoil = [+f.recoil, 100];
    }
    const fx = describe(e, tpl);                     // auto effect summary
    e.fx = fx;
    if (f.about) { e.origDesc = f.about; e.desc = fx === 'No additional effect.' ? f.about : `${f.about} — ${fx}`; }
    else e.desc = fx;
    return e;
  }
  function describe(e, tpl) {
    const p = [];
    if (tpl) p.push(`Based on ${tpl.name}.`);
    if (e.priority > 0) p.push(`Usually goes first (priority +${e.priority}).`);
    if (e.priority < 0) p.push(`Usually goes last (priority ${e.priority}).`);
    if (e.target === 'allAdjacentFoes') p.push('Hits all foes.');
    if (e.willCrit) p.push('Always lands a critical hit.'); else if (e.critRatio > 1) p.push('High critical-hit ratio.');
    if (e.accuracy === true && e.category !== 'status') p.push('Never misses.');
    if (e.status) p.push(`Inflicts ${STN[e.status]}.`);
    if (e.volatileStatus === 'confusion') p.push('Confuses the target.');
    if (e.boosts) p.push(`${e.target === 'self' ? 'User' : 'Target'}: ${btxt(e.boosts)}.`);
    for (const s of e.secondaries) {
      const what = s.status ? STN[s.status] : s.volatileStatus === 'confusion' ? 'confuses the target' : s.volatileStatus === 'flinch' ? 'target flinches'
        : s.boosts ? 'target ' + btxt(s.boosts) : s.self ? 'user ' + btxt(s.self.boosts) : '';
      if (what) p.push(s.chance >= 100 ? cap(what) + '.' : `${s.chance}% chance: ${what}.`);
    }
    if (e.self && e.self.boosts) p.push(`User: ${btxt(e.self.boosts)}.`);
    if (e.drain) p.push(`Heals the user by ${e.drain[0]}% of the damage dealt.`);
    if (e.recoil) p.push(`User takes ${e.recoil[0]}% of the damage dealt as recoil.`);
    if (e.heal) p.push(`Heals the user by ${e.heal[0]}% of its max HP.`);
    if (e.weather) p.push(`Sets ${e.weather}.`);
    if (e.terrain) p.push(`Sets ${e.terrain} terrain.`);
    if (tpl && (tpl.multihit || tpl.ohko || tpl.selfdestruct || (tpl.volatileStatus && tpl.volatileStatus !== 'confusion') || SPECIAL.test(e.base || '')))
      p.push('Keeps: ' + (tpl.desc || ''));
    return p.join(' ') || 'No additional effect.';
  }

  function formHtml(f) {
    const tpl = f.base && PK[f.base], st = f.cat === 'status';
    const n = (k, v, min, max, lbl) => `<label>${lbl}<input type="number" data-f="${k}" value="${esc(v)}" min="${min}" max="${max}"></label>`;
    const sel = (k, list, v, lbl) => `<label>${lbl}<select data-f="${k}">${opt(list, v)}</select></label>`;
    const bst = (side, ch, lbl) => `<div class="wide"><div class="mle-sub">${lbl}</div><div class="mle-bst">${BST.map(([k, l]) => n(side + '.' + k, f[side][k] || 0, -6, 6, l)).join('')}${st ? '' : n(ch, f[ch], 1, 100, 'Chance %')}</div></div>`;
    const tg = st ? [['normal', 'One foe'], ['allAdjacentFoes', 'All foes'], ['self', 'Self']] : [['normal', 'One foe'], ['allAdjacentFoes', 'All foes']];
    return `<div class="mle-form">
      <div class="wide mle-basebox">
        <div class="mle-sub">Base move <span class="mlr-dim">copies a Pokémon move's behaviour (priority, multi-hit, Protect, fixed damage…), then change anything</span></div>
        ${tpl ? `<div class="mle-cur">${pkOpt(f.base, false, 'cur')}<button type="button" data-a="nobase">Clear base</button></div>` : ''}
        <div class="mle-pick">
          <div class="mle-pbar">
            <input type="search" data-pick autocomplete="off" value="${esc(pk.q)}"
              placeholder="${tpl ? 'Change base move…' : 'Search by name or effect: Shadow Sneak, flinch, Leech Seed…'}">
            <select data-pickty><option value="">All types</option>${TYPES.map(t => `<option value="${t}" ${pk.ty === t ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select>
            <div class="mle-pcat">${['', 'physical', 'special', 'status'].map(c => `<button type="button" data-pickcat="${c}" class="${pk.cat === c ? 'on' : ''}">${c ? CAT[c] : 'All'}</button>`).join('')}</div>
          </div>
          <div class="mle-res" hidden></div>
        </div>
      </div>
      <div class="wide"><label>Description (original text, shown in battle)
        <textarea data-f="about" rows="2" placeholder="The move's own description">${esc(f.about || '')}</textarea></label>
        <div class="mle-fxline">Effect: <span class="mle-fxlive">${esc(fromForm(f).fx)}</span></div></div>
      <label>Name<input type="text" data-f="name" value="${esc(f.name)}"></label>
      ${sel('type', TYPES, f.type, 'Type')}
      ${sel('cat', ['physical', 'special', 'status'], f.cat, 'Category')}
      ${st ? '' : n('power', f.power, 0, 250, 'Power')}
      ${n('acc', f.acc, 0, 100, 'Accuracy (0 = never misses)')}
      ${n('prio', f.prio, -7, 5, 'Priority (+1 = goes first)')}
      ${st ? '' : sel('crit', [['normal', 'Normal'], ['high', 'High'], ['always', 'Always']], f.crit, 'Critical hits')}
      ${sel('target', tg, f.target, 'Target')}
      ${sel('cost', [['', 'Auto (by level)'], '0', '1', '2', '3'], f.cost, 'Energy cost (card run)')}
      ${sel('st', STS.map(s => [s, s ? STN[s] : 'none']), f.st, 'Status condition')}
      ${st ? '' : n('stCh', f.stCh, 1, 100, 'Status chance %')}
      ${n('conf', f.conf, 0, 100, st ? 'Confuse (any number = yes)' : 'Confuse chance %')}
      ${st ? '' : n('flinch', f.flinch, 0, 100, 'Flinch chance %')}
      ${bst('foe', 'foeCh', st && f.target === 'self' ? 'Stat changes on the user (target is Self)' : 'Stat changes on the target (− lowers, + raises)')}
      ${bst('me', 'meCh', 'Stat changes on the user')}
      ${st ? n('heal', f.heal, 0, 100, 'Heal % of max HP') : n('drain', f.drain, 0, 100, 'Drain % of damage') + n('recoil', f.recoil, 0, 100, 'Recoil % of damage')}
      ${sel('weather', WS.map(w => [w, w || 'none']), f.weather, 'Sets weather')}
      ${sel('terrain', TS.map(t => [t, t || 'none']), f.terrain, 'Sets terrain')}
    </div>`;
  }

  async function open(key) {
    const api = MonsterRun.api; await api.load(); await loadPK();
    const r = Gacha.mon(key); if (!r) return;
    const old = r.moveEdits || {};
    const ids = [...new Set(api.learnOf(key).map(e => e.id))];
    const myType = (r.types || []).map(t => String(t).toLowerCase()).find(t => TYPES.includes(t)) || 'normal';
    let types = (r.types || []).map(t => String(t).toLowerCase()).filter(t => TYPES.includes(t)).slice(0, 2), typesTouched = false, typesReset = false;
    const forms = {}, on = {}; let openId = null;
    ids.forEach(id => {
      const b = api.baseMove(r, id) || {};
      on[id] = !!old[id]; forms[id] = toForm(old[id] || b, myType);
      forms[id].name = (old[id] && old[id].name) || b.name || id;
      const od = b.desc || b.description || '';      // the move's own text (ignore old auto-generated text)
      forms[id].about = (old[id] && old[id].origDesc) || (old[id] && od === old[id].desc ? '' : od);
    });
    const byName = {};
    Object.entries(PK).forEach(([id, m]) => { byName[String(m.name || id).toLowerCase()] = id; byName[id] = id; });
    const findBase = v => { const s = String(v || '').trim().toLowerCase(); return byName[s] || byName[s.replace(/[^a-z0-9]/g, '')] || null; };

    return new Promise(done => {
      const el = document.createElement('div'); el.className = 'mlr mle'; document.body.appendChild(el);
      const row = id => {
        const f = forms[id], b = api.baseMove(r, id) || {};
        const orig = f.about || b.desc || b.description || '';
        const summary = on[id]
          ? `${orig ? `<span>${esc(orig)}</span>` : ''}<span class="mle-fx">${esc(fromForm(f).fx)}</span>`
          : esc(orig || (r.fr === 'digimon' ? 'Not set up yet: unusable in battle until ticked.' : 'Original damage only.'));
        return `<div class="mle-row mlr-box ${openId === id ? 'open' : ''}" data-id="${esc(id)}"><div class="mle-head">
          <label><input type="checkbox" data-on="${esc(id)}" ${on[id] ? 'checked' : ''}> <b>${esc(f.name)}</b></label>
          <span class="mlr-dim mle-sum">${summary}</span>
          <button type="button" data-open="${esc(id)}">${openId === id ? 'Done' : 'Edit'}</button></div>
          ${openId === id ? formHtml(f) : ''}</div>`;
      };
      const draw = () => {
        const sy = el.scrollTop;
        el.innerHTML = `<div class="mlr-wrap"><h2>Edit types & moves: ${esc(r.name)}</h2>
          <p class="mlr-dim">Ticked moves use your settings. ${r.fr === 'palworld' ? 'Unticked Pal moves keep their original damage.' : 'Unticked Digimon moves are not usable; the monster uses placeholder moves until some are ticked.'}
            Tip: pick a Pokémon base move, then change what you want. Changing any setting ticks the move.</p>
          ${r.fr === 'digimon' ? `<label class="mlr-box" style="display:block"><input type="checkbox" id="mle-ver" ${r.verified ? 'checked' : ''}> <b>Finished</b>: this Digimon can now appear as a wild enemy</label>` : ''}
          <div class="mlr-box"><b>Battle types</b> <span class="mlr-dim">(pick up to 2 · now: ${esc((r.types || []).join(' / ') || 'none')})</span>
            <div class="mle-types">${TYPES.map(t => `<button type="button" data-ty="${t}" class="${types.includes(t) ? 'on' : ''}">${t}</button>`).join('')}</div>
            <button type="button" data-a="tyreset">Reset to original types</button>
            <span class="mlr-dim">${typesReset ? 'Original types come back when you press Save.' : 'Type changes apply from the next battle.'}</span></div>

          ${ids.map(row).join('') || '<p class="mlr-dim">No moves in the data. Add some below.</p>'}
          <div class="mlr-box mlr-row"><input id="mle-new" type="text" placeholder="New move name"><button type="button" data-a="add">Add move</button></div>
          <button class="big" type="button" data-a="save">Save</button> <button type="button" data-a="cancel">Cancel</button></div>`;
        el.scrollTop = sy;
      };
      const tick = id => { on[id] = true; const cb = [...el.querySelectorAll('[data-on]')].find(x => x.dataset.on === id); if (cb) cb.checked = true; };

      el.addEventListener('input', e => {
        const x = e.target.closest('[data-f]'); if (!x || !openId) return;
        const f = forms[openId], k = x.dataset.f, v = x.value;
        if (k.includes('.')) { const [s, stat] = k.split('.'); f[s][stat] = +v || 0; }
        else f[k] = NUM.includes(k) ? (+v || 0) : v;
        tick(openId);
        if (k === 'cat' || k === 'target') draw();
        else { const lv = el.querySelector('.mle-fxlive'); if (lv) lv.textContent = fromForm(f).fx; }
      });
      /* ---- base-move picker ---- */
      const results = () => {
        const box = el.querySelector('.mle-res'); if (!box) return;
        pk.list = searchPK(pk.q, pk.ty, pk.cat);
        pk.hi = Math.max(0, Math.min(pk.hi, pk.list.length - 1));
        box.hidden = false;
        box.innerHTML = pk.list.length ? pk.list.map((id, i) => pkOpt(id, i === pk.hi)).join('')
          : '<div class="mle-none">No Pokémon move matches.</div>';
        const h = box.querySelector('.hi'); if (h) h.scrollIntoView({ block: 'nearest' });
      };
      const applyBase = bid => {
        if (!openId || !PK[bid]) return;
        const keep = forms[openId];
        forms[openId] = toForm({ ...PK[bid], base: bid }, myType);
        Object.assign(forms[openId], { name: keep.name, about: keep.about, cost: keep.cost });   // keep your name, text and cost
        on[openId] = true; pk.q = ''; pk.hi = 0; draw();
      };
      el.addEventListener('input', e => {
        if (e.target.matches('[data-pick]')) { pk.q = e.target.value; pk.hi = 0; results(); }
        else if (e.target.matches('[data-pickty]')) { pk.ty = e.target.value; pk.hi = 0; results(); }
      });
      el.addEventListener('focusin', e => { if (e.target.matches('[data-pick]')) results(); });
      el.addEventListener('keydown', e => {
        if (!e.target.matches('[data-pick]')) return;
        const box = el.querySelector('.mle-res');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); if (box.hidden) return results();
          pk.hi = Math.max(0, Math.min(pk.list.length - 1, pk.hi + (e.key === 'ArrowDown' ? 1 : -1))); results();
        } else if (e.key === 'Enter') { e.preventDefault(); if (pk.list[pk.hi]) applyBase(pk.list[pk.hi]); }
        else if (e.key === 'Escape') box.hidden = true;
      });
      el.addEventListener('click', e => {
        if (!e.target.closest('.mle-pick')) { const rb = el.querySelector('.mle-res'); if (rb) rb.hidden = true; }
        const pc = e.target.closest('[data-pickcat]');
        if (pc) { pk.cat = pc.dataset.pickcat; pk.hi = 0; el.querySelectorAll('[data-pickcat]').forEach(x => x.classList.toggle('on', x === pc)); return results(); }
        const pi = e.target.closest('[data-pickid]'); if (pi) return applyBase(pi.dataset.pickid);
        const cb = e.target.closest('[data-on]'); if (cb) { on[cb.dataset.on] = cb.checked; return; }
        const op = e.target.closest('[data-open]'); if (op) { openId = openId === op.dataset.open ? null : op.dataset.open; pk.q = ''; pk.hi = 0; return draw(); }

        const ty = e.target.closest('[data-ty]');
        if (ty) { const t = ty.dataset.ty; types = types.includes(t) ? types.filter(x => x !== t) : types.concat(t).slice(-2); typesTouched = true; typesReset = false; return draw(); }
        const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a; if (!a) return;
        if (a === 'tyreset') { typesReset = true; typesTouched = false; return draw(); }
        if (a === 'nobase' && openId) { forms[openId].base = ''; return draw(); }
        if (a === 'cancel') { el.remove(); return done(false); }
        if (a === 'add') {
          const name = el.querySelector('#mle-new').value.trim(); if (!name) return;
          const id = 'ml-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          if (!ids.includes(id)) ids.push(id);
          forms[id] = forms[id] || toForm({ name, type: myType, category: 'physical', power: 60, accuracy: 100 }, myType);
          forms[id].name = name; on[id] = true; openId = id; return draw();
        }
        if (a === 'save') {
          const out = {};
          ids.forEach(id => { if (on[id]) out[id] = fromForm(forms[id]); });
          const patch = { ...cur(key), moveEdits: out }, v = el.querySelector('#mle-ver');
          if (v) patch.verified = v.checked;
          if (typesReset) patch.types = undefined;
          else if (typesTouched && types.length) patch.types = types.slice();
          Gacha.setOverride(key, patch); el.remove(); done(true);
        }
      });
      draw();
    });
  }
  window.MonsterEditor = { open };
})();
