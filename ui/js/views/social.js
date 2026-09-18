// Social window: the timeline, profile pages, the live ticker, conversations and the details side panel.
import { tag, tags, replyTo, isEphemeral } from '../nostr.js';
import { esc, stripHtml, fmtDate, ago, fmtTime, dayLabel, bolt11Sats, plural } from '../format.js';
import { ENGAGE } from '../kinds.js';
import { store, ui, settings, revealed, expanded, rollup, allEvents, eventsBy, relatedTo, inPersonScope, profileOf, isVisibleInTimeline, scopeMatches, scopeIs, activeUrls } from '../state.js';
import { nameOf, handle, npub, avatar } from '../people.js';
import { describe } from '../describe.js';
import { inspectorHtml, ICON } from './inspector.js';
import { openSheet } from './overlays.js';
import { clientRows, clientPostHtml, clientProfileHeader } from './client.js';
import { parseQuery, matchesQuery } from '../query.js';

const $ = id => document.getElementById(id);

let parsed = { text: '', q: null };
export function matchesSearch(ev) {
  if (!ui.search) return true;
  if (parsed.text !== ui.search) parsed = { text: ui.search, q: parseQuery(ui.search) };
  return matchesQuery(ev, parsed.q, nameOf);
}

const FEED_MAX = 300;   // the timeline stays quick with thousands of posts

export function renderSocial() {
  const all = allEvents();
  let rows = all.filter(ev => (ui.scope.type === 'all' ? isVisibleInTimeline(ev) : !ENGAGE.has(ev.kind) && scopeMatches(ev)) && (!ui.person || inPersonScope(ev, ui.person, ui.personScope)) && matchesSearch(ev)).sort((a, b) => b.created_at - a.created_at);
  const total = rows.length; if (total > FEED_MAX) rows = rows.slice(0, FEED_MAX);
  const client = settings.feedMode === 'client';
  let out = modeSwitch(client);
  if (ui.person) out += client ? clientProfileHeader(ui.person) + scopeBar(ui.person) : profileHeader(ui.person);
  else out += tickerHtml(all);
  const shown = client ? clientRows(rows) : rows;
  if (!shown.length) out += client && rows.length ? hiddenByClientView(rows.length) : emptyState();
  let day = '';
  for (const ev of shown) {
    const d = dayLabel(ev.created_at);
    if (d !== day) { day = d; out += `<div class="dayhdr"><span>${esc(d)}</span></div>`; }
    out += client ? clientPostHtml(ev) : postHtml(ev);
  }
  if (total > FEED_MAX) out += `<div class="feedmore">Showing the latest ${FEED_MAX} of ${total.toLocaleString()} posts. Narrow the timeline with the sidebar or the search field.</div>`;
  $('feed').innerHTML = out;
  renderDetails();
}

/** Relay View explains every event; Client View shows the feed as a full-featured client would. */
function modeSwitch(client) {
  return `<div class="feedmode"><div class="seg" role="group" aria-label="Feed style"><button data-action="feedmode" data-mode="relay" aria-pressed="${!client}">Relay View</button><button data-action="feedmode" data-mode="client" aria-pressed="${client}">Client View</button></div><span class="hint">${client ? 'As a client would show it: relay-only kinds hidden, replies folded, media embedded.' : 'Every event, explained.'}</span></div>`;
}

/** The selection has events, but none of a kind a social client shows as a post. */
function hiddenByClientView(n) {
  return `<div class="empty"><div class="glyph">${ICON.relay}</div><h3>${n} matching ${n === 1 ? 'event' : 'events'}, none a client would show as a post</h3><div>Moderation, lists, receipts and other protocol events only appear in Relay View.</div><div style="margin-top:12px"><button class="cprimary secondary" data-action="feedmode" data-mode="relay">Switch to Relay View</button></div></div>`;
}

function emptyState() {
  const connected = ui.watching || store.events.size;
  if (store.events.size) return `<div class="empty"><div class="glyph">${ICON.relay}</div><h3>Nothing matches</h3><div>Try another filter or clear the search.</div></div>`;
  if (!connected) return `<div class="empty"><div class="glyph">${ICON.relay}</div><h3>Not connected</h3><div>Pick a relay in the toolbar pop-up (R) or check that the relays are running.</div></div>`;
  const where = activeUrls().length === 1 ? 'this relay' : 'these relays';
  return `<div class="empty"><div class="glyph">${ICON.relay}</div><h3>Nothing on ${where} yet</h3><div>Publish something with nak and it appears here as it arrives. The seed fills the relays with a small conversation: <code>docker compose --profile seed run --rm seed</code></div><div class="row" style="margin-top:12px"><button class="copy" data-action="sample-load">Load Sample Data</button></div></div>`;
}

