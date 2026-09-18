// The event inspector: Summary, Tags, Refs, Raw and nak. Used by the technical window and the social details panel.
// Everything here works for any kind: names come from the NIP index, the rest is derived from the event itself.
import { tag, isEphemeral, isReplaceable, isAddressable, neventEncode, address, isHex32, decodeCode } from '../nostr.js';
import { esc, fmtDate, shortHex, stripHtml, ago, plural, safeJson } from '../format.js';
import { sealedGroup } from './sealed.js';
import { label, kindInfo, kindClass, nipTitle, nipNote, nipUrl, LOCAL_NIPS, ALARM, tagMeaning } from '../kinds.js';
import { store, settings, relayFor, relayName, referencedBy } from '../state.js';
import { nameOf, npub } from '../people.js';
import { describe } from '../describe.js';
import { forEvent } from '../nak.js';
import { withIdentity, acting } from '../identities.js';

const FIELDS = ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'];
export const eventJson = (ev, pretty) => JSON.stringify(ev, FIELDS, pretty ? 2 : undefined);
const TABS = [['summary', 'Summary'], ['tags', 'Tags'], ['refs', 'Refs'], ['raw', 'Raw'], ['nak', 'nak']];
const row = (k, v, copyText, cls = '') => `<div class="grow"><span class="k">${k}</span><span class="v ${cls}">${v}</span>${copyText !== undefined ? `<button class="copy" data-action="copy" data-text="${esc(copyText)}">Copy</button>` : ''}</div>`;
const flag = (text, cls = '') => `<span class="flag ${cls}">${text}</span>`;
const uniqueById = list => [...new Map(list.map(e => [e.id, e])).values()];
const openBtn = id => store.events.has(id) ? `<button class="copy" data-action="details" data-id="${id}">Open</button>` : '';

/** mode: "technical" (tabs act on the technical inspector) or "detail" (the social side panel, closeable). */
export function inspectorHtml(ev, activeTab, mode) {
  const s = describe(ev); const info = kindInfo(ev.kind);
  const tools = mode === 'detail'
    ? `<button class="iconbtn" data-action="to-technical" data-id="${ev.id}" title="Open in Technical">${ICON.code}</button><button class="iconbtn" data-action="close-details" title="Close (Esc)">${ICON.close}</button>`
    : '';
  const tabAction = mode === 'detail' ? 'dtab' : 'tab';
  const tabs = TABS.map(([id, name]) => `<button role="tab" data-action="${tabAction}" data-tab="${id}" aria-pressed="${activeTab === id}">${name}</button>`).join('');
  const nip = info.nips[0] ? `NIP-${info.nips[0]}` : LOCAL_NIPS[ev.kind] || '';
  const tip = settings.tipsDismissed.includes(mode === 'detail' ? 'details' : 'inspector') ? '' : `<button class="tipmark" data-action="tip" data-tip="${mode === 'detail' ? 'details' : 'inspector'}" aria-label="About this panel">?</button>`;
  return `<div class="insp-h"><div><div class="k"><span class="kn">${ev.kind}</span> ${esc(label(ev.kind))}${nip ? ` <span class="muted">· ${esc(nip)}</span>` : ''}${tip}</div><div class="m">${esc(nameOf(ev.pubkey))} ${esc(stripHtml(s.verb))}</div></div><div class="tools">${tools}</div></div>
    <div class="insp-tabs"><div class="seg" role="tablist">${tabs}</div></div>
    <div class="insp-body">${BODY[activeTab] ? BODY[activeTab](ev) : ''}</div>`;
}

// ---------- verification (nostr-tools bundle, loaded as a global) ----------
function verify(ev) {
  const T = globalThis.NostrTools; if (!T) return { available: false };
  let hash = null, sig = null;
  try { hash = T.getEventHash(ev) === ev.id; } catch { hash = false; }
  try { sig = T.verifyEvent(ev); } catch { sig = false; }
  return { available: true, hash, sig };
}
/** NIP-13: leading zero bits of the id, only meaningful when a nonce tag claims work. */
function powBits(id) { let bits = 0; for (const c of id) { const n = parseInt(c, 16); if (n === 0) { bits += 4; continue; } bits += Math.clz32(n) - 28; break; } return bits; }

