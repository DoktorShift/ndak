// Popovers, menus, alerts, prompts, sheets and notification banners. Composite overlays live at the bottom.
import { esc, stripHtml, plural } from '../format.js';
import { label, groupOf, COLOR } from '../kinds.js';
import { isEphemeral } from '../nostr.js';
import { settings, saveSettings, store, ui, eventsBy, relayLabel, relayHost, relayName, relayFor, activeUrls } from '../state.js';
import { nameOf, handle, npub, avatar } from '../people.js';
import { describe } from '../describe.js';
import { forProfile, forRelay } from '../nak.js';
import { nakList, eventJson, ICON } from './inspector.js';
import { emit } from '../bus.js';
import * as relay from '../relay.js';
import * as ids from '../identities.js';
import * as tour from '../tour.js';
import { TOURS, TIPS, NAK_INTRO, tourById } from '../tours.js';

const $ = id => document.getElementById(id);

// ---------- primitives ----------
function place(el, anchor) {
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 12)) + 'px';
  const below = r.bottom + 6; const above = r.top - el.offsetHeight - 6;   // flip above when there is no room below
  el.style.top = (below + el.offsetHeight > innerHeight - 12 && above > 8 ? above : Math.min(below, innerHeight - el.offsetHeight - 12)) + 'px';
}
export function closeOverlays() { $('popover').classList.remove('open'); const m = $('menu'); m.classList.remove('open'); m._anchor?.removeAttribute('aria-expanded'); m._anchor = null; }
export function openPopover(html, anchor) { const p = $('popover'); p.innerHTML = html; p.classList.add('open'); place(p, anchor); }

