// Sidebar: one macOS-style source list. A filter field on top narrows every section; sections collapse;
// rows are 26pt with an accent-coloured symbol, a label and a count. Relay first, the long People list last.
import { esc, plural } from '../format.js';
import { label, GROUPS, kindInGroup, ENGAGE, nipCatalogue, kindInNip } from '../kinds.js';
import { isEphemeral } from '../nostr.js';
import { store, ui, settings, saveSettings, allEvents, relatedTo, isVisibleInTimeline, relayHost, relayLabel, scopeIs } from '../state.js';
import * as relay from '../relay.js';
import { npub as npubOf } from '../people.js';
import { nameOf, avatar, npub } from '../people.js';

const $ = id => document.getElementById(id);
/** One family of 16pt line icons, drawn like SF Symbols, so every row reads the same way. */
const SVG = d => `<svg class="sym" viewBox="0 0 16 16">${d}</svg>`;
const ICONS = {
  all: SVG('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/>'),
  notes: SVG('<path d="M3 13l1-3.5L11.5 2 14 4.5 6.5 12z"/><path d="M10.5 3l2.5 2.5"/>'),
  subs: SVG('<path d="M9 1.5 3.5 9H7.5L7 14.5 12.5 7H8.5z"/>'),
  keys: SVG('<circle cx="5.5" cy="10.5" r="3"/><path d="M8 8l6-6M11 5l2 2M9.5 6.5 11 8"/>'),
  groups: SVG('<circle cx="5.5" cy="6" r="2.2"/><circle cx="11" cy="6" r="2.2"/><path d="M1.5 13c.4-2.4 2-3.7 4-3.7s3.6 1.3 4 3.7M8.5 12.5c.5-2 1.7-3.2 3.3-3.2 1.4 0 2.4 1 2.7 3.2"/>'),
  nwc: SVG('<rect x="1.5" y="4" width="13" height="9" rx="2"/><path d="M1.5 7h13M10.5 10.5h1.5"/>'),
  clink: SVG('<path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"/>'),
  people: SVG('<circle cx="8" cy="5.5" r="2.7"/><path d="M2.5 14c.7-3 2.8-4.5 5.5-4.5s4.8 1.5 5.5 4.5"/>'),
  other: SVG('<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2.5 2"/>'),
  live: SVG('<path d="M2 8c1.5-2.5 3-2.5 4.5 0s3 2.5 4.5 0 3-2.5 4.5 0"/>'),
  everyone: SVG('<circle cx="5.5" cy="6" r="2.2"/><circle cx="11" cy="6" r="2.2"/><path d="M1.5 13c.4-2.4 2-3.7 4-3.7s3.6 1.3 4 3.7M8.5 12.5c.5-2 1.7-3.2 3.3-3.2 1.4 0 2.4 1 2.7 3.2"/>'),
  plus: SVG('<path d="M8 3v10M3 8h10"/>'),
  hash: SVG('<path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10h11"/>'),
  kind: SVG('<circle cx="8" cy="8" r="2.5"/>'),
  kindOff: SVG('<circle cx="8" cy="8" r="2.5" stroke-dasharray="1.5 1.5"/>'),
  nip: SVG('<path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13"/>'),
  chevron: SVG('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
  more: SVG('<circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/>'),
};

const row = ({ action, data = '', icon, text, badge, pressed = false, title = '' }) =>
  `<button class="sb-row" data-action="${action}" ${data} aria-pressed="${pressed}" ${title ? `title="${esc(title)}"` : ''}>${icon}<span class="lbl">${text}</span>${badge !== undefined ? `<span class="badge">${badge}</span>` : ''}</button>`;
const glyph = name => `<span class="ic">${ICONS[name] || ICONS.kind}</span>`;
const tipMark = id => settings.tipsDismissed.includes(id) ? '' : `<span class="tipmark" data-action="tip" data-tip="${id}" role="button" aria-label="About ${id}">?</span>`;
const header = (id, text) => `<button class="sb-h" data-action="section" data-section="${id}" aria-expanded="${!settings.collapsed[id]}"><span>${text}${tipMark(id)}</span><span class="disc">${settings.collapsed[id] ? 'Show' : 'Hide'}</span></button>`;

/** A section renders its rows only when expanded; while filtering, every section is forced open and empty ones vanish. */
function section(id, text, rows, filtering) {
  if (filtering && !rows.length) return '';
  const open = filtering || !settings.collapsed[id];
  return `<div class="sb-section">${header(id, text)}${open ? rows.join('') : ''}</div>`;
}
const matches = (q, ...texts) => !q || texts.some(t => String(t || '').toLowerCase().includes(q));

export function renderSidebar() {
  const q = ui.sbFilter.trim().toLowerCase(); const filtering = !!q;
  const all = allEvents();
  let html = relaySection(q, filtering) + identitiesSection(q, filtering);
  html += showSection(all, q, filtering) + kindsSection(all, q, filtering);
  if (ui.win === 'social') html += peopleSection(all, q, filtering);
  if (filtering && !html) html = '<div class="sb-empty">Nothing matches</div>';
  $('sbScroll').innerHTML = html;
  $('sbFilterBox').classList.toggle('has', filtering);
}

/** Identities the agent holds: click opens the profile, right-click for Act as and more. The last row mints a new one. */
function identitiesSection(q, filtering) {
  const rows = store.identities.filter(i => matches(q, i.name, nameOf(i.pubkey), npubOf(i.pubkey))).map(i => {
    const acting = settings.actAs === i.name;
    const shown = nameOf(i.pubkey); const hasName = shown !== i.name && !shown.startsWith('npub1');
    return row({ action: 'act-as', data: `data-name="${esc(i.name)}" data-pubkey="${i.pubkey}" data-identity="${esc(i.name)}" data-acting="${acting}"`, icon: avatar(i.pubkey, 's'), text: `${esc(i.name)}${hasName ? ` <span class="muted">${esc(shown)}</span>` : ''}<span class="sub">${esc(npubOf(i.pubkey).slice(0, 16))}…${i.source === 'demo' ? ' · demo key' : ''}</span>`, badge: acting ? 'acting' : undefined, pressed: false, title: `Click to act as ${i.name}. ··· for profile, nak commands and removal.` })
      .replace('</button>', `<span class="rowmenu" data-action="identity-menu" data-name="${esc(i.name)}" data-pubkey="${i.pubkey}" role="button" aria-label="More for ${esc(i.name)}">${ICONS.more}</span></button>`);
  });
  if (!filtering || matches(q, 'new identity')) rows.push(row({ action: 'identity-new', icon: glyph('plus'), text: 'New Identity…', pressed: false }));
  return section('identities', 'Identities', rows, filtering);
}

/** One row per known relay: dot for its state, events seen from it as the count. Click toggles the connection. */
function relaySection(q, filtering) {
  const all = allEvents();
  const rows = settings.relays.filter(r => matches(q, relayLabel(r), r.url, 'relay')).map(r => {
    const state = relay.stateOf(r.url); const want = settings.active.includes(r.url); const seen = all.filter(ev => ev._seen?.has(r.url)).length;
    const dot = state === 'live' ? 'on' : state === 'off' || state === 'error' ? (want ? 'err' : '') : 'busy';
    const sub = state === 'live' ? `${relayHost(r.url)}` : state === 'off' ? (want ? 'not reachable' : 'off') : state;
    return row({ action: 'relay-scope', data: `data-url="${esc(r.url)}"`, icon: `<span class="ic"><span class="dotbtn" data-action="relay-toggle" data-url="${esc(r.url)}" role="button" title="${want ? 'Connected: click to disconnect' : 'Off: click to connect'}"><span class="dot ${dot}"></span></span></span>`, text: `${esc(relayLabel(r))}<span class="sub">${esc(sub)}</span>`, badge: seen || undefined, pressed: scopeIs('relay', r.url), title: `Show only events seen on ${relayLabel(r)}. The dot connects or disconnects.` })
      .replace('</button>', `<span class="rowmenu" data-action="relay-more" data-url="${esc(r.url)}" role="button" aria-label="More for ${esc(relayLabel(r))}">${ICONS.more}</span></button>`);
  });
  return section('relay', 'Relays', rows, filtering);
}

function showSection(all, q, filtering) {
  const rows = GROUPS.filter(([g, text]) => matches(q, text, g)).map(([g, text]) => {
    const technical = ui.win === 'technical';   // the table lists every event; the timeline folds engagement kinds into their posts
    const n = all.filter(ev => (technical || !ENGAGE.has(ev.kind)) && (g === 'all' ? (technical || settings.showLive || !isEphemeral(ev.kind)) : kindInGroup(ev.kind, g))).length;
    return row({ action: 'group', data: `data-group="${g}"`, icon: glyph(g), text, badge: n, pressed: g === 'all' ? scopeIs('all') : scopeIs('group', g) });
  });
  return section('show', 'Show', rows, filtering);
}

/** Kinds, one section with two views: the flat list of kinds seen (with counts), or the catalogue grouped by NIP. */
function kindsSection(all, q, filtering) {
  const mode = settings.kindsMode;
  const seg = `<span class="seg mini" role="group" aria-label="Kinds view"><button data-action="kinds-mode" data-mode="seen" aria-pressed="${mode === 'seen'}">Seen</button><button data-action="kinds-mode" data-mode="nip" aria-pressed="${mode === 'nip'}">By NIP</button></span>`;
  let rows = mode === 'seen' ? seenRows(q) : nipRows(all, q, filtering);
  if (filtering && mode === 'seen' && !rows.length) rows = nipRows(all, q, true);   // a NIP nobody has used yet is still findable
  if (filtering && !rows.length) return '';
  const open = filtering || !settings.collapsed.kinds;
  return `<div class="sb-section"><div class="sb-hrow">${header('kinds', 'Kinds')}${open ? seg : ''}</div>${open ? rows.join('') : ''}</div>`;
}
/** A kind row: the number set apart so it never reads as a count. */
const rowHtml = r => `<span class="kn">${r.from === r.to ? r.from : `${r.from}–${r.to}`}</span> ${esc(r.name)}`;
function seenRows(q) {
  const kinds = [...store.counts.keys()].sort((a, b) => a - b).filter(k => matches(q, String(k), label(k)));
  return [...(matches(q, 'all kinds') ? [row({ action: 'kind', data: 'data-kind="all"', icon: glyph('hash'), text: 'All kinds', badge: store.events.size, pressed: scopeIs('all') })] : []),
    ...kinds.map(k => row({ action: 'kind', data: `data-kind="${k}"`, icon: glyph(isEphemeral(k) ? 'live' : 'kind'), text: `<span class="kn">${k}</span> ${esc(label(k))}`, badge: store.counts.get(k), pressed: scopeIs('kind', k) }))];
}

/** The whole catalogue from the NIP index: a NIP row filters to all its kinds, its disclosure reveals the kinds (seen ones carry counts).
 *  NIPs without events stay hidden until "Show all NIPs" is on or the filter field mentions them. */
function nipRows(all, q, filtering) {
  const open = new Set(settings.openNips); const counts = store.counts;
  const countFor = e => all.filter(ev => kindInNip(ev.kind, e.nip)).length;
  const rowMatches = (e, r) => matches(q, `nip-${e.nip}`, `nip${e.nip}`, e.nip, e.title, r.name, String(r.from));
  const nips = nipCatalogue().map(e => ({ e, n: countFor(e), hit: matches(q, `nip-${e.nip}`, `nip${e.nip}`, e.nip, e.title) || e.rows.some(r => rowMatches(e, r)) }))
    .filter(x => x.hit && (filtering || settings.allNips || x.n > 0 || scopeIs('nip', x.e.nip)));
  const rows = [];
  for (const { e, n } of nips) {
    const label = /^\d+$/.test(e.nip) ? `NIP-${e.nip}` : '';
    const isOpen = open.has(e.nip) || (filtering && e.rows.some(r => !matches(q, e.nip, e.title) && rowMatches(e, r)));
    rows.push(`<div class="sb-nip"><button class="disc-btn" data-action="nip-toggle" data-nip="${esc(e.nip)}" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Hide' : 'Show'} kinds of ${esc(label || e.title)}">${ICONS.chevron}</button>${row({ action: 'nip', data: `data-nip="${esc(e.nip)}"`, icon: glyph('nip'), text: `${label ? `<b>${label}</b> ` : ''}${esc(e.title)}${e.note ? ' <span class="note">· deprecated</span>' : ''}`, badge: n || undefined, pressed: scopeIs('nip', e.nip), title: e.note ? `${e.title} · ${e.note}` : `every kind that NIP-${e.nip} defines` })}</div>`);
    if (isOpen) for (const r of e.rows) {
      const seen = r.from === r.to ? (counts.get(r.from) || 0) : [...counts.entries()].filter(([k]) => k >= r.from && k <= r.to).reduce((a, [, c]) => a + c, 0);
      const pressed = r.from === r.to ? scopeIs('kind', r.from) : (ui.scope.type === 'range' && ui.scope.from === r.from);
      rows.push(row({ action: r.from === r.to ? 'kind' : 'range', data: r.from === r.to ? `data-kind="${r.from}"` : `data-from="${r.from}" data-to="${r.to}"`, icon: glyph(seen ? 'kind' : 'kindOff'), text: `<span class="${seen ? '' : 'muted'}">${rowHtml(r)}</span>`, badge: seen || undefined, pressed, title: seen ? '' : 'no events of this kind loaded' }).replace('class="sb-row"', 'class="sb-row sub"'));
    }
  }
  if (!filtering) rows.push(row({ action: 'nips-all', icon: glyph('plus'), text: settings.allNips ? 'Only NIPs with events' : `Show all ${nipCatalogue().length} NIPs`, pressed: false }));
  return rows;
}

function peopleSection(all, q, filtering) {
  const people = [...new Set(all.map(ev => ev.pubkey))].filter(pk => matches(q, nameOf(pk), npub(pk), pk)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const rows = [...(matches(q, 'everyone') ? [row({ action: 'person', data: 'data-pubkey=""', icon: glyph('everyone'), text: 'Everyone', pressed: false })] : []),
    ...people.map(pk => row({ action: 'person', data: `data-pubkey="${pk}"`, icon: avatar(pk, 's'), text: esc(nameOf(pk)), badge: relatedTo(pk).filter(isVisibleInTimeline).length, pressed: ui.person === pk, title: npub(pk) }))];
  return section('people', 'People', rows, filtering);
}