function contentAnalysis(ev) {
  const c = ev.content || ''; const bytes = new TextEncoder().encode(c).length; const out = [];
  if (!c) return ['empty'];
  const json = safeJson(c);
  if (json && typeof json === 'object') out.push(Array.isArray(json) ? `JSON array, ${json.length} items` : `JSON object · keys: ${Object.keys(json).slice(0, 12).map(esc).join(', ')}`);
  if (/^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]+$/.test(c)) out.push('looks encrypted (NIP-04: base64?iv=…)');
  else if (/^[A-Za-z0-9+/]{90,}={0,2}$/.test(c)) { try { const first = atob(c.slice(0, 4)).charCodeAt(0); if (first === 2) out.push('looks encrypted (NIP-44 v2 payload)'); else out.push('base64 payload'); } catch { /* not base64 */ } }
  const urls = (c.match(/https?:\/\/\S+/g) || []).length; if (urls) out.push(plural(urls, 'URL'));
  const refs = (c.match(/nostr:(npub|nprofile|note|nevent|naddr)1/g) || []).length; if (refs) out.push(plural(refs, 'nostr: reference'));
  const tags = (c.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length; if (tags) out.push(plural(tags, 'hashtag'));
  out.push(`${c.length} chars · ${bytes} bytes`);
  return out;
}

