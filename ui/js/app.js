// Wiring: toolbar, delegated actions, keyboard, relay events and rendering.
import { on, emit } from './bus.js';
import { esc } from './format.js';
import { settings, saveSettings, store, ui, revealed, expanded, addEvent, removeEvent, clearStore, activeUrls, relayName, relayHost, scopeIs, isLocalRelay } from './state.js';
import * as relay from './relay.js';
import { renderSidebar } from './views/sidebar.js';
import { renderSocial, renderDetails, openThread } from './views/social.js';
import { renderTechnical, renderInspector, techRows, sort } from './views/technical.js';
import { eventJson } from './views/inspector.js';
import * as ov from './views/overlays.js';
import { previewText, previewAction } from './views/client.js';
import * as ids from './identities.js';
import { querySheet, runQuery, toggleAll, nakForQuery } from './views/query.js';
import * as scen from './views/scenarios.js';
import * as sed from './views/scenario-editor.js';
import * as sealed from './sealed.js';
import { relaySheet, refreshRelaySheet, runProbes } from './views/relayinfo.js';
import * as term from './views/terminal.js';
import * as tour from './tour.js';
import { tourById } from './tours.js';

const $ = id => document.getElementById(id);

// ---------- appearance ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
const applyAppearance = () => document.documentElement.classList.toggle('dark', settings.appearance === 'dark' || (settings.appearance === 'system' && mq.matches));
mq.addEventListener('change', applyAppearance);

// ---------- rendering ----------
export function render() {
  renderSidebar();
  if (ui.win === 'social') renderSocial(); else renderTechnical();
  renderToolbar();
  tour.onRender();
}
function renderToolbar() {
  const a = ids.acting(); $('actName').textContent = a ? a.name : 'No identity'; $('actBtn').classList.toggle('none', !a);
  const active = activeUrls(); const live = relay.connectedUrls().length;
  $('relayName').textContent = active.length === 1 ? relayName(active[0]) : `${active.length} relays`;
  $('relayBtn').title = `${active.map(relayName).join(', ') || 'no relay'} · choose relays (R)`;
  $('dot').className = 'dot' + (live ? (live === active.length ? ' on' : ' busy') : '');
  ui.watching = relay.anyLive();
  $('liveBtn').setAttribute('aria-pressed', !ui.paused);
  $('liveBtn').hidden = !ui.watching && !ui.paused;
  $('liveLabel').textContent = ui.paused ? `Paused${ui.queue.length ? ` · ${ui.queue.length} new` : ''}` : rate() >= 2 ? `Live · ${Math.round(rate())}/s` : 'Live';
  $('liveBtn').title = ui.paused ? 'Resume: let the queued events into the timeline' : 'Pause: keep the timeline still while you inspect; new events are counted, not lost';
  $('sbToggle').setAttribute('aria-pressed', settings.sidebar);
  $('split').classList.toggle('nosb', !settings.sidebar);
  applyWidths();
  $('detailsBtn').setAttribute('aria-pressed', ui.win === 'social' ? ui.detailOpen : ui.inspOpen);
}
function showWindow(name) {
  ui.win = name;
  $('social').classList.toggle('active', name === 'social');
  $('technical').classList.toggle('active', name === 'technical');
  $('tabSocial').setAttribute('aria-pressed', name === 'social');
  $('tabTech').setAttribute('aria-pressed', name === 'technical');
  document.title = `Relay Window · ${name === 'social' ? 'Social' : 'Technical'}`;
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  ov.closeOverlays(); render();
}
function openDetails(id) { if (id) ui.detailId = id; ui.detailOpen = true; if (ui.win !== 'social') showWindow('social'); else renderSocial(); }
// One control for the right-hand panel in both windows: the post details in Social, the inspector in Technical.
function toggleDetails() {
  if (ui.win === 'social') { ui.detailOpen = !ui.detailOpen; renderSocial(); } else { ui.inspOpen = !ui.inspOpen; renderTechnical(); }
  renderToolbar();
}
function setStatus(text) { $('state').textContent = text; }
const storedText = () => { const on = relay.connectedUrls().length, want = activeUrls().length; return `${store.events.size} events${on < want ? ` · ${on} of ${want} relays connected` : ''}`; };
function flashDot() { const d = $('dot'); d.classList.remove('pulse'); void d.offsetWidth; d.classList.add('pulse'); }
const copyText = async (text, btn) => {
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
  if (btn && btn.classList.contains('copy')) { const old = btn.textContent; btn.classList.add('done'); btn.textContent = 'Copied'; setTimeout(() => { btn.classList.remove('done'); btn.textContent = old; }, 1200); }
};

