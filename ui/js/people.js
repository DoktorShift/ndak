// Names, handles and avatars for pubkeys. Display name first, then a truncated npub (never a bare hex).
import { npubEncode, isHex32 } from './nostr.js';
import { esc, shortHex } from './format.js';
import { store } from './state.js';

const npubCache = new Map();
export function npub(hex) {
  if (!isHex32(hex)) return hex ? shortHex(hex) : '?';
  if (!npubCache.has(hex)) npubCache.set(hex, npubEncode(hex));
  return npubCache.get(hex);
}
export const handle = hex => { const n = npub(hex); return n.length > 20 ? n.slice(0, 12) + '…' + n.slice(-4) : n; };
export function nameOf(pk) { const p = store.profiles.get(pk); return p && (p.display_name || p.name) ? (p.display_name || p.name) : handle(pk); }
const hue = hex => parseInt((hex || '00').slice(0, 6), 16) % 360;

/** size: s (18px), s32 (32px), m (44px), l (72px). Falls back to coloured initials when there is no picture. */
export function avatar(pk, size) {
  const p = store.profiles.get(pk);
  if (p && p.picture) return `<span class="av ${size}"><img alt="" src="${esc(p.picture)}" loading="lazy"></span>`;
  const initials = nameOf(pk).replace('npub1', '').slice(0, 2).toUpperCase();
  return `<span class="av ${size}" style="background:hsl(${hue(pk)} 55% 50%)">${esc(initials)}</span>`;
}