const BODY = {
  summary(ev) {
    const info = kindInfo(ev.kind); const cls = kindClass(ev.kind); const v = verify(ev); const now = Math.floor(Date.now() / 1000);
    const flags = [];
    flags.push(flag(`${cls} · ${{ regular: 'stored as is', replaceable: 'newest per author wins', ephemeral: 'relays pass it on, should not store it', addressable: 'newest per author and d tag wins' }[cls]}`, cls === 'ephemeral' ? 'live' : ''));
    if (!info.listed && !LOCAL_NIPS[ev.kind]) flags.push(flag('kind not in the NIP index: shown from the raw event', 'warn'));
    if (ALARM.has(ev.kind)) flags.push(flag('must never be on a relay unwrapped', 'alarm'));
    if (v.available) { flags.push(v.hash ? flag('id matches the content', 'ok') : flag('id does not match the content', 'alarm')); flags.push(v.sig ? flag('signature valid', 'ok') : flag('signature invalid', 'alarm')); }
    else flags.push(flag('verification library not loaded', 'warn'));
    if (ev.created_at > now + 60) flags.push(flag(`created ${ago(ev.created_at)} ahead of your clock`, 'warn'));
    const nonce = tag(ev, 'nonce'); if (nonce) flags.push(flag(`proof of work: ${powBits(ev.id)} bits (nonce claims ${esc(ev.tags.find(t => t[0] === 'nonce')?.[2] || '?')})`));
    const nips = info.nips.map(n => `<a href="${nipUrl(n)}" target="_blank" rel="noopener">NIP-${n}</a>${nipTitle(n) ? ` ${esc(nipTitle(n))}` : ''}${nipNote(n) ? ` <span class="muted">(${esc(nipNote(n))})</span>` : ''}`).join(', ') || (LOCAL_NIPS[ev.kind] ? esc(LOCAL_NIPS[ev.kind]) : '<span class="muted">none listed</span>');
    const received = ev._received ? `${fmtDate(ev._received)} (${ev._received - ev.created_at >= 0 ? `${describeDelta(ev._received - ev.created_at)} after creation` : 'before its own created_at'})` : 'imported';
    const seen = [...(ev._seen || [])].map(u => `<span class="rchip">${esc(relayName(u))}</span>`).join('') || '<span class="muted">none</span>';
    const nevent = neventEncode(ev.id, { relay: relayFor(ev), author: ev.pubkey });
    return `<div>${flags.join('')}</div>
      <div class="group">${row('kind', `${ev.kind} · ${esc(label(ev.kind))}${info.range ? ` <span class="muted">(range ${info.range})</span>` : ''}`)}${row('spec', nips)}${row('class', cls)}${isAddressable(ev.kind) ? row('address', esc(address(ev)), address(ev)) : ''}</div>
      <div class="group">${row('id', ev.id, ev.id)}${row('author', `${esc(nameOf(ev.pubkey))}<br>${npub(ev.pubkey)}`, npub(ev.pubkey))}${row('hex', ev.pubkey, ev.pubkey)}${row('signature', ev.sig.slice(0, 40) + '…', ev.sig)}</div>
      <div class="group">${row('created', `${ev.created_at} · ${esc(fmtDate(ev.created_at))} · ${esc(ago(ev.created_at))} ago`, String(ev.created_at))}${row('received', esc(received))}${row('seen on', seen)}</div>
      <div class="group">${row('content', contentAnalysis(ev).map(esc).join(' · '))}${row('tags', `${ev.tags.length} · ${[...new Set(ev.tags.map(t => t[0]))].map(esc).join(' ')}`)}</div>
      ${sealedGroup(ev)}
      <div class="group">${row('nevent', nevent.slice(0, 40) + '…', nevent)}${row('njump', 'njump.me/' + nevent.slice(0, 20) + '…', 'https://njump.me/' + nevent)}</div>`;
  },
  tags(ev) {
    if (!ev.tags.length) return '<div class="group"><div class="grow"><span class="k"></span><span class="muted">no tags</span></div></div>';
    const rows = ev.tags.map((t, i) => {
      const [meaning, nip] = tagMeaning(t[0]);
      return `<div class="tagrow"><div class="tagname"><b>${esc(t[0])}</b><small>${esc(meaning)}${nip ? ` · NIP-${esc(nip)}` : ''}</small></div><div class="tagvals">${t.slice(1).map((v, j) => tagValue(t[0], v, j, t)).join('')}${t.length === 1 ? '<span class="muted">(flag, no value)</span>' : ''}</div><button class="copy" data-action="copy" data-text="${esc(JSON.stringify(t))}" aria-label="Copy tag ${i}">Copy</button></div>`;
    }).join('');
    return `<div class="group tags">${rows}</div><details class="disc" open><summary>Content (${ev.content.length} chars)</summary><pre>${esc(ev.content || '(empty)')}</pre></details>`;
  },
  refs(ev) {
    const outgoing = ev.tags.filter(t => ['e', 'a', 'q', 'p', 'P'].includes(t[0]) && t[1]);
    let html = '<div class="sect">Points at</div>';
    html += outgoing.length ? `<div class="group">${outgoing.map(refRow).join('')}</div>` : '<div class="muted" style="padding:4px 2px 10px">no e, a, q or p tags</div>';
    const incoming = uniqueById([...referencedBy(ev.id), ...(isAddressable(ev.kind) ? referencedBy(address(ev)) : [])]).sort((a, b) => b.created_at - a.created_at);
    html += `<div class="sect">Referenced by (${incoming.length})</div>`;
    if (!incoming.length) return html + '<div class="muted" style="padding:4px 2px 10px">nothing loaded points at this event</div>';
    const byKind = new Map();
    for (const e of incoming) byKind.set(e.kind, [...(byKind.get(e.kind) || []), e]);
    for (const [k, list] of byKind) {
      const items = list.slice(0, 20).map(e => {
        const excerpt = e.content ? ' — ' + esc(e.content.slice(0, 80)) : '';
        return `<div class="grow"><span class="k muted">${esc(ago(e.created_at))}</span><span class="v sans">${esc(nameOf(e.pubkey))}: ${esc(stripHtml(describe(e).verb))}${excerpt}</span>${openBtn(e.id)}</div>`;
      }).join('');
      html += `<div class="group"><div class="grow"><span class="k">${k}</span><span class="v sans"><b>${esc(label(k))}</b> · ${plural(list.length, 'event')}</span></div>${items}</div>`;
    }
    return html;
  },
  raw(ev) {
    const serialized = JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
    return `<pre>${esc(eventJson(ev, true))}</pre><div style="margin:8px 0"><button class="copy" data-action="copy" data-text="${esc(eventJson(ev))}">Copy JSON</button> <span class="muted" style="font-size:11.5px">${new TextEncoder().encode(eventJson(ev)).length} bytes</span></div>
      <details class="disc"><summary>Serialized form that is hashed for the id (NIP-01)</summary><pre>${esc(serialized)}</pre></details>`;
  },
  nak(ev) { return nakList(forEvent(ev, relayFor(ev))); },
};

function describeDelta(s) { if (s < 60) return `${s} s`; if (s < 3600) return `${Math.round(s / 60)} min`; if (s < 86400) return `${Math.round(s / 3600)} h`; return `${Math.round(s / 86400)} d`; }

