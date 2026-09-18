// What the window knows about event kinds: names, groups for the sidebar, and special cases.
import { isEphemeral, isReplaceable, isAddressable } from './nostr.js';
import { NIPS, KIND_RANGES } from './registry.js';

const LABEL = {
  0: 'Profile', 1: 'Note', 3: 'Follows', 5: 'Deletion', 6: 'Repost', 7: 'Reaction', 13: 'Seal', 16: 'Repost', 20: 'Picture',
  1059: 'Gift wrap', 1063: 'File', 1111: 'Comment', 7001: 'Subscribe', 7002: 'Unsubscribe', 7003: 'Receipt',
  9734: 'Zap request', 9735: 'Zap receipt', 9802: 'Highlight', 10002: 'Relay list', 10050: 'DM relays',
  30023: 'Article', 30078: 'App data', 37001: 'Tier',
  21001: 'CLINK offer', 21002: 'CLINK debit', 21003: 'CLINK manage', 21004: 'CLINK enroll', 21088: 'Key rumor', 21089: 'Key request',
  // NIP-47 Nostr Wallet Connect
  13194: 'Wallet info', 23194: 'Wallet request', 23195: 'Wallet response', 23196: 'Wallet notification', 23197: 'Wallet notification',
  // NIP-29 relay-based groups
  9: 'Group chat', 11: 'Group thread', 9000: 'Group: add user', 9001: 'Group: remove user', 9002: 'Group: edit metadata', 9005: 'Group: delete event',
  9007: 'Group: create', 9008: 'Group: delete', 9009: 'Group: invite', 9010: 'Group: pin list', 9021: 'Group: join request', 9022: 'Group: leave request',
  39000: 'Group metadata', 39001: 'Group admins', 39002: 'Group members', 39003: 'Group roles', 39004: 'Group participants', 39005: 'Group pins',
};
/** Name from our own table first, then the official NIP index (ranges included), then the NIP-01 class. */
export const kindInfo = kind => {
  const row = KIND_RANGES.find(r => kind >= r.from && kind <= r.to);
  return { name: LABEL[kind] || row?.name || null, nips: row?.nips || [], listed: !!row, range: row && row.from !== row.to ? `${row.from}–${row.to}` : null };
};
export const label = kind => kindInfo(kind).name || `Kind ${kind}`;
export const nipTitle = n => NIPS[n]?.title || '';
/** The index's own words for a NIP it no longer recommends, or '' */
export const nipNote = n => NIPS[n]?.deprecated || '';
export const nipUrl = n => `https://github.com/nostr-protocol/nips/blob/master/${NIPS[n]?.file || n + '.md'}`;
export const kindClass = kind => isEphemeral(kind) ? 'ephemeral' : isReplaceable(kind) ? 'replaceable' : isAddressable(kind) ? 'addressable' : 'regular';
/** NIP the kind belongs to: from the index, or our local knowledge for nostr-gate, CLINK and NWC. */
export const LOCAL_NIPS = { 7001: 'nostr-gate (NIP-88)', 7002: 'nostr-gate (NIP-88)', 7003: 'nostr-gate (NIP-88)', 37001: 'nostr-gate (NIP-88)', 21088: 'nostr-gate', 21089: 'nostr-gate', 21001: 'CLINK', 21002: 'CLINK', 21003: 'CLINK', 21004: 'CLINK' };

/** Sidebar groups, in display order: [id, label, glyph]. */
export const GROUPS = [
  ['all', 'Everything', '◎'], ['notes', 'Notes and Articles', '✎'], ['subs', 'Subscriptions and Payments', '⚡︎'],
  ['keys', 'Keys and Sealed Messages', '⚿'], ['groups', 'Groups (NIP-29)', '⌂'], ['nwc', 'NWC (Wallet Connect)', '₿'], ['clink', 'CLINK (Lightning.Pub)', '⚡︎'], ['people', 'Profiles and Relays', '☺'], ['other', 'Other Kinds', '◇'], ['live', 'Live Only', '◦'],
];
const GROUP_KINDS = {
  notes: [1, 6, 16, 20, 30023, 1063, 1111, 9802],
  subs: [37001, 7001, 7002, 7003, 9734, 9735],
  keys: [1059, 13, 21088, 21089],
  clink: [21001, 21002, 21003, 21004, 30078],
  people: [0, 3, 10002, 10050, 5],
  nwc: [13194, 23194, 23195, 23196, 23197],
  groups: [9, 11, 9000, 9001, 9002, 9005, 9007, 9008, 9009, 9010, 9021, 9022, 39000, 39001, 39002, 39003, 39004, 39005],
};
export const COLOR = { subs: 'var(--green)', keys: 'var(--purple)', people: 'var(--teal)', notes: 'var(--blue)', live: 'var(--orange)', groups: 'var(--indigo)', nwc: 'var(--yellow)', clink: 'var(--orange)', other: 'var(--gray)' };
export const groupOf = kind => isEphemeral(kind) ? 'live' : (Object.keys(GROUP_KINDS).find(g => GROUP_KINDS[g].includes(kind)) || 'other');
/** Sidebar filter: a kind can sit in its own group and still count as live-only. */
const grouped = kind => Object.values(GROUP_KINDS).some(list => list.includes(kind));
export const kindInGroup = (kind, g) => g === 'all' ? true : g === 'live' ? isEphemeral(kind) : g === 'other' ? !grouped(kind) && !ENGAGE.has(kind) : (GROUP_KINDS[g] || []).includes(kind);