/** items: { label, action, destructive, check, sub } | { title } | 'sep' */
export function openMenu(items, anchor) {
  const m = $('menu');
  m.innerHTML = items.map((it, i) => it === 'sep' ? '<hr>' : it.title ? `<span class="title">${esc(it.title)}</span>`
    : `<button role="menuitem" data-i="${i}" class="${it.destructive ? 'destructive' : ''}"><span class="check">${it.check ? '✓' : ''}</span>${esc(it.label)}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ''}</button>`).join('');
  m.onclick = e => { const b = e.target.closest('button[data-i]'); if (!b) return; closeOverlays(); items[+b.dataset.i].action?.(); };
  m.classList.add('open'); place(m, anchor);
  anchor.setAttribute('aria-expanded', 'true'); m._anchor = anchor;
}
// Menus follow the keyboard like NSMenu: arrows move the highlight, Return chooses, Escape closes.
document.addEventListener('keydown', e => {
  const m = $('menu'); if (!m.classList.contains('open')) return;
  const items = [...m.querySelectorAll('button[data-i]')]; if (!items.length) return;
  const cur = items.findIndex(b => b.classList.contains('hi'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length; items.forEach(b => b.classList.remove('hi')); items[n].classList.add('hi'); }
  else if (e.key === 'Enter' && cur >= 0) { e.preventDefault(); items[cur].click(); }
});

export function showAlert({ title, message, buttons, destructive = false, input }) {
  return new Promise(resolve => {
    const body = $('alertBody');
    body.innerHTML = `<div class="icon">${ICON.relay}</div><h3>${esc(title)}</h3><p>${esc(message)}</p>${input ? `<input id="alertInput" type="text" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value || '')}" spellcheck="false">` : ''}
      <div class="row">${buttons.map((l, i) => `<button data-i="${i}" class="${i === buttons.length - 1 ? (destructive ? 'destructive' : 'default') : ''}">${esc(l)}</button>`).join('')}</div>`;
    body.onclick = e => { const b = e.target.closest('button'); if (!b) return; const value = input ? $('alertInput').value : undefined; $('alert').close(); resolve({ index: +b.dataset.i, value }); };
    if (input) $('alertInput').onkeydown = e => { if (e.key === 'Enter') body.querySelector('button.default')?.click(); };
    $('alert').showModal(); if (input) $('alertInput').focus();
  });
}
export function openSheet(title, html, { wide = false, footer = '' } = {}) {
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; $('sheet').classList.toggle('wide', wide);
  $('sheetFoot').innerHTML = footer; $('sheetFoot').hidden = !footer;
  if (!$('sheet').open) $('sheet').showModal();
  // Focus the body rather than the first button, so no focus ring appears until someone presses Tab (HIG: rings for keyboard focus).
  $('sheetBody').setAttribute('tabindex', '-1'); $('sheetBody').focus({ preventScroll: true });
}
export function closeSheet() { $('sheet').close(); $('sheetBody').innerHTML = ''; $('sheetFoot').innerHTML = ''; $('sheetFoot').hidden = true; }

// Live banners coalesce: the first event of a burst opens one banner, the rest of the burst updates it in place.
// A public relay can deliver many events a second; a banner per event is noise, one digest is information.
const burst = { el: null, n: 0, kinds: new Map(), relays: new Set(), timer: 0, last: 0, opened: 0, latest: null };
const BURST_GAP = 2500;   // ms of quiet that ends a burst
export function notify(ev, url) {
  if (ev._relayError) { const el = document.createElement('div'); el.className = 'notif'; el.innerHTML = `<div class="ni" style="background:var(--red)">!</div><div><div class="nt"><span>Relay</span><small>${esc(relayName(ev.id))}</small></div><div class="nb">${esc(ev._relayError)}</div></div>`; el.addEventListener('click', () => { el.remove(); relayMenu($('relayBtn')); }); $('notifs').prepend(el); setTimeout(() => el.remove(), 8000); return; }
  const now = Date.now();
  if (burst.el && (!burst.el.isConnected || now - burst.last > BURST_GAP)) endBurst();
  if (!burst.el) {
    burst.el = document.createElement('div'); burst.el.className = 'notif'; burst.opened = now; burst.n = 0; burst.kinds.clear(); burst.relays.clear();
    burst.el.addEventListener('click', () => { const id = burst.latest?.id; endBurst(); if (id) emit('details', id); });
    $('notifs').prepend(burst.el); while ($('notifs').children.length > 3) $('notifs').lastChild.remove();
  }
  burst.n++; burst.last = now; burst.latest = ev; burst.kinds.set(ev.kind, (burst.kinds.get(ev.kind) || 0) + 1); if (url) burst.relays.add(relayName(url));
  renderBurst();
  clearTimeout(burst.timer); burst.timer = setTimeout(endBurst, burst.n === 1 ? 6000 : 4000);
}
function endBurst() { clearTimeout(burst.timer); burst.el?.remove(); burst.el = null; burst.timer = 0; }
function renderBurst() {
  const ev = burst.latest; const el = burst.el; const g = groupOf(ev.kind); const s = describe(ev);
  if (burst.n === 1) { el.innerHTML = `<div class="ni" style="background:${COLOR[g] || 'var(--blue)'}">${isEphemeral(ev.kind) ? '◦' : '•'}</div><div><div class="nt"><span>${esc(label(ev.kind))}</span><small>${isEphemeral(ev.kind) ? 'live only' : 'stored'}</small></div><div class="nb">${esc(nameOf(ev.pubkey))} ${esc(stripHtml(s.verb))}</div></div>`; return; }
  const perSecond = burst.n / Math.max(1, (burst.last - burst.opened) / 1000);
  const kinds = [...burst.kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} × ${esc(label(k))}`).join(', ');
  el.innerHTML = `<div class="ni" style="background:var(--blue)">${burst.n > 999 ? '999+' : burst.n}</div><div><div class="nt"><span>${burst.n} new events</span><small>${perSecond >= 2 ? `${Math.round(perSecond)}/s` : 'live'}</small></div><div class="nb">${kinds}${burst.kinds.size > 3 ? ', …' : ''} · ${esc([...burst.relays].join(', '))}</div></div>`;
}

// ---------- composite overlays ----------
export function profilePopover(pk, anchor) {
  const p = store.profiles.get(pk) || {}; const mine = eventsBy(pk);
  openPopover(`<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px">${avatar(pk, 'm')}<div><h4>${esc(nameOf(pk))}</h4><div class="sub" style="margin:0">${esc(handle(pk))}</div></div></div>
    ${p.about ? `<div style="font-size:12.5px;margin-bottom:8px">${esc(p.about)}</div>` : ''}${p.nip05 ? `<div class="sub" title="NIP-05 address. It is a label, not a verification.">@ ${esc(p.nip05)}</div>` : ''}${p.lud16 ? `<div class="sub">⚡︎ ${esc(p.lud16)}</div>` : ''}
    <div class="sub">${plural(mine.length, 'event')} on this relay</div>
    <div class="row"><button class="copy" data-action="person" data-pubkey="${pk}">Open Profile</button><button class="copy" data-action="copy" data-text="${npub(pk)}">Copy npub</button><button class="copy" data-action="copy" data-text="${pk}">Copy Hex</button><button class="copy" data-action="profile-nak" data-pubkey="${pk}">nak Commands…</button></div>`, anchor);
}
export function profileNakSheet(pk) {
  closeOverlays();
  const url = activeUrls()[0] || settings.relays[0].url;
  openSheet(`nak · ${nameOf(pk)}`, `<div class="settings"><div class="hint" style="margin:0 2px 4px">Commands for ${esc(nameOf(pk))} on ${esc(relayHost(url))}.</div>${nakList(forProfile(pk, url))}</div>`);
}
export function relayNakSheet(url = activeUrls()[0] || settings.relays[0].url) {
  closeOverlays();
  openSheet(`nak · ${relayName(url)}`, `<div class="settings"><div class="hint" style="margin:0 2px 4px">Commands for the relay at ${esc(url)}.</div>${nakList(forRelay(url))}</div>`);
}

