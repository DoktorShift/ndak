// The nak terminal: a bottom panel that runs commands through the local agent and shows each run as a block
// (command, output, status). Quiet chrome, keyboard first. Output is batched per animation frame and capped per block.
import { AGENT } from '../agent.js';
import { esc, ago } from '../format.js';
import { label } from '../kinds.js';
import { settings, saveSettings, ui, addEvent, store } from '../state.js';
import { nameOf, npub } from '../people.js';
import { emit } from '../bus.js';
import { openMenu, closeOverlays } from './overlays.js';
import { decodeCode } from '../nostr.js';

const $ = id => document.getElementById(id);
const START_CMD = 'docker compose up -d agent';
const MAX_LINES = 5000;          // per block; the rest is counted and kept for export
const SUGGESTIONS = ['nak req -l 20 ws://localhost:7777', 'nak req -k 0 -k 3 -l 50 ws://localhost:7777 | jq -c {kind,pubkey}', 'nak relay localhost:7777', 'nak req --stream ws://localhost:7777'];

let agent = { ok: false };
let history = []; let cursor = -1; let draft = '';
const runs = new Map();          // id -> { block, controller, lines: [], hidden, start, status }
let seq = 0; let pinned = true; let unseen = 0;
try { history = JSON.parse(localStorage.getItem('relay-window-terminal-history') || '[]'); } catch { /* ignore */ }

// ---------- panel ----------
export function isOpen() { return ui.terminalOpen; }
export function toggle(open = !ui.terminalOpen) {
  ui.terminalOpen = open; $('terminal').hidden = !open; $('terminalBtn').setAttribute('aria-pressed', open);
  if (open) { checkAgent(); renderEmpty(); $('termInput').focus(); }
}
/** Run a command, or prefill it when it still carries a placeholder to fill in. */
export function show(cmd) {
  if (!ui.terminalOpen) toggle(true);
  if (!cmd) return;
  $('termInput').value = cmd;
  if (IDENTITY_PLACEHOLDER.test(cmd)) { askIdentity(cmd); return; }
  const ph = cmd.search(/<[a-z ]+>/i);
  if (ph >= 0) { $('termInput').focus(); $('termInput').setSelectionRange(ph, cmd.indexOf('>', ph) + 1); }
  else run(cmd);
}
/** Typed commands: a few shell habits are handled here; everything else goes to the agent. */
const BUILTINS = {
  clear: () => clear(), cls: () => clear(),
  help: () => note('help', ['Runs nak and jq on this Mac; pipes work, nothing else does.', 'clear · history · help are handled here.', '↑ ↓ history  ⌘K clear  ⌘F find  ⌘. stop  ⌘↑ ⌘↓ between commands', `Keys: ${(agent.identities || []).map(n => '$' + n).join('  ') || 'none (start the agent)'}`]),
  history: () => note('history', history.length ? history.slice(0, 30).map((h, i) => `${String(i + 1).padStart(3)}  ${h}`) : ['empty']),
};
function note(title, lines) { const r = newBlock(title); for (const l of lines) push(r, 'o', l); finish(r, 'ok'); }
function submit(cmd) {
  const word = cmd.trim().toLowerCase();
  if (BUILTINS[word]) { $('termInput').value = ''; BUILTINS[word](); return; }
  if (IDENTITY_PLACEHOLDER.test(cmd)) askIdentity(cmd); else run(cmd);
}

