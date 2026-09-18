// Identities live in the agent: it mints keys, keeps them in a file on this Mac and signs with them.
// The page only ever sees names and public keys. "Acting as" picks which name write commands sign with.
import { store, settings, saveSettings } from './state.js';
import { emit } from './bus.js';

const AGENT = 'http://127.0.0.1:7790';
export let available = false;

export async function refresh() {
  try { const r = await fetch(`${AGENT}/identities`); const data = await r.json(); store.identities = data.identities || []; available = true; }
  catch { store.identities = []; available = false; }
  if (settings.actAs && !store.identities.some(i => i.name === settings.actAs)) { settings.actAs = null; saveSettings(); }
  emit('identities');
}
export const acting = () => store.identities.find(i => i.name === settings.actAs) || null;
export function actAs(name) { settings.actAs = name; saveSettings(); emit('identities'); }

export async function create(payload) {
  const r = await fetch(`${AGENT}/identities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || r.statusText);
  await refresh(); return data;
}
export async function remove(name) {
  const r = await fetch(`${AGENT}/identities/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || r.statusText);
  if (settings.actAs === name) settings.actAs = null;
  await refresh();
}
/** Write commands carry "--sec <nsec>"; with an acting identity they sign as it, and the agent substitutes the key. */
export const withIdentity = cmd => { const a = acting(); return a ? cmd.replace(/--sec <nsec>/g, `--sec $${a.name}`) : cmd; };