export function eventMenu(id, anchor) {
  const ev = store.events.get(id); if (!ev) return;
  const copyText = t => () => navigator.clipboard.writeText(t).catch(() => {});
  openMenu([
    { label: 'Show Details', action: () => emit('details', id) },
    { label: 'Open Conversation', action: () => emit('thread', id) },
    { label: 'Open in Technical', action: () => emit('technical', id) },
    'sep',
    { label: 'Copy Event ID', action: copyText(ev.id) },
    { label: 'Copy Author npub', action: copyText(npub(ev.pubkey)) },
    { label: 'Copy Raw JSON', action: copyText(eventJson(ev)) },
    { label: 'Copy nak Fetch Command', action: copyText(`nak req -i ${ev.id} ${relayFor(ev)} < /dev/null`) },
    'sep',
    { label: 'Hide from This Window', destructive: true, action: () => emit('hide', id) },
  ], anchor);
}

/** Contextual menu for one relay row (right-click). */
export function relayContextMenu(url, anchor) {
  openMenu([
    { title: relayName(url) },
    relay.isConnected(url) ? { label: 'Disconnect', action: () => relay.setActive(url, false) } : { label: 'Connect', action: () => relay.setActive(url, true) },
    { label: 'Relay Details…', action: () => emit('relay-details', url) },
    { label: 'nak Commands…', action: () => relayNakSheet(url) },
    'sep',
    { label: 'Copy URL', action: () => navigator.clipboard.writeText(url).catch(() => {}) },
    { label: 'Remove from List', destructive: true, action: () => relay.removeRelay(url) },
  ], anchor);
}
/** Acting as: which identity signs write commands. */
export async function identityMenu(anchor) {
  await ids.refresh();   // the agent may have started, or a key may have been minted elsewhere, since the last look
  const items = [{ title: 'Acting as' }];
  if (!ids.available) items.push({ label: 'Agent not running: open the terminal for the start command', action: () => emit('terminal', '') });
  for (const i of store.identities) items.push({ label: i.name, sub: nameOf(i.pubkey) !== i.name && !nameOf(i.pubkey).startsWith('npub1') ? nameOf(i.pubkey) : handle(i.pubkey), check: settings.actAs === i.name, action: () => ids.actAs(i.name) });
  items.push('sep', { label: 'No Identity', check: !settings.actAs, action: () => ids.actAs(null) });
  items.push('sep');
  items.push({ label: 'New Identity…', action: newIdentitySheet });
  items.push({ label: 'Manage Identities…', action: identitiesSheet });
  openMenu(items, anchor);
}
export function identityContextMenu(name, pubkey, anchor) {
  const i = store.identities.find(x => x.name === name);
  openMenu([
    { title: name },
    settings.actAs === name ? { label: 'Stop Acting as This Identity', action: () => ids.actAs(null) } : { label: 'Act as This Identity', action: () => ids.actAs(name) },
    { label: 'Open Profile', action: () => { emit('person', pubkey); } },
    { label: 'Copy npub', action: () => navigator.clipboard.writeText(npub(pubkey)).catch(() => {}) },
    { label: 'nak Commands…', action: () => profileNakSheet(pubkey) },
    'sep',
    { label: 'Remove Identity…', sub: i?.source === 'demo' ? 'from demo-keys.env' : '', destructive: true, action: () => emit('identity-remove', name) },
  ], anchor);
}
export function identitiesSheet() {
  const rows = store.identities.map(i => `<div class="irow relayrow"><span class="dot ${settings.actAs === i.name ? 'on' : ''}" style="${settings.actAs === i.name ? '' : 'background:var(--fill3)'}"></span><div><div><b>${esc(i.name)}</b> <span class="hint">${esc(nameOf(i.pubkey) !== i.name ? nameOf(i.pubkey) : '')}</span></div><div class="u">${esc(npub(i.pubkey))}</div></div><div class="btns">${settings.actAs === i.name ? '<span class="chip on">Acting</span>' : `<button class="copy" data-action="act-as" data-name="${esc(i.name)}">Act as</button>`}<button class="copy" data-action="person" data-pubkey="${i.pubkey}">Profile</button><button class="copy" data-action="identity-remove" data-name="${esc(i.name)}">Remove</button></div></div>`).join('');
  openSheet('Identities', `<div class="settings"><div class="sect">Keys the agent holds</div><div class="inset">${rows || '<div class="irow hint">None yet.</div>'}</div><div class="inset"><div class="irow"><span>Mint a new key with a profile and a NIP-65 relay list</span><button class="copy" data-action="identity-new">New Identity…</button></div></div><div class="irow hint" style="padding:0 4px">Keys never reach this page. Demo keys come from identities/demo-keys.env; minted ones are stored in identities/relay-window.env next to it, readable by your user only. Removing deletes the key from its file.</div></div>`);
}
export function newIdentitySheet() {
  const connected = new Set(relay.connectedUrls());
  const relays = settings.relays.map(r => `<label class="qrelay"><input type="checkbox" data-url="${esc(r.url)}" ${connected.has(r.url) ? 'checked' : ''}> ${esc(relayLabel(r))} <small>${esc(r.url.replace(/^wss?:\/\//, ''))}</small><span class="spacer"></span><select data-mode="${esc(r.url)}" class="qmode"><option value="rw">read and write</option><option value="w">write only</option><option value="r">read only</option></select></label>`).join('');
  const field = (id, label, placeholder, hint = '') => `<div class="irow" style="display:block"><label for="${id}" style="display:block;font-size:12px;color:var(--label2);margin-bottom:3px">${label}</label><input id="${id}" class="qfield" style="font-family:var(--sans)" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">${hint ? `<div class="hint" style="margin-top:3px">${hint}</div>` : ''}</div>`;
  openSheet('New Identity', `<div class="settings">
    <div class="sect">Name</div><div class="inset">${field('idName', 'Name for commands, as in $bob: lowercase letters, digits and underscore', 'bob')}</div>
    <div class="sect">Profile (kind 0)</div><div class="inset">${field('idDisplay', 'Display name', 'Bob')}${field('idAbout', 'About', 'A short line about this identity')}${field('idPicture', 'Picture URL', 'https://…')}${field('idNip05', 'NIP-05 address', 'bob@example.com')}${field('idLud16', 'Lightning address', 'bob@example.com')}</div>
    <div class="sect">Relay list (kind 10002, NIP-65)</div><div class="inset" id="idRelays">${relays}</div>
    
    <div id="idResult"></div></div>`, { wide: true, footer: `<span class="hint">Mints the key in the agent, publishes profile and relay list to the checked relays, and starts acting as it.</span><button class="copy" data-action="sheet-close">Cancel</button><button class="cprimary" data-action="identity-create">Create Identity</button>` });
  $('idName').focus();
}
export async function createIdentityFromSheet() {
  const out = $('idResult'); const btn = $('sheet').querySelector('[data-action="identity-create"]');
  const relays = [...$('idRelays').querySelectorAll('input:checked')].map(i => { const mode = $('idRelays').querySelector(`select[data-mode="${i.dataset.url}"]`).value; return { url: i.dataset.url, read: mode !== 'w', write: mode !== 'r' }; });
  const payload = { name: $('idName').value.trim(), profile: { display_name: $('idDisplay').value.trim(), about: $('idAbout').value.trim(), picture: $('idPicture').value.trim(), nip05: $('idNip05').value.trim(), lud16: $('idLud16').value.trim() }, relays };
  btn.disabled = true; out.innerHTML = '<div class="progress" style="margin:4px 0 10px"><i></i></div>';
  try {
    const r = await ids.create(payload); ids.actAs(r.name);
    out.innerHTML = `<div class="inset"><div class="irow"><span>Created <b>${esc(r.name)}</b></span><span class="hint mono">${esc(r.npub)}</span></div>${r.results.map(x => `<div class="irow"><span>${esc(x.label)}</span><span class="${x.ok ? 'ok' : 'no'}">${x.ok ? 'published' : esc(x.error || 'failed')}</span></div>`).join('')}${relays.length ? '' : '<div class="irow hint">No relays checked: nothing was published. The key exists; publish later from the terminal.</div>'}</div><div class="row" style="margin-top:10px"><button class="copy" data-action="person" data-pubkey="${r.pubkey}">Open Profile</button></div>`;
  } catch (e) { out.innerHTML = `<div class="hint no">${esc(e.message)}</div>`; btn.disabled = false; }
}
export function relayMenu(anchor) {
  const items = [{ title: 'Connected relays (click to toggle)' }];
  for (const r of settings.relays) items.push({ label: relayLabel(r), sub: `${relayHost(r.url)}${relay.isConnected(r.url) ? '' : settings.active.includes(r.url) ? ' · connecting' : ''}`, check: relay.isConnected(r.url), action: () => relay.setActive(r.url, !settings.active.includes(r.url)) });
  items.push('sep');
  items.push({ label: 'Connect All', action: () => relay.connectAll() });
  items.push({ label: 'Disconnect All', action: () => relay.disconnectAll() });
  items.push('sep');
  items.push({ label: 'Relay Details…', action: () => emit('relay-details', activeUrls()[0] || settings.relays[0].url) });
  items.push({ label: 'Query and Compare…', action: () => emit('query', '') });
  items.push({ label: 'nak Commands for a Relay…', action: () => relayNakSheet() });
  items.push('sep');
  items.push({ label: 'Add Relay…', action: addRelayPrompt });
  items.push({ label: 'Manage Relays…', action: relayManagerSheet });
  openMenu(items, anchor);
}