/** Ephemeral events scroll past in a ticker above the timeline unless the reader chose to see them inline. */
function tickerHtml(all) {
  if (settings.showLive || scopeIs('group', 'live')) return '';
  const live = all.filter(ev => isEphemeral(ev.kind)).sort((a, b) => b.created_at - a.created_at).slice(0, 5);
  if (!live.length) return '';
  return `<div class="ticker"><span class="ldot"></span><div class="items">${live.map(ev => `<span><b>${esc(nameOf(ev.pubkey))}</b> ${esc(stripHtml(describe(ev).verb))} · ${esc(ago(ev.created_at))}</span>`).join('')}</div><button class="chip" data-action="group" data-group="live">Live only</button></div>`;
}

function postHtml(ev, opts = {}) {
  const s = describe(ev); const r = rollup(ev.id);
  const warning = tag(ev, 'content-warning'); const hidden = warning !== undefined && !revealed.has(ev.id);
  const long = (s.body || '').length > 700 && !expanded.has(ev.id);
  const content = hidden
    ? `<div class="cw">⚠︎ ${esc(warning || 'Content warning')}<button class="chip" data-action="reveal" data-id="${ev.id}">Show</button></div>`
    : `${s.body ? `<div class="body${long ? ' clamp' : ''}">${s.body}</div>${long ? `<button class="more-btn" data-action="expand" data-id="${ev.id}">Show more</button>` : ''}` : ''}${mediaHtml(s.media)}${s.card}`;
  const time = settings.relative ? ago(ev.created_at) : fmtTime(ev.created_at);
  const classes = ['post', ev._fresh ? 'fresh' : '', opts.focus ? 'focus' : '', opts.reply ? 'reply' : ''].filter(Boolean).join(' ');
  return `<article class="${classes}" data-id="${ev.id}" aria-selected="${ui.detailOpen && ui.detailId === ev.id}">
    <button class="avb" data-action="profile" data-pubkey="${ev.pubkey}" aria-label="Profile">${avatar(ev.pubkey, 'm')}</button>
    <div><div class="head"><button class="name" data-action="profile" data-pubkey="${ev.pubkey}">${esc(nameOf(ev.pubkey))}</button>${nameOf(ev.pubkey) === handle(ev.pubkey) ? '' : `<span class="handle">${esc(handle(ev.pubkey))}</span>`}<span class="verb">${s.verb}</span><span class="time" title="${esc(fmtDate(ev.created_at))}">· ${esc(time)}</span></div>
      ${s.context}${content}${s.pills.length ? `<div class="pills">${s.pills.join('')}</div>` : ''}${engagementHtml(ev, r)}</div>
    <div class="side"><button class="iconbtn" data-action="details" data-id="${ev.id}" title="Details (I)" aria-pressed="${ui.detailOpen && ui.detailId === ev.id}">${ICON.info}</button><button class="iconbtn" data-action="menu" data-id="${ev.id}" aria-label="More" aria-haspopup="menu">···</button></div></article>`;
}