// ---------- relay events ----------
on('relay:state', ({ url, state, text }) => {
  const loading = [...activeUrls()].some(u => ['connecting', 'loading'].includes(relay.stateOf(u)));
  $('progress').style.display = loading ? '' : 'none';
  setStatus(state === 'live' || state === 'off' ? storedText() : `${relayName(url)}: ${text}`);
  renderToolbar(); renderSidebar();
});
on('relay:info', () => { renderSidebar(); renderToolbar(); });
/** Live traffic renders at most a few times a second: a public relay can deliver hundreds of events in a burst. */
const RENDER_EVERY = 250; let renderTimer = 0, lastRender = 0;
function scheduleRender() {
  if (renderTimer) return;
  const wait = Math.max(0, RENDER_EVERY - (performance.now() - lastRender));
  renderTimer = setTimeout(() => { renderTimer = 0; lastRender = performance.now(); setStatus(storedText()); render(); if (rate() >= 1) setTimeout(scheduleRender, 5200); }, wait);
}
const arrivals = [];   // timestamps of the last five seconds of live events, for the rate on the Live pill
const rate = () => { const now = performance.now(); while (arrivals.length && now - arrivals[0] > 5000) arrivals.shift(); return arrivals.length / 5; };
const wantsBanner = url => settings.notify === 'all' || (settings.notify === 'local' && isLocalRelay(url));
on('relay:eose', scheduleRender);
on('relay:event', ({ ev, url }) => {
  const live = relay.isLive(url);
  if (ui.paused && live) { if (ui.queue.length >= settings.keep) ui.queue.shift(); ui.queue.push({ ev, url }); scheduleRender(); return; }
  const result = addEvent(ev, live, url);
  if (!result) return;
  if (result === 'seen') { if (ui.win === 'technical') scheduleRender(); return; }
  if (live) { arrivals.push(performance.now()); if (wantsBanner(url)) ov.notify(ev, url); flashDot(); }
  scheduleRender();
});
on('relay:error', ({ url, reason }) => {
  setStatus(`${relayName(url)}: ${reason === 'invalid' ? 'invalid address' : 'not reachable'}`);
  ov.notify({ kind: -1, pubkey: '', id: url, tags: [], content: '', created_at: 0, _relayError: reason === 'invalid' ? `“${url}” is not a valid ws:// address.` : `${relayName(url)} at ${url} is not reachable. Is it running?` });
});

// ---------- navigation requests from overlays ----------
on('details', id => openDetails(id));
on('thread', id => openThread(id));
on('technical', id => { ui.selected = id; ui.inspOpen = true; showWindow('technical'); });
on('hide', id => { removeEvent(id); if (ui.detailId === id) ui.detailId = null; render(); });
on('render', () => render());
on('query', prefill => querySheet(prefill));
on('window', name => showWindow(name));
on('feedmode', mode => { settings.feedMode = mode; saveSettings(); if (ui.win === 'social') renderSocial(); });
on('details-first', () => { const first = document.querySelector('#feed article.post, #feed article.cpost'); if (first) { ui.detailId = first.dataset.id; ui.detailOpen = true; renderSocial(); } });
on('dtab', tab => { ui.detailTab = tab; renderDetails(); });
on('select-first', () => { const rows = techRows(); if (rows.length && !ui.selected) ui.selected = rows[0].id; ui.inspOpen = true; renderTechnical(); });
on('sidebar-open', () => { if (!settings.sidebar) { settings.sidebar = true; saveSettings(); } settings.collapsed = {}; renderToolbar(); renderSidebar(); });
on('terminal-open', () => term.toggle(true));
on('terminal-close', () => term.toggle(false));
on('identities', () => { renderToolbar(); renderSidebar(); });
on('terminal', cmd => term.show(cmd));
on('scenarios', () => scen.scenariosSheet());
on('scenario-capture', id => { const ev = store.events.get(id); if (ev) scen.captureEvent(ev); });
on('relay-details', url => relaySheet(url));
on('relay:info', ({ url }) => { if ($('relayDetails')) refreshRelaySheet(url); });