export async function addRelayPrompt() {
  const { index, value } = await showAlert({ title: 'Add a Relay', message: 'Local relays usually listen on ws://localhost:<port>.', buttons: ['Cancel', 'Add'], input: { placeholder: 'ws://localhost:7783', value: 'ws://localhost:' } });
  if (index !== 1) return;
  const url = relay.addRelay(value || '');
  if (!url) { await showAlert({ title: 'Not a Relay Address', message: 'Use ws:// or wss:// followed by host and port.', buttons: ['OK'] }); return; }
  relay.setActive(url, true);
}

export function relayManagerSheet() {
  const rows = settings.relays.map(r => { const on = relay.isConnected(r.url); const want = settings.active.includes(r.url); return `<div class="irow relayrow"><span class="dot ${on ? 'on' : want ? 'busy' : ''}" style="${on || want ? '' : 'background:var(--fill3)'}"></span><div><div>${esc(relayLabel(r))}</div><div class="u">${esc(r.url)}${want && !on ? ' · not reachable' : ''}</div></div><div class="btns">${want ? `<button class="copy" data-action="relay-off" data-url="${esc(r.url)}">Disconnect</button>` : `<button class="copy" data-action="relay-use" data-url="${esc(r.url)}">Connect</button>`}<button class="copy" data-action="relay-remove" data-url="${esc(r.url)}" ${settings.relays.length < 2 ? 'disabled' : ''}>Remove</button></div></div>`; }).join('');
  openSheet('Relays', `<div class="settings"><div class="sect">Known relays</div><div class="inset">${rows}</div>
    <div class="inset"><div class="irow"><span>Add another relay</span><button class="copy" data-action="relay-add">Add Relay…</button></div></div>
    <div class="irow hint" style="padding:0 4px">Connect several relays at once: every event remembers where it was seen. Names come from each relay's NIP-11 document. Nothing is deleted anywhere.</div></div>`);
}

