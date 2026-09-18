// Turns one event into a plain-language sentence with optional body, media, card and pills for the social window.
import { tag, tagRow, tags, address, replyTo, targetOf, isEphemeral, decodeCode } from './nostr.js';
import { esc, safeJson, shortHex, fmtDate, amountText, bolt11Sats, untilText, mdLite, isImageUrl, plural } from './format.js';
import { ALARM, kindInfo } from './kinds.js';
import { store, settings, expanded, tierTitle, allEvents } from './state.js';
import { nameOf } from './people.js';

const who = pk => `<b>${esc(nameOf(pk))}</b>`;
const card = (title, sub, extra = '') => `<div class="card">${title ? `<div class="t">${title}</div>` : ''}${sub ? `<div class="s">${sub}</div>` : ''}${extra}</div>`;
const quote = (ev, fallback) => ev ? `<div class="card quote"><div class="s">${esc(nameOf(ev.pubkey))}</div><div>${esc((ev.content || '').slice(0, 280))}</div></div>` : `<div class="card quote"><div class="s">${fallback}</div></div>`;

/** Content with links, nostr: mentions, hashtags and custom emoji rendered; image links pulled out as media. */
export function richText(ev, text) {
  const emoji = Object.fromEntries(tags(ev, 'emoji').map(t => [t[1], t[2]]));
  const media = [];
  let html = esc(text).replace(/https?:\/\/[^\s<]+/g, url => {
    const clean = url.replace(/[.,)]+$/, '');
    if (settings.media && isImageUrl(clean)) { media.push(clean); return ''; }
    return `<a href="${clean}" target="_blank" rel="noopener">${clean.length > 60 ? clean.slice(0, 57) + '…' : clean}</a>`;
  });
  html = html.replace(/nostr:((?:npub|nprofile|note|nevent|naddr)1[0-9a-z]+)/g, (m, code) => {
    const d = decodeCode(code); if (!d) return m;
    if (d.hrp === 'npub' || d.hrp === 'nprofile') return `<button class="name" data-action="profile" data-pubkey="${d.hex}" style="font-size:inherit">@${esc(nameOf(d.hex))}</button>`;
    return `<a href="#" data-action="open" data-id="${esc(d.hex)}">${code.slice(0, 12)}…</a>`;
  });
  html = html.replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, (m, pre, t) => `${pre}<a href="#" data-action="hashtag" data-tag="${esc(t)}">#${esc(t)}</a>`);
  html = html.replace(/:([a-zA-Z0-9_]+):/g, (m, code) => emoji[code] ? `<img class="emoji" alt=":${esc(code)}:" src="${esc(emoji[code])}">` : m);
  for (const t of tags(ev, 'imeta')) { const u = t.find(x => x.startsWith('url '))?.slice(4); if (u && settings.media && isImageUrl(u) && !media.includes(u)) media.push(u); }
  return { html, media };
}

export function describe(ev) {
  const out = { verb: '', context: '', body: '', media: [], card: '', pills: [] };
  const k = ev.kind;
  if (isEphemeral(k)) out.pills.push('<span class="pill live">live only</span>');
  if (ALARM.has(k)) out.pills.push('<span class="pill alarm">should not be on a relay</span>');
  const exp = tag(ev, 'expiration'); if (exp) out.pills.push(`<span class="pill">⏳ ${esc(untilText(+exp))}</span>`);
  if (ev.tags.some(t => t[0] === '-')) out.pills.push('<span class="pill lock">protected: only the author may publish this</span>');
  const subject = tag(ev, 'subject'); if (subject) out.context = `<div class="ctx">Subject: <b>${esc(subject)}</b></div>`;
  for (const t of tags(ev, 't').slice(0, 6)) out.pills.push(`<span class="pill tag">#${esc(t[1])}</span>`);
  (KIND_HANDLERS[k] || fallback)(ev, out);
  return out;
}

function fallback(ev, out) { const info = kindInfo(ev.kind); out.verb = info.name ? `published: ${esc(info.name)} (kind ${ev.kind}${info.nips.length ? `, NIP-${info.nips[0]}` : ''})` : `published a kind ${ev.kind} event (not in the NIP index)`; out.body = esc(ev.content.slice(0, 300)); }

function note(ev, out) {
  const parent = replyTo(ev); const q = tag(ev, 'q');
  out.verb = parent ? 'replied' : (ev.kind === 1111 ? 'commented' : 'wrote');
  if (parent) { const p = store.events.get(parent); out.context = `<div class="ctx">replying to ${p ? who(p.pubkey) : `<b>${shortHex(parent)}</b>`}</div>`; }
  const rt = richText(ev, ev.content); out.body = rt.html; out.media = rt.media;
  if (q && store.events.get(q)) out.card = quote(store.events.get(q));
}

