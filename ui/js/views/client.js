// Client view: the feed as an editorial social client would render it.
// SF for interface text, New York (ui-serif) only for long-form headlines and quotes. Relay-only kinds are hidden,
// reactions, reposts and zaps fold into an action bar, replies fold into threads, money events become ledger rows.
// Nothing here writes: every action opens a preview that explains what a client would do and offers the nak command.
import { tag, tags, replyTo, targetOf, address } from '../nostr.js';
import { esc, safeJson, fmtDate, ago, amountText, bolt11Sats, mdLite, isImageUrl, plural, shortHex } from '../format.js';
import { store, settings, revealed, expanded, rollup, allEvents, profileOf, tierTitle } from '../state.js';
import { nameOf, handle, avatar, npub } from '../people.js';
import { richText } from '../describe.js';
import { ICON } from './inspector.js';

// ---------- symbols (SF-like line icons) ----------
const SYM = {
  reply: '<svg class="sym" viewBox="0 0 16 16"><path d="M2.5 8.5a5 4.5 0 1 1 2.2 3.7L2 13l.9-2.6A4.4 4.4 0 0 1 2.5 8.5z"/></svg>',
  repost: '<svg class="sym" viewBox="0 0 16 16"><path d="M3 6.5V5a1.5 1.5 0 0 1 1.5-1.5H11M9 1.5l2 2-2 2M13 9.5V11a1.5 1.5 0 0 1-1.5 1.5H5M7 14.5l-2-2 2-2"/></svg>',
  heart: '<svg class="sym" viewBox="0 0 16 16"><path d="M8 13.5S2.5 10 2.5 6.2A2.9 2.9 0 0 1 8 4.6a2.9 2.9 0 0 1 5.5 1.6C13.5 10 8 13.5 8 13.5z"/></svg>',
  bolt: '<svg class="sym" viewBox="0 0 16 16"><path d="M9 1.5 3.5 9H7.5L7 14.5 12.5 7H8.5z"/></svg>',
  lock: '<svg class="sym" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  check: '<svg class="sym" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  link: '<svg class="sym" viewBox="0 0 16 16"><path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8"/></svg>',
  people: '<svg class="sym" viewBox="0 0 16 16"><circle cx="6" cy="5.5" r="2.3"/><path d="M1.5 13c.5-2.6 2.3-4 4.5-4s4 1.4 4.5 4M11 3.5a2.3 2.3 0 0 1 0 4.4M12 9.2c1.4.4 2.3 1.6 2.5 3.8"/></svg>',
  doc: '<svg class="sym" viewBox="0 0 16 16"><path d="M4 1.5h5.5L13 5v9.5H4zM9.5 1.5V5H13M6 8h4M6 10.5h4"/></svg>',
};

// ---------- which events become posts ----------
const POST_KINDS = new Set([1, 11, 9, 1111, 20, 1063, 9802, 30023, 37001, 7001, 7002, 7003, 39000]);
const isPost = ev => POST_KINDS.has(ev.kind) || ((ev.kind === 6 || ev.kind === 16) && !store.events.has(targetOf(ev)));
/** Roots only: a reply whose parent is loaded shows under that parent. */
export function clientRows(events) {
  const shown = events.filter(isPost); const ids = new Set(shown.map(e => e.id));
  return shown.filter(e => !(replyTo(e) && ids.has(replyTo(e))));
}

// ---------- shared pieces ----------
const isCreator = pk => allEvents().some(e => e.kind === 37001 && e.pubkey === pk);
const tierFor = addr => addr && store.tiers.get(addr);
const priceOf = tierEv => tierEv ? amountText(tierEv).replace(' monthly', '/month').replace(' yearly', '/year').replace(' weekly', '/week') : '';
const readTime = text => `${Math.max(1, Math.round(text.split(/\s+/).length / 220))} min read`;
const media = (list, alt = '') => list.length ? `<div class="cmedia${list.length === 1 ? ' one' : ''}">${list.map(u => `<button class="cimg" data-action="lightbox" data-src="${esc(u)}" aria-label="Open image"><img alt="${esc(alt)}" src="${esc(u)}" loading="lazy"></button>`).join('')}</div>` : '';
const linkCard = url => { try { const u = new URL(url); return `<a class="clink" href="${esc(url)}" target="_blank" rel="noopener">${SYM.link}<span><b>${esc(u.host)}</b><small>${esc((u.pathname + u.search).slice(0, 70))}</small></span></a>`; } catch { return ''; } };
const embed = (inner, fallback) => inner
  ? `<div class="cquote"><div class="chead small">${avatar(inner.pubkey, 's')}<span class="cname">${esc(nameOf(inner.pubkey))}</span><span class="ctime">${esc(ago(inner.created_at))}</span></div><div class="ctext">${richText(inner, (inner.content || '').slice(0, 400)).html}</div></div>`
  : `<div class="cquote muted">${fallback}</div>`;
