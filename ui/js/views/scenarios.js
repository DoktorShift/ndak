// Scenarios: relay tests written as recipes that the agent runs. This sheet lists them, runs one against the chosen
// relays and draws the matrix while the run is going: one row per step, one column per relay, one glyph per cell.
// Results stay for the session, so a scenario can be reopened and compared after a config change.
import { esc, plural, fmtDate } from '../format.js';
import { settings, relayLabel, relayName, store } from '../state.js';
import * as relay from '../relay.js';
import { agentJson, agentStream } from '../agent.js';
import { openSheet, showAlert } from './overlays.js';
import * as editor from './scenario-editor.js';
import { identityLabel } from '../identities.js';
import { emit } from '../bus.js';

const $ = id => document.getElementById(id);
let scenarios = [];                 // what the agent lists
let agentError = '';
let current = null;                 // selected scenario id
const chosen = new Set();           // relay urls to run against
const openSteps = new Set();        // details disclosures the person opened
const runs = new Map();             // scenario id -> run
let mode = 'list';                  // 'list' or 'edit': the editor takes over the sheet body

const SHELL = '<div class="scen"><aside class="slist" aria-label="Scenarios"></aside><section class="sbody"></section></div>';
export async function scenariosSheet(pick, { edit = null, capture = null, recipe = null } = {}) {
  await refresh();
  if (!chosen.size) for (const u of relay.connectedUrls()) chosen.add(u);
  current = pick || (scenarios.some(s => s.id === current) ? current : scenarios[0]?.id || null);
  openSheet('Scenarios', SHELL, { wide: true, footer: ' ' });
  if (capture) { mode = 'edit'; editor.addStepFromEvent(capture, afterEdit); return; }
  if (recipe) { mode = 'edit'; editor.startFrom(recipe, { quiet: true, done: afterEdit }); return; }
  if (edit) { mode = 'edit'; editor.edit(edit, afterEdit); return; }
  mode = 'list'; render();
}
async function refresh() { try { scenarios = (await agentJson('/scenarios')).scenarios; agentError = ''; } catch (e) { scenarios = []; agentError = e.message; } }
async function afterEdit(id, { run: runNow = false } = {}) { mode = 'list'; await refresh(); if (id) current = id; if ($('sheet').open) { $('sheetTitle').textContent = 'Scenarios'; $('sheetDone').hidden = false; $('sheetBody').innerHTML = SHELL; render(); if (id && runNow) run(); } }
const byId = id => scenarios.find(s => s.id === id);
export function newScenario() { mode = 'edit'; editor.choose(afterEdit); }
export function continueDraft() { mode = 'edit'; editor.edit(null, afterEdit); }
export function editCurrent() { const sc = byId(current); if (sc?.definition) { mode = 'edit'; editor.edit(sc.definition, afterEdit); } }
export function duplicateCurrent() { const sc = byId(current); if (!sc?.definition) return; const def = structuredClone(sc.definition); def.id = `${def.id}-copy`; def.title = `${def.title} copy`; mode = 'edit'; editor.edit(def, afterEdit); }
export async function deleteCurrent() {
  const sc = byId(current); if (!sc) return;
  const { index } = await showAlert({ title: `Delete “${sc.title}”?`, message: `This removes ${sc.file} from the scenarios folder. Results of past runs stay until the window reloads.`, buttons: ['Cancel', 'Delete'], destructive: true });
  if (index !== 1) return;
  try { await agentJson('/scenarios/remove', { id: sc.id }); } catch (e) { await showAlert({ title: 'Could Not Delete', message: e.message, buttons: ['OK'] }); return; }
  runs.delete(sc.id); await refresh(); current = scenarios[0]?.id || null; render();
}
/** From an event's menu: the event becomes a step of the draft, in the editor. */
export function captureEvent(ev) { if ($('sheet').open && $('sheetBody').querySelector('.scen, .sed')) { mode = 'edit'; editor.addStepFromEvent(ev, afterEdit); } else scenariosSheet(null, { capture: ev }); }
export function pick(id) { current = id; render(); }
export function toggleRelay(url, on) { on ? chosen.add(url) : chosen.delete(url); renderFooter(); }
export function rememberOpen(stepId, open) { open ? openSteps.add(stepId) : openSteps.delete(stepId); }