/** Kinds that must never sit on a relay unwrapped (nostr-gate seals and key rumors). */
export const ALARM = new Set([13, 21088]);
/** Kinds shown as rollups under their target instead of as posts. */
export const ENGAGE = new Set([7, 6, 16, 9735]);

/** What a tag means, for the inspector. Single letters are indexable per NIP-01. */
const TAG_MEANINGS = {
  e: ['event reference', '01, 10'], p: ['pubkey reference', '01'], a: ['addressable event reference kind:pubkey:d', '01'], d: ['identifier of an addressable event', '01'], q: ['quoted event', '18'],
  t: ['hashtag', '24'], r: ['reference: URL or relay', '24, 65'], g: ['geohash', '52'], i: ['external identity', '39, 73'], k: ['kind being referenced', '18, 25, 72'], l: ['label', '32'], L: ['label namespace', '32'],
  h: ['group id (NIP-29)', '29'], x: ['file hash', '35, 94'], m: ['MIME type', '94'], u: ['URL', '98'], w: ['warning', ''], I: ['external content id', '73'],
  alt: ['human-readable summary for clients that cannot render the kind', '31'], amount: ['amount (msats or sats) and period', '57, 88'], bolt11: ['Lightning invoice', '57'], preimage: ['payment preimage', '57'], description: ['zap request JSON', '57'],
  relay: ['relay URL', '17, 42'], relays: ['relay URLs', '57'], challenge: ['AUTH challenge', '42'], subject: ['subject line', '14'], title: ['title', '23'], summary: ['summary', '23'], image: ['image URL', '23'], published_at: ['first publication time', '23'],
  expiration: ['unix time after which relays drop the event', '40'], 'content-warning': ['sensitive content reason', '36'], emoji: ['custom emoji shortcode and URL', '30'], imeta: ['inline media metadata', '92'], client: ['client that created the event', '89'], proxy: ['bridged from another protocol', '48'],
  nonce: ['proof of work', '13'], delegation: ['delegation token', '26'], '-': ['protected: only the author may publish it', '70'], encryption: ['encryption scheme', '44, 47'], notifications: ['supported notifications', '47'],
  name: ['name', '29, 51'], about: ['description', '29'], picture: ['picture URL', '29'], previous: ['previous event ids', '29'], parent: ['parent group', '29'], child: ['child group', '29'], public: ['group is readable by anyone', '29'], private: ['group content is members-only', '29'], open: ['anyone can join', '29'], closed: ['joining needs approval', '29'], role: ['group role', '29'], code: ['invite code', '29'],
  perk: ['membership perk (nostr-gate)', '88'], valid: ['receipt validity from, to (nostr-gate)', '88'], tier: ['tier id (nostr-gate)', '88'], gate_payment: ['settlement reference (nostr-gate)', ''], gate_amount: ['settled amount in sats (nostr-gate)', ''], gate_epoch: ['content key epoch (nostr-gate)', ''], gate_v: ['nostr-gate version', ''], preview: ['free preview text (nostr-gate)', ''], P: ['secondary pubkey: payer, zap sender', '57, 88'],
  url: ['URL', '94'], size: ['size in bytes', '94'], dim: ['dimensions', '94'], blurhash: ['blurhash placeholder', '94'], thumb: ['thumbnail URL', '94'], ox: ['original file hash', '94'], magnet: ['magnet link', '94'],
};
export const tagMeaning = name => TAG_MEANINGS[name] || (name.length === 1 ? ['single-letter tag: indexable, meaning defined by the kind', '01'] : ['not in our table', '']);

/** Local kind families that are not in the NIP index yet. They appear in the catalogue like a NIP. */
const LOCAL_FAMILIES = [
  { nip: 'gate', title: 'nostr-gate subscriptions (draft NIP-88)', rows: [{ from: 37001, to: 37001, name: 'Tier' }, { from: 7001, to: 7001, name: 'Subscribe' }, { from: 7002, to: 7002, name: 'Unsubscribe' }, { from: 7003, to: 7003, name: 'Receipt' }, { from: 21088, to: 21088, name: 'Key rumor' }, { from: 21089, to: 21089, name: 'Key request' }] },
  { nip: 'clink', title: 'CLINK (Lightning.Pub)', rows: [{ from: 21001, to: 21001, name: 'Offer' }, { from: 21002, to: 21002, name: 'Debit' }, { from: 21003, to: 21003, name: 'Manage' }, { from: 21004, to: 21004, name: 'Enroll' }, { from: 30078, to: 30078, name: 'Node beacon (app data)' }] },
];
let catalogueCache = null;
/** Every NIP that defines kinds, with its kind rows (single kinds and ranges), sorted by NIP number; local families last. */
export function nipCatalogue() {
  if (catalogueCache) return catalogueCache;
  const byNip = new Map();
  for (const row of KIND_RANGES) for (const n of row.nips) { const e = byNip.get(n) || { nip: n, title: NIPS[n]?.title || '', note: NIPS[n]?.deprecated || '', rows: [] }; e.rows.push(row); byNip.set(n, e); }
  const list = [...byNip.values()].sort((a, b) => (parseInt(a.nip, 10) || 999) - (parseInt(b.nip, 10) || 999) || a.nip.localeCompare(b.nip));
  for (const e of list) e.rows.sort((a, b) => a.from - b.from);
  catalogueCache = [...list, ...LOCAL_FAMILIES];
  return catalogueCache;
}
export const kindInNip = (kind, nip) => (nipCatalogue().find(e => e.nip === nip)?.rows || []).some(r => kind >= r.from && kind <= r.to);