async function checkAgent() {
  try { const r = await fetch(`${AGENT}/health`); agent = await r.json(); } catch { agent = { ok: false }; }
  renderMeta(); renderEmpty();
}
export function retry() { checkAgent(); }
function renderMeta() {
  const running = [...runs.values()].filter(r => r.status === 'running').length;
  $('termDot').className = 'tdot' + (agent.ok ? ' on' : '');
  $('termMeta').textContent = agent.ok ? `${(agent.nak || '').replace('nak version ', '')}${running ? ` · ${running} running` : ''}` : 'agent not running';
  $('termIn').classList.toggle('running', running > 0);
}
function renderEmpty() {
  const out = $('termOut'); const empty = out.querySelector('.tempty');
  if (runs.size) { empty?.remove(); return; }
  const html = agent.ok
    ? `<div class="tempty"><p>Runs nak on this Mac through the agent. Event lines become rows you can inspect.</p><div class="tsug">${SUGGESTIONS.map(c => `<button class="tsg" data-action="term-suggest" data-cmd="${esc(c)}"><span class="tbp">❯</span>${esc(c)}</button>`).join('')}</div><p class="tkeys"><kbd>↑</kbd> history <kbd>⌘K</kbd> clear <kbd>⌘F</kbd> find <kbd>⌘.</kbd> stop <kbd>⌘↑</kbd> previous command${agent.identities?.length ? ` · keys ${agent.identities.map(n => `<code>$${esc(n)}</code>`).join(' ')}` : ''}</p></div>`
    : `<div class="tempty"><p>The agent is not running. Start it from the project folder, then commands run from here.</p><div class="tsug"><div class="tsg static"><code>${esc(START_CMD)}</code><button class="copy" data-action="copy" data-text="${esc(START_CMD)}">Copy</button><button class="copy" data-action="term-retry">Retry</button></div></div></div>`;
  if (empty) empty.outerHTML = html; else out.insertAdjacentHTML('afterbegin', html);
}

// ---------- blocks ----------
function newBlock(cmd) {
  const id = ++seq; const el = document.createElement('section'); el.className = 'trun running'; el.dataset.run = id;
  el.innerHTML = `<header class="tbh"><span class="tbp" aria-hidden="true">❯</span><code class="tbc" data-action="term-edit" data-cmd="${esc(cmd)}" title="Click to edit and run again">${esc(cmd)}</code><span class="tbm"><span class="tbt"></span><span class="tbs"><span class="spin" aria-label="running"></span></span></span><span class="tba"><button class="tbb" data-action="term-stop" data-run="${id}" title="Stop (⌘.)">Stop</button><button class="tbb" data-action="term-rerun" data-cmd="${esc(cmd)}" title="Run again">Run Again</button><button class="tbb" data-action="term-copy-out" data-run="${id}" title="Copy output">Copy Output</button></span></header><div class="tbo"></div><div class="tbf" hidden></div>`;
  $('termOut').querySelector('.tempty')?.remove(); $('termOut').appendChild(el);
  const run = { id, block: el, cmd, lines: [], hidden: 0, start: performance.now(), status: 'running', controller: null, pending: [], raf: 0, net: { connected: [], published: [], failed: [], pending: null } };
  runs.set(id, run); renderMeta(); scrollToBottom(true); return run;
}
function finish(run, status, note) {
  run.status = status; run.controller = null; flush(run);
  const el = run.block; el.className = `trun ${status}`;
  const ms = performance.now() - run.start; el.querySelector('.tbt').textContent = ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  el.querySelector('.tbs').innerHTML = { ok: '<span class="ok" title="exit 0">✓</span>', err: `<span class="no" title="${esc(note || 'failed')}">✗ ${esc(note || '')}</span>`, stopped: '<span class="muted">stopped</span>', lost: '<span class="no">agent lost</span>' }[status] || '';
  el.querySelector('[data-action="term-stop"]').hidden = true;
  renderMeta();
}
/** nak narrates its relay work on stderr, one line per relay: "connecting to X... ok." or "publishing to X... failed: <why>".
 *  Those lines fold into one status line per run; nak's closing summary ("failed to connect to any…") is dropped once a failure is shown. */
