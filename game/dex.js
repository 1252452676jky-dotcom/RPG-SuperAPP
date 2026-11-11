/* MONSTER LAB — Dex: every monster, owned or not.   file: game/dex.js  (load AFTER game/gacha.js) */
(function () {
  const TC = { normal:'#9fa19f', fire:'#e62829', water:'#2980ef', electric:'#fac000', grass:'#3fa129', ice:'#3dcef3', fighting:'#ff8000',
    poison:'#9141cb', ground:'#915121', flying:'#81b9ef', psychic:'#ef4179', bug:'#91a119', rock:'#afa981', ghost:'#704170',
    dragon:'#5060e1', dark:'#624d4e', steel:'#60a1b8', fairy:'#ef70ef' };
  const FRL = { pokemon: 'Pokémon', palworld: 'Palworld', digimon: 'Digimon' }, TIER = { 1: 'Early', 2: 'Mid', 3: 'Late', 4: 'Legend' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const F = { q: '', fr: '', type: '', type2: '', tier: '', evo: '', tag: '', owned: '', level: '', attr: '', bmin: '', bmax: '', sort: 'dex', n: 120 };
  let el = null, ALL = [];
  const opts = (list, cur, any) => `<option value="">${any}</option>` + list.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  function match(r) {
    if (F.q && !(r.name + ' ' + (r.ja || '') + ' ' + r.dex).toLowerCase().includes(F.q)) return false;
    if (F.fr && r.fr !== F.fr) return false;
    if (F.type && !r.types.includes(F.type)) return false;
    if (F.type2 && !r.types.includes(F.type2)) return false;
    if (F.tier && String(r.tier) !== F.tier) return false;
    if (F.evo === 'evolves' && r.final) return false;
    if (F.evo === 'final' && !r.final) return false;
    if (F.evo === 'single' && !(r.final && r.stage <= 1)) return false;
    if (F.tag === 'legendary' && !r.legendary) return false;
    if (F.tag === 'special' && !r.special) return false;
    if (F.tag === 'edited' && !r.edited) return false;
    if (F.tag === 'wild' && r.fr === 'digimon' && !r.verified) return false;          // can appear as an enemy
    if (F.tag === 'unset' && !(r.fr !== 'pokemon' && !r.verified)) return false;      // still needs editing
    if (F.owned === 'yes' && !Gacha.owned(r.key)) return false;
    if (F.owned === 'no' && Gacha.owned(r.key)) return false;
    if (F.level && r.level !== F.level) return false;
    if (F.attr && r.attribute !== F.attr) return false;
    if (F.bmin && r.bst < +F.bmin) return false;
    if (F.bmax && r.bst > +F.bmax) return false;
    return true;
  }
  const SORT = { dex: (a, b) => a.fr.localeCompare(b.fr) || (parseInt(a.dex) || 0) - (parseInt(b.dex) || 0), name: (a, b) => a.name.localeCompare(b.name),
    bst: (a, b) => b.bst - a.bst, spe: (a, b) => b.base[5] - a.base[5], atk: (a, b) => Math.max(b.base[1], b.base[3]) - Math.max(a.base[1], a.base[3]) };
  function draw() {
    const list = ALL.filter(match).sort(SORT[F.sort]), types = Object.keys(TC);
    const lv = [...new Set(ALL.map(r => r.level).filter(Boolean))], at = [...new Set(ALL.map(r => r.attribute).filter(Boolean))];
    el.innerHTML = `<div class="dex-wrap"><div class="dex-head"><h2>DIGITAL DEX</h2><span>${list.length} / ${ALL.length}</span><button data-x>✕ Close</button></div>
      <div class="dex-bar">
        <input data-f="q" placeholder="Search name / dex #" value="${esc(F.q)}">
        <select data-f="fr">${opts(Object.keys(FRL), F.fr, 'All franchises')}</select>
        <select data-f="type">${opts(types, F.type, 'Any type')}</select><select data-f="type2">${opts(types, F.type2, '+ 2nd type')}</select>
        <select data-f="tier">${opts(['1', '2', '3', '4'], F.tier, 'Any pool')}</select>
        <select data-f="evo"><option value="">Any evolution</option>${[['evolves', 'Can evolve'], ['final', 'Final form'], ['single', 'No evolution line']].map(([v, l]) => `<option value="${v}" ${F.evo === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select data-f="tag"><option value="">Any tag</option>${[['legendary', 'Legendary / Legend pool'], ['special', 'Mega / Gmax / Primal'], ['wild', 'Can appear in the wild'], ['unset', 'Pal/Digimon not finished'], ['edited', 'Edited by me']].map(([v, l]) => `<option value="${v}" ${F.tag === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select data-f="owned"><option value="">Owned + not owned</option><option value="yes" ${F.owned === 'yes' ? 'selected' : ''}>In my Box</option><option value="no" ${F.owned === 'no' ? 'selected' : ''}>Not collected</option></select>
        <select data-f="level">${opts(lv, F.level, 'Digimon level')}</select><select data-f="attr">${opts(at, F.attr, 'Digimon attribute')}</select>
        <input data-f="bmin" type="number" placeholder="BST ≥" value="${esc(F.bmin)}"><input data-f="bmax" type="number" placeholder="BST ≤" value="${esc(F.bmax)}">
        <select data-f="sort">${[['dex', 'Sort: Dex #'], ['name', 'Sort: Name'], ['bst', 'Sort: Base total'], ['atk', 'Sort: Best attack'], ['spe', 'Sort: Speed']].map(([v, l]) => `<option value="${v}" ${F.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button data-reset>Reset</button></div>
      <div class="dex-grid">${list.slice(0, F.n).map(r => `<div class="dex-card ${Gacha.owned(r.key) ? 'own' : ''}" data-k="${esc(r.key)}">
        <span class="dex-no">${esc(FRL[r.fr][0])}#${esc(r.dex)}</span><img src="${esc(Gacha.img(r.key) || r.img || '')}" loading="lazy" alt="">
        <b>${esc(r.name)}</b><div class="dex-ty">${r.types.map(t => `<i style="background:${TC[t] || '#666'}">${t}</i>`).join('')}</div>
        <small>${TIER[r.tier] || ''} · BST ${r.bst}${r.level ? ' · ' + esc(r.level) : ''}</small></div>`).join('') || '<p>No monster matches.</p>'}</div>
      ${list.length > F.n ? '<button class="dex-more" data-more>Show more</button>' : ''}</div>`;
  }
  async function open() {
    if (!el) {
      el = document.createElement('div'); el.className = 'dex'; document.body.appendChild(el);
      el.addEventListener('input', e => { const f = e.target.dataset.f; if (!f) return; F[f] = f === 'q' ? e.target.value.trim().toLowerCase() : e.target.value; F.n = 120;
        const pos = e.target.selectionStart; draw(); const n = el.querySelector(`[data-f="${f}"]`); n.focus(); if (f === 'q') n.setSelectionRange(pos, pos); });
      el.addEventListener('click', e => {
        if (e.target.closest('[data-x]')) { el.style.display = 'none'; return; }
        if (e.target.closest('[data-more]')) { F.n += 240; return draw(); }
        if (e.target.closest('[data-reset]')) { Object.assign(F, { q: '', fr: '', type: '', type2: '', tier: '', evo: '', tag: '', owned: '', level: '', attr: '', bmin: '', bmax: '', sort: 'dex', n: 120 }); return draw(); }
        const c = e.target.closest('[data-k]'); if (c) Gacha.open(c.dataset.k);    // full info panel (stats, evolutions, moves, editor)
      });
    }
    el.style.display = ''; el.innerHTML = '<p style="padding:20px">Loading data…</p>';
    await Gacha.load(); ALL = Gacha.list(); draw();
  }
  window.MonsterDex = { open };
})();