// ---------- the run ----------
export async function run() {
  const sc = scenarios.find(s => s.id === current); if (!sc || missingIdentities(sc).length || !chosen.size) return;
  const relays = settings.relays.filter(x => chosen.has(x.url)).map(x => ({ url: x.url, name: relayName(x.url) }));   // the order of the relay list above
  const r = { status: 'running', started: Date.now(), relays, steps: new Map(sc.steps.map(s => [s.id, { id: s.id, title: s.title, as: s.as, type: s.type, checks: [], status: 'waiting', ok: null, error: null, event: null }])), summary: null, error: '', controller: new AbortController() };
  runs.set(sc.id, r); openSteps.clear(); render();
  try {
    await agentStream('/scenarios/run', { id: sc.id, relays }, line => { apply(r, line); render(); }, r.controller.signal);
    if (r.status === 'running') r.status = 'done';
  } catch (e) { r.status = e.name === 'AbortError' ? 'stopped' : 'failed'; r.error = e.name === 'AbortError' ? '' : e.message; }
  for (const st of r.steps.values()) if (st.status === 'running') st.status = 'done';
  for (const st of r.steps.values()) if (st.ok === false) openSteps.add(st.id);   // failures open themselves
  render(); emit('render');
}
export function stop() { const r = runs.get(current); if (r?.status === 'running') r.controller.abort(); }
export function stopAll() { for (const r of runs.values()) if (r.status === 'running') r.controller.abort(); }
function apply(r, line) {
  if (line.done) { r.summary = line; r.status = 'done'; return; }
  if (line.error && !line.step) { r.error = line.error; r.status = 'failed'; return; }
  const st = r.steps.get(line.step); if (!st) return;
  if (line.phase === 'start') st.status = 'running';
  else if (line.event) st.event = line.event;
  else if (line.check) st.checks.push(line);
  else if (line.phase === 'done') { st.status = 'done'; st.ok = line.ok; st.error = line.error || null; }
}
const missingIdentities = sc => (sc.identities || []).filter(n => !store.identities.some(i => i.name === n));

// ---------- rendering ----------
function render() { if (mode !== 'list' || !$('sheet').open || !$('sheetBody').querySelector('.scen')) return; $('sheetBody').querySelector('.slist').innerHTML = listHtml(); $('sheetBody').querySelector('.sbody').innerHTML = bodyHtml(); renderFooter(); }
function renderFooter() {
  const sc = scenarios.find(s => s.id === current); const r = sc && runs.get(sc.id); const running = r?.status === 'running';
  const missing = sc ? missingIdentities(sc) : [];
  const status = !sc ? '' : running ? 'Running… closing this sheet stops the run.' : missing.length ? `Needs ${missing.join(', ')} as held identities: run the seed or mint them.` : !chosen.size ? 'Choose at least one relay.' : r?.summary ? summaryText(r) : 'Publishes as the named identities; nothing is deleted.';
  $('sheetFoot').innerHTML = `<span class="hint">${esc(status)}</span>${r && r.status !== 'running' ? `<button class="copy" data-action="scenario-export" title="Save the matrix and every check as Markdown">Export Report</button>` : ''}${running ? `<button class="copy" data-action="scenario-stop">Stop</button>` : `<button class="cprimary" data-action="scenario-run" ${!sc || missing.length || !chosen.size ? 'disabled' : ''}>${r ? 'Run Again' : 'Run'}</button>`}`;
  $('sheetFoot').hidden = false;
}
const summaryText = r => `${plural(r.summary.passed, 'check')} passed${r.summary.failed ? `, ${r.summary.failed} failed` : ''}${r.summary.skipped ? `, ${r.summary.skipped} observed` : ''} · ${fmtDate(Math.floor(r.started / 1000))}`;