const preview = (id, what) => `data-action="preview" data-id="${id}" data-what="${what}"`;

/** Name and time. Per nostrdesign, feeds show the name, not the NIP-05; the address stays on the profile page. */
function identity(ev, small = false) {
  const time = settings.relative ? ago(ev.created_at) : fmtDate(ev.created_at);
  return `<div class="chead${small ? ' small' : ''}"><button class="cname" data-action="profile" data-pubkey="${ev.pubkey}">${esc(nameOf(ev.pubkey))}</button>${isCreator(ev.pubkey) ? '<span class="ctag">Creator</span>' : ''}<span class="ctime" title="${esc(fmtDate(ev.created_at))}">${esc(time)}</span></div>`;
}

/** Reply · repost · react · zap. Counts come from the relay; clicking explains what a client would do. */
function actionBar(ev) {
  const r = rollup(ev.id);
  const sats = r.zaps.reduce((n, z) => n + bolt11Sats(tag(z, 'bolt11')), 0);
  const faces = [...new Set(r.reactions.map(x => x.content === '+' || !x.content ? '' : x.content))].filter(Boolean).slice(0, 3).join('');
  const act = (what, icon, n, cls = '', title = '') => `<button class="cact ${cls}" ${preview(ev.id, what)} title="${esc(title)}">${icon}${n ? `<b>${n}</b>` : ''}</button>`;
  return `<div class="cbar">${act('reply', SYM.reply, r.replies.length, '', 'Reply')}${act('repost', SYM.repost, r.reposts.length, '', 'Repost')}${act('react', faces || SYM.heart, r.reactions.length, r.reactions.length ? 'on' : '', 'React')}${act('zap', SYM.bolt, sats ? `${sats.toLocaleString()} sats` : r.zaps.length, sats ? 'zap' : '', 'Zap')}</div>`;
}

function threadHtml(ev, depth) {
  const r = rollup(ev.id); if (!r.replies.length || depth >= 2) return '';
  const list = [...r.replies].sort((a, b) => a.created_at - b.created_at);
  const open = expanded.has(ev.id + ':replies'); const show = open ? list : list.slice(0, 2);
  const more = list.length > show.length ? `<button class="more-btn" data-action="expand" data-id="${ev.id}:replies">Show all ${list.length} replies</button>` : '';
  return `<div class="cthread">${show.map(x => clientPostHtml(x, depth + 1)).join('')}${more}</div>`;
}

// ---------- one post ----------
export function clientPostHtml(ev, depth = 0) {
  const warning = tag(ev, 'content-warning'); const sensitive = warning !== undefined && !revealed.has(ev.id);
  const body = BODY[ev.kind] ? BODY[ev.kind](ev) : BODY.generic(ev);
  const content = sensitive ? `<div class="csensitive"><div class="cblur">${body}</div><div class="cveil">${SYM.lock}<span>Sensitive content${warning ? `: ${esc(warning)}` : ''}</span><button class="chip" data-action="reveal" data-id="${ev.id}">Show</button></div></div>` : body;
  const compact = COMPACT.has(ev.kind);
  return `<article class="cpost${depth ? ' creply' : ''}${compact ? ' compact' : ''}" data-id="${ev.id}" aria-selected="false">
    <button class="avb" data-action="profile" data-pubkey="${ev.pubkey}" aria-label="Profile">${avatar(ev.pubkey, depth ? 's32' : 'm')}</button>
    <div class="cbody">${compact ? '' : identity(ev, !!depth)}${content}${compact ? '' : actionBar(ev)}${threadHtml(ev, depth)}</div>
    <div class="side"><button class="iconbtn" data-action="details" data-id="${ev.id}" title="Details (I)">${ICON.info}</button><button class="iconbtn" data-action="menu" data-id="${ev.id}" aria-label="More" aria-haspopup="menu">···</button></div></article>`;
}
/** Money and membership activity read as one line, like "followed you" rows in a client. */
const COMPACT = new Set([7001, 7002, 7003]);

