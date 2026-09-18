// Technical window: sortable table of every event plus the inspector on the right.
import { esc, fmtTime, shortHex, plural } from '../format.js';
import { label } from '../kinds.js';
import { isEphemeral } from '../nostr.js';
import { store, ui, settings, allEvents, relayName, activeUrls, scopeMatches } from '../state.js';
import { nameOf, npub } from '../people.js';
import { matchesSearch } from './social.js';
import { inspectorHtml, ICON, nakList } from './inspector.js';
import { forFilter } from '../nak.js';

const $ = id => document.getElementById(id);
export const sort = { key: 'created_at', dir: -1 };
const COLS = [['created_at', 'Time'], ['kind', 'Kind'], ['label', 'Label'], ['pubkey', 'Author'], ['id', 'Id'], ['tags', 'Tags'], ['relays', 'Seen on']];

const MAX_ROWS = 500;   // thousands of rows would make every live render slow; the count and the filter cover the rest
const moreRow = total => total > MAX_ROWS ? `<tr class="more"><td colspan="${COLS.length}">Showing the first ${MAX_ROWS} of ${total.toLocaleString()} rows. Narrow the list with the filter, the sidebar or a sort.</td></tr>` : '';

export function techRows() {
  const val = (ev, k) => k === 'label' ? label(ev.kind) : k === 'tags' ? ev.tags.length : k === 'relays' ? ev._seen.size : ev[k];
  return allEvents().filter(ev => scopeMatches(ev) && matchesSearch(ev))
    .sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir || b.created_at - a.created_at; });
}

export function renderTechnical() {
  document.querySelector('.tech').classList.toggle('noinsp', !ui.inspOpen);
  $('thead').innerHTML = COLS.map(([k, l]) => `<th ${sort.key === k ? `aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}><button data-action="sort" data-key="${k}">${l}<span class="arrow">${sort.dir > 0 ? '▲' : '▼'}</span></button></th>`).join('');
  const rows = techRows();
  $('count').textContent = `${rows.length} of ${plural(store.events.size, 'event')}`;
  $('rows').innerHTML = rows.slice(0, MAX_ROWS).map(ev => `<tr class="row${ev._fresh ? ' fresh' : ''}" data-action="row" data-id="${ev.id}" aria-selected="${ui.selected === ev.id}"><td>${esc(fmtTime(ev.created_at))}</td><td>${ev.kind}</td><td>${esc(label(ev.kind))}${isEphemeral(ev.kind) ? ' <span style="color:var(--orange)">live</span>' : ''}</td><td class="mono" title="${esc(npub(ev.pubkey))}">${esc(nameOf(ev.pubkey).slice(0, 18))}</td><td class="mono">${shortHex(ev.id)}</td><td class="mono">${esc(ev.tags.map(t => t[0]).join(' '))}</td><td>${[...ev._seen].map(u => `<span class="rchip">${esc(relayName(u))}</span>`).join('')}</td></tr>`).join('') + moreRow(rows.length);
  renderInspector();
}

export function renderInspector() {
  const ev = store.events.get(ui.selected);
  if (ev) { $('inspector').innerHTML = inspectorHtml(ev, ui.inspTab, 'technical'); return; }
  const query = nakList(forFilter({ kind: ui.scope.type === 'kind' ? ui.scope.value : 'all', search: ui.search }, activeUrls().join(' ') || settings.relays[0].url), { foot: false });
  $('inspector').innerHTML = `<div class="empty" style="padding-bottom:24px"><div class="glyph">${ICON.code}</div><h3>No Selection</h3><div>Select a row, or use ↑ and ↓.</div></div><div class="insp-body">${query}</div>`;
}
