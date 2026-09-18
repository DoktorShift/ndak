// The "Sealed content" part of the inspector: who it is for, whether a held key can open it, and the opened layers.
import { esc } from '../format.js';
import { label, ALARM } from '../kinds.js';
import { nameOf, npub } from '../people.js';
import { identityProfile } from '../identities.js';
import { sealedScheme, holders, recipient, opened, nakCommand } from '../sealed.js';
import { describe } from '../describe.js';

const SCHEME = { wrap: 'a gift wrap (NIP-59): a sealed event inside an envelope signed by a throwaway key', seal: 'a seal (kind 13) on its own, outside its envelope', nip04: 'an encrypted message, NIP-04', nip44: 'an encrypted payload, NIP-44' };
const row = (k, v) => `<div class="grow"><span class="k">${k}</span><span class="v sans">${v}</span></div>`;
const flag = (text, cls = '') => `<span class="flag ${cls}">${text}</span>`;
const stripHtml = h => String(h).replace(/<[^>]+>/g, '');
const pre = text => `<pre class="sealedtext">${esc(text)}</pre>`;

export function sealedGroup(ev) {
  const scheme = sealedScheme(ev); if (!scheme) return '';
  const to = recipient(ev); const who = holders(ev); const result = opened(ev.id);
  const forText = to ? `${esc(nameOf(to))} <span class="muted">${esc(npub(to).slice(0, 16))}…</span>` : '<span class="muted">not named in the event</span>';
  const head = `<div class="sect">Sealed content<button class="tipmark" data-action="tip" data-tip="sealed" aria-label="What is this?">?</button></div><div class="group">${row('sealed as', esc(SCHEME[scheme]))}${row('for', forText)}`;
  if (!result) {
    if (!who.length) return `${head}${row('open', '<span class="muted">no held key is a party to this message</span>')}</div>`;
    const cmd = nakCommand(ev, who[0].name);
    return `${head}${row('open', `<button class="copy primary" data-action="sealed-open" data-id="${ev.id}">Decrypt with ${who.length === 1 ? `${esc(who[0].name)}’s key` : 'a held key'}</button> <button class="copy" data-action="copy" data-text="${esc(cmd)}" title="Copy the same operation as a nak command">Copy nak</button> <button class="copy" data-action="sealed-run" data-cmd="${esc(cmd)}" title="Run the same operation in the terminal">Run</button>`)}</div>`;
  }
  const layers = result.layers.map(layerGroup).join('');
  return `${head}${row('opened with', `${esc(result.as)}’s key${identityProfile(result.as) ? ` (${esc(identityProfile(result.as))})` : ''} · ${result.scheme === 'nip04' ? 'NIP-04' : 'NIP-44'} <button class="copy" data-action="sealed-forget" data-id="${ev.id}" title="Drop the decrypted content from this window; the event itself stays">Forget</button>`)}</div>${layers}`;
}
function layerGroup(l) {
  const ev = l.event;
  if (!ev) return `<div class="group">${row('plaintext', l.plaintext ? pre(l.plaintext) : '<span class="muted">empty</span>')}</div>`;
  const sig = l.verified ? flag('signature checks out') : ev.sig ? flag('signature does not check out', 'alarm') : flag('no signature');
  const by = `<span class="kn">${ev.kind}</span> ${esc(label(ev.kind))} · ${ALARM.has(ev.kind) ? `from ${esc(nameOf(ev.pubkey))}` : `${esc(nameOf(ev.pubkey))} ${esc(stripHtml(describe(ev).verb))}`}`;
  const note = l.role === 'seal' ? 'The seal is signed by the real sender; the envelope around it uses a throwaway key.' : l.role === 'rumor' ? 'Unsigned by design (NIP-59): the seal is what proves who wrote it.' : 'An event carried inside the payload.';
  if (l.role === 'seal') return `<div class="group">${row('seal', `${by}<br>${sig}<br><span class="muted">${note}</span>`)}</div>`;   // its content is only the rumor's ciphertext
  const tags = (ev.tags || []).length ? `<details class="disc"><summary>${ev.tags.length} ${ev.tags.length === 1 ? 'tag' : 'tags'}</summary>${ev.tags.map(t => `<div class="tagline"><code>${esc(t[0])}</code> ${t.slice(1).map(v => t[0] === 'p' && /^[0-9a-f]{64}$/.test(v) ? `${esc(nameOf(v))} <span class="muted">${esc(v.slice(0, 12))}…</span>` : esc(v)).join(' · ')}</div>`).join('')}</details>` : '<span class="muted">none</span>';
  const content = l.json && typeof l.json === 'object' ? pre(JSON.stringify(l.json, null, 2)) : ev.content ? pre(ev.content) : '<span class="muted">empty</span>';
  return `<div class="group">${row(l.role, `${by}<br>${sig}<br><span class="muted">${note}</span>`)}${row('content', content)}${row('tags', tags)}</div>`;
}
