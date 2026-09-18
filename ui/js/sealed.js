// Sealed content: which events carry ciphertext, which held identities are a party to them, and what was opened.
// Opening happens in the agent with a held key. The page keeps only what came back, and only until reload.
import { store, relayFor } from './state.js';
import { tag } from './nostr.js';
import { agentJson } from './agent.js';
import { emit } from './bus.js';

const NIP04 = /^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]+$/;
const NIP44 = /^[A-Za-z0-9+/]{90,}={0,2}$/;
const looksNip44 = c => { if (!NIP44.test(c)) return false; try { return atob(c.slice(0, 4)).charCodeAt(0) === 2; } catch { return false; } };

/** 'wrap' (NIP-59 gift wrap), 'seal' (a kind 13 on its own), 'nip04', 'nip44', or null for readable content. */
export function sealedScheme(ev) {
  if (ev.kind === 1059) return 'wrap';
  if (ev.kind === 13) return 'seal';
  if (ev.kind === 4 || NIP04.test(ev.content || '')) return 'nip04';
  return looksNip44(ev.content || '') ? 'nip44' : null;
}
export const isSealed = ev => sealedScheme(ev) !== null;
export const recipient = ev => tag(ev, 'p') || null;
/** Held identities that are a party to the message: the named recipient, or the author. A bare seal names nobody, so every held key may try. */
export function holders(ev) {
  const held = store.identities || []; const p = recipient(ev);
  if (ev.kind === 13) return held;
  return held.filter(i => i.pubkey === p || (ev.kind !== 1059 && i.pubkey === ev.pubkey));
}
export const opened = id => store.opened.get(id);
export async function open(ev) {
  const result = await agentJson('/decrypt', { event: Object.fromEntries(Object.entries(ev).filter(([k]) => !k.startsWith('_'))) });
  store.opened.set(ev.id, result); emit('render'); return result;
}
export function forget(id) { store.opened.delete(id); emit('render'); }
/** The same operation as a terminal command. Nothing secret is in it: the key is named, the agent fills it in. */
export function nakCommand(ev, name) {
  const relay = relayFor(ev) || 'ws://localhost:7777'; const scheme = sealedScheme(ev);
  if (scheme === 'wrap') return `nak req -i ${ev.id} ${relay} | nak gift unwrap --sec $${name}`;
  const me = store.identities.find(i => i.name === name)?.pubkey;
  const counterpart = ev.pubkey === me ? recipient(ev) : ev.pubkey;
  return `nak decrypt '${ev.content}' --sec $${name} -p ${counterpart}${scheme === 'nip04' ? ' --nip04' : ''}`;
}
