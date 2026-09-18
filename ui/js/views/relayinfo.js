// Relay details: the whole NIP-11 document, live probes of behaviour, and the protocol log.
import { esc, plural } from '../format.js';
import { nipTitle, nipNote, nipUrl } from '../kinds.js';
import { settings, store, relayLabel, relayName } from '../state.js';
import * as relay from '../relay.js';
import { openSheet } from './overlays.js';

const $ = id => document.getElementById(id);
const probes = new Map();   // url -> last probe results

export function relaySheet(url) {
  const picker = `<div class="seg" role="group" style="margin:0 0 12px;flex-wrap:wrap;height:auto">${settings.relays.map(r => `<button data-action="relay-details" data-url="${esc(r.url)}" aria-pressed="${r.url === url}">${esc(relayLabel(r))}</button>`).join('')}</div>`;
  openSheet('Relay Details', `<div class="settings">${picker}<div id="relayDetails">${detailsHtml(url)}</div></div>`, { wide: true });
}
export function refreshRelaySheet(url) { const el = $('relayDetails'); if (el) el.innerHTML = detailsHtml(url); }

function detailsHtml(url) {
  const info = store.relayInfo.get(url); const state = relay.stateOf(url); const seen = [...store.events.values()].filter(e => e._seen?.has(url)).length;
  const head = `<div class="inset"><div class="irow"><span><b>${esc(relayName(url))}</b><br><span class="hint mono">${esc(url)}</span></span><span class="hint">${state === 'live' ? 'connected · live' : state} · ${plural(seen, 'event')} seen</span><span style="display:flex;gap:4px"><button class="copy" data-action="relay-toggle" data-url="${esc(url)}">${relay.isConnected(url) ? 'Disconnect' : 'Connect'}</button><button class="copy" data-action="relay-nak-for" data-url="${esc(url)}">nak…</button></span></div></div>`;
  const nip11 = info === undefined ? '<div class="hint">Not fetched yet: connect to load the NIP-11 document.</div>' : info === null ? '<div class="hint">This relay serves no NIP-11 document over http.</div>' : nip11Html(info);
  const p = probes.get(url);
  const probeHtml = `<div class="sect" style="margin-top:14px">Behaviour probes <button class="copy" data-action="relay-probe" data-url="${esc(url)}">${p ? 'Run Again' : 'Run Probes'}</button></div>${p ? `<div class="inset">${p.map(([k, v, cls]) => `<div class="irow"><span>${esc(k)}</span><span class="${cls || ''}">${v}</span></div>`).join('')}</div>` : '<div class="hint" style="padding:2px 12px">Connect time, time to EOSE, COUNT and NIP-50 support, the relay\'s answer to a filter above its limit, and whether it asks for AUTH. Read-only: nothing is published.</div>'}`;
  const log = (store.log.get(url) || []).slice(-40).reverse();
  const logHtml = `<div class="sect" style="margin-top:14px">Protocol log <span class="hint">(everything except EVENT, newest first)</span></div>${log.length ? `<pre style="max-height:220px">${log.map(l => `${new Date(l.t).toLocaleTimeString()} ${l.dir === 'in' ? '←' : '→'} ${esc(JSON.stringify(l.msg)).slice(0, 300)}`).join('\n')}</pre>` : '<div class="hint">Nothing logged yet.</div>'}`;
  return head + `<div class="sect" style="margin-top:14px">NIP-11 information document</div>` + nip11 + probeHtml + logHtml;
}

function nip11Html(info) {
  const nips = (info.supported_nips || []).map(n => { const id = String(n).padStart(2, '0'); return `<a class="chip" href="${nipUrl(id)}" target="_blank" rel="noopener" title="${esc(nipNote(id) ? `${nipTitle(id)} · ${nipNote(id)}` : nipTitle(id))}">${n}${nipTitle(id) ? ` ${esc(nipTitle(id))}` : ''}${nipNote(id) ? ' <span class="note">· deprecated</span>' : ''}</a>`; }).join('');
  const skip = new Set(['supported_nips']);
  const rows = Object.entries(info).filter(([k]) => !skip.has(k)).map(([k, v]) => `<div class="irow" style="align-items:flex-start"><span style="min-width:140px">${esc(k)}</span><span class="hint" style="text-align:right;word-break:break-word">${valueHtml(v)}</span></div>`).join('');
  return `<div class="inset">${rows}</div><div class="sect">Supported NIPs (${(info.supported_nips || []).length})</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${nips || '<span class="hint">none listed</span>'}</div>`;
}
function valueHtml(v) {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  if (typeof v === 'object') return `<pre style="text-align:left;margin:0">${esc(JSON.stringify(v, null, 1))}</pre>`;
  if (/^https?:\/\//.test(String(v))) return `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
  return esc(String(v));
}

/** Read-only probes on separate sockets. */
export async function runProbes(url) {
  const t0 = Date.now(); const rows = [];
  const open = await new Promise(res => { let s; try { s = new WebSocket(url); } catch { return res(null); } const t = setTimeout(() => { s.close(); res(null); }, 5000); s.onopen = () => { clearTimeout(t); res(Date.now() - t0); s.close(); }; s.onerror = () => { clearTimeout(t); res(null); }; });
  rows.push(['Connect', open === null ? '<span class="no">failed</span>' : `${open} ms`]);
  const one = await relay.queryOnce(url, { limit: 1 }, 6000); rows.push(['REQ limit 1 → EOSE', one.status === 'ok' ? `${one.ms} ms · ${one.events.length} event` : `<span class="no">${one.status}</span>`]);
  const count = await relay.countOnce(url, { kinds: [1] }); rows.push(['COUNT (NIP-45)', count === null ? '<span class="no">not supported or no answer</span>' : `<span class="ok">supported</span> · ${count} kind-1 events`]);
  const search = await relay.queryOnce(url, { search: 'a', limit: 1 }, 6000); const searchNotice = search.messages.find(m => m[0] === 'NOTICE' || m[0] === 'CLOSED'); rows.push(['Search (NIP-50)', searchNotice ? `<span class="no">rejected</span> · ${esc(String(searchNotice[searchNotice.length - 1]))}` : search.status === 'ok' ? `<span class="ok">accepted</span> · ${search.events.length} result` : `<span class="no">${search.status}</span>`]);
  const big = await relay.queryOnce(url, { limit: 5000 }, 8000); const bigNotice = big.messages.find(m => m[0] === 'NOTICE' || m[0] === 'CLOSED'); rows.push(['REQ limit 5000', bigNotice ? `<span class="no">${esc(String(bigNotice[bigNotice.length - 1]))}</span>` : `${big.events.length} events returned (${big.status})`]);
  const auth = (store.log.get(url) || []).some(l => l.msg[0] === 'AUTH'); rows.push(['AUTH challenge (NIP-42)', auth ? 'sent by the relay' : 'not seen on this connection']);
  const info = store.relayInfo.get(url); rows.push(['NIP-11 limitation', info?.limitation ? esc(JSON.stringify(info.limitation)) : '<span class="muted">none published</span>']);
  probes.set(url, rows); refreshRelaySheet(url);
}