/** A tag value with meaning: references resolve against the store, times become dates, addresses split up. */
function tagValue(name, v, j, t) {
  const text = esc(v);
  if (j === 0 && (name === 'e' || name === 'q') && isHex32(v)) { const e = store.events.get(v); return `<span class="tv">${e ? `<b>${e.kind} ${esc(label(e.kind))}</b> by ${esc(nameOf(e.pubkey))} · ${esc(ago(e.created_at))} ${openBtn(v)}` : `<span class="muted">not loaded</span>`}<code>${text}</code></span>`; }
  if (j === 0 && (name === 'p' || name === 'P') && isHex32(v)) return `<span class="tv"><b>${esc(nameOf(v))}</b> <button class="copy" data-action="person" data-pubkey="${v}">Profile</button><code>${esc(npub(v))}</code></span>`;
  if (j === 0 && name === 'a') { const parts = v.split(':'); const e = store.tiers.get(v) || [...store.events.values()].find(x => isAddressable(x.kind) && address(x) === v); return `<span class="tv">${e ? `<b>${e.kind} ${esc(label(e.kind))}</b> “${esc(tag(e, 'title') || tag(e, 'd') || '')}” ${openBtn(e.id)}` : `<span class="muted">kind ${esc(parts[0])} by ${esc(nameOf(parts[1]) || '?')} · not loaded</span>`}<code>${text}</code></span>`; }
  if (j === 0 && (name === 'expiration' || name === 'published_at') && /^\d{9,}$/.test(v)) return `<span class="tv">${esc(fmtDate(+v))}<code>${text}</code></span>`;
  if (name === 'valid' && /^\d{9,}$/.test(v)) return `<span class="tv">${esc(fmtDate(+v))}<code>${text}</code></span>`;
  if (j > 0 && (name === 'e' || name === 'a' || name === 'p') && /^wss?:\/\//.test(v)) return `<span class="tv"><span class="muted">relay hint</span><code>${text}</code></span>`;
  if (j > 0 && name === 'e' && ['root', 'reply', 'mention'].includes(v)) return `<span class="tv"><span class="muted">marker</span><code>${text}</code></span>`;
  if (name === 'imeta') return `<span class="tv"><code>${text}</code></span>`;
  if (/^https?:\/\//.test(v)) return `<span class="tv"><a href="${text}" target="_blank" rel="noopener">${text.length > 70 ? text.slice(0, 67) + '…' : text}</a></span>`;
  return `<span class="tv"><code>${text}</code></span>`;
}
function refRow(t) {
  const [name, v] = t; const [meaning] = tagMeaning(name);
  return `<div class="grow"><span class="k">${esc(name)}</span><span class="v">${tagValue(name, v, 0, t)}</span></div>`;
}

/** nak commands grouped by intent (read, write, share), each with a one-line note and a Copy button. */
const GROUP_TITLES = { read: 'Read', write: 'Write (needs a key)', share: 'Share' };
export function nakList(commands, { foot = true } = {}) {
  const groups = ['read', 'write', 'share'].filter(g => commands.some(c => c.group === g));
  const item = raw => { const c = { ...raw, cmd: withIdentity(raw.cmd) }; return `<div class="cmd"><div><div class="t">${esc(c.title)}</div>${c.note ? `<div class="n">${esc(c.note)}</div>` : ''}</div><span class="cmdbtns"><button class="copy" data-action="copy" data-text="${esc(c.cmd)}" aria-label="Copy command: ${esc(c.title)}">Copy</button><button class="copy run" data-action="run" data-cmd="${esc(c.cmd)}" title="Run in the terminal">Run</button></span><code>${highlight(c.cmd)}</code></div>`; };
  const body = groups.map(g => `<div class="nak-h">${GROUP_TITLES[g]}</div>${commands.filter(c => c.group === g).map(item).join('')}`).join('');
  const a = acting();
  const footer = foot ? `<div class="nak-foot">${a ? `Write commands sign as <b>${esc(a.name)}</b>; the agent fills in the key.` : 'No identity chosen: write commands carry <code>&lt;nsec&gt;</code>. Pick one under Acting as in the toolbar, or replace it by hand.'} The trailing <code>&lt; /dev/null</code> keeps nak from waiting on stdin.</div>` : '';
  return `<div class="nak">${body}</div>${footer}`;
}
function highlight(command) {
  return esc(command).replace(/&lt;nsec&gt;|&#39;your reply&#39;|'your reply'|'hello'|'hello from nak'|\$[a-z][a-z0-9_]*/g, m => `<span class="ph">${m}</span>`).replace(/&lt; \/dev\/null/g, '<span class="tail">&lt; /dev/null</span>');
}

export const ICON = {
  code: '<svg class="sym" viewBox="0 0 16 16"><path d="M5 5 2 8l3 3M11 5l3 3-3 3M9.5 3l-3 10"/></svg>',
  close: '<svg class="sym" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  info: '<svg class="sym" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M8 7.5v4M8 5v.2"/></svg>',
  relay: '<svg class="sym" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><circle cx="8" cy="8" r="5.5" opacity=".6"/></svg>',
  terminal: '<svg class="sym" viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="2"/><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5"/></svg>',
};
