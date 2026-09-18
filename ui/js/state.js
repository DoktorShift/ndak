// Settings (persisted per browser) and the in-memory event store with its indexes.
import { tag, address, replyTo, targetOf, isEphemeral } from './nostr.js';
import { safeJson } from './format.js';
import { ENGAGE, kindInGroup, kindInNip } from './kinds.js';

// ---------- settings ----------
// Names match the GitHub repositories. The relay's NIP-11 name replaces these once connected.
const DEFAULT_RELAYS = [
  { url: 'ws://localhost:7777', name: 'rnostr' },
  { url: 'ws://localhost:7779', name: 'nostr-rs-relay' },
  { url: 'ws://localhost:7780', name: 'strfry' },
  { url: 'ws://localhost:7781', name: 'obelisk-relay' },
  { url: 'ws://localhost:7782', name: 'khatru' },
];
const DEFAULTS = { relays: DEFAULT_RELAYS, active: [DEFAULT_RELAYS[0].url], appearance: 'system', notify: 'local', keep: 5000, relative: false, sidebar: true, limit: 1000, showLive: false, media: true, collapsed: {}, openNips: [], allNips: false, kindsMode: 'seen', feedMode: 'relay', sidebarWidth: 240, detailWidth: 400, terminalHeight: 260, actAs: null, tours: {}, tipsDismissed: [], welcomeDone: false };

