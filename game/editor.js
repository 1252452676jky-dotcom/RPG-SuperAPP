/* MONSTER LAB — Digimon / Pal move editor        file: game/editor.js
   Load AFTER game/run.js. Opened from the monster info panel ("Edit moves").
   Saves into game.overrides[key] = { ...existing, moveEdits: { moveId: {...} }, verified } via Gacha.setOverride. */
(function () {
  const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];
  const STS = ['', 'brn', 'par', 'psn', 'tox', 'slp', 'frz'], WS = ['', 'sun', 'rain', 'sand', 'snow'], TS = ['', 'electric', 'grassy', 'psychic', 'misty'];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const opt = (list, v, empty) => list.map(x => `<option value="${x}" ${x === (v || '') ? 'selected' : ''}>${x || empty}</option>`).join('');
  const cur = key => { try { return (Gacha.exportState().overrides || {})[key] || {}; } catch { return {}; } };

  async function open(key) {
    const api = MonsterRun.api; await api.load();
    const r = Gacha.mon(key); if (!r) return;
    const edits = JSON.parse(JSON.stringify(r.moveEdits || {}));
    const ids = [...new Set(api.learnOf(key).map(e => e.id))];
    const myType = (r.types || []).map(t => String(t).toLowerCase()).find(t => TYPES.includes(t)) || 'normal';
    return new Promise(done => {
      const el = document.createElement('div'); el.className = 'mlr mle'; document.body.appendChild(el);
      const row = id => {
        const b = api.baseMove(r, id) || {}, e = edits[id] || {};
        const bt = String(b.type || b.element || '').toLowerCase(), st = e.status || (e.secondary && e.secondary.status) || '';
        return `<div class="mle-row" data-id="${esc(id)}">
          <div><label><input data-f="on" type="checkbox" ${edits[id] ? 'checked' : ''}> <b>${esc(e.name || b.name || id)}</b></label>
            <div class="mlr-dim">${esc(b.desc || b.description || '')}</div></div>
          <div class="mlr-row">
            <select data-f="type">${opt(TYPES, e.type || (TYPES.includes(bt) ? bt : myType))}</select>
            <select data-f="category">${opt(['physical', 'special', 'status'], e.category || 'physical')}</select>
            <label>Power <input data-f="power" type="number" min="0" max="250" value="${e.power ?? (+b.power || 60)}"></label>
            <label>Acc <input data-f="accuracy" type="number" min="1" max="100" value="${e.accuracy ?? 100}"></label>
            <select data-f="st">${opt(STS, st, 'no status')}</select>
            <label>Chance % <input data-f="chance" type="number" min="1" max="100" value="${(e.secondary && e.secondary.chance) || 100}"></label>
            <select data-f="weather">${opt(WS, e.weather, 'no weather')}</select>
            <select data-f="terrain">${opt(TS, e.terrain, 'no terrain')}</select>
          </div></div>`;
      };
      const collect = () => el.querySelectorAll('.mle-row').forEach(rw => {
        const id = rw.dataset.id, g = f => rw.querySelector(`[data-f="${f}"]`);
        if (!g('on').checked) { delete edits[id]; return; }
        const b = api.baseMove(r, id) || {}, cat = g('category').value, st = g('st').value;
        const e = { name: (edits[id] && edits[id].name) || b.name || id, type: g('type').value, category: cat,
          power: cat === 'status' ? 0 : (+g('power').value || 0), accuracy: +g('accuracy').value || 100 };
        if (st) { if (cat === 'status') e.status = st; else e.secondary = { chance: +g('chance').value || 100, status: st }; }
        if (g('weather').value) e.weather = g('weather').value;
        if (g('terrain').value) e.terrain = g('terrain').value;
        edits[id] = e;
      });
      const draw = () => {
        el.innerHTML = `<div class="mlr-wrap"><h2>Edit moves: ${esc(r.name)}</h2>
          <p class="mlr-dim">Tick a move to use your settings for it. ${r.fr === 'palworld' ? 'Unticked Pal moves keep their original damage.' : 'Digimon moves only work once ticked; until then the monster uses placeholder moves.'} Status on a damaging move = chance to inflict it.</p>
          ${r.fr === 'digimon' ? `<label class="mlr-box" style="display:block"><input type="checkbox" id="mle-ver" ${r.verified ? 'checked' : ''}> <b>Finished</b>: this Digimon can now appear as a wild enemy</label>` : ''}
          ${ids.map(row).join('') || '<p class="mlr-dim">No moves in the data. Add some below.</p>'}
          <div class="mlr-box mlr-row"><input id="mle-new" type="text" placeholder="New move name"><button data-a="add">Add move</button></div>
          <button class="big" data-a="save">Save</button> <button data-a="cancel">Cancel</button></div>`;
      };
      el.addEventListener('click', e => {
        const a = e.target.closest('[data-a]') && e.target.closest('[data-a]').dataset.a; if (!a) return;
        if (a === 'cancel') { el.remove(); return done(false); }
        collect();
        if (a === 'add') {
          const name = el.querySelector('#mle-new').value.trim(); if (!name) return;
          const id = 'ml-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          if (!ids.includes(id)) ids.push(id);
          edits[id] = edits[id] || { name, type: myType, category: 'physical', power: 60, accuracy: 100 };
          return draw();
        }
        if (a === 'save') {
          const patch = { ...cur(key), moveEdits: edits }, v = el.querySelector('#mle-ver');
          if (v) patch.verified = v.checked;
          Gacha.setOverride(key, patch); el.remove(); done(true);
        }
      });
      draw();
    });
  }
  window.MonsterEditor = { open };
})();
