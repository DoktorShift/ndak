// Search tokens for the search field and the relay query: free text plus kind:, author:, id:, #tag:, relay:, since:, until:, nip:.
import { decodeCode, isHex32 } from './nostr.js';
import { kindInfo } from './kinds.js';
import { store, relayName } from './state.js';

export const QUERY_HELP = 'kind:1  author:npub…|name  id:hex  #t:tag  tag:name=value  relay:strfry  since:2026-09-17  until:2026-09-18  nip:56  free text';

/** Parse "kind:1 author:alice #t:gold hello" into a structured query. Unknown tokens stay free text. */
export function parseQuery(text) {
  const q = { kinds: [], authors: [], ids: [], tags: [], relays: [], since: null, until: null, nips: [], text: [] };
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(#?[A-Za-z_-]+):(.+)$/.exec(token);
    if (!m) { q.text.push(token.toLowerCase()); continue; }
    const [, key, raw] = m; const value = raw.replace(/^["']|["']$/g, '');
    if (key === 'kind' || key === 'k') value.split(',').forEach(v => { const n = Number(v); if (Number.isFinite(n)) q.kinds.push(n); });
    else if (key === 'author' || key === 'pk' || key === 'from') q.authors.push(resolveAuthor(value));
    else if (key === 'id') q.ids.push(value.startsWith('note1') || value.startsWith('nevent1') ? (decodeCode(value)?.hex || value) : value.toLowerCase());
    else if (key.startsWith('#')) q.tags.push([key.slice(1), value]);
    else if (key === 'tag') { const [n, ...rest] = value.split('='); q.tags.push([n, rest.join('=')]); }
    else if (key === 'relay') q.relays.push(value.toLowerCase());
    else if (key === 'since' || key === 'after') q.since = toUnix(value);
    else if (key === 'until' || key === 'before') q.until = toUnix(value);
    else if (key === 'nip') q.nips.push(value.replace(/^nip-?/i, '').padStart(2, '0'));
    else q.text.push(token.toLowerCase());
  }
  return q;
}
export const isEmpty = q => !q.kinds.length && !q.authors.length && !q.ids.length && !q.tags.length && !q.relays.length && !q.since && !q.until && !q.nips.length && !q.text.length;

function resolveAuthor(value) {
  if (isHex32(value)) return value;
  if (/^(npub1|nprofile1)/.test(value)) return decodeCode(value)?.hex || value;
  const name = value.toLowerCase();
  for (const [pk, p] of store.profiles) if ((p.display_name || '').toLowerCase() === name || (p.name || '').toLowerCase() === name) return pk;
  return value;   // may be a hex prefix
}
function toUnix(value) {
  if (/^\d{9,}$/.test(value)) return Number(value);
  const rel = /^(\d+)([mhd])$/.exec(value);   // 15m, 2h, 3d ago
  if (rel) return Math.floor(Date.now() / 1000) - Number(rel[1]) * { m: 60, h: 3600, d: 86400 }[rel[2]];
  const t = Date.parse(value); return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** Client-side match against the store. */
export function matchesQuery(ev, q, nameOf) {
  if (q.kinds.length && !q.kinds.includes(ev.kind)) return false;
  if (q.authors.length && !q.authors.some(a => ev.pubkey.startsWith(a))) return false;
  if (q.ids.length && !q.ids.some(i => ev.id.startsWith(i))) return false;
  if (q.tags.length && !q.tags.every(([n, v]) => ev.tags.some(t => t[0] === n && (v === '' || String(t[1] || '').toLowerCase().includes(v.toLowerCase()))))) return false;
  if (q.relays.length && !q.relays.some(r => [...(ev._seen || [])].some(u => relayName(u).toLowerCase().includes(r) || u.includes(r)))) return false;
  if (q.since && ev.created_at < q.since) return false;
  if (q.until && ev.created_at > q.until) return false;
  if (q.nips.length && !q.nips.some(n => kindInfo(ev.kind).nips.includes(n))) return false;
  if (q.text.length) {
    const hay = `${ev.id} ${ev.pubkey} ${nameOf(ev.pubkey)} ${ev.content} ${ev.tags.map(t => t.join(' ')).join(' ')}`.toLowerCase();
    if (!q.text.every(t => hay.includes(t))) return false;
  }
  return true;
}

/** The same query as a NIP-01 filter for a relay REQ. Free text becomes a NIP-50 search. */
export function toFilter(q, limit = 200) {
  const f = {};
  if (q.kinds.length) f.kinds = q.kinds;
  if (q.authors.length) f.authors = q.authors.filter(isHex32);
  if (q.ids.length) f.ids = q.ids.filter(isHex32);
  for (const [n, v] of q.tags) if (n.length === 1 && v) (f['#' + n] = f['#' + n] || []).push(v);
  if (q.since) f.since = q.since;
  if (q.until) f.until = q.until;
  if (q.text.length) f.search = q.text.join(' ');
  f.limit = limit;
  return f;
}
