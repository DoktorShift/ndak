// Query and Compare: run one NIP-01 filter against several relays on separate sockets, add what comes back
// to the window with its seen-on relays, and show a presence matrix of what each relay returned.
import { esc, fmtDate, ago, plural, shortHex, shellQuote } from '../format.js';
import { label } from '../kinds.js';
import { settings, addEvent, relayName, relayLabel, activeUrls } from '../state.js';
import { nameOf } from '../people.js';
import { parseQuery, toFilter, isEmpty, QUERY_HELP } from '../query.js';
import * as relay from '../relay.js';
import { openSheet } from './overlays.js';
import { emit } from '../bus.js';

const $ = id => document.getElementById(id);
let last = null;   // results of the last run, for "show all" toggles

export function querySheet(prefill = '') {
  const checked = new Set(relay.connectedUrls().length ? relay.connectedUrls() : activeUrls());
  const relays = settings.relays.map(r => `<label class="qrelay"><input type="checkbox" data-url="${esc(r.url)}" ${checked.has(r.url) ? 'checked' : ''}> ${esc(relayLabel(r))} <small>${esc(r.url.replace(/^wss?:\/\//, ''))}</small></label>`).join('');
  openSheet('Query and Compare', `<div class="settings">
    <div class="sect">Filter</div><div class="inset"><div class="irow" style="display:block"><input id="qText" type="text" class="qfield" value="${esc(prefill)}" placeholder="kind:1 author:alice #t:gold since:2h  (empty = everything)" autocomplete="off" spellcheck="false"><div class="hint" style="margin-top:6px">${esc(QUERY_HELP)}. Free text becomes a NIP-50 search where the relay supports it.</div></div>
      <div class="irow"><span>Limit per relay</span><select id="qLimit">${[50, 200, 500, 2000].map(n => `<option ${n === 200 ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <div class="sect">Relays</div><div class="inset" id="qRelays">${relays}</div>
    <div class="row" style="display:flex;gap:8px;align-items:center;margin:0 0 12px"><button class="cprimary" data-action="query-run">Run</button><label class="hint"><input type="checkbox" id="qAdd" checked> Add results to the window</label><span class="spacer"></span><button class="copy" data-action="query-nak">Copy as nak</button></div>
    <div id="qResults"></div></div>`, { wide: true });
  $('qText').focus();
  $('qText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runQuery(); } });
}

function currentFilter() {
  const q = parseQuery($('qText').value); const limit = +$('qLimit').value;
  return { q, filter: toFilter(q, limit), urls: [...$('qRelays').querySelectorAll('input:checked')].map(i => i.dataset.url) };
}

export async function runQuery() {
  const { filter, urls } = currentFilter(); const out = $('qResults');
  if (!urls.length) { out.innerHTML = '<div class="hint">Pick at least one relay.</div>'; return; }
  out.innerHTML = `<div class="progress" style="margin:4px 0 10px"><i></i></div><div class="hint">Asking ${plural(urls.length, 'relay')}…</div>`;
  const [results, counts] = await Promise.all([Promise.all(urls.map(u => relay.queryOnce(u, filter))), Promise.all(urls.map(u => relay.countOnce(u, { ...filter, limit: undefined })))]);
  last = { filter, results, counts, showAll: false };
  if ($('qAdd').checked) { let added = 0; for (const r of results) for (const ev of r.events) if (addEvent(ev, false, r.url) === 'new') added++; if (added) emit('render'); last.added = added; }
  renderResults();
}

function renderResults() {
  const { filter, results, counts, showAll, added } = last; const out = $('qResults');
  const union = new Map(); for (const r of results) for (const ev of r.events) { const row = union.get(ev.id) || { ev, on: new Set() }; row.on.add(r.url); union.set(ev.id, row); }
  const rows = [...union.values()].sort((a, b) => b.ev.created_at - a.ev.created_at);
  const per = results.map((r, i) => { const only = r.events.filter(e => union.get(e.id).on.size === 1).length; return `<tr><td><span class="rchip">${esc(relayName(r.url))}</span></td><td>${statusText(r)}</td><td class="mono">${r.ms} ms</td><td class="mono">${r.events.length}</td><td class="mono">${counts[i] === null ? '<span class="muted">no COUNT</span>' : counts[i]}</td><td class="mono">${only}</td></tr>`; }).join('');
  const diff = rows.filter(x => x.on.size !== results.length);
  const shown = showAll ? rows : diff;
  const matrix = results.length > 1 ? `<div class="sect" style="margin-top:14px">Presence${diff.length ? ` · ${plural(diff.length, 'difference')}` : ' · identical'}${rows.length ? ` <button class="copy" data-action="query-toggle">${showAll ? 'Show differences' : `Show all ${rows.length}`}</button>` : ''}</div>
    ${shown.length ? `<div class="tablewrap" style="border:1px solid var(--sep);border-radius:8px;max-height:320px"><table class="qmatrix"><thead><tr><th>Event</th>${results.map(r => `<th>${esc(relayName(r.url))}</th>`).join('')}</tr></thead><tbody>${shown.slice(0, 300).map(x => `<tr><td><button class="linkbtn" data-action="details" data-id="${x.ev.id}"><b>${x.ev.kind} ${esc(label(x.ev.kind))}</b> · ${esc(nameOf(x.ev.pubkey))} · ${esc(ago(x.ev.created_at))} <span class="mono muted">${shortHex(x.ev.id)}</span></button></td>${results.map(r => `<td class="mark">${x.on.has(r.url) ? '<span class="ok">✓</span>' : '<span class="no">–</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="hint">Every relay returned the same set.</div>'}` : '';
  out.innerHTML = `<div class="sect">Results${added !== undefined ? ` · ${added} new in the window` : ''}</div><div class="tablewrap" style="border:1px solid var(--sep);border-radius:8px"><table><thead><tr><th>Relay</th><th>Status</th><th>Time</th><th>Returned</th><th>COUNT</th><th>Only here</th></tr></thead><tbody>${per}</tbody></table></div>
    <details class="disc" style="margin-top:10px"><summary>Filter sent</summary><pre>${esc(JSON.stringify(filter))}</pre></details>${matrix}`;
}
function statusText(r) {
  const notices = r.messages.filter(m => m[0] === 'NOTICE' || m[0] === 'CLOSED').map(m => m[m.length - 1]).join('; ');
  return { ok: '<span class="ok">EOSE</span>', timeout: '<span class="no">timeout</span>', closed: '<span class="no">closed</span>', unreachable: '<span class="no">unreachable</span>', invalid: '<span class="no">invalid</span>' }[r.status] + (notices ? ` <small class="muted">${esc(notices)}</small>` : '');
}
export function toggleAll() { if (last) { last.showAll = !last.showAll; renderResults(); } }
/** The same query for the terminal: nak reads a filter from stdin. */
export function nakForQuery() {
  const { filter, urls } = currentFilter();
  return `echo ${shellQuote(JSON.stringify(filter))} | nak req ${urls.join(' ')}`;
}