const NET_STEP = /^(connecting|publishing) to (\S+?)\.\.\.\s*(.*)$/i;
const NET_OK = /^(ok|success)\.?$/i;
const NET_SUMMARY = /^failed to (connect to any of the given relays|publish to any of the relays)\.?$/i;
const netStep = text => { const m = NET_STEP.exec(text.trim()); return m && { kind: m[1].toLowerCase() === 'connecting' ? 'connected' : 'published', relay: m[2].replace(/^wss?:\/\//, ''), result: m[3] }; };
function netLine(run, text) {
  const step = netStep(text);
  if (step) { netResult(run, step.kind, step.relay, step.result || 'no answer'); return true; }
  return NET_SUMMARY.test(text.trim()) && run.net.failed.length > 0;
}
/** A line still being written ("connecting to X... ") shows as pending until its result arrives. */
function netPending(run, text) { const step = netStep(text); if (step && !step.result) { run.net.pending = step; renderNet(run); } }
function netResult(run, kind, relay, result) {
  if (NET_OK.test(result)) run.net[kind].push(relay); else run.net.failed.push(`${relay}: ${result.replace(/^failed:?\s*(msg:\s*)?/i, '')}`);
  run.net.pending = null; renderNet(run);
}
function renderNet(run) {
  const { connected, published, failed, pending } = run.net; const parts = [];
  if (connected.length) parts.push(`Connected to ${connected.map(esc).join(', ')}`);
  if (published.length) parts.push(`Published to ${published.map(esc).join(', ')}`);
  if (failed.length) parts.push(`<span class="no">Failed: ${failed.map(esc).join('; ')}</span>`);
  if (pending) parts.push(`${pending.kind === 'connected' ? 'Connecting' : 'Publishing'} to ${esc(pending.relay)}…`);
  let el = run.block.querySelector('.ln.net'); if (!el) { el = document.createElement('div'); el.className = 'ln net'; run.block.querySelector('.tbo').prepend(el); }
  el.innerHTML = parts.join(' · ');
}
/** Queue a line; the DOM is touched once per frame. */
function push(run, kind, text) {
  if (kind === 'e' && netLine(run, text)) return;
  run.lines.push(text);
  if (run.lines.length > MAX_LINES) { run.hidden++; return; }
  run.pending.push([kind, text]); if (!run.raf) run.raf = requestAnimationFrame(() => flush(run));
}
function flush(run) {
  run.raf = 0; if (!run.pending.length) { updateFooter(run); return; }
  const frag = document.createDocumentFragment();
  for (const [kind, text] of run.pending) frag.appendChild(lineNode(kind, text));
  run.pending = []; run.block.querySelector('.tbo').appendChild(frag); updateFooter(run);
  if (pinned) scrollToBottom(); else { unseen += 1; $('termNew').hidden = false; $('termNew').textContent = `↓ New output`; }
}
function updateFooter(run) { const f = run.block.querySelector('.tbf'); if (run.hidden) { f.hidden = false; f.innerHTML = `${run.hidden.toLocaleString()} more lines not shown · <button class="linkbtn" data-action="term-export" data-run="${run.id}">Export all ${run.lines.length.toLocaleString()} lines…</button>`; } }

// ---------- lines ----------
const ANSI = /\x1b\[([0-9;]*)m/g;   // SGR: colour and weight
const OTHER_ESC = /\x1b\[[0-9;?]*[A-LN-Za-ln-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[^[\]()]/g;   // every other escape is dropped (not m: that is SGR)
const TOKENS = /(https?:\/\/[^\s"'<>]+|wss?:\/\/[^\s"'<>]+|\b[0-9a-f]{64}\b|\b(?:npub|nprofile|note|nevent|naddr|nsec)1[02-9ac-hj-np-z]{20,}\b)/g;
function lineNode(kind, raw) {
  const cr = raw.lastIndexOf('\r'); const text = cr >= 0 ? raw.slice(cr + 1) : raw;   // carriage-return overwrite keeps the last segment
  if (kind === 'o') { const ev = eventLine(text); if (ev) return ev; }
  const div = document.createElement('div'); div.className = `ln ${kind}${kind === 'e' && /\b(error|invalid|failed|not allowed|refused|denied)\b/i.test(text) ? ' err' : ''}`;
  div.innerHTML = renderText(text); div.dataset.raw = text; return div;
}
/** Plain text with SGR colours honoured, other escapes dropped, and recognisable identifiers made actionable. */
function renderText(text) {
  const parts = text.split(ANSI); let html = ''; let cls = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { for (const code of parts[i].split(';').filter(Boolean).map(Number)) { if (code === 0) cls = []; else if (code === 1) cls.push('b'); else if (code === 2) cls.push('dim'); else if (code === 3) cls.push('i'); else if (code === 4) cls.push('u'); else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) { cls = cls.filter(c => !c.startsWith('fg')); cls.push(`fg${code}`); } else if (code === 39) cls = cls.filter(c => !c.startsWith('fg')); } continue; }
    if (!parts[i]) continue;
    const plain = parts[i].replace(OTHER_ESC, '');
    const tokenised = plain.length > 4000 ? esc(plain) : esc(plain).replace(TOKENS, m => tokenSpan(m));
    html += cls.length ? `<span class="a ${cls.join(' ')}">${tokenised}</span>` : tokenised;
  }
  return html;
}
function tokenSpan(m) {
  if (/^nsec1/.test(m)) return `<span class="tok secret" title="a secret key was printed; nothing here shares it">${m.slice(0, 8)}…</span>`;
  const kind = /^https?:/.test(m) ? 'url' : /^wss?:/.test(m) ? 'relay' : /^[0-9a-f]{64}$/.test(m) ? 'hex' : 'code';
  return `<span class="tok ${kind}" data-tok="${kind}" data-value="${esc(m)}" role="button" tabindex="-1">${m}</span>`;
}
/** A JSON line that is a signed event becomes one quiet row with actions on hover. */
function eventLine(text) {
  const s = text.trim(); if (!s.startsWith('{') || !s.endsWith('}')) return null;
  let ev; try { ev = JSON.parse(s); } catch { return null; }
  if (!ev || typeof ev.id !== 'string' || typeof ev.sig !== 'string' || typeof ev.kind !== 'number') return null;
  addEvent(ev, false, 'terminal'); emit('render');
  const div = document.createElement('div'); div.className = 'ln ev'; div.dataset.raw = s; div.dataset.id = ev.id;
  div.innerHTML = `<span class="evk"><span class="kn">${ev.kind}</span> ${esc(label(ev.kind))}</span><span class="evw">${esc(nameOf(ev.pubkey))}</span><span class="evt">${esc(ago(ev.created_at))}</span><span class="evid tok hex" data-tok="hex" data-value="${ev.id}" role="button" tabindex="-1">${ev.id.slice(0, 12)}…</span><span class="eva"><button class="tbb" data-action="details" data-id="${ev.id}">Inspect</button><button class="tbb" data-action="copy" data-text="${esc(s)}">Copy JSON</button><button class="tbb" data-action="term-raw" title="Show raw JSON">{ }</button></span><pre class="evraw" hidden>${esc(JSON.stringify(ev, null, 2))}</pre>`;
  return div;
}

// ---------- running ----------
export async function run(cmd) {
  cmd = cmd.trim(); if (!cmd) return;
  history = [cmd, ...history.filter(h => h !== cmd)].slice(0, 200); cursor = -1; draft = '';
  try { localStorage.setItem('relay-window-terminal-history', JSON.stringify(history)); } catch { /* ignore */ }
  $('termInput').value = ''; pinned = true;
  const r = newBlock(cmd); r.controller = new AbortController();
  try {
    const res = await fetch(`${AGENT}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd }), signal: r.controller.signal });
    if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); push(r, 'e', err.error || 'refused'); finish(r, 'err', 'refused'); return; }
    if (!agent.ok) checkAgent();
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const partial = { o: '', e: '' }; let exit = null;
    // Both streams arrive in chunks; only whole lines become rows. stdout keeps blank lines, stderr drops them.
    const takeLines = (kind, text) => { partial[kind] += text; const parts = partial[kind].split('\n'); partial[kind] = parts.pop(); for (const l of parts) if (l || kind === 'o') push(r, kind, l); if (kind === 'e') netPending(r, partial.e); };
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf('\n')) >= 0) { const chunk = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!chunk) continue; let msg; try { msg = JSON.parse(chunk); } catch { continue; }
        if (msg.o !== undefined) takeLines('o', msg.o);
        else if (msg.e !== undefined) takeLines('e', msg.e);
        else if (msg.x !== undefined) exit = msg.x; }
    }
    for (const kind of ['o', 'e']) if (partial[kind]) push(r, kind, partial[kind]);
    finish(r, exit === 0 ? 'ok' : exit === null ? 'stopped' : 'err', exit === null ? '' : `exit ${exit}`);
  } catch (e) {
    if (e.name === 'AbortError') finish(r, 'stopped');
    else { push(r, 'e', `agent unreachable — ${START_CMD}`); finish(r, 'lost'); agent = { ok: false }; renderMeta(); }
  }
}
export function stop(id) {
  const targets = id ? [runs.get(+id)] : [...runs.values()].filter(r => r.status === 'running');
  for (const r of targets) r?.controller?.abort();
}
export function clear() { for (const r of runs.values()) r.controller?.abort(); runs.clear(); $('termOut').innerHTML = ''; unseen = 0; $('termNew').hidden = true; renderEmpty(); renderMeta(); }
function historyStep(dir) {
  if (!history.length) return;
  if (cursor === -1) draft = $('termInput').value;
  cursor = Math.min(history.length - 1, Math.max(-1, cursor + dir));
  $('termInput').value = cursor === -1 ? draft : history[cursor];
}
export const outputOf = id => { const r = runs.get(+id); return r ? r.lines.join('\n') : ''; };
const allText = () => [...runs.values()].map(r => `❯ ${r.cmd}\n${r.lines.join('\n')}`).join('\n\n');
export function exportRun(id) { const r = runs.get(+id); if (!r) return; const blob = new Blob([r.lines.join('\n') + '\n'], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `nak-${r.id}.txt`; a.click(); }

// ---------- scrolling ----------
function scrollToBottom(force) { const out = $('termOut'); out.scrollTop = out.scrollHeight; if (force) pinned = true; unseen = 0; $('termNew').hidden = true; }
export function jumpToBottom() { scrollToBottom(true); }
/** ⌘↑ / ⌘↓: the previous or next command header, like marks in Terminal. */
function jumpBlock(dir) {
  const out = $('termOut'); const heads = [...out.querySelectorAll('.tbh')]; if (!heads.length) return;
  const base = out.getBoundingClientRect().top; const posOf = h => h.getBoundingClientRect().top - base + out.scrollTop;   // relative to the scroll container
  const positions = heads.map(posOf); const top = out.scrollTop;
  let idx = dir < 0 ? positions.filter(p => p < top - 2).length - 1 : positions.findIndex(p => p > top + 10);   // the current header sits 6pt below the top
  if (idx === -1) idx = dir < 0 ? 0 : heads.length - 1;
  pinned = false; out.scrollTo({ top: Math.max(0, positions[idx] - 6), behavior: 'smooth' });
}

// ---------- find ----------
let matches = []; let matchIdx = -1;
function openFind() { $('termSearch').hidden = false; $('termFind').focus(); $('termFind').select(); }
export function closeFind() { $('termSearch').hidden = true; clearMarks(); $('termFind').value = ''; $('termFindCount').textContent = ''; $('termInput').focus(); }
function clearMarks() { for (const el of $('termOut').querySelectorAll('.ln.hit, .tbc.hit')) { el.classList.remove('hit', 'cur'); el.querySelectorAll('mark').forEach(m => m.replaceWith(document.createTextNode(m.textContent))); el.normalize(); } matches = []; matchIdx = -1; }
export function find(q) {
  clearMarks(); if (!q) { $('termFindCount').textContent = ''; return; }
  const needle = q.toLowerCase();
  for (const el of $('termOut').querySelectorAll('.ln, .tbc')) {
    if (!el.textContent.toLowerCase().includes(needle)) continue;
    el.classList.add('hit'); markText(el, needle); matches.push(el);
  }
  $('termFindCount').textContent = matches.length ? `${matches.length}` : 'none';
  if (matches.length) { matchIdx = -1; step(1); }
}
function markText(el, needle) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) { const text = node.nodeValue; const i = text.toLowerCase().indexOf(needle); if (i < 0) continue; const m = document.createElement('mark'); m.textContent = text.slice(i, i + needle.length); const after = document.createTextNode(text.slice(i + needle.length)); node.nodeValue = text.slice(0, i); node.parentNode.insertBefore(m, node.nextSibling); m.parentNode.insertBefore(after, m.nextSibling); }
}
export function step(dir) {
  if (!matches.length) return; matches[matchIdx]?.classList.remove('cur');
  matchIdx = (matchIdx + dir + matches.length) % matches.length; const el = matches[matchIdx]; el.classList.add('cur');
  pinned = false; el.scrollIntoView({ block: 'center' }); $('termFindCount').textContent = `${matchIdx + 1} of ${matches.length}`;
}

// ---------- menus ----------
export function moreMenu(anchor) {
  openMenu([
    { label: 'Find…', sub: '⌘F', action: openFind },
    { label: 'Clear', sub: '⌘K', action: clear },
    { label: 'Copy All', action: () => navigator.clipboard.writeText(allText()).catch(() => {}) },
    { label: 'Export Session…', action: () => { const blob = new Blob([allText() + '\n'], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `nak-session-${Date.now()}.txt`; a.click(); } },
    'sep',
    { title: agent.ok ? `Agent · nak ${(agent.nak || '').replace('nak version ', '')}` : 'Agent not running' },
    ...(agent.ok ? [{ label: `Keys: ${(agent.identities || []).map(n => '$' + n).join('  ') || 'none'}`, action: () => {} }] : [{ label: 'Copy Start Command', action: () => navigator.clipboard.writeText(START_CMD).catch(() => {}) }, { label: 'Retry Connection', action: checkAgent }]),
    'sep',
    { label: 'Close Terminal', sub: 'T', action: () => toggle(false) },
  ], anchor);
}
function blockMenu(id, anchor) {
  const r = runs.get(+id); if (!r) return;
  openMenu([
    { label: 'Run Again', action: () => run(r.cmd) },
    { label: 'Edit Command', action: () => { $('termInput').value = r.cmd; $('termInput').focus(); } },
    'sep',
    { label: 'Copy Command', action: () => navigator.clipboard.writeText(r.cmd).catch(() => {}) },
    { label: 'Copy Output', action: () => navigator.clipboard.writeText(r.lines.join('\n')).catch(() => {}) },
    { label: 'Export Output…', action: () => exportRun(r.id) },
    'sep',
    ...(r.status === 'running' ? [{ label: 'Stop', sub: '⌘.', action: () => stop(r.id) }] : []),
    { label: 'Remove Block', destructive: true, action: () => { r.controller?.abort(); runs.delete(r.id); r.block.remove(); renderEmpty(); renderMeta(); } },
  ], anchor);
}
/** Identifiers in the output: one small menu, no permanent UI. */
function tokenMenu(el) {
  const kind = el.dataset.tok; const value = el.dataset.value; const items = [];
  const copy = t => () => navigator.clipboard.writeText(t).catch(() => {});
  if (kind === 'hex') {
    const ev = store.events.get(value); const isPk = [...store.profiles.keys()].includes(value) || [...store.events.values()].some(e => e.pubkey === value);
    if (ev) items.push({ label: `Inspect ${ev.kind} ${label(ev.kind)}`, action: () => emit('details', value) });
    if (isPk) items.push({ label: `Open Profile · ${nameOf(value)}`, action: () => emit('person', value) });
    if (!ev && !isPk) items.push({ label: 'Not loaded in the window', action: () => {} });
    items.push({ label: 'Search in Window', action: () => emit('search', ev ? `id:${value}` : `author:${value}`) });
    items.push('sep', { label: 'Copy Hex', action: copy(value) }, { label: 'Copy as npub', action: copy(npub(value)) });
  } else if (kind === 'code') {
    const d = decodeCode(value);
    if (d && (d.hrp === 'npub' || d.hrp === 'nprofile')) items.push({ label: `Open Profile · ${nameOf(d.hex)}`, action: () => emit('person', d.hex) }, { label: 'Copy Hex', action: copy(d.hex) });
    if (d && (d.hrp === 'note' || d.hrp === 'nevent')) items.push(store.events.get(d.hex) ? { label: 'Inspect Event', action: () => emit('details', d.hex) } : { label: 'Event not loaded', action: () => {} }, { label: 'Copy Id', action: copy(d.hex) });
    items.push('sep', { label: 'Copy', action: copy(value) });
  } else if (kind === 'relay') {
    items.push({ label: 'Add to Relay List', action: () => emit('add-relay', value) }, { label: 'Query This Relay…', action: () => emit('query', `relay:${value}`) }, 'sep', { label: 'Copy URL', action: copy(value) });
  } else items.push({ label: 'Open Link', action: () => window.open(value, '_blank', 'noopener') }, { label: 'Copy URL', action: copy(value) });
  openMenu(items, el);
}

// ---------- wiring ----------
const IDENTITY_PLACEHOLDER = /<(nsec|npub|pubkey|hex|pk)>/i;
function askIdentity(cmd) {
  const m = IDENTITY_PLACEHOLDER.exec(cmd); const kind = m[1].toLowerCase();
  const items = [{ title: kind === 'nsec' ? 'Sign as' : 'Which identity' }];
  for (const i of store.identities) items.push({ label: i.name, sub: i.source === 'demo' ? 'demo key' : npub(i.pubkey).slice(0, 14) + '…', action: () => show(fillIdentity(cmd, i)) });
  if (!store.identities.length) items.push({ label: 'No identities: start the agent or create one', action: () => {} });
  items.push('sep', { label: 'Edit by Hand', action: () => { $('termInput').focus(); const s = cmd.search(IDENTITY_PLACEHOLDER); $('termInput').setSelectionRange(s, cmd.indexOf('>', s) + 1); } });
  openMenu(items, $('termIn'));
}
const fillIdentity = (cmd, i) => cmd.replace(/<nsec>/gi, `$${i.name}`).replace(/<npub>/gi, npub(i.pubkey)).replace(/<(pubkey|hex|pk)>/gi, i.pubkey);

export function init() {
  const out = $('termOut'); const input = $('termInput');
  out.addEventListener('scroll', () => { pinned = out.scrollTop + out.clientHeight >= out.scrollHeight - 8; if (pinned) { unseen = 0; $('termNew').hidden = true; } });
  // Click in the output focuses the input, unless the person is selecting text or hit a control.
  out.addEventListener('click', e => { if (e.target.closest('[data-action], .tok, a, .evraw')) return; if (!getSelection().isCollapsed) return; input.focus(); });
  out.addEventListener('click', e => { const t = e.target.closest('.tok'); if (t) { e.stopPropagation(); closeOverlays(); tokenMenu(t); } });
  out.addEventListener('contextmenu', e => { const b = e.target.closest('.trun'); if (!b) return; e.preventDefault(); blockMenu(b.dataset.run, e.target.closest('.tbh') || b); });
  $('terminal').addEventListener('dblclick', e => { if (!e.target.closest('.thd') || e.target.closest('button, input')) return; const max = Math.max(120, $('main').clientHeight - 180); settings.terminalHeight = settings.terminalHeight >= max - 4 ? 260 : max; saveSettings(); emit('layout'); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submit(input.value); }
    else if (e.key === 'ArrowUp' && (input.selectionStart === 0 || cursor >= 0)) { e.preventDefault(); historyStep(1); }
    else if (e.key === 'ArrowDown' && cursor >= 0) { e.preventDefault(); historyStep(-1); }
  });
  $('termFind').addEventListener('input', e => find(e.target.value));
  $('termFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.stopPropagation(); closeFind(); } });
  // Standard shortcuts while the terminal has focus: ⌘F find, ⌘G next, ⌘K clear, ⌘. and ⌃C stop, ⌘↑ ⌘↓ between commands, Esc closes find.
  $('terminal').addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'f') { e.preventDefault(); openFind(); }
    else if (mod && e.key === 'g') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (mod && e.key === 'k') { e.preventDefault(); clear(); }
    else if ((e.metaKey && e.key === '.') || (e.ctrlKey && e.key === 'c' && getSelection().isCollapsed)) { e.preventDefault(); stop(); }
    else if (e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); jumpBlock(e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'Escape') { if (!$('termSearch').hidden) closeFind(); e.stopPropagation(); }
  });
}