export const settings = loadSettings();
function loadSettings() {
  const s = { ...DEFAULTS };
  try { Object.assign(s, JSON.parse(localStorage.getItem('relay-window') || '{}')); } catch { /* private mode or blocked storage */ }
  if (!Array.isArray(s.relays)) s.relays = [];
  for (const d of DEFAULT_RELAYS) if (!s.relays.some(r => r.url === d.url)) s.relays.push({ ...d });  // new defaults join a saved list
  if (!Array.isArray(s.active)) s.active = s.url ? [s.url] : [DEFAULT_RELAYS[0].url];   // older settings kept one url
  if (!s.v) { s.relative = false; s.v = 2; }   // absolute times became the default
  if (s.v < 3) { s.notify = s.notifications === false ? 'off' : 'local'; delete s.notifications; s.v = 3; }   // banners: on/off became a scope
  delete s.url;
  return s;
}
export function saveSettings() { try { localStorage.setItem('relay-window', JSON.stringify(settings)); } catch { /* ignore */ } }
export const relayByUrl = url => settings.relays.find(r => r.url === url);
export const activeUrls = () => settings.active.filter(u => relayByUrl(u));
/** The relay to put into a nak command: where the event was seen, else the first active relay. */
export const relayFor = ev => (ev && ev._seen && [...ev._seen][0]) || activeUrls()[0] || settings.relays[0]?.url || 'ws://localhost:7777';
export const relayName = url => { const r = relayByUrl(url); return r ? (r.name || relayHost(r.url)) : relayHost(url); };
/** Relay label without the protocol prefix, as nostrdesign.org recommends for non-technical readers. */
export const relayHost = url => String(url).replace(/^wss?:\/\//, '').replace(/\/$/, '');
/** A relay on this machine or a private network: one you push events to, as opposed to a public firehose. */
export function isLocalRelay(url) {
  const host = relayHost(url).split('/')[0].replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || host === 'host.docker.internal' || /^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /\.(local|internal|lan)$/.test(host) || !host.includes('.');
}
export const relayLabel = r => r.name || relayHost(r.url);
/** Events that reference this id or address (replies, reactions, receipts, anything with an e, a or q tag). */
export const referencedBy = key => [...(store.refs.get(key) || [])].map(id => store.events.get(id)).filter(Boolean);

// ---------- store ----------
export const store = {
  events: new Map(),     // id -> event
  counts: new Map(),     // kind -> number
  profiles: new Map(),   // pubkey -> parsed kind 0 content (+ _at)
  tiers: new Map(),      // "37001:pubkey:d" -> tier event
  byTarget: new Map(),   // event id -> { reactions, reposts, zaps, replies }
  refs: new Map(),       // referenced id or address -> Set of event ids that point at it (e, a, q tags)
  relayInfo: new Map(),  // url -> NIP-11 document (or null when unavailable)
  log: new Map(),        // url -> protocol messages other than EVENT, newest last
  identities: [],        // [{ name, pubkey, source }] from the agent; never a secret
};
export const revealed = new Set();   // content-warning posts the reader opened
export const expanded = new Set();   // long posts / articles the reader expanded

/** View state that is not persisted. */
export const ui = {
  win: 'social', scope: { type: 'all' }, person: null, personScope: 'all', sbFilter: '', search: '',
  selected: null, inspTab: 'summary', inspOpen: true,   // technical window
  detailId: null, detailTab: 'summary', detailOpen: false, // social details panel
  paused: false, queue: [], watching: false,
  terminalOpen: false,
};

/** Returns 'new', 'seen' (already stored, another relay had it too) or false for a duplicate from the same relay. */
export function addEvent(ev, fresh, url = 'import') {
  const have = store.events.get(ev.id);
  if (have) { if (have._seen.has(url)) return false; have._seen.add(url); return 'seen'; }
  ev._fresh = fresh; ev._seen = new Set([url]); ev._received = Math.floor(Date.now() / 1000);
  store.events.set(ev.id, ev);
  store.counts.set(ev.kind, (store.counts.get(ev.kind) || 0) + 1);
  indexEvent(ev);
  if (store.events.size > settings.keep) evict(store.events.size - settings.keep);
  return true;
}
export function removeEvent(id) {
  const ev = store.events.get(id); if (!ev) return;
  store.events.delete(id);
  const n = store.counts.get(ev.kind) - 1; n ? store.counts.set(ev.kind, n) : store.counts.delete(ev.kind);
  for (const t of ev.tags) if ((t[0] === 'e' || t[0] === 'a' || t[0] === 'q') && t[1]) { const set = store.refs.get(t[1]); if (set) { set.delete(id); if (!set.size) store.refs.delete(t[1]); } }
  if (ev.kind === 37001 && store.tiers.get(address(ev)) === ev) store.tiers.delete(address(ev));
  const target = (ev.kind === 1 || ev.kind === 1111) ? replyTo(ev) : ENGAGE.has(ev.kind) ? targetOf(ev) : null;
  const r = target && store.byTarget.get(target);
  if (r) for (const k of ['reactions', 'zaps', 'replies', 'reposts']) r[k] = r[k].filter(x => x.id !== id);
}
/** Retention: the oldest arrivals leave first (the map keeps insertion order); what is selected stays. */
function evict(n) {
  for (const id of [...store.events.keys()]) { if (n <= 0) break; if (id === ui.selected || id === ui.detailId) continue; removeEvent(id); n--; }
}
export function clearStore() { for (const m of [store.events, store.counts, store.profiles, store.tiers, store.byTarget, store.refs]) m.clear(); }

function indexEvent(ev) {
  if (ev.kind === 0) {
    const p = safeJson(ev.content); const old = store.profiles.get(ev.pubkey);
    if (p && (!old || old._at < ev.created_at)) { p._at = ev.created_at; store.profiles.set(ev.pubkey, p); }
  }
  if (ev.kind === 37001) store.tiers.set(address(ev), ev);
  for (const t of ev.tags) if ((t[0] === 'e' || t[0] === 'a' || t[0] === 'q') && t[1]) { const set = store.refs.get(t[1]) || new Set(); set.add(ev.id); store.refs.set(t[1], set); }
  const isReply = (ev.kind === 1 || ev.kind === 1111) && replyTo(ev);
  if (ENGAGE.has(ev.kind) || isReply) {
    const target = isReply ? replyTo(ev) : targetOf(ev); if (!target) return;
    const r = rollup(target);
    (ev.kind === 7 ? r.reactions : ev.kind === 9735 ? r.zaps : isReply ? r.replies : r.reposts).push(ev);
    store.byTarget.set(target, r);
  }
}

// ---------- derived ----------
export const rollup = id => store.byTarget.get(id) || { reactions: [], reposts: [], zaps: [], replies: [] };
export const profileOf = pk => store.profiles.get(pk) || {};
export const allEvents = () => [...store.events.values()];
export const eventsBy = pk => allEvents().filter(e => e.pubkey === pk);
/** Events that involve a person: written by them, or tagging them with p or P (subscriptions, receipts, zaps, replies, mentions). */
export const mentions = (ev, pk) => ev.tags.some(t => (t[0] === 'p' || t[0] === 'P') && t[1] === pk);
export const relatedTo = pk => allEvents().filter(e => e.pubkey === pk || mentions(e, pk));
/** scope: all (related), by (written by them), about (only tagging them). */
export const inPersonScope = (ev, pk, scope) => scope === 'by' ? ev.pubkey === pk : scope === 'about' ? (ev.pubkey !== pk && mentions(ev, pk)) : (ev.pubkey === pk || mentions(ev, pk));
export const tierTitle = addr => { const t = addr && store.tiers.get(addr); return t ? (tag(t, 'title') || tag(t, 'd')) : (addr || '').split(':').pop(); };
export const isVisibleInTimeline = ev => !ENGAGE.has(ev.kind) && (settings.showLive || !isEphemeral(ev.kind));
/** The sidebar selection: everything, a curated group, a NIP (all its kinds), a single kind or a kind range. */
export function scopeMatches(ev, scope = ui.scope) {
  switch (scope.type) {
    case 'group': return kindInGroup(ev.kind, scope.value);
    case 'nip': return kindInNip(ev.kind, scope.value);
    case 'kind': return ev.kind === scope.value;
    case 'range': return ev.kind >= scope.from && ev.kind <= scope.to;
    case 'relay': return !!ev._seen?.has(scope.value);
    default: return true;
  }
}
export const scopeIs = (type, value) => ui.scope.type === type && (value === undefined || ui.scope.value === value);
