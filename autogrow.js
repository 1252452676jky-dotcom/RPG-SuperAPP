/* Text boxes grow with what you type (quest notes, training descriptions, events…).
   file: autogrow.js — load after app.js. Add data-no-grow to a <textarea> to opt out. */
(function () {
  const MIN = 120, MAX = 0.6;                 // px floor; ceiling = 60% of the screen height, then it scrolls
  function fit(t) {
    if (!t || t.tagName !== 'TEXTAREA' || t.hasAttribute('data-no-grow')) return;
    t.style.height = 'auto';
    const max = Math.round(window.innerHeight * MAX), need = t.scrollHeight + 2;
    t.style.height = Math.max(MIN, Math.min(max, need)) + 'px';
    t.style.overflowY = need > max ? 'auto' : 'hidden';
  }
  document.addEventListener('input', e => fit(e.target));
  document.addEventListener('focusin', e => fit(e.target));
  new MutationObserver(ms => requestAnimationFrame(() => { for (const m of ms) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'TEXTAREA') fit(n); else n.querySelectorAll('textarea').forEach(fit);
  } })).observe(document.documentElement, { childList: true, subtree: true });
})();