function listHtml() {
  if (agentError) return `<div class="hint" style="padding:8px 10px">The agent is not reachable: ${esc(agentError)}</div>`;
  const tail = `${settings.scenarioDraft ? '<button class="srow draft" data-action="scenario-draft">Unsaved draft · continue editing</button>' : ''}<button class="srow new" data-action="scenario-new">+ New Scenario…</button>`;
  if (!scenarios.length) return `<div class="hint" style="padding:8px 10px">No scenario files yet.</div>${tail}`;
  return scenarios.map(s => {
    const r = runs.get(s.id); const badge = r?.summary ? `<span class="sres ${r.summary.failed ? 'no' : 'ok'}" title="${r.summary.failed ? `${r.summary.failed} checks failed` : `all ${r.summary.passed} checks passed`}">${r.summary.failed ? `${r.summary.failed} ✗` : `${r.summary.passed} ✓`}</span>` : r?.status === 'running' ? '<span class="spin" aria-label="running"></span>' : '';
    return `<button class="srow" data-action="scenario-pick" data-id="${esc(s.id)}" aria-pressed="${s.id === current}"><span class="st">${esc(s.title)}${badge}</span><span class="ss">${esc(s.summary)}</span><span class="sm">${plural(s.steps.length, 'step')}${s.identities?.length ? ` · signs as ${s.identities.join(', ')}` : ''}</span></button>`;
  }).join('') + tail;
}
function bodyHtml() {
  const sc = scenarios.find(s => s.id === current); if (!sc) return '<div class="empty"><h3>Pick a scenario</h3></div>';
  if (sc.error) return `<h3>${esc(sc.title)}</h3><div class="hint">This file could not be read: ${esc(sc.error)}</div>`;
  const missing = missingIdentities(sc); const r = runs.get(sc.id);
  const idChips = (sc.identities || []).map(n => `<span class="chip ${missing.includes(n) ? 'warn' : ''}" title="${missing.includes(n) ? 'not held by the agent' : `held by the agent; in commands: $${esc(n)}`}">${esc(identityLabel(n))}${missing.includes(n) ? ' · missing' : ''}</span>`).join(' ');
  const relays = settings.relays.map(x => `<label class="qrelay"><input type="checkbox" data-url="${esc(x.url)}" ${chosen.has(x.url) ? 'checked' : ''} ${r?.status === 'running' ? 'disabled' : ''}> ${esc(relayLabel(x))} <small>${esc(x.url.replace(/^wss?:\/\//, ''))}</small></label>`).join('');
  const busy = r?.status === 'running';
  return `<div class="scen-head"><h3>${esc(sc.title)}<button class="tipmark" data-action="tip" data-tip="scenarios" aria-label="What is this?">?</button><span class="spacer"></span><span class="scen-actions"><button class="copy" data-action="scenario-edit" ${busy ? 'disabled' : ''}>Edit</button><button class="copy" data-action="scenario-duplicate" ${busy ? 'disabled' : ''}>Duplicate</button><button class="copy" data-action="scenario-delete" ${busy ? 'disabled' : ''}>Delete…</button></span></h3><p class="hint">${esc(sc.summary)}</p></div>
    <div class="scen-setup"><div class="sect">Signs as</div><div class="chips">${idChips || '<span class="hint">no identity needed</span>'}</div><div class="sect" style="margin-top:12px">Relays</div><div class="qrelays">${relays}</div></div>
    ${r ? matrixHtml(sc, r) + detailsHtml(r) : `<div class="scen-empty"><div class="sect">Steps</div>${sc.steps.map((s, i) => `<div class="irow"><span><span class="kn">${i + 1}</span> ${esc(s.title)}</span><span class="hint">${s.as ? `${esc(s.as)} · ` : ''}${esc(s.type)}${s.expect?.length ? ` · ${s.expect.join(', ')}` : ''}</span></div>`).join('')}<p class="hint" style="margin:10px 2px 0">Run draws one row per step and one column per relay: what each relay accepted, stored, replaced or refused.</p></div>`}`;
}
/** One cell per step and relay: all checks passed, any failed, only observed, still running, or nothing to check. */
function cell(st, relayUrl) {
  const checks = st.checks.filter(c => (relayUrl === null ? c.relay === null : c.relay === relayUrl));
  if (!checks.length) return st.status === 'running' ? '<td class="cell run"><span class="spin" aria-label="running"></span></td>' : '<td class="cell none" title="nothing to check here"><span class="g"></span></td>';
  const failed = checks.filter(c => c.ok === false), passed = checks.filter(c => c.ok === true);
  const cls = failed.length ? 'no' : passed.length ? 'ok' : 'obs'; const glyph = failed.length ? '✗' : passed.length ? '✓' : '–';
  const title = checks.map(c => `${c.check}: ${c.ok === null ? 'observed' : c.ok ? 'ok' : 'FAILED'} · ${c.detail}`).join('\n');
  return `<td class="cell ${cls}" title="${esc(title)}"><span class="g">${glyph}</span>${checks.length > 1 ? `<small>${passed.length}/${checks.length - checks.filter(c => c.ok === null).length}</small>` : ''}</td>`;
}
function matrixHtml(sc, r) {
  const hasGlobal = [...r.steps.values()].some(st => st.checks.some(c => c.relay === null)) || sc.steps.some(s => s.expect?.includes('opens_as'));
  const head = `<tr><th>Step</th>${r.relays.map(x => `<th title="${esc(x.url)}">${esc(x.name)}</th>`).join('')}${hasGlobal ? '<th class="opens" title="checks on the event itself, not on a relay: does a held key open it">Opens</th>' : ''}</tr>`;
  const rows = [...r.steps.values()].map((st, i) => {
    const state = st.status === 'running' ? 'running' : st.status === 'done' ? (st.ok === false ? 'failed' : 'ok') : 'waiting';
    const meta = [st.as ? `signed by ${esc(st.as)}` : '', st.event ? `<span class="kn">${st.event.kind}</span> <button class="linkbtn" data-action="details" data-id="${st.event.id}" title="Open this event in the details panel">Inspect</button>` : '', st.error ? `<span class="no">${esc(st.error)}</span>` : ''].filter(Boolean).join(' · ');
    return `<tr class="srow-m ${state}"><td><div class="st"><span class="kn">${i + 1}</span> ${esc(st.title)}</div><div class="sm">${meta}</div></td>${r.relays.map(x => cell(st, x.url)).join('')}${hasGlobal ? cell(st, null) : ''}</tr>`;
  }).join('');
  const state = r.status === 'running' ? '<span class="spin"></span> running' : r.status === 'stopped' ? 'stopped' : r.status === 'failed' ? `failed: ${esc(r.error)}` : '';
  return `<div class="sect" style="margin-top:14px">Result <span class="hint">${state}</span></div><div class="tablewrap smatrixwrap"><table class="smatrix"><thead>${head}</thead><tbody>${rows}</tbody></table></div><div class="hint slegend"><span><b class="ok">✓</b> as expected</span><span><b class="no">✗</b> not as expected</span><span><b>–</b> observed only</span><span>empty: nothing to check</span></div>`;
}
function detailsHtml(r) {
  return `<div class="sect" style="margin-top:14px">Checks</div>` + [...r.steps.values()].map(st => {
    const failed = st.checks.filter(c => c.ok === false).length, passed = st.checks.filter(c => c.ok === true).length;
    const rows = st.checks.map(c => `<tr class="${c.ok === null ? 'obs' : c.ok ? 'ok' : 'no'}"><td>${c.relay ? esc(relayName(c.relay)) : '<span class="muted">event</span>'}</td><td>${esc(c.check)}</td><td>${esc(String(c.expected === null ? 'observe' : c.expected))} → ${esc(String(c.actual))}</td><td>${esc(c.detail)}</td></tr>`).join('');
    return `<details class="sdet" data-step="${esc(st.id)}" ${openSteps.has(st.id) ? 'open' : ''}><summary>${esc(st.title)} <span class="hint">${st.error ? esc(st.error) : `${passed} passed${failed ? `, ${failed} failed` : ''}`}</span></summary>${rows ? `<table class="schecks"><thead><tr><th>Relay</th><th>Check</th><th>Expected → actual</th><th>What the relay did</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="hint" style="padding:6px 10px">no checks</div>'}</details>`;
  }).join('');
}