export function settingsSheet() {
  const sw = (id, key, on) => `<button class="switch" role="switch" data-action="toggle" data-key="${key}" aria-checked="${on}" id="${id}"></button>`;
  openSheet('Settings', `<div class="settings">
    <div class="sect">Relays</div><div class="inset"><div class="irow"><span>Connected<br><span class="hint">${esc(activeUrls().map(relayName).join(', ') || 'none')}</span></span><button class="copy" data-action="relay-manage">Manage Relays…</button></div><div class="irow"><span>Stored events to load</span><select data-action="limit">${[100, 500, 1000, 2000].map(n => `<option ${settings.limit === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="irow"><span>Events to keep<br><span class="hint">Once the window holds this many, the oldest arrivals leave first</span></span><select data-action="keep">${[2000, 5000, 10000, 20000].map(n => `<option value="${n}" ${settings.keep === n ? 'selected' : ''}>${n.toLocaleString()}</option>`).join('')}</select></div></div>
    <div class="sect">Appearance</div><div class="inset"><div class="irow"><span>Theme</span><div class="seg" role="group">${['system', 'light', 'dark'].map(t => `<button data-action="theme" data-theme="${t}" aria-pressed="${settings.appearance === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
      <div class="irow"><span>Relative times<br><span class="hint">“3m” instead of a clock time</span></span>${sw('swRel', 'relative', settings.relative)}</div>
      <div class="irow"><span>Load images<br><span class="hint">Pictures, avatars, article covers</span></span>${sw('swMedia', 'media', settings.media)}</div></div>
    <div class="sect">Live</div><div class="inset"><div class="irow"><span>Notification banners<br><span class="hint">One banner per burst; a busy relay updates it instead of stacking more</span></span><select data-action="notify">${[['local', 'Local relays only'], ['all', 'All relays'], ['off', 'Off']].map(([v, t]) => `<option value="${v}" ${settings.notify === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="irow"><span>Live-only events in the timeline<br><span class="hint">Off: they show in the ticker at the top</span></span>${sw('swLive', 'showLive', settings.showLive)}</div></div>
    <div class="hint" style="text-align:center">Settings are kept in this browser only.</div></div>`);
}

export function helpSheet() {
  const card = t => `<div class="tour"><div class="m"><span><b>${esc(t.title)}</b></span><span>${t.steps.length} ${t.steps.length === 1 ? 'step' : 'steps'}${tour.seen(t.id) ? ' · seen' : ''}</span></div><p>${esc(t.promise)}</p><button class="show" data-action="tour" data-tour="${t.id}">Show Me</button></div>`;
  openSheet('Help', `<div class="settings help">
    <div class="quick"><div><div class="sect" style="margin:0 0 4px">Quick Start</div><p>Eight steps on the live interface, about two minutes. It points at the real controls, so try them as you go.</p></div><div class="row"><button class="cprimary" data-action="tour" data-tour="quick">${tour.seen('quick') ? 'Replay Tour' : 'Take the Tour'}</button>${store.events.size ? '' : '<button class="copy" data-action="sample-load">Load Sample Data</button>'}</div></div>
    <div class="sect">Tours by area</div><div class="tours">${TOURS.map(card).join('')}</div>
    <div class="sect">What is nak?</div><div class="inset" style="padding:10px 12px"><p style="margin:0">${NAK_INTRO} It is the <code>agent</code> service of the Docker stack; the terminal says so when it cannot reach it.</p></div>
    <div class="sect">Tips</div><div class="inset"><div class="irow"><span>Small ? marks next to section titles explain them in place<br><span class="hint">Got It hides a mark; this brings all of them back.</span></span><button class="copy" data-action="tips-reset">Reset Tips</button></div></div>
    <div class="hint" style="text-align:center;margin-top:8px">Relay Window reads relays and never writes on its own; every write is a nak command you run.</div></div>`, { wide: true });
}

/** A contextual tip: one callout by the mark, Got it dismisses it for good, Show me runs the matching tour step. */
export function tipPopover(id, anchor) {
  const t = TIPS[id]; if (!t) return;
  openPopover(`<h4>${esc(t.title)}</h4><div style="font-size:13px;margin:4px 0 10px">${esc(t.text)}</div><div class="row"><button class="copy" data-action="tip-dismiss" data-tip="${id}">Got It</button>${t.tour ? `<button class="copy" data-action="tour" data-tour="${t.tour}" data-step="${t.step}">Show Me</button>` : ''}</div>`, anchor);
}
export function dismissTip(id) { if (!settings.tipsDismissed.includes(id)) settings.tipsDismissed.push(id); saveSettings(); closeOverlays(); emit('render'); }
export function resetTips() { settings.tipsDismissed = []; saveSettings(); emit('render'); closeSheet(); }
/** First launch: a welcome card. Skip is remembered; the tour is one click away in Help afterwards. */
export function welcome() {
  tour.start({ id: 'welcome', title: 'Welcome', dismiss: 'Not Now', onDone: () => tour.start(tourById('quick')), steps: [{ label: '', title: 'Welcome to Relay Window', text: 'A window onto your local Nostr relays: watch events arrive, understand any of them, and try things with nak without leaving the app.' + (store.events.size ? '' : ' Nothing has arrived yet, so you can load a small sample set to explore.'), tip: store.events.size ? '' : '<button class="copy" data-action="sample-load">Load Sample Data</button>', cta: 'Take the Two-Minute Tour' }] });
  settings.welcomeDone = true; saveSettings();
}
