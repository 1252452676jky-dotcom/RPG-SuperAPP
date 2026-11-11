/* Chronicle tab — Google-Calendar-style views + events.   Load AFTER app.js */
(function () {
  const C = { view: 'month', cur: new Date() };
  const pad = n => String(n).padStart(2, '0');
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const TZS = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [LOCAL_TZ];
  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
  const HOUR = 44;
  const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };
  const fmtT = t => { const m = toMin(t), h = Math.floor(m / 60); return `${(h % 12) || 12}:${pad(m % 60)}${h < 12 ? 'am' : 'pm'}`; };
  const nth = ds => Math.ceil(parseDate(ds).getDate() / 7);
  const nextHalf = () => { const d = new Date(); return fromMin(Math.ceil((d.getHours() * 60 + d.getMinutes()) / 30) * 30); };
  const tzTag = e => e.tz && e.tz !== LOCAL_TZ ? ` (${e.tz.split('/').pop().replace(/_/g, ' ')})` : '';

  /* ---------- data helpers ---------- */
  function occursOn(e, ds) {
    if (ds < e.date) return false;
    const r = e.repeat || { f: 'none' };
    if (r.until && ds > r.until) return false;
    const a = parseDate(e.date), b = parseDate(ds), days = Math.round((b - a) / 864e5), n = Math.max(1, r.n || 1);
    const f = r.f === 'custom' ? ({ day: 'daily', week: 'weekly', month: 'monthday', year: 'yearly' })[r.u] : r.f;
    const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
    if (f === 'none') return ds <= (e.endDate || e.date);
    if (f === 'daily') return days % n === 0;
    if (f === 'weekdays') return b.getDay() % 6 !== 0;
    if (f === 'weekly') return (r.days && r.days.length ? r.days : [a.getDay()]).includes(b.getDay()) && Math.floor((days + a.getDay()) / 7) % n === 0;
    if (f === 'monthly') return b.getDay() === a.getDay() && nth(ds) === nth(e.date) && months % n === 0;
    if (f === 'monthday') return b.getDate() === a.getDate() && months % n === 0;
    if (f === 'yearly') return b.getMonth() === a.getMonth() && b.getDate() === a.getDate() && (months / 12) % n === 0;
    return false;
  }
  const dayEvents = ds => (appState.events || []).filter(e => occursOn(e, ds))
    .sort((x, y) => (y.allDay - x.allDay) || toMin(x.start) - toMin(y.start));
  const questsOn = ds => appState.quests.filter(q => q.kind === 'recurring' ? q.nextDate === ds
    : (q.dueDate ? q.dueDate === ds : q.createdDate === ds));
  function dayAllDay(ds) {
    return holidaysOn(ds).map(h => `<span class="chip h">${h.cc} ${escapeHtml(h.name)}</span>`).join('')
      + dayEvents(ds).filter(e => e.allDay).map(e => `<span class="chip ev" onclick="event.stopPropagation();chronEditEvent('${e.id}','${ds}')">${escapeHtml(e.title || '(No title)')}</span>`).join('')
      + questsOn(ds).map(q => `<span class="chip ${q.kind === 'recurring' ? 'r' : 'q'}" onclick="event.stopPropagation();openQuest('${q.id}')">${escapeHtml(q.title)}</span>`).join('');
  }
  window.chronEventBadges = ds => dayEvents(ds).map(e =>
    `<span class="chip ev" title="${escapeAttr(e.title || '')}">${e.allDay ? '' : fmtT(e.start) + ' '}${escapeHtml(e.title || '(No title)')}</span>`).join('');

  /* ---------- navigation ---------- */
  window.chronGo = (view, ds) => {
    if (view) C.view = view;
    if (ds) C.cur = parseDate(ds);
    if (C.view === 'month') sharedCalMonth = new Date(C.cur.getFullYear(), C.cur.getMonth(), 1);
    render();
  };
  window.chronStep = dir => {
    const d = new Date(C.cur);
    if (C.view === 'day') d.setDate(d.getDate() + dir);
    else if (C.view === 'week') d.setDate(d.getDate() + 7 * dir);
    else if (C.view === 'year') d.setFullYear(d.getFullYear() + dir);
    else d.setDate(d.getDate() + 30 * dir);
    C.cur = d; render();
  };
  const weekDates = () => { const s = new Date(C.cur); s.setDate(s.getDate() - s.getDay());
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(s.getDate() + i); return fmtDate(d); }); };
  function title() {
    const o = { month: 'long', year: 'numeric' };
    if (C.view === 'day') return C.cur.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (C.view === 'week') { const w = weekDates(); return `${parseDate(w[0]).toLocaleDateString('default', { month: 'short', day: 'numeric' })} – ${parseDate(w[6]).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`; }
    if (C.view === 'year') return String(C.cur.getFullYear());
    if (C.view === 'schedule') return 'From ' + C.cur.toLocaleDateString('default', o);
    return '';
  }

  /* ---------- views ---------- */
  window.viewChronicle = () => `<div class="chr-bar">
      <h2 class="text-xl font-bold mr-2"><i class="fa-solid fa-calendar-days"></i> Chronicle</h2>
      <button onclick="chronGo(null, todayStr())" class="bg-slate-700 px-3 py-1 rounded text-sm">Today</button>
      ${C.view === 'month' ? '' : `<button onclick="chronStep(-1)" class="bg-slate-700 px-2 py-1 rounded">&lt;</button>
      <button onclick="chronStep(1)" class="bg-slate-700 px-2 py-1 rounded">&gt;</button>`}
      <b class="chr-title">${title()}</b>
      <select onchange="chronGo(this.value)" class="bg-slate-700 rounded px-2 py-1 text-sm">
        ${['day', 'week', 'month', 'year', 'schedule'].map(v => `<option value="${v}" ${v === C.view ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select>
      <button onclick="openChronicleDay(todayStr(), 'event')" class="bg-indigo-600 px-3 py-1 rounded text-sm"><i class="fa-solid fa-plus"></i> Create</button>
    </div><div id="chronBody"></div>`;

  window.mountChronicle = () => {
    const el = document.getElementById('chronBody'); if (!el) return;
    enabledHolidayCountries().forEach(cc => ensureHolidays(cc, C.cur.getFullYear()));
    if (C.view === 'month') { el.innerHTML = '<div id="calWrap"></div>'; drawSharedCal(document.getElementById('calWrap'), 'chronicle'); }
    else if (C.view === 'week') el.innerHTML = timeGrid(weekDates());
    else if (C.view === 'day') el.innerHTML = timeGrid([fmtDate(C.cur)]);
    else if (C.view === 'year') el.innerHTML = yearView(C.cur.getFullYear());
    else el.innerHTML = schedule();
    const g = el.querySelector('.chg'); if (g) g.scrollTop = 7 * HOUR;
  };

  function timeGrid(dates) {
    const head = dates.map(ds => { const d = parseDate(ds);
      return `<div class="chg-h ${ds === todayStr() ? 'today' : ''}" onclick="chronGo('day','${ds}')"><small>${DOW[d.getDay()]}</small><b>${d.getDate()}</b></div>`; }).join('');
    const allday = dates.map(ds => `<div class="chg-ad" onclick="openDayDetail('${ds}')">${dayAllDay(ds)}</div>`).join('');
    const cols = dates.map(ds => `<div class="chg-col" onclick="chronSlot(event,'${ds}')">${dayEvents(ds).filter(e => !e.allDay).map(e => {
      const s = toMin(e.start), en = toMin(e.end) > s ? toMin(e.end) : 1440;
      return `<div class="chg-ev" style="top:${s / 60 * HOUR}px;height:${Math.max(18, (en - s) / 60 * HOUR - 2)}px"
        onclick="event.stopPropagation();chronEditEvent('${e.id}','${ds}')"><b>${escapeHtml(e.title || '(No title)')}</b><br>${fmtT(e.start)} – ${fmtT(e.end)}${tzTag(e)}</div>`; }).join('')}</div>`).join('');
    const hours = Array.from({ length: 24 }, (_, h) => `<div style="height:${HOUR}px">${h ? `${(h % 12) || 12}${h < 12 ? 'am' : 'pm'}` : ''}</div>`).join('');
    return `<div class="chg" style="--n:${dates.length}"><div></div>${head}<div class="chg-lbl">all-day</div>${allday}<div class="chg-hours">${hours}</div>${cols}</div>`;
  }
  window.chronSlot = (ev, ds) => openChronicleDay(ds, 'event', { start: fromMin(Math.floor(ev.offsetY / HOUR) * 60) });

  function yearView(y) {
    let out = '';
    for (let m = 0; m < 12; m++) {
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      let c = '<span></span>'.repeat(first);
      for (let d = 1; d <= days; d++) {
        const ds = `${y}-${pad(m + 1)}-${pad(d)}`, has = dayEvents(ds).length || questsOn(ds).length;
        c += `<span class="${ds === todayStr() ? 't' : ''} ${has ? 'dot' : ''} ${dayStatus(ds).holidayOff ? 'hol' : ''}" onclick="chronGo('day','${ds}')">${d}</span>`;
      }
      out += `<div class="chy-m"><h4 onclick="chronGo('month','${y}-${pad(m + 1)}-01')">${new Date(y, m, 1).toLocaleString('default', { month: 'long' })}</h4>
        <div class="chy-g">${'SMTWTFS'.split('').map(x => `<i>${x}</i>`).join('')}${c}</div></div>`;
    }
    return `<div class="chy">${out}</div>`;
  }

  function schedule() {
    let out = ''; const d = new Date(C.cur);
    for (let i = 0; i < 60; i++, d.setDate(d.getDate() + 1)) {
      const ds = fmtDate(d), ev = dayEvents(ds), q = questsOn(ds), hs = holidaysOn(ds);
      if (!ev.length && !q.length && !hs.length) continue;
      out += `<div class="chs-day"><div class="chs-date ${ds === todayStr() ? 't' : ''}" onclick="chronGo('day','${ds}')"><b>${d.getDate()}</b>
          <small>${d.toLocaleString('default', { month: 'short', weekday: 'short' })}</small></div><div class="flex-1">
        ${hs.map(h => `<div class="chs-it hol">${h.cc} · ${escapeHtml(h.name)}</div>`).join('')}
        ${ev.map(e => `<div class="chs-it" onclick="chronEditEvent('${e.id}','${ds}')">${e.allDay ? 'All day' : fmtT(e.start) + ' – ' + fmtT(e.end)}${tzTag(e)} · ${escapeHtml(e.title || '(No title)')}</div>`).join('')}
        ${q.map(x => `<div class="chs-it q" onclick="openQuest('${x.id}')">${x.kind === 'recurring' ? '↻' : '⚑'} ${escapeHtml(x.title)}</div>`).join('')}
      </div></div>`;
    }
    return out || '<p>Nothing scheduled in the next 60 days.</p>';
  }

  /* ---------- day dialog: Quest | Events | Training ---------- */
  const tabs = (ds, on) => `<div class="chd-tabs">${[['quest', 'Quest'], ['event', 'Events'], ['train', 'Training']]
    .map(([k, l]) => `<button class="${k === on ? 'on' : ''}" onclick="openChronicleDay('${ds}','${k}')">${l}</button>`).join('')}
    <span class="ml-auto text-sm font-bold">${parseDate(ds).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>`;

  const _odd = openDayDetail;                                   // original day popup (quests + training check-all)
  openDayDetail = ds => (appState.activeTab === 'chronicle' ? openChronicleDay(ds) : _odd(ds));

  window.openChronicleDay = (ds, tab = 'quest', pre = {}) => {
    if (tab === 'quest') {
      openQuestForm();
      const due = document.getElementById('nqDue'), first = document.getElementById('nqFirst');
      if (due) due.value = ds; if (first) first.value = ds;
    } else if (tab === 'train') _odd(ds);
    else { openModal(eventForm(ds, pre)); wireEventForm(); }
    document.getElementById('modalInner').insertAdjacentHTML('afterbegin', tabs(ds, tab));
  };
  window.chronEditEvent = (id, ds) => openChronicleDay(ds, 'event', { id });

  function eventForm(ds, pre) {
    const e = pre.id ? (appState.events || []).find(x => x.id === pre.id) : null;
    const v = e || { title: '', desc: '', date: ds, endDate: ds, start: pre.start || nextHalf(), allDay: false, tz: LOCAL_TZ, repeat: { f: 'none' } };
    if (!e) v.end = fromMin(toMin(v.start) + 60);                       // default length: 1 hour
    const d = parseDate(v.date), r = v.repeat || { f: 'none' }, wd = d.toLocaleString('default', { weekday: 'long' });
    const opts = [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', `Weekly on ${wd}`],
      ['monthly', `Monthly on the ${ORD[nth(v.date)]} ${wd}`], ['yearly', `Annually on ${d.toLocaleString('default', { month: 'long', day: 'numeric' })}`],
      ['weekdays', 'Every weekday (Monday to Friday)'], ['custom', 'Custom…']];
    const list = !e && dayEvents(ds).length ? `<h4 class="mt-4 font-bold">Events on this day</h4>${dayEvents(ds).map(x =>
      `<div class="che-item" onclick="chronEditEvent('${x.id}','${ds}')">${x.allDay ? 'All day' : fmtT(x.start)} · ${escapeHtml(x.title || '(No title)')}</div>`).join('')}` : '';
    return `<div class="che">
      <input id="evTitle" class="che-title" placeholder="Add title" value="${escapeAttr(v.title)}">
      <div class="che-row"><i class="fa-regular fa-clock"></i>
        <input id="evDate" type="date" value="${v.date}">
        <span class="evTimes ${v.allDay ? 'hidden' : ''}"><input id="evStart" type="time" value="${v.start}"> – <input id="evEnd" type="time" value="${v.end}"></span>
        <span class="evEndDate ${v.allDay ? '' : 'hidden'}">– <input id="evEndDate" type="date" value="${v.endDate || v.date}"></span></div>
      <div class="che-row"><i></i><label><input id="evAllDay" type="checkbox" ${v.allDay ? 'checked' : ''}> All day</label>
        <select id="evTz" title="Time zone">${TZS.map(z => `<option ${z === v.tz ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
      <div class="che-row"><i class="fa-solid fa-rotate"></i><select id="evRepeat">${opts.map(([k, l]) => `<option value="${k}" ${r.f === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="evCustom" class="che-custom ${r.f === 'custom' ? '' : 'hidden'}">Repeat every <input id="evN" type="number" min="1" value="${r.n || 1}">
        <select id="evUnit">${['day', 'week', 'month', 'year'].map(u => `<option ${r.u === u ? 'selected' : ''}>${u}</option>`).join('')}</select><br>
        On <span id="evDays">${'SMTWTFS'.split('').map((x, i) => `<label><input type="checkbox" value="${i}" ${(r.days || [d.getDay()]).includes(i) ? 'checked' : ''}>${x}</label>`).join('')}</span> <small>(weekly only)</small><br>
        Ends <input id="evUntil" type="date" value="${r.until || ''}"> <small>(blank = never)</small></div>
      <div class="che-row"><i class="fa-solid fa-align-left"></i><textarea id="evDesc" placeholder="Add description">${escapeHtml(v.desc || '')}</textarea></div>
      <div class="flex gap-2 justify-end">
        ${e ? `<button onclick="chronDeleteEvent('${e.id}')" class="bg-red-600 px-3 py-1 rounded text-sm">Delete</button>` : ''}
        <button onclick="chronSaveEvent('${e ? e.id : ''}')" class="bg-emerald-600 px-3 py-1 rounded text-sm">Save</button>
        <button onclick="closeModal()" class="bg-slate-600 px-3 py-1 rounded text-sm">Cancel</button></div>${list}</div>`;
  }
  function wireEventForm() {
    const $ = id => document.getElementById(id);
    let dur = toMin($('evEnd').value) - toMin($('evStart').value); if (dur <= 0) dur = 60;
    $('evStart').onchange = () => { $('evEnd').value = fromMin(toMin($('evStart').value) + dur); };   // keep the length, like Google
    $('evEnd').onchange = () => { dur = toMin($('evEnd').value) - toMin($('evStart').value); if (dur <= 0) dur += 1440; };
    $('evAllDay').onchange = () => {
      document.querySelector('.evTimes').classList.toggle('hidden', $('evAllDay').checked);
      document.querySelector('.evEndDate').classList.toggle('hidden', !$('evAllDay').checked);
    };
    $('evRepeat').onchange = () => $('evCustom').classList.toggle('hidden', $('evRepeat').value !== 'custom');
    $('evTitle').focus();
  }
  window.chronSaveEvent = id => {
    const $ = x => document.getElementById(x);
    const date = $('evDate').value || todayStr(), f = $('evRepeat').value, allDay = $('evAllDay').checked;
    const repeat = f === 'custom'
      ? { f, n: Math.max(1, +$('evN').value || 1), u: $('evUnit').value, days: [...document.querySelectorAll('#evDays input:checked')].map(i => +i.value), until: $('evUntil').value || '' }
      : f === 'weekly' ? { f, days: [parseDate(date).getDay()] } : { f };
    const data = { title: $('evTitle').value.trim(), desc: $('evDesc').value.trim(), date, allDay,
      start: $('evStart').value || '09:00', end: $('evEnd').value || '10:00',
      endDate: allDay && $('evEndDate').value > date ? $('evEndDate').value : date, tz: $('evTz').value, repeat };
    appState.events = appState.events || [];
    if (id) Object.assign(appState.events.find(x => x.id === id), data);
    else appState.events.push(Object.assign({ id: uid() }, data));
    save(); closeModal(); render();
    toast(`Event "${data.title || '(No title)'}" saved`);
  };
  window.chronDeleteEvent = id => {
    if (!confirm('Delete this event (all repeats)?')) return;
    appState.events = appState.events.filter(x => x.id !== id);
    save(); closeModal(); render(); toast('Event deleted', 'err');
  };

  /* close nav dropdowns when clicking elsewhere */
  document.addEventListener('click', e => document.querySelectorAll('details.nav-dd[open]')
    .forEach(d => { if (!d.contains(e.target)) d.open = false; }));
})();