function mediaHtml(list) {
  if (!list.length) return '';
  return `<div class="media${list.length === 1 ? ' one' : ''}">${list.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img alt="" src="${esc(u)}" loading="lazy"></a>`).join('')}</div>`;
}

function engagementHtml(ev, r) {
  if (!(r.reactions.length || r.reposts.length || r.zaps.length || r.replies.length)) return '';
  const sats = r.zaps.reduce((n, z) => n + bolt11Sats(tag(z, 'bolt11')), 0);
  const faces = [...new Set(r.reactions.map(x => x.content === '+' || !x.content ? '❤️' : x.content))].slice(0, 3).join('');
  return `<div class="engage">${r.replies.length ? `<button data-action="thread" data-id="${ev.id}">💬 ${r.replies.length}</button>` : ''}${r.reposts.length ? `<span>🔁 ${r.reposts.length}</span>` : ''}${r.reactions.length ? `<span>${faces} ${r.reactions.length}</span>` : ''}${r.zaps.length ? `<span class="z">⚡︎ ${sats ? sats.toLocaleString() + ' sats' : r.zaps.length}</span>` : ''}</div>`;
}

/** The scope bar alone, for the client profile page. */
function scopeBar(pk) {
  const related = relatedTo(pk).filter(isVisibleInTimeline); const by = related.filter(e => e.pubkey === pk).length;
  const btn = (id, text, n) => `<button data-action="scope" data-scope="${id}" aria-pressed="${ui.personScope === id}">${text} <span class="muted">${n}</span></button>`;
  return `<div class="scope standalone"><div class="seg" role="group" aria-label="Which events">${btn('all', 'Everything', related.length)}${btn('by', 'By them', by)}${btn('about', 'About them', related.length - by)}</div></div>`;
}

function profileHeader(pk) {
  const p = profileOf(pk); const mine = eventsBy(pk); const related = relatedTo(pk);
  // Scope counts only count what the timeline can show, so the numbers match the posts below.
  const shown = related.filter(isVisibleInTimeline); const shownBy = shown.filter(e => e.pubkey === pk).length; const shownAbout = shown.length - shownBy;
  const tiers = mine.filter(e => e.kind === 37001).length, subs = mine.filter(e => e.kind === 7001).length;
  const receipts = allEvents().filter(e => e.kind === 7003 && tag(e, 'P') === pk).length;
  const subscribers = new Set(allEvents().filter(e => e.kind === 7003 && tag(e, 'p') === pk).map(e => tag(e, 'P'))).size;
  const relays = mine.filter(e => e.kind === 10002).sort((a, b) => b.created_at - a.created_at)[0];
  const stat = (n, word) => n ? `<span><b>${n}</b> ${word}${n === 1 ? '' : 's'}</span>` : '';
  const scopeBtn = (id, text, n) => `<button data-action="scope" data-scope="${id}" aria-pressed="${ui.personScope === id}">${text} <span class="muted">${n}</span></button>`;
  const scope = `<div class="scope"><div class="seg" role="group" aria-label="Which events">${scopeBtn('all', 'Everything', shown.length)}${scopeBtn('by', 'By them', shownBy)}${scopeBtn('about', 'About them', shownAbout)}</div></div>`;
  return `<div class="profilehdr"><div class="banner" style="${p.banner && settings.media ? `background-image:url(${esc(p.banner)})` : ''}"></div><div class="ph">${avatar(pk, 'l')}<h2>${esc(nameOf(pk))}</h2><div class="hd">${esc(npub(pk))}</div>${p.about ? `<div class="about">${esc(p.about)}</div>` : ''}
    <div class="stats"><span><b>${shown.length}</b> related events</span>${stat(tiers, 'tier published')}${stat(subscribers, 'paying subscriber')}${stat(subs, 'subscription')}${stat(receipts, 'payment receipt')}</div>${scope}
    <div class="links">${p.nip05 ? `<span class="chip" title="NIP-05 address. It is a label, not a verification.">@ ${esc(p.nip05)}</span>` : ''}${p.lud16 ? `<span class="chip">⚡︎ ${esc(p.lud16)}</span>` : ''}${p.website ? `<a class="chip" href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, ''))}</a>` : ''}${relays ? tags(relays, 'r').slice(0, 4).map(t => `<span class="chip" title="relay from their NIP-65 list">${esc(t[1].replace(/^wss?:\/\//, ''))}</span>`).join('') : ''}<button class="chip" data-action="copy" data-text="${npub(pk)}">Copy npub</button><button class="chip" data-action="profile-nak" data-pubkey="${pk}">nak Commands…</button></div></div></div>`;
}

export function openThread(id) {
  const ev = store.events.get(id); if (!ev) return;
  const parent = replyTo(ev) && store.events.get(replyTo(ev));
  const replies = allEvents().filter(e => (e.kind === 1 || e.kind === 1111) && replyTo(e) === id).sort((a, b) => a.created_at - b.created_at);
  openSheet('Conversation', `<div class="thread">${parent ? postHtml(parent) : ''}${postHtml(ev, { focus: true })}${replies.map(r => postHtml(r, { reply: true })).join('')}</div>`);
}

/** The details panel beside the timeline: the inspector for one post, without leaving Social. */
export function renderDetails() {
  const panel = $('detail'); const ev = ui.detailId && store.events.get(ui.detailId);
  $('social').classList.toggle('insp', ui.detailOpen);
  $('detailsBtn').setAttribute('aria-pressed', ui.detailOpen);
  if (!ui.detailOpen) return;
  panel.innerHTML = ev ? inspectorHtml(ev, ui.detailTab, 'detail')
    : `<div class="insp-h"><div><div class="k">Details</div><div class="m">Select a post</div></div><div class="tools"><button class="iconbtn" data-action="close-details" title="Close">${ICON.close}</button></div></div><div class="empty"><div class="glyph">${ICON.info}</div><h3>No post selected</h3><div>Click ⓘ on a post, or click a post and press I.</div></div>`;
}
