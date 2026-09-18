// Opens sealed content with a held key: NIP-04 messages, NIP-44 payloads and NIP-59 gift wraps (wrap → seal → rumor).
// The key never leaves this process; the page receives the layers it asked for and nothing else.
import { nak, parseEvent, safeJson } from './nak.js';

const NIP04 = /^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]+$/;
const firstTag = (ev, name) => (ev.tags || []).find(t => t[0] === name)?.[1];

/** nak reports a wrong key on stdout with exit 0, so the text decides. */
async function decrypt(ciphertext, sec, counterpart, scheme) {
  const r = await nak(['decrypt', ciphertext, '--sec', sec, '-p', counterpart, ...(scheme === 'nip04' ? ['--nip04'] : [])]);
  if (r.code !== 0 || /^failed to decrypt/i.test(r.out)) throw new Error(`this key cannot open it (${(r.out || r.err).replace(/^failed to decrypt:?\s*/i, '').split('\n')[0] || 'no plaintext'})`);
  return r.out;
}
const verified = async ev => { if (!ev.sig) return false; const r = await nak(['verify'], { input: JSON.stringify(ev) }); return r.code === 0 && !/invalid/i.test(r.out + r.err); };
const layerFor = async (role, ev, note) => ({ role, event: ev, verified: await verified(ev), note, plaintext: ev.content, json: safeJson(ev.content) });

/** { scheme, layers } for one held key (holder = its public key). Throws when this key is not a party to the message. */
export async function openSealed(ev, sec, holder) {
  const p = firstTag(ev, 'p');
  if (ev.kind === 1059) {
    if (p !== holder) throw new Error('addressed to someone else');
    const seal = parseEvent(await decrypt(ev.content, sec, ev.pubkey, 'nip44'));
    if (!seal || seal.kind !== 13) throw new Error('the wrap did not contain a seal');
    const rumor = parseEvent(await decrypt(seal.content, sec, seal.pubkey, 'nip44'));
    if (!rumor) throw new Error('the seal did not contain an event');
    return { scheme: 'nip44', layers: [
      await layerFor('seal', seal, 'signed by the real sender; the wrap itself was signed by a throwaway key'),
      await layerFor('rumor', rumor, 'unsigned by design (NIP-59): the seal is what proves who wrote it'),
    ] };
  }
  if (ev.kind === 13) {   // a seal on its own: the recipient is not named, so the held key is tried as the recipient
    const rumor = parseEvent(await decrypt(ev.content, sec, ev.pubkey, 'nip44'));
    if (!rumor) throw new Error('the seal did not contain an event');
    return { scheme: 'nip44', layers: [await layerFor('rumor', rumor, 'unsigned by design (NIP-59)')] };
  }
  const counterpart = ev.pubkey === holder ? p : p === holder ? ev.pubkey : null;
  if (!counterpart) throw new Error('neither the sender nor the recipient');
  const scheme = ev.kind === 4 || NIP04.test(ev.content) ? 'nip04' : 'nip44';
  const text = await decrypt(ev.content, sec, counterpart, scheme);
  const inner = parseEvent(text);
  return { scheme, layers: [inner ? await layerFor('event', inner, 'an event carried inside the payload') : { role: 'plain', plaintext: text, json: safeJson(text) }] };
}

/** Try the named identity, or every held one; the first key that opens the event wins. */
export async function openWithAny(ev, identities, names) {
  const reasons = [];
  for (const [name, sec, pubkey] of identities.filter(([n]) => !names || names.includes(n))) {
    try { return { as: name, ...(await openSealed(ev, sec, pubkey)) }; }
    catch (e) { reasons.push(`$${name}: ${e.message}`); }
  }
  const err = new Error(reasons.length ? `No held key opens this event. ${reasons.join('; ')}` : 'No identity is held; mint one or run the seed.');
  err.status = 422; throw err;
}
