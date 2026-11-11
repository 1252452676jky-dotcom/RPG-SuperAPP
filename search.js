/* Search box on the fixed tabs (Party, Quest Board, Training, Chronicle, Shop).
   file: search.js — load AFTER app.js and chronicle.js */
(function () {
  const SCOPE = { party: ['party'], quests: ['quests'], training: ['trainings'], chronicle: ['events', 'quests'], shop: ['shop'] };
  const LABEL = { party: 'party members', quests: 'quests', training: 'trainings', chronicle: 'events & quests', shop: 'shop items' };
  const S = { q: {}, all: false };
  const prio = q => priorityInfo(q.priority).label;

  const SRC = {
    quests: () => appState.quests.map(q => ({
      k: 'quest', id: q.id, title: q.title, text: q.note,
      type: q.kind === 'recurring' ? 'Recurring' : q.kind === 'side' ? 'Side quest' : 'Main quest',
      sub: q.kind === 'recurring' ? `Next ${q.nextDate} · ${intervalText(q)}` : `${prio(q)} · Due ${q.dueDate || '—'}`,
      done: !!q.done && q.kind !== 'recurring', doneTxt: 'Completed ' + (q.completedDate || '') })),
    trainings: () => appState.trainings.map(h => ({ k: 'training', id: h.id, type: 'Training', title: h.name, text: h.note, sub: `+${h.xpEach || 0} XP each` })),
    party: () => appState.party.map(m => ({ k: 'member', id: m.id, type: 'Party', title: m.name, sub: 'Lv ' + m.level,
      text: Object.entries(m.attributes || {}).map(([a, v]) => a + ' ' + v).join(' ') })),
    shop: () => appState.shop.map(s => ({ k: 'shop', id: s.id, type: 'Shop', title: s.name, text: s.note, sub: s.price + ' gems',
      done: !!s.purchased, doneTxt: 'Purchased ' + (s.purchasedDate || '') })),
    events: () => (appState.events || []).map(e => ({ k: 'event', id: e.id, date: e.date, type: 'Event', title: e.title || '(No title)',
      text: e.desc, sub: e.date + (e.allDay ? ' · All day' : ' · ' + e.start) }))
  };
  const OPEN = {
    quest: id => openQuest(id),
    training: id => { const h = appState.trainings.find(x => x.id === id); if (!h) return; trainingCalMonth = new Date(); renderTrainingModal(h); },
    member: id => openMember(id),
    shop: id => openShopItem(id),
    event: (id, date) => chronEditEvent(id, date)
  };

  function find(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    (S.all ? Object.keys(SRC) : SCOPE[appState.activeTab]).forEach(s => SRC[s]().forEach(it => {
      const title = (it.title || '').toLowerCase(), hay = `${title} ${it.text || ''} ${it.sub || ''}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) return;
      it.rank = (it.done ? 10 : 0) + (title.startsWith(words[0]) ? 0 : words.every(w => title.includes(w)) ? 1 : 2);
      out.push(it);
    }));
    return out.sort((a, b) => a.rank - b.rank);                          // completed always sink to the bottom
  }
  function results() {
    const q = S.q[appState.activeTab] || '';
    if (!q.trim()) return '';
    const list = find(q);
    if (!list.length) return '<div class="bs-none">No matches.</div>';
    const firstDone = list.findIndex(x => x.done);
    return list.slice(0, 50).map((it, i) => (i === firstDone ? '<div class="bs-sep">Completed</div>' : '') + `
      <button type="button" class="bs-hit ${it.done ? 'done' : ''}" data-k="${it.k}" data-sid="${escapeAttr(it.id)}" data-date="${escapeAttr(it.date || '')}">
        <span class="bs-type">${it.type}</span><span class="bs-title">${escapeHtml(it.title || '')}</span>
        <span class="bs-sub">${escapeHtml(it.sub || '')}</span>
        ${it.done ? `<span class="bs-done"><i class="fa-solid fa-check"></i> ${escapeHtml(it.doneTxt)}</span>` : ''}
      </button>`).join('') + (list.length > 50 ? `<div class="bs-none">${list.length - 50} more — keep typing to narrow it down.</div>` : '');
  }
  const ph = () => `Search ${S.all ? 'everything' : LABEL[appState.activeTab]}…`;
  const bar = () => `<div class="bsearch">
      <div class="bsearch-bar"><i class="fa-solid fa-magnifying-glass"></i>
        <input id="bsInput" type="search" autocomplete="off" placeholder="${ph()}" value="${escapeAttr(S.q[appState.activeTab] || '')}">
        <label title="Search every fixed tab"><input id="bsAll" type="checkbox" ${S.all ? 'checked' : ''}> All tabs</label>
      </div><div id="bsResults"></div></div>`;

  function wire() {
    const inp = document.getElementById('bsInput'), all = document.getElementById('bsAll'), out = document.getElementById('bsResults');
    const draw = () => { out.innerHTML = results(); };
    inp.oninput = () => { S.q[appState.activeTab] = inp.value; draw(); };
    inp.onkeydown = e => { if (e.key === 'Escape') { inp.value = ''; inp.oninput(); } };
    all.onchange = () => { S.all = all.checked; inp.placeholder = ph(); draw(); };
    out.onclick = e => { const b = e.target.closest('[data-k]'); if (b) OPEN[b.dataset.k](b.dataset.sid, b.dataset.date); };
    draw();
  }

  const _render = render;
  render = function () {
    _render.apply(this, arguments);
    if (!SCOPE[appState.activeTab]) return;                              // generators/checklists: no search
    const c = document.getElementById('content');
    if (!c || c.querySelector('.bsearch')) return;
    c.insertAdjacentHTML('afterbegin', bar());
    wire();
  };
})();
