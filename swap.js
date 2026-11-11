/* Swap mode: "Swap position" in a quest/training editor → click another card to trade places.
   file: swap.js — load AFTER search.js */
(function () {
  let held = null;   // { k: 'quest' | 'training', id }
  const LISTS = { quest: ['mainQuestList', 'mainQuestListLow', 'sideQuestList', 'sideQuestListLow'], training: ['trainingList'] };
  const arr = k => k === 'quest' ? appState.quests : appState.trainings;
  const find = (k, id) => arr(k).find(x => x.id === id);
  const group = q => q.kind || 'main';
  const nameOf = (k, x) => k === 'quest' ? x.title : x.name;
  const canSwap = (k, x) => !!x && (k === 'training' || (!x.done && x.kind !== 'recurring'));

  function addButton(k, id) {
    const box = document.getElementById('modalInner');
    if (!box || !canSwap(k, find(k, id)) || box.querySelector('.swap-open')) return;
    box.insertAdjacentHTML('afterbegin',
      `<button type="button" class="swap-open" onclick="startSwap('${k}','${id}')"><i class="fa-solid fa-right-left"></i> Swap position</button>`);
  }
  window.startSwap = (k, id) => {
    const x = find(k, id); if (!canSwap(k, x)) return;
    held = { k, id };
    if (k === 'quest' && typeof QUEST_LOW_OPEN !== 'undefined') QUEST_LOW_OPEN[group(x)] = true;
    closeModal();
    appState.activeTab = k === 'quest' ? 'quests' : 'training';
    render();
  };
  function clearMarks() {
    document.body.classList.remove('swap-mode');
    document.getElementById('swapBar')?.remove();
    document.querySelectorAll('.swap-held, .swap-target').forEach(r => r.classList.remove('swap-held', 'swap-target'));
  }
  window.cancelSwap = () => { held = null; clearMarks(); toast('Swap cancelled', 'info'); };

  function swap(tid) {
    const k = held.k, a = find(k, held.id), b = find(k, tid);
    held = null;
    if (!a || !b || a === b) { clearMarks(); return; }
    const L = arr(k), i = L.indexOf(a), j = L.indexOf(b);
    L[i] = b; L[j] = a;
    if (k === 'quest' && a.priority !== b.priority) { const p = a.priority; a.priority = b.priority; b.priority = p; }
    save(); render();
    toast(`Swapped "${nameOf(k, a)}" ⇄ "${nameOf(k, b)}"`);
  }

  /* add Swap button to the editors (works from the list AND from search results) */
  const _oq = window.openQuest;
  if (_oq) window.openQuest = function (id) { const r = _oq.apply(this, arguments); addButton('quest', id); return r; };
  const _tm = window.renderTrainingModal;
  if (_tm) window.renderTrainingModal = function (h) { const r = _tm.apply(this, arguments); if (h) addButton('training', h.id); return r; };

  /* highlight held card + valid targets after every render */
  const _render = render;
  render = function () {
    _render.apply(this, arguments);
    clearMarks();
    if (!held) return;
    const x = find(held.k, held.id);
    if (!canSwap(held.k, x)) { held = null; return; }
    document.body.classList.add('swap-mode');
    LISTS[held.k].forEach(lid => {
      if (held.k === 'quest' && !lid.startsWith(group(x))) return;          // Main ↔ Main, Side ↔ Side
      const el = document.getElementById(lid); if (!el) return;
      Array.from(el.children).forEach(r => { if (r.dataset && r.dataset.id) r.classList.add(r.dataset.id === held.id ? 'swap-held' : 'swap-target'); });
    });
    document.body.insertAdjacentHTML('beforeend', `<div id="swapBar" class="swap-bar">
      <i class="fa-solid fa-hand-back-fist"></i><span>Holding "<b>${escapeHtml(nameOf(held.k, x))}</b>" — click a glowing card to swap</span>
      <button type="button" onclick="cancelSwap()">Cancel</button></div>`);
  };

  /* while holding: clicking a target swaps; clicking the held card or Esc cancels; clicking elsewhere drops it */
  document.addEventListener('click', e => {
    if (!held || e.target.closest('#swapBar')) return;
    const row = e.target.closest('.swap-target, .swap-held');
    if (!row) { held = null; clearMarks(); return; }                         // let the click go through
    e.preventDefault(); e.stopPropagation();
    if (row.classList.contains('swap-held')) return window.cancelSwap();
    swap(row.dataset.id);
  }, true);
  document.addEventListener('keydown', e => { if (held && e.key === 'Escape') window.cancelSwap(); });
})();