const note = ev => {
  const parent = replyTo(ev); const rt = richText(ev, ev.content);
  const ctx = parent && !store.events.has(parent) ? `<div class="cctx">Replying to a note not on this relay (${shortHex(parent)})</div>` : '';
  const q = tag(ev, 'q'); const quote = q ? embed(store.events.get(q), `Quoted note ${shortHex(q)}`) : '';
  const links = [...ev.content.matchAll(/https?:\/\/[^\s<]+/g)].map(m => m[0].replace(/[.,)]+$/, '')).filter(u => !isImageUrl(u)).slice(0, 1);
  return `${ctx}<div class="ctext">${rt.html}</div>${media(rt.media)}${quote}${!rt.media.length ? links.map(linkCard).join('') : ''}`;
};

const BODY = {
  1: note, 1111: note,
  11: ev => `<div class="cctx">Thread in <b>${esc(tag(ev, 'h') || '')}</b></div>${note(ev)}`,
  9: ev => `<div class="cctx">${esc(tag(ev, 'h') || 'group')}</div><div class="cbubble">${richText(ev, ev.content).html}</div>`,
  6: repost, 16: repost,
  20: ev => `${tag(ev, 'title') ? `<div class="ctext">${esc(tag(ev, 'title'))}</div>` : ''}${media(tags(ev, 'imeta').map(t => t.find(x => x.startsWith('url '))?.slice(4)).filter(Boolean), tags(ev, 'imeta')[0]?.find(x => x.startsWith('alt '))?.slice(4) || '')}`,
  1063: ev => `<div class="cfile">${SYM.doc}<span><b>${esc(tag(ev, 'alt') || tag(ev, 'url') || 'File')}</b><small>${esc(tag(ev, 'm') || '')}${tag(ev, 'size') ? ` · ${(+tag(ev, 'size') / 1024).toFixed(0)} KB` : ''}</small></span></div>`,
  9802: ev => `<blockquote class="chighlight">${esc(ev.content)}${tag(ev, 'r') ? `<cite>${esc(tag(ev, 'r').replace(/^https?:\/\//, ''))}</cite>` : ''}</blockquote>`,
  30023: article, 37001: tier, 7001: subscription, 7002: unsubscription, 7003: receipt, 39000: group,
  generic: ev => `<div class="ctext">${esc(ev.content.slice(0, 300))}</div>`,
};

function repost(ev) {
  const inner = safeJson(ev.content) || store.events.get(targetOf(ev));
  return `<div class="cctx">${SYM.repost} Reposted</div>${embed(inner, `Event ${shortHex(targetOf(ev))}`)}`;
}

/** Long-form: hero, serif headline, summary, meta line. Locked articles end in a paywall that quotes the tier's price. */
function article(ev) {
  const locked = !!tag(ev, 'gate_epoch'); const img = settings.media && tag(ev, 'image'); const open = expanded.has(ev.id);
  const tierEv = tierFor(tag(ev, 'a')); const tierName = tierTitle(tag(ev, 'a'));
  const summary = locked ? (tag(ev, 'preview') || '') : (tag(ev, 'summary') || ev.content.replace(/[#*>]/g, '').slice(0, 240));
  const published = tag(ev, 'published_at') ? fmtDate(+tag(ev, 'published_at')) : fmtDate(ev.created_at);
  const meta = `<div class="cmeta">${locked ? `<span class="cbadge lock">${SYM.lock} Members only</span>` : '<span class="cbadge">Free</span>'}<span>${esc(published)}</span>${locked ? '' : `<span>${readTime(ev.content)}</span>`}</div>`;
  const reader = locked
    ? `<div class="cpaywall"><div class="cfade">${esc(summary)}</div><div class="cgate"><div>${SYM.lock}<b>Continue reading with ${esc(tierName || 'a membership')}</b><small>${tierEv ? esc(priceOf(tierEv)) + ' · cancel any time' : 'price on the creator page'}</small></div><button class="cprimary" ${preview(tierEv ? tierEv.id : ev.id, 'subscribe')}>Subscribe</button></div></div>`
    : `<div class="cread">${open ? `<div class="carticle-body">${mdLite(ev.content)}</div><button class="more-btn" data-action="read" data-id="${ev.id}">Collapse</button>` : `<button class="cprimary secondary" data-action="read" data-id="${ev.id}">Read</button>`}</div>`;
  return `<div class="carticle">${img ? `<button class="cimg hero" data-action="lightbox" data-src="${esc(img)}"><img alt="" src="${esc(img)}" loading="lazy"></button>` : ''}<h2 class="ctitle">${esc(tag(ev, 'title') || 'Untitled')}</h2>${summary && !locked ? `<p class="csummary">${esc(summary)}</p>` : ''}${meta}${reader}</div>`;
}

/** Membership storefront card. */
function tier(ev) {
  const members = new Set(allEvents().filter(e => e.kind === 7003 && tag(e, 'a') === address(ev)).map(e => tag(e, 'P'))).size;
  const perks = tags(ev, 'perk').map(t => `<li>${SYM.check}${esc(t[1])}</li>`).join('');
  return `<div class="ctier"><div class="k">Membership</div><div class="row"><div><div class="t">${esc(tag(ev, 'title') || tag(ev, 'd'))}</div>${ev.content ? `<div class="s">${esc(ev.content)}</div>` : ''}</div><div class="price">${esc(priceOf(ev))}</div></div>${perks ? `<ul>${perks}</ul>` : ''}<div class="row foot"><span class="s">${SYM.people} ${plural(members, 'member')} · renews automatically over Lightning</span><button class="cprimary" ${preview(ev.id, 'subscribe')}>Subscribe</button></div></div>`;
}
function subscription(ev) {
  const t = tierFor(tag(ev, 'a'));
  return `<div class="cledger"><span class="ico join">${SYM.people}</span><span><b>${esc(nameOf(ev.pubkey))}</b> joined ${esc(nameOf(tag(ev, 'p')))}${t ? `'s <b>${esc(tierTitle(tag(ev, 'a')))}</b>` : ''} · ${esc(amountText(ev))}</span><span class="ctime">${esc(ago(ev.created_at))}</span></div>`;
}
function unsubscription(ev) {
  return `<div class="cledger"><span class="ico">${SYM.people}</span><span><b>${esc(nameOf(ev.pubkey))}</b> left ${esc(nameOf(tag(ev, 'p')))}</span><span class="ctime">${esc(ago(ev.created_at))}</span></div>`;
}
function receipt(ev) {
  const v = ev.tags.find(t => t[0] === 'valid'); const amount = tag(ev, 'gate_amount');
  return `<div class="cledger"><span class="ico ok">${SYM.check}</span><span><b>Payment confirmed</b> · ${esc(nameOf(tag(ev, 'P')))} → ${esc(nameOf(tag(ev, 'p')))} · ${esc(tierTitle(tag(ev, 'a')) || tag(ev, 'tier') || '')}${amount ? ` · <b>${Number(amount).toLocaleString()} sats</b>` : ''}${v ? `<small>Valid until ${esc(fmtDate(+v[2]))}</small>` : ''}</span><span class="ctime">${esc(ago(ev.created_at))}</span></div>`;
}
function group(ev) {
  const members = allEvents().find(e => e.kind === 39002 && tag(e, 'd') === tag(ev, 'd'));
  const flags = ['public', 'private', 'open', 'closed'].filter(f => ev.tags.some(t => t[0] === f));
  return `<div class="ctier group"><div class="k">Community${tag(ev, 'parent') ? ` · in ${esc(tag(ev, 'parent'))}` : ''}</div><div class="t">${esc(tag(ev, 'name') || tag(ev, 'd'))}</div>${tag(ev, 'about') ? `<div class="s">${esc(tag(ev, 'about'))}</div>` : ''}<div class="row foot"><span class="s">${SYM.people} ${members ? plural(tags(members, 'p').length, 'member') : 'members unknown'}${flags.length ? ' · ' + flags.join(', ') : ''}</span><button class="cprimary" ${preview(ev.id, 'join')}>Join</button></div></div>`;
}

// ---------- profile page in client view ----------
export function clientProfileHeader(pk) {
  const p = profileOf(pk); const mine = allEvents().filter(e => e.pubkey === pk);
  const tiersList = mine.filter(e => e.kind === 37001); const articles = mine.filter(e => e.kind === 30023).length; const notes = mine.filter(e => e.kind === 1).length;
  const members = new Set(allEvents().filter(e => e.kind === 7003 && tag(e, 'p') === pk).map(e => tag(e, 'P'))).size;
  const stat = (n, w) => `<span><b>${n}</b> ${w}${n === 1 ? '' : 's'}</span>`;
  const tiles = tiersList.map(t => `<div class="ctile"><div class="t">${esc(tag(t, 'title') || tag(t, 'd'))}</div><div class="price">${esc(priceOf(t))}</div>${tags(t, 'perk').slice(0, 2).map(x => `<div class="s">${SYM.check} ${esc(x[1])}</div>`).join('')}<button class="cprimary" ${preview(t.id, 'subscribe')}>Subscribe</button></div>`).join('');
  return `<div class="cprofile"><div class="banner" style="${p.banner && settings.media ? `background-image:url(${esc(p.banner)})` : ''}"></div><div class="ph">${avatar(pk, 'l')}<div class="who"><h2>${esc(nameOf(pk))}${isCreator(pk) ? '<span class="ctag">Creator</span>' : ''}</h2><div class="hd">${p.nip05 ? esc(p.nip05) : esc(handle(pk))}</div></div>${p.about ? `<p class="about">${esc(p.about)}</p>` : ''}<div class="stats">${stat(notes, 'note')}${stat(articles, 'article')}${members ? stat(members, 'member') : ''}</div>${p.website ? `<a class="clink inline" href="${esc(p.website)}" target="_blank" rel="noopener">${SYM.link}<span><b>${esc(p.website.replace(/^https?:\/\//, ''))}</b></span></a>` : ''}${tiles ? `<div class="k">Memberships</div><div class="ctiles">${tiles}</div>` : ''}</div></div>`;
}

/** The concrete command for an action on this event, signed by the acting identity if there is one. */
export function previewAction(what, ev, relays) {
  const rel = relays.join(' ') + ' < /dev/null';
  const t = ev.kind === 37001 ? ev : tierFor(tag(ev, 'a'));
  const sec = '--sec <nsec>';
  switch (what) {
    case 'react': return { title: 'React', note: 'Pick a reaction. A kind 7 event pointing at this note is published to the connected relays.', emojis: ['+', '🔥', '👍', '🤙', '⚡︎', '🫡'], command: e => `nak event -k 7 -c ${sq(e)} -e ${ev.id} -p ${ev.pubkey} ${sec} ${rel}` };
    case 'reply': return { title: 'Reply', note: 'Your text goes into a kind 1 note whose e tag is marked reply (NIP-10).', text: true, command: txt => `nak event -k 1 -c ${sq(txt)} -t ${sq(`e=${ev.id};;reply`)} -p ${ev.pubkey} ${sec} ${rel}` };
    case 'repost': return { title: 'Repost', note: 'A kind 6 repost carrying the original event.', command: () => `nak event -k 6 -c ${sq(JSON.stringify(ev, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']))} -e ${ev.id} -p ${ev.pubkey} ${sec} ${rel}` };
    case 'subscribe': return t ? { title: 'Subscribe', note: `A kind 7001 subscribe event for “${tierTitle(address(t))}”. nostr-gate then issues the invoice and, once paid, the kind 7003 receipt.`, command: () => `nak event -k 7001 -p ${t.pubkey} -t ${sq(`a=${address(t)}`)} -t ${sq(`amount=${tag(t, 'amount')};msats;${tags(t, 'amount')[0]?.[3] || 'monthly'}`)} ${sec} ${rel}` } : { title: 'Subscribe', note: 'The tier this article belongs to is not loaded on any connected relay, so there is nothing to subscribe to yet.' };
    case 'join': return { title: 'Join', note: 'A kind 9021 join request to the group (NIP-29). The relay answers by adding you, or by waiting for an admin.', command: () => `nak event -k 9021 -t ${sq(`h=${tag(ev, 'd') || tag(ev, 'h') || ''}`)} ${sec} ${rel}` };
    case 'zap': return { title: 'Zap', note: 'Zaps need a Lightning wallet: a client fetches the author\'s Lightning address, pays the invoice and the wallet publishes a kind 9735 receipt. nak has no wallet, so this stays a preview.', steps: ['Read lud16 from the profile', 'Request an invoice with a kind 9734 zap request', 'Pay it; the receipt (kind 9735) lands on the relay'] };
    default: return { title: what, note: '' };
  }
}
const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** What a client would do for each preview action, and where the nak command lives. */
export function previewText(what, ev) {
  const t = ev.kind === 37001 ? ev : tierFor(tag(ev, 'a'));
  const steps = {
    subscribe: [`Create a kind 7001 subscribe event for ${esc(t ? tierTitle(address(t)) : 'the tier')}.`, 'Pay the invoice over CLINK or NWC.', 'Receive a kind 7003 receipt that unlocks the content.'],
    zap: ['Fetch the author\'s Lightning address from their profile.', 'Pay the invoice from your wallet.', 'A kind 9735 zap receipt lands on the relay.'],
    react: ['Publish a kind 7 reaction pointing at this event.'],
    reply: ['Publish a kind 1 note with an e tag marked reply.'],
    repost: ['Publish a kind 6 repost carrying the original.'],
    join: ['Publish a kind 9021 join request to the group\'s relay.'],
  }[what] || ['Publish an event.'];
  return { title: { subscribe: 'Subscribe', zap: 'Zap', react: 'React', reply: 'Reply', repost: 'Repost', join: 'Join' }[what] || what, steps, nakFor: t && what === 'subscribe' ? t.id : ev.id };
}