function article(ev, out) {
  const encrypted = tag(ev, 'gate_epoch'); const img = settings.media && tag(ev, 'image'); const published = tag(ev, 'published_at');
  out.verb = encrypted ? 'published a members-only article' : 'published an article';
  const summary = encrypted ? (tag(ev, 'preview') || 'Members only.') : (tag(ev, 'summary') || ev.content.replace(/[#*>]/g, '').slice(0, 220));
  const open = expanded.has(ev.id);
  const reader = encrypted ? '' : `<div style="margin-top:8px"><button class="more-btn" data-action="read" data-id="${ev.id}">${open ? 'Collapse' : 'Read article'}</button></div>${open ? `<div class="article-body">${mdLite(ev.content)}</div>` : ''}`;
  out.card = `<div class="card article">${img ? `<img class="cover" alt="" src="${esc(img)}" loading="lazy">` : ''}<div class="t">${esc(tag(ev, 'title') || 'Untitled')}</div><div class="s">${esc(summary)}${published ? ` · ${esc(fmtDate(+published))}` : ''}</div>${reader}</div>`;
  if (encrypted) out.pills.push(`<span class="pill lock">encrypted for tier “${esc(tierTitle(tag(ev, 'a')))}”</span>`);
}

function tier(ev, out) {
  const subscribers = new Set(allEvents().filter(e => e.kind === 7003 && tag(e, 'a') === address(ev)).map(e => tag(e, 'P'))).size;
  out.verb = 'published a tier';
  const perks = tags(ev, 'perk').map(t => '✓ ' + esc(t[1])).join('<br>');
  out.card = card(esc(tag(ev, 'title') || tag(ev, 'd')), `${esc(amountText(ev))}${perks ? '<br>' + perks : ''}${ev.content ? `<br>${esc(ev.content)}` : ''}`, `<div class="s" style="margin-top:6px">${plural(subscribers, 'paying subscriber')} seen on this relay</div>`);
  out.pills.push('<span class="pill pay">tier</span>');
}

function receipt(ev, out) {
  const valid = ev.tags.find(t => t[0] === 'valid'); const amount = tag(ev, 'gate_amount'); const payment = tags(ev, 'gate_payment')[0];
  out.verb = `confirmed that ${who(tag(ev, 'P'))} paid ${who(tag(ev, 'p'))}`;
  const when = valid ? `${esc(fmtDate(+valid[1]))} → ${esc(fmtDate(+valid[2]))}` : '';
  out.card = card(`Tier “${esc(tierTitle(tag(ev, 'a')) || tag(ev, 'tier') || '?')}”`, `${when}${amount ? ` · ${Number(amount).toLocaleString()} sats` : ''}${payment ? ` · paid via ${esc(payment[1])}` : ''}`);
  out.pills.push('<span class="pill pay">payment receipt</span>');
}

const KIND_HANDLERS = {
  0(ev, out) {
    const p = safeJson(ev.content) || {}; out.verb = 'updated their profile'; out.body = esc(p.about || '');
    const bits = [p.lud16 && `⚡︎ ${esc(p.lud16)}`, p.nip05 && `@ ${esc(p.nip05)}`, p.website && `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\//, ''))}</a>`, p.clink_offer && 'receives over CLINK', p.clink_debit && 'can be debited over CLINK'].filter(Boolean);
    if (bits.length) out.card = card('', bits.join(' · '));
  },
  1: note, 1111: note,
  3(ev, out) { out.verb = `follows ${plural(tags(ev, 'p').length, 'person').replace('persons', 'people')}`; },
  5(ev, out) { out.verb = 'asked relays to delete an event'; },
  6: repost, 16: repost,
  7(ev, out) { out.verb = `reacted ${esc(ev.content || '+')}`; },
  20(ev, out) { out.verb = 'shared a picture'; out.body = esc(tag(ev, 'title') || ''); out.media = tags(ev, 'imeta').map(t => t.find(x => x.startsWith('url '))?.slice(4)).filter(Boolean); },
  1063(ev, out) { out.verb = 'shared a file'; out.card = card(esc(tag(ev, 'alt') || tag(ev, 'url') || 'file'), `${esc(tag(ev, 'm') || '')}${tag(ev, 'size') ? ` · ${(+tag(ev, 'size') / 1024).toFixed(0)} KB` : ''}`); if (settings.media && isImageUrl(tag(ev, 'url') || '')) out.media = [tag(ev, 'url')]; },
  9802(ev, out) { out.verb = 'highlighted'; out.card = `<div class="card quote"><div>${esc(ev.content)}</div>${tag(ev, 'r') ? `<div class="s">${esc(tag(ev, 'r'))}</div>` : ''}</div>`; },
  7001(ev, out) { const a = tag(ev, 'a'); out.verb = `subscribed to ${who(tag(ev, 'p'))}`; out.card = card(esc(a ? tierTitle(a) : 'a tier'), esc(amountText(ev))); out.pills.push('<span class="pill pay">subscription</span>'); },
  7002(ev, out) { out.verb = `unsubscribed from ${who(tag(ev, 'p'))}`; },
  7003: receipt,
  9734(ev, out) { out.verb = `wants to zap ${who(tag(ev, 'p'))}`; },
  9735(ev, out) { const s = bolt11Sats(tag(ev, 'bolt11')); out.verb = `zapped ${who(tag(ev, 'p'))}${s ? ` <b>${s.toLocaleString()} sats</b>` : ''}`; out.pills.push('<span class="pill pay">zap</span>'); },
  10002(ev, out) { out.verb = 'set their relays'; const rows = tags(ev, 'r'); out.card = rows.length ? `<div class="relaylist">${rows.map(t => `<span class="chip">${esc(t[1].replace(/^wss?:\/\//, ''))} · ${esc(t[2] || 'read and write')}</span>`).join('')}</div>` : card('', 'none'); },
  10050(ev, out) { out.verb = 'set where to receive private messages'; out.card = card('', tags(ev, 'relay').map(t => esc(t[1])).join('<br>') || 'none'); },
  30023: article,
  30078(ev, out) { out.verb = tag(ev, 'd') === 'clink-node' ? 'reports their Lightning node is online' : `stored app data “${esc(tag(ev, 'd') || '')}”`; },
  37001: tier,
  1059(ev, out) { out.verb = `sent a sealed message to ${who(tag(ev, 'p'))}`; out.pills.push('<span class="pill lock">encrypted, only the recipient can open it</span>'); },
  21089(ev, out) { out.verb = `asked ${who(tag(ev, 'p'))} for a content key`; out.pills.push('<span class="pill lock">key request</span>'); },
  21001(ev, out) { out.verb = `asked ${who(tag(ev, 'p'))} for an invoice over CLINK`; out.pills.push('<span class="pill lock">encrypted offer request</span>'); },
  21002(ev, out) { out.verb = `asked ${who(tag(ev, 'p'))} to pay from their budget over CLINK`; out.pills.push('<span class="pill lock">encrypted debit request</span>'); },
  21003(ev, out) { out.verb = `sent a management command to ${who(tag(ev, 'p'))} over CLINK`; out.pills.push('<span class="pill lock">encrypted</span>'); },
  21004(ev, out) { out.verb = `enrolled with ${who(tag(ev, 'p'))} over CLINK`; out.pills.push('<span class="pill lock">encrypted</span>'); },
  21088(ev, out) { out.verb = 'published a content key in the clear'; },
  13(ev, out) { out.verb = 'published a seal on its own'; },
};
// ---------- NIP-47 wallet connect ----------
const NWC_HANDLERS = {
  13194(ev, out) {
    const methods = ev.content.trim().split(/\s+/).filter(Boolean);
    out.verb = 'advertises a wallet over NWC';
    out.card = card(`${plural(methods.length, 'method')}`, `${methods.map(esc).join(' · ')}${tag(ev, 'encryption') ? `<br>encryption: ${esc(tag(ev, 'encryption'))}` : ''}${tag(ev, 'notifications') ? `<br>notifications: ${esc(tag(ev, 'notifications'))}` : ''}`);
    out.pills.push('<span class="pill pay">wallet service</span>');
  },
  23194(ev, out) { out.verb = `sent a wallet request to ${who(tag(ev, 'p'))}`; out.pills.push('<span class="pill lock">encrypted: only the wallet can read the command</span>'); },
  23195(ev, out) { out.verb = `answered a wallet request from ${who(tag(ev, 'p'))}`; out.pills.push('<span class="pill lock">encrypted response</span>'); },
  23196(ev, out) { out.verb = `notified ${who(tag(ev, 'p'))} about a wallet event`; out.pills.push('<span class="pill lock">encrypted notification</span>'); },
  23197(ev, out) { out.verb = `notified ${who(tag(ev, 'p'))} about a wallet event`; out.pills.push('<span class="pill lock">encrypted notification</span>'); },
};
Object.assign(KIND_HANDLERS, NWC_HANDLERS);

// ---------- NIP-29 groups ----------
const groupOf = ev => tag(ev, 'h') || tag(ev, 'd') || '?';
const inGroup = ev => `in group <b>${esc(groupOf(ev))}</b>`;
const GROUP_HANDLERS = {
  9(ev, out) { out.verb = `wrote ${inGroup(ev)}`; const rt = richText(ev, ev.content); out.body = rt.html; out.media = rt.media; },
  11(ev, out) { out.verb = `started a thread ${inGroup(ev)}`; const rt = richText(ev, ev.content); out.body = rt.html; out.media = rt.media; },
  9000(ev, out) { out.verb = `added ${who(tag(ev, 'p'))} to group <b>${esc(groupOf(ev))}</b>${tagRow(ev, 'p')?.[2] ? ` as ${esc(tagRow(ev, 'p')[2])}` : ''}`; },
  9001(ev, out) { out.verb = `removed ${who(tag(ev, 'p'))} from group <b>${esc(groupOf(ev))}</b>`; },
  9002(ev, out) { const fields = ev.tags.filter(t => !['h', 'previous'].includes(t[0])).map(t => t.length > 1 ? `${esc(t[0])}: ${esc(t[1])}` : esc(t[0])); out.verb = `changed the metadata of group <b>${esc(groupOf(ev))}</b>`; if (fields.length) out.card = card('', fields.join(' · ')); },
  9005(ev, out) { out.verb = `deleted an event ${inGroup(ev)}`; },
  9007(ev, out) { out.verb = `created group <b>${esc(groupOf(ev))}</b>`; },
  9008(ev, out) { out.verb = `deleted group <b>${esc(groupOf(ev))}</b>`; },
  9009(ev, out) { out.verb = `created an invite for group <b>${esc(groupOf(ev))}</b>`; },
  9010(ev, out) { out.verb = `updated the pinned list ${inGroup(ev)}`; },
  9021(ev, out) { out.verb = `asked to join group <b>${esc(groupOf(ev))}</b>`; if (tag(ev, 'code')) out.card = card('', 'with an invite code'); },
  9022(ev, out) { out.verb = `left group <b>${esc(groupOf(ev))}</b>`; },
  39000(ev, out) {
    const parent = tag(ev, 'parent'); const children = tags(ev, 'child').map(t => esc(t[1]));
    out.verb = `describes group <b>${esc(groupOf(ev))}</b>`;
    const flags = ['public', 'private', 'open', 'closed', 'restricted', 'hidden', 'broadcast', 'nonbroadcast'].filter(f => ev.tags.some(t => t[0] === f));
    out.card = card(esc(tag(ev, 'name') || groupOf(ev)), `${esc(tag(ev, 'about') || '')}${flags.length ? `<br>${flags.join(' · ')}` : ''}${parent ? `<br>subgroup of <b>${esc(parent)}</b>` : ''}${children.length ? `<br>subgroups: ${children.join(', ')}` : ''}`);
    out.pills.push('<span class="pill">relay-signed</span>'); if (parent) out.pills.push('<span class="pill tag">subgroup</span>');
  },
  39001(ev, out) { out.verb = `lists the admins of group <b>${esc(groupOf(ev))}</b>`; out.card = card('', tags(ev, 'p').map(t => `${esc(nameOf(t[1]))}${t[2] ? ` · ${esc(t[2])}` : ''}`).join('<br>') || 'none'); out.pills.push('<span class="pill">relay-signed</span>'); },
  39002(ev, out) { const m = tags(ev, 'p'); out.verb = `lists the ${plural(m.length, 'member')} of group <b>${esc(groupOf(ev))}</b>`; out.card = card('', m.map(t => esc(nameOf(t[1]))).join('<br>') || 'none'); out.pills.push('<span class="pill">relay-signed</span>'); },
  39003(ev, out) { out.verb = `lists the roles of group <b>${esc(groupOf(ev))}</b>`; out.card = card('', tags(ev, 'role').map(t => esc(t.slice(1).join(': '))).join('<br>') || 'none'); },
  39004(ev, out) { out.verb = `lists the live participants ${inGroup(ev)}`; },
  39005(ev, out) { out.verb = `lists the pinned events ${inGroup(ev)}`; },
};
Object.assign(KIND_HANDLERS, GROUP_HANDLERS);

function repost(ev, out) { const inner = safeJson(ev.content); const t = targetOf(ev); out.verb = 'reposted'; out.card = quote(inner || store.events.get(t), `event ${shortHex(t)}`); }