// ---------- delegated actions ----------
const ACTIONS = {
  win: el => showWindow(el.dataset.win),
  group: el => { ui.scope = el.dataset.group === 'all' ? { type: 'all' } : { type: 'group', value: el.dataset.group }; render(); },
  nip: el => { ui.scope = { type: 'nip', value: el.dataset.nip }; render(); },
  range: el => { ui.scope = { type: 'range', from: +el.dataset.from, to: +el.dataset.to }; render(); },
  'nip-toggle': el => { const set = new Set(settings.openNips); set.has(el.dataset.nip) ? set.delete(el.dataset.nip) : set.add(el.dataset.nip); settings.openNips = [...set]; saveSettings(); renderSidebar(); },
  'kinds-mode': el => { settings.kindsMode = el.dataset.mode; saveSettings(); renderSidebar(); },
  'nips-all': () => { settings.allNips = !settings.allNips; saveSettings(); renderSidebar(); },
  person: el => { if (el.closest('#sheet')) ov.closeSheet(); ui.person = el.dataset.pubkey || null; ui.personScope = 'all'; ov.closeOverlays(); if (ui.win !== 'social') showWindow('social'); else render(); $('feedwrap').scrollTop = 0; },
  scope: el => { ui.personScope = el.dataset.scope; renderSocial(); },
  lightbox: el => { const d = $('lightbox'); d.querySelector('img').src = el.dataset.src; d.showModal(); },
  preview: el => {
    const ev = store.events.get(el.dataset.id); if (!ev) return;
    const relays = relay.connectedUrls().length ? relay.connectedUrls() : activeUrls();
    const p = previewAction(el.dataset.what, ev, relays); const a = ids.acting();
    const who = a ? `as <b>${esc(a.name)}</b>` : '<span class="muted">no identity chosen</span>';
    const chooser = a ? '' : `<button class="copy" data-action="act-menu">Choose Identity…</button>`;
    let body = '';
    if (p.emojis) body = `<div class="row">${p.emojis.map(e => `<button class="chip emoji" data-action="preview-run" data-cmd="${esc(ids.withIdentity(p.command(e)))}">${e === '+' ? '❤️' : e}</button>`).join('')}</div>`;
    else if (p.text) body = `<input id="previewText" class="qfield" placeholder="Your reply" autocomplete="off"><div class="row" style="margin-top:8px"><button class="cprimary" data-action="preview-reply" data-id="${ev.id}">Run in Terminal</button><button class="copy" data-action="preview-reply" data-id="${ev.id}" data-copy="1">Copy</button></div>`;
    else if (p.command) { const cmd = ids.withIdentity(p.command()); body = `<code class="pcmd">${esc(cmd.length > 220 ? cmd.slice(0, 217) + '…' : cmd)}</code><div class="row" style="margin-top:8px"><button class="cprimary" data-action="preview-run" data-cmd="${esc(cmd)}">Run in Terminal</button><button class="copy" data-action="copy" data-text="${esc(cmd)}">Copy</button></div>`; }
    else if (p.steps) body = `<ol class="csteps">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`;
    ov.openPopover(`<h4>${esc(p.title)} ${who}</h4><div class="sub">${esc(p.note)}</div>${body}${chooser ? `<div class="row" style="margin-top:8px">${chooser}</div>` : ''}`, el);
    if (p.text) $('previewText').focus();
  },
  'preview-run': el => { ov.closeOverlays(); term.show(el.dataset.cmd); },
  'preview-reply': el => {
    const ev = store.events.get(el.dataset.id); const text = $('previewText').value.trim(); if (!ev || !text) { $('previewText').focus(); return; }
    const relays = relay.connectedUrls().length ? relay.connectedUrls() : activeUrls();
    const cmd = ids.withIdentity(previewAction('reply', ev, relays).command(text));
    if (el.dataset.copy) { copyText(cmd, el); return; } ov.closeOverlays(); term.show(cmd);
  },
  'act-menu': el => ov.identityMenu(el),
  'act-as': el => ids.actAs(el.dataset.name || null),
  'identity-menu': el => ov.identityContextMenu(el.dataset.name, el.dataset.pubkey, el),
  'relay-scope': el => { ui.scope = scopeIs('relay', el.dataset.url) ? { type: 'all' } : { type: 'relay', value: el.dataset.url }; render(); },
  'relay-more': el => ov.relayContextMenu(el.dataset.url, el),
  'identity-new': () => ov.newIdentitySheet(),
  'identity-manage': () => ov.identitiesSheet(),
  'identity-create': () => ov.createIdentityFromSheet(),
  'identity-remove': el => ov.showAlert({ title: 'Remove This Identity?', message: `The key for “${el.dataset.name}” is deleted from its file on this Mac and cannot be recovered. Events it signed stay on the relays.`, buttons: ['Cancel', 'Remove'], destructive: true }).then(({ index }) => { if (index === 1) ids.remove(el.dataset.name).then(() => ov.identitiesSheet()).catch(e => setStatus(e.message)); }),
  'lightbox-close': () => $('lightbox').close(),
  'nak-for': el => { ov.closeOverlays(); ui.detailTab = 'nak'; openDetails(el.dataset.id); },
  feedmode: el => { settings.feedMode = el.dataset.mode; saveSettings(); renderSocial(); $('feedwrap').scrollTop = 0; },
  section: el => { const id = el.dataset.section; settings.collapsed[id] = !settings.collapsed[id]; saveSettings(); renderSidebar(); },
  'sheet-close': () => ov.closeSheet(),
  scenarios: () => scen.scenariosSheet(),
  'scenario-pick': el => scen.pick(el.dataset.id),
  'scenario-run': () => scen.run(),
  'scenario-stop': () => scen.stop(),
  'scenario-export': () => scen.exportReport(),
  'scenario-new': () => scen.newScenario(),
  'scenario-draft': () => scen.continueDraft(),
  'scenario-edit': () => scen.editCurrent(),
  'scenario-duplicate': () => scen.duplicateCurrent(),
  'scenario-delete': () => scen.deleteCurrent(),
  ...Object.fromEntries(Object.keys(sed.actions).map(k => [k, el => sed.actions[k](el)])),
  'sealed-open': el => { const ev = store.events.get(el.dataset.id); if (ev) sealed.open(ev).catch(e => ov.showAlert({ title: 'Cannot Decrypt', message: e.message, buttons: ['OK'] })); },
  'sealed-forget': el => sealed.forget(el.dataset.id),
  'sealed-run': el => term.show(el.dataset.cmd),
  'sb-clear': () => { ui.sbFilter = ''; $('sbFilter').value = ''; renderSidebar(); $('sbFilter').focus(); },
  'relay-nak': () => ov.relayNakSheet(),
  kind: el => { ui.scope = el.dataset.kind === 'all' ? { type: 'all' } : { type: 'kind', value: +el.dataset.kind }; render(); },
  profile: el => ov.profilePopover(el.dataset.pubkey, el),
  'profile-nak': el => ov.profileNakSheet(el.dataset.pubkey),
  menu: el => ov.eventMenu(el.dataset.id, el),
  details: el => { if (ui.detailOpen && ui.detailId === el.dataset.id) { ui.detailOpen = false; renderSocial(); } else openDetails(el.dataset.id); },
  'close-details': () => { ui.detailOpen = false; renderSocial(); },
  'to-technical': el => emit('technical', el.dataset.id),
  dtab: el => { ui.detailTab = el.dataset.tab; renderDetails(); },
  tab: el => { ui.inspTab = el.dataset.tab; renderInspector(); },
  thread: el => openThread(el.dataset.id),
  open: el => { if (store.events.get(el.dataset.id)) openThread(el.dataset.id); },
  reveal: el => { revealed.add(el.dataset.id); renderSocial(); },
  expand: el => { expanded.add(el.dataset.id); renderSocial(); },
  read: el => { expanded.has(el.dataset.id) ? expanded.delete(el.dataset.id) : expanded.add(el.dataset.id); renderSocial(); },
  hashtag: el => { $('search').value = '#t:' + el.dataset.tag; setSearch('#t:' + el.dataset.tag); },
  copy: el => copyText(el.dataset.text, el),
  sort: el => { const k = el.dataset.key; sort.dir = sort.key === k ? -sort.dir : (k === 'created_at' ? -1 : 1); sort.key = k; renderTechnical(); },
  row: el => { ui.selected = el.dataset.id; renderTechnical(); },
  'relay-menu': el => ov.relayMenu(el),
  'relay-manage': () => ov.relayManagerSheet(),
  'relay-add': () => { ov.closeSheet(); ov.addRelayPrompt(); },
  'relay-use': el => { relay.setActive(el.dataset.url, true); ov.relayManagerSheet(); },
  'relay-off': el => { relay.setActive(el.dataset.url, false); ov.relayManagerSheet(); },
  'relay-toggle': el => { relay.setActive(el.dataset.url, !settings.active.includes(el.dataset.url)); if ($('relayDetails')) setTimeout(() => refreshRelaySheet(el.dataset.url), 300); },
  'relay-details': el => relaySheet(el.dataset.url),
  'relay-probe': el => { el.textContent = 'Running…'; el.disabled = true; runProbes(el.dataset.url); },
  'relay-nak-for': el => ov.relayNakSheet(el.dataset.url),
  'query-run': () => runQuery(),
  'query-toggle': () => toggleAll(),
  'query-nak': el => copyText(nakForQuery(), el),
  'import': () => $('importFile').click(),
  query: () => querySheet(ui.search),
  run: el => term.show(el.dataset.cmd),
  'term-stop': el => term.stop(el.dataset.run),
  'term-close': () => term.toggle(false),
  'term-retry': () => term.retry(),
  'term-menu': el => term.moreMenu(el),
  'term-bottom': () => term.jumpToBottom(),
  'term-find-close': () => term.closeFind(),
  'term-suggest': el => term.run(el.dataset.cmd),
  'term-rerun': el => term.run(el.dataset.cmd),
  'term-edit': el => { $('termInput').value = el.dataset.cmd; $('termInput').focus(); },
  'term-copy-out': el => copyText(term.outputOf(el.dataset.run), el),
  'term-export': el => term.exportRun(el.dataset.run),
  tour: el => { ov.closeOverlays(); ov.closeSheet(); tour.start(tourById(el.dataset.tour), +(el.dataset.step || 0)); },
  tip: el => ov.tipPopover(el.dataset.tip, el),
  'tip-dismiss': el => ov.dismissTip(el.dataset.tip),
  'tips-reset': () => ov.resetTips(),
  'sample-load': el => loadSample(el),
  'term-raw': el => { const pre = el.closest('.ln.ev').querySelector('.evraw'); pre.hidden = !pre.hidden; },
  'relay-remove': el => { relay.removeRelay(el.dataset.url); ov.relayManagerSheet(); },
  toggle: el => { const k = el.dataset.key; settings[k] = !settings[k]; el.setAttribute('aria-checked', settings[k]); saveSettings(); render(); },
  theme: el => { settings.appearance = el.dataset.theme; el.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === el)); applyAppearance(); saveSettings(); },
};
document.addEventListener('click', e => {
  const inner = e.target.closest('.rowmenu, .dotbtn'); if (inner) { e.stopPropagation(); ov.closeOverlays(); ACTIONS[inner.dataset.action]?.(inner); return; }
  const el = e.target.closest('[data-action]');
  if (!el) { if (!e.target.closest('#popover, #menu')) ov.closeOverlays(); return; }
  if (el.classList.contains('sb-row') && e.target.closest('.rowmenu, .dotbtn')) return;   // handled by the inner control
  if (el.tagName === 'A') e.preventDefault();
  const insideOverlay = !!el.closest('#popover, #menu');
  if (!insideOverlay && !['profile', 'menu', 'relay-menu', 'preview', 'act-menu', 'identity-menu', 'relay-more', 'term-menu', 'tip'].includes(el.dataset.action)) ov.closeOverlays();
  e.stopPropagation();
  ACTIONS[el.dataset.action]?.(el);
});
document.addEventListener('change', e => {
  const a = e.target.dataset.action;
  if (a === 'limit' || a === 'keep') { settings[a] = +e.target.value; saveSettings(); }
  else if (a === 'notify') { settings.notify = e.target.value; saveSettings(); }
});
$('lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('lightbox').close(); });
document.addEventListener('dblclick', e => { const r = e.target.closest('tr.row'); if (r) { ui.selected = r.dataset.id; ui.inspTab = 'raw'; renderTechnical(); } });
// Clicking a post's empty area selects it for ⌘I without opening anything.
$('feed').addEventListener('click', e => { const p = e.target.closest('article.post, article.cpost'); if (p && !e.target.closest('[data-action], a')) { ui.detailId = p.dataset.id; if (ui.detailOpen) renderSocial(); } });

// ---------- toolbar ----------
function setSearch(q) { ui.search = q.trim(); $('searchBox').classList.toggle('has', !!ui.search); render(); }
let searchTimer = 0;   // a keystroke re-filters thousands of events; wait for the pause in typing
$('search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setSearch(e.target.value), 120); });
// Right-click a relay row for its contextual menu.
$('sidebar').addEventListener('contextmenu', e => { const relayRow = e.target.closest('[data-action="relay-toggle"]'); const idRow = e.target.closest('[data-identity]'); if (!relayRow && !idRow) return; e.preventDefault(); if (relayRow) ov.relayContextMenu(relayRow.dataset.url, relayRow); else ov.identityContextMenu(idRow.dataset.identity, idRow.dataset.pubkey, idRow); });
on('person', pk => { ov.closeSheet(); ui.person = pk; ui.personScope = 'all'; if (ui.win !== 'social') showWindow('social'); else render(); });
on('identity-remove', name => ACTIONS['identity-remove']({ dataset: { name } }));
// Import JSON Lines (one event per line) from a file or by dropping it anywhere on the window.
function importText(text, name) {
  let added = 0, bad = 0;
  for (const line of text.split(/\r?\n/)) { const s = line.trim(); if (!s) continue; let ev = null; try { ev = JSON.parse(s); } catch { bad++; continue; } if (Array.isArray(ev) && ev[0] === 'EVENT') ev = ev[2]; if (!ev || !ev.id || !ev.sig) { bad++; continue; } if (addEvent(ev, false, name === 'sample' ? 'sample' : `file:${name}`) === 'new') added++; }
  setStatus(`${name}: ${added} imported${bad ? `, ${bad} lines skipped` : ''}`); render();
}
$('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => importText(t, f.name)); e.target.value = ''; });
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.text().then(t => importText(t, f.name)); });
// Sidebar filter: narrows every section live. ↑ ↓ move a highlight through the visible rows, Return opens it, Esc clears.
$('sbFilter').addEventListener('input', e => { ui.sbFilter = e.target.value; renderSidebar(); });
$('sbFilter').addEventListener('keydown', e => {
  const rows = [...$('sbScroll').querySelectorAll('.sb-row')]; const cur = rows.findIndex(r => r.classList.contains('hi'));
  if (e.key === 'Escape') { e.stopPropagation(); ui.sbFilter = ''; e.target.value = ''; renderSidebar(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!rows.length) return; const n = e.key === 'ArrowDown' ? Math.min(rows.length - 1, cur + 1) : Math.max(0, cur - 1); rows.forEach(r => r.classList.remove('hi')); rows[n].classList.add('hi'); rows[n].scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); (rows[cur] || rows.find(r => r.dataset.action !== 'relay-menu'))?.click(); }
});
// Resize handles: one routine for the sidebar (grows to the right) and the right-hand panel (grows to the left).
function attachResizer(handle, { key, min, max, fromRight }) {
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); handle.classList.add('active'); document.body.classList.add('resizing'); handle.setPointerCapture(e.pointerId);
    const move = ev => { const w = fromRight ? $('main').getBoundingClientRect().right - ev.clientX : ev.clientX; settings[key] = Math.round(Math.min(max, Math.max(min, w))); applyWidths(); };
    const up = () => { handle.classList.remove('active'); document.body.classList.remove('resizing'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); saveSettings(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => { settings[key] = key === 'sidebarWidth' ? 240 : 400; applyWidths(); saveSettings(); });
}
function applyWidths() {
  $('split').style.setProperty('--sbw', settings.sidebarWidth + 'px'); $('split').style.setProperty('--dw', settings.detailWidth + 'px');
  // The terminal never takes the whole column: the window above keeps at least 180pt.
  $('terminal').style.height = Math.min(settings.terminalHeight, Math.max(120, $('main').clientHeight - 180)) + 'px';
}
addEventListener('resize', applyWidths);
// The terminal grows upward: drag its top edge.
$('termResize').addEventListener('pointerdown', e => {
  e.preventDefault(); const h = e.target; h.classList.add('active'); document.body.classList.add('resizing'); h.setPointerCapture(e.pointerId);
  const move = ev => { settings.terminalHeight = Math.round(Math.min(innerHeight * .7, Math.max(120, $('main').getBoundingClientRect().bottom - ev.clientY))); applyWidths(); };
  const up = () => { h.classList.remove('active'); document.body.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); saveSettings(); };
  h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
});
attachResizer($('sbResize'), { key: 'sidebarWidth', min: 180, max: 360, fromRight: false });
attachResizer($('detailResize'), { key: 'detailWidth', min: 320, max: 640, fromRight: true });
attachResizer($('inspResize'), { key: 'detailWidth', min: 320, max: 640, fromRight: true });
$('searchClear').onclick = () => { $('search').value = ''; setSearch(''); };
$('tabSocial').onclick = () => showWindow('social');
$('tabTech').onclick = () => showWindow('technical');
$('sbToggle').onclick = () => { settings.sidebar = !settings.sidebar; saveSettings(); renderToolbar(); };
// Live pill: click to pause the timeline; events keep arriving and are counted; click again to let them in.
$('liveBtn').onclick = () => {
  ui.paused = !ui.paused;
  if (!ui.paused && ui.queue.length) { for (const { ev, url } of ui.queue) addEvent(ev, true, url); ui.queue = []; setStatus(storedText()); render(); }
  renderToolbar();
};
$('detailsBtn').onclick = toggleDetails;
$('terminalBtn').onclick = () => term.toggle();
term.init();
scen.init();
on('layout', () => applyWidths());
on('search', q => { $('search').value = q; setSearch(q); });
on('add-relay', url => { const clean = relay.addRelay(url); if (clean) relay.setActive(clean, true); });
$('settingsBtn').onclick = ov.settingsSheet;
$('helpBtn').onclick = ov.helpSheet;
$('sheetDone').onclick = ov.closeSheet;
$('export').onclick = () => {
  const blob = new Blob([[...store.events.values()].map(ev => eventJson(ev)).join('\n') + '\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `relay-window-${Date.now()}.jsonl`; a.click();
};
$('clear').onclick = () => ov.showAlert({ title: 'Clear the List?', message: 'This only empties the window. Nothing on any relay is deleted.', buttons: ['Cancel', 'Clear'], destructive: true })
  .then(({ index }) => { if (index === 1) { clearStore(); ui.selected = null; ui.detailId = null; setStatus(storedText()); render(); } });

// ---------- keyboard ----------
// Single keys, active when no text field has focus. Command-key combos are reserved by browsers (⌘1 switches tabs, ⌘L the address bar).
const SHORTCUTS = {
  '1': () => showWindow('social'),
  '2': () => showWindow('technical'),
  'i': () => toggleDetails(),
  '/': () => { $('search').focus(); $('search').select(); },
  'f': () => { if (settings.sidebar) { $('sbFilter').focus(); $('sbFilter').select(); } },
  'r': () => ov.relayMenu($('relayBtn')),
  'a': () => ov.identityMenu($('actBtn')),
  'q': () => querySheet(ui.search),
  't': () => term.toggle(),
  's': () => $('sbToggle').click(),
  ',': () => ov.settingsSheet(),
  '?': () => ov.helpSheet(),
  'c': () => { if (ui.win === 'social') { settings.feedMode = settings.feedMode === 'client' ? 'relay' : 'client'; saveSettings(); renderSocial(); } },
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { ov.closeOverlays(); if (ui.detailOpen && !$('sheet').open && !$('alert').open) { ui.detailOpen = false; renderSocial(); } return; }
  const typing = e.target instanceof Element && e.target.closest('input, select, textarea');
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (SHORTCUTS[e.key]) { e.preventDefault(); SHORTCUTS[e.key](); return; }
  if (ui.win === 'technical' && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k')) {
    e.preventDefault(); const rows = techRows(); if (!rows.length) return;
    const down = e.key === 'ArrowDown' || e.key === 'j';
    const i = rows.findIndex(r => r.id === ui.selected); const n = down ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
    ui.selected = rows[n].id; renderTechnical(); $('rows').querySelector(`tr[data-id="${ui.selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }
});
addEventListener('hashchange', () => showWindow(location.hash === '#technical' ? 'technical' : 'social'));
setInterval(() => { if (store.events.size && ui.win === 'social' && settings.relative) renderSocial(); }, 30000);

// Sample data: a bundled set drawn from the local relays, so every tour step has something to point at.
async function loadSample(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  try { const text = await (await fetch('data/sample.jsonl')).text(); importText(text, 'sample'); ov.closeSheet(); }
  catch { setStatus('sample data could not be loaded'); if (btn) { btn.disabled = false; btn.textContent = 'Load Sample Data'; } }
}
// ---------- start ----------
applyAppearance();
showWindow(location.hash === '#technical' ? 'technical' : 'social');
relay.connectActive();
ids.refresh();
tour.init();
if (!settings.welcomeDone && !tour.seen('quick')) setTimeout(() => ov.welcome(), 1200);