// ---------- report ----------
export function exportReport() {
  const sc = scenarios.find(s => s.id === current); const r = sc && runs.get(sc.id); if (!r) return;
  const mark = (st, url) => { const cs = st.checks.filter(c => c.relay === url); if (!cs.length) return '·'; return cs.some(c => c.ok === false) ? '✗' : cs.some(c => c.ok === true) ? '✓' : '–'; };
  const lines = [`# ${sc.title}`, '', sc.summary, '', `Run ${fmtDate(Math.floor(r.started / 1000))} · ${r.summary ? summaryText(r) : r.status}`, '', `| Step | ${r.relays.map(x => x.name).join(' | ')} | event |`, `|---|${r.relays.map(() => '---').join('|')}|---|`];
  for (const st of r.steps.values()) lines.push(`| ${st.title} | ${r.relays.map(x => mark(st, x.url)).join(' | ')} | ${mark(st, null)} |`);
  lines.push('', '## Checks', '');
  for (const st of r.steps.values()) { lines.push(`### ${st.title}${st.as ? ` (as $${st.as})` : ''}${st.event ? ` · kind ${st.event.kind} · ${st.event.id}` : ''}`); if (st.error) lines.push(`- error: ${st.error}`); for (const c of st.checks) lines.push(`- ${c.ok === null ? 'observed' : c.ok ? 'ok' : 'FAILED'} · ${c.relay ? relayName(c.relay) : 'event'} · ${c.check}: expected ${c.expected === null ? 'observe' : c.expected}, got ${c.actual} · ${c.detail}`); lines.push(''); }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `scenario-${sc.id}-${Date.now()}.md`; a.click();
}

export function init() {
  $('sheetBody').addEventListener('input', e => { if (e.target.closest('.sed')) editor.onInput(e.target); });
  $('sheetBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-mint-name]')) { e.preventDefault(); editor.actions['sed-mint'](e.target.nextElementSibling); } });
  $('sheetBody').addEventListener('toggle', e => { const d = e.target.closest?.('details.sdet'); if (d) rememberOpen(d.dataset.step, d.open); }, true);
  $('sheetBody').addEventListener('change', e => { const cb = e.target.closest('.scen input[data-url]'); if (cb) toggleRelay(cb.dataset.url, cb.checked); });
  $('sheet').addEventListener('close', () => { stopAll(); editor.stopRecording(); });
  $('sheetBody').addEventListener('focusin', e => editor.rememberField(e.target));
}
