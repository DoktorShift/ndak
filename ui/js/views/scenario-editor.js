// The scenario editor. First-time use follows the HIG playbook: start from a recipe instead of a blank page, explain an
// empty area with what goes there, show the simple version of each control and reveal the rest on demand, and close the
// loop with Save and Run. A form for people and the JSON beside it for people who think in JSON edit the same draft,
// which survives a reload until it is saved or discarded. Saving writes a file into scenarios/ through the agent.
import { esc, plural } from '../format.js';
import { label } from '../kinds.js';
import { settings, saveSettings, store, relayLabel, isLocalRelay } from '../state.js';
import { agentJson } from '../agent.js';
import * as ids from '../identities.js';
import { nameOf } from '../people.js';
import { on } from '../bus.js';
import * as relay from '../relay.js';
import * as tour from '../tour.js';
import { tourById } from '../tours.js';

const $ = id => document.getElementById(id);
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const slugOf = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);
let draft = null;              // the scenario being edited
let onDone = null;             // called with the saved id (and whether to run it), or null on cancel
let error = '';                // last save or JSON problem, shown in the footer
let editingId = null;          // the id the draft was opened from, for the title
let recording = false;         // while on, events a held identity publishes to a local relay become steps
const captured = new Set();    // event ids already turned into steps this session
const openExpect = new Set();  // steps whose expectation controls are revealed
const openSteps = new WeakSet(); // steps shown in full; the others fold to one line so a long scenario stays scannable
let lastField = null;          // the text field that had focus last, for token chips

// ---------- recipes: the starting points ----------
const pick = (prefer, not) => { const names = store.identities.map(i => i.name); return names.find(n => n === prefer && n !== not) || names.find(n => n !== not) || names[0] || prefer; };
const RECIPES = [
  { id: 'note', title: 'Publish and check a note', blurb: 'The simplest recipe: one note that every relay should accept and keep.', build: (a) => ({ title: 'A note on every relay', summary: 'One note; every relay should accept it and keep it.', identities: [a], steps: [
    { id: 'note', title: 'Publish a note', as: a, event: { kind: 1, content: 'Hello from a scenario.', tags: [] }, expect: { accepted: true, stored: true } }] }) },
  { id: 'replaceable', title: 'Replaceable event, two versions', blurb: 'Publish a profile twice; only the newest version should come back.', build: (a) => ({ title: 'Newest version wins', summary: 'A profile published twice; every relay should return only the newer one.', identities: [a], steps: [
    { id: 'first', title: 'Profile, first version', as: a, event: { kind: 0, content: '{"name":"first version"}', tags: [] }, expect: { accepted: true } },
    { id: 'second', title: 'Profile, second version', as: a, event: { kind: 0, content: '{"name":"second version"}', tags: [] }, expect: { accepted: true, latest: { kinds: [0], authors: [`$${a}`] } } }] }) },
  { id: 'ephemeral', title: 'Ephemeral event', blurb: 'An event relays should pass on but not keep. Some keep it briefly; that is worth seeing.', build: (a, b) => ({ title: 'Passed on, not kept', summary: 'An ephemeral key request: relays should deliver it and not store it.', identities: [a, b].filter((x, i, arr) => arr.indexOf(x) === i), steps: [
    { id: 'ephemeral', title: 'Publish an ephemeral key request', as: a, event: { kind: 21089, content: '', tags: [['p', `$${b}`]] }, expect: { accepted: { default: true, khatru: null }, stored: { default: false, rnostr: true, strfry: true } } }] }) },
  { id: 'sealed', title: 'Sealed message', blurb: 'A gift-wrapped message to another identity; relays keep the envelope, the recipient’s key opens it.', build: (a, b) => ({ title: 'A sealed message', summary: 'A gift wrap to the recipient; every relay should keep it, and the recipient’s key should open it.', identities: [a, b].filter((x, i, arr) => arr.indexOf(x) === i), steps: [
    { id: 'wrapped', title: 'Send a sealed message', as: a, wrap: { to: b, rumor: { kind: 14, content: 'Only the recipient can read this.', tags: [['p', `$${b}`]] } }, expect: { accepted: true, stored: { default: true, strfry: false }, opens_as: b, kind: 14 } }] }) },
  { id: 'group', title: 'Group flow', blurb: 'Create a NIP-29 group, name it and post the first message.', build: (a) => ({ title: 'A small group', summary: 'Create a group, describe it and post into it.', identities: [a], steps: [
    { id: 'create', title: 'Create the group', as: a, event: { kind: 9007, content: '', tags: [['h', 'recipe-group']] }, expect: { accepted: true } },
    { id: 'describe', title: 'Name the group', as: a, event: { kind: 9002, content: '', tags: [['h', 'recipe-group'], ['name', 'Recipe group'], ['public'], ['open']] }, expect: { accepted: true } },
    { id: 'message', title: 'Post the first message', as: a, event: { kind: 9, content: 'First message in the group.', tags: [['h', 'recipe-group']] }, expect: { accepted: true, stored: true } }] }) },
  { id: 'blank', title: 'Blank', blurb: 'Start from nothing and add steps yourself, or record what you publish.', build: () => ({ title: '', summary: '', identities: store.identities.slice(0, 1).map(i => i.name), steps: [] }) },
];

// ---------- entry points ----------
export function current() { return draft; }
/** The first screen of "New Scenario…": pick a starting point. */
export function choose(done) { onDone = done; editingId = null; error = ''; renderChooser(); }
export function startFrom(recipeId) {
  const r = RECIPES.find(x => x.id === recipeId); if (!r) return;
  const a = pick('creator'); const b = pick('subscriber', a);
  draft = { id: '', ...r.build(a, b) }; showOnly(draft.steps[0]); persist(); render(); firstTimeTour();
}
/** Open the editor on a definition (edit or duplicate) or on the saved draft. */
export function edit(definition, done) {
  draft = definition ? structuredClone(definition) : (settings.scenarioDraft || RECIPES.at(-1).build());
  editingId = definition?.id || null; onDone = done; error = ''; showOnly(draft.steps[0]); persist(); render(); firstTimeTour();
}
/** Turn a loaded event into a step of the draft, opening the editor. */
export function addStepFromEvent(ev, done) {
  if (!draft) draft = settings.scenarioDraft || RECIPES.at(-1).build();
  addStep(ev); showOnly(draft.steps.at(-1)); onDone = done; editingId = null; error = ''; persist(); render();
}
function showOnly(step) { for (const st of draft.steps) openSteps.delete(st); if (step) openSteps.add(step); }
function addStep(ev) {
  const as = store.identities.find(i => i.pubkey === ev.pubkey)?.name || draft.identities[0] || store.identities[0]?.name || '';
  draft.steps.push({ id: uniqueStepId(slugOf(label(ev.kind)) || `step-${draft.steps.length + 1}`), title: `${label(ev.kind)} from ${nameOf(ev.pubkey)}`, as, event: { kind: ev.kind, content: ev.content || '', tags: ev.tags.map(t => [...t]) }, expect: { accepted: true, stored: true } });
  if (as && !draft.identities.includes(as)) draft.identities.push(as);
}
export function discard() { stopRecording(); draft = null; settings.scenarioDraft = null; saveSettings(); $('sheetDone').hidden = false; onDone?.(null); }
export async function save(run = false) {
  error = '';
  if (!draft.id) draft.id = slugOf(draft.title);
  try { const r = await agentJson('/scenarios/save', { scenario: draft }); stopRecording(); draft = null; settings.scenarioDraft = null; saveSettings(); $('sheetDone').hidden = false; onDone?.(r.id, { run }); }
  catch (e) { error = e.message; renderFooter(); }
}
const persist = () => { settings.scenarioDraft = draft; saveSettings(); };
const uniqueStepId = base => { let id = base, n = 2; while (draft.steps.some(s => s.id === id)) id = `${base}-${n++}`; return id; };
function firstTimeTour() { if (!tour.seen('editor') && draft.steps.length) setTimeout(() => { if (draft && $('sheet').open) tour.start(tourById('editor')); }, 400); }

// ---------- recording ----------
export function stopRecording() { if (recording) { recording = false; if (draft && $('sheet').open) renderSteps(); } }
function toggleRecording() { recording = !recording; renderSteps(); }
on('relay:event', ({ ev, url }) => {
  if (!recording || !draft || !relay.isLive(url) || !isLocalRelay(url) || captured.has(ev.id)) return;
  if (!store.identities.some(i => i.pubkey === ev.pubkey)) return;
  captured.add(ev.id); addStep(ev); showOnly(draft.steps.at(-1)); persist(); renderSteps(); refreshJson(); renderFooter();
});

// ---------- the chooser ----------
function renderChooser() {
  if (!$('sheet').open) return;
  $('sheetTitle').textContent = 'New Scenario'; $('sheetDone').hidden = true;
  $('sheetBody').innerHTML = `<div class="sed sed-choose">
    <p class="sed-intro">A scenario is a short list of steps. Each step publishes an event as one of your identities and says what every relay should do with it: accept it, keep it, return only the newest version, refuse it. Start from a recipe and change what you like.</p>
    <button class="recipe blank" data-action="sed-template" data-id="blank"><span class="plus" aria-hidden="true">+</span><span><span class="rt">Blank scenario</span><span class="rb">Start from nothing: add steps yourself, or press Record and publish from the terminal.</span></span></button>
    <div class="sect">Or start from a recipe</div>
    <div class="recipes">${RECIPES.filter(r => r.id !== 'blank').map(r => `<button class="recipe" data-action="sed-template" data-id="${r.id}"><span class="rt">${esc(r.title)}</span><span class="rb">${esc(r.blurb)}</span></button>`).join('')}
      <div class="recipe static"><span class="rt">Something you just did</span><span class="rb">Open any event’s ··· menu and choose Add to Scenario…, or press Record in the editor and publish from the terminal.</span></div></div></div>`;
  $('sheetFoot').innerHTML = `<span class="hint">Recipes use the identities the agent holds${store.identities.length ? `: ${store.identities.map(i => i.name).join(', ')}` : '. None yet: run the seed or mint one in the sidebar first'}.</span><button class="copy" data-action="sed-cancel">Cancel</button>`;
  $('sheetFoot').hidden = false;
}

// ---------- the form ----------
function render() { if (!draft || !$('sheet').open) return; $('sheetTitle').textContent = editingId ? 'Edit Scenario' : 'New Scenario'; $('sheetDone').hidden = true; $('sheetBody').innerHTML = `<div class="sed">${headHtml()}${identitiesHtml()}<div class="sed-steps">${stepsHtml()}</div>${jsonHtml()}</div>`; renderFooter(); }
function renderSteps() { const host = $('sheetBody').querySelector('.sed-steps'); if (host) host.innerHTML = stepsHtml(); }
function renderFooter() {
  const problems = quickProblems(); const busy = false;
  $('sheetFoot').innerHTML = `<span class="hint ${error || problems ? 'no' : ''}">${esc(error || problems || (editingId ? `Editing ${editingId}.json` : `Saved as ${draft.id || slugOf(draft.title) || '…'}.json in the scenarios folder.`))}</span><button class="copy" data-action="sed-cancel">Cancel</button><button class="copy" data-action="sed-save" ${problems || busy ? 'disabled' : ''}>Save</button><button class="cprimary" data-action="sed-save-run" ${problems || busy ? 'disabled' : ''}>Save and Run</button>`;
  $('sheetFoot').hidden = false;
}
function quickProblems() {
  if (!draft.title.trim()) return 'Give it a title.';
  if (draft.id && !SLUG.test(draft.id)) return 'The file name may only hold lowercase letters, digits and dashes.';
  if (!draft.steps.length) return 'Add a step, use a recipe, or record what you publish.';
  const missing = draft.identities.filter(n => !store.identities.some(i => i.name === n));
  if (missing.length) return `${missing.join(', ')}: not held by the agent. Create it below or remove it.`;
  for (const st of draft.steps) { if ((st.event || st.wrap) && !st.as) return `“${st.title || st.id}” needs someone to sign it.`; if (st.wrap && !st.wrap.to) return `“${st.title || st.id}” needs a recipient.`; }
  return '';
}
const field = (path, value, { placeholder = '', kind = 'text', wide = false, rows = 0 } = {}) => rows
  ? `<textarea data-path="${path}" rows="${rows}" placeholder="${esc(placeholder)}" class="${wide ? 'wide' : ''}">${esc(value ?? '')}</textarea>`
  : `<input type="${kind}" data-path="${path}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" class="${wide ? 'wide' : ''}">`;
const select = (path, value, options, blankLabel) => `<select data-path="${path}">${blankLabel ? `<option value="" ${!value ? 'selected' : ''}>${esc(blankLabel)}</option>` : ''}${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

function headHtml() {
  return `<div class="sed-head"><div class="sed-grid">
      <label>Title${field('title', draft.title, { placeholder: 'What this run shows', wide: true })}</label>
      <label>File name${field('id', draft.id, { placeholder: slugOf(draft.title) || 'lowercase-with-dashes' })}<span class="hint">.json, in the scenarios folder</span></label>
      <label class="span">Summary${field('summary', draft.summary, { placeholder: 'One or two sentences a reader sees in the list', wide: true, rows: 2 })}</label>
    </div></div>`;
}
function identitiesHtml() {
  const held = store.identities;
  const chips = held.map(i => `<button class="chip ${draft.identities.includes(i.name) ? 'on' : ''}" data-action="sed-identity" data-name="${esc(i.name)}" aria-pressed="${draft.identities.includes(i.name)}" title="${esc(nameOf(i.pubkey))} · in commands: $${esc(i.name)}">${esc(i.name)}</button>`).join('');
  const missing = draft.identities.filter(n => !held.some(i => i.name === n)).map(n => `<span class="chip warn" title="not held by the agent">${esc(n)} · missing</span>`).join('');
  return `<div class="sect">Who signs<button class="tipmark" data-action="tip" data-tip="editor" aria-label="What is this?">?</button></div><div class="sed-ids"><div class="chips">${chips}${missing}</div>
    <div class="sed-newid"><input type="text" data-mint-name placeholder="new identity name, as in bob" pattern="[a-z][a-z0-9_]{0,31}" title="lowercase letters, digits and underscore"><button class="copy" data-action="sed-mint">Create Identity</button><span class="hint">mints a key the agent holds; a profile can follow later from the sidebar</span></div></div>`;
}
function stepsHtml() {
  const identities = draft.identities.length ? draft.identities : store.identities.map(i => i.name);
  const idOptions = identities.map(n => [n, n]);
  const stepRefs = draft.steps.map(s => s.id).filter(Boolean);
  const head = `<div class="sect sed-steps-head">Steps<span class="spacer"></span><button class="copy rec ${recording ? 'on' : ''}" data-action="sed-record" aria-pressed="${recording}" title="While recording, every event one of your identities publishes to a local relay becomes a step"><span class="dot"></span>${recording ? 'Recording' : 'Record'}</button></div>`;
  const recHint = recording ? `<div class="sed-rec">Recording. Publish something as ${identities.join(', ')} from the terminal or a preview, and it appears here as a step. Press Recording to stop.</div>` : '';
  if (!draft.steps.length) return `${head}${recHint}<div class="sed-empty"><p>A step publishes one event and says what every relay should do with it. Three ways to add one:</p><ul><li><b>+ Step</b> below: a note with the usual checks, ready to change.</li><li><b>Record</b>, then publish from the terminal or a preview: what you did becomes a step.</li><li>Any event’s ··· menu: <b>Add to Scenario…</b></li></ul><div class="sed-example"><span class="kn">1</span> Publish a note <span class="hint">· signed by creator · every relay should accept it and keep it</span></div></div><button class="copy" data-action="sed-step-add">+ Step</button>`;
  return head + recHint + draft.steps.map((st, i) => {
    const p = `steps.${i}`; const type = st.wrap ? 'wrap' : st.event ? 'event' : 'query';
    const ev = st.wrap ? st.wrap.rumor : st.event; const evPath = `${p}.${type === 'wrap' ? 'wrap.rumor' : 'event'}`;
    const evHtml = ev ? `<div class="sed-ev"><label><span>Kind <span class="hint kindlbl">· ${esc(label(ev.kind))}</span></span>${field(`${evPath}.kind`, ev.kind, { kind: 'number' })}</label>
        ${type === 'wrap' ? `<label>To${select(`${p}.wrap.to`, st.wrap.to, idOptions, 'recipient…')}</label>` : `<label>Encrypt${select(`${p}.encrypt`, st.encrypt || '', [['nip44', 'NIP-44, for the p tag'], ['nip04', 'NIP-04, for the p tag']], 'no')}</label>`}
        <label class="span">Content${field(`${evPath}.content`, ev.content, { placeholder: 'text, or JSON for kinds that carry it', wide: true, rows: 2 })}</label>
        <div class="span sed-tags"><span class="lbl">Tags</span>${(ev.tags || []).map((t, j) => `<div class="sed-tag"><input type="text" data-path="${evPath}.tags.${j}" value="${esc(tagText(t))}" placeholder="name=value;value" spellcheck="false"><button class="copy" data-action="sed-tag-remove" data-step="${i}" data-tag="${j}" aria-label="Remove tag">−</button></div>`).join('')}<button class="copy" data-action="sed-tag-add" data-step="${i}">+ Tag</button>
        <div class="hint sed-tokens">Written as nak takes them: <code>p=$subscriber</code>, <code>e=$note.id;;reply</code> (two semicolons skip a position), <code>public</code>. Click to insert: ${tokenChips(identities, stepRefs, st.id)}</div></div></div>` : '';
    const open = openSteps.has(st);
    const chevron = `<button class="disc-btn" data-action="sed-step-toggle" data-step="${i}" aria-expanded="${open}" aria-label="${open ? 'Fold' : 'Unfold'} step ${i + 1}"><svg class="sym" viewBox="0 0 16 16"><path d="M6 3.5l4.5 4.5L6 12.5"/></svg></button>`;
    if (!open) return `<div class="sed-step folded" data-step="${i}"><div class="sed-step-h">${chevron}<span class="kn">${i + 1}</span><button class="sed-fold" data-action="sed-step-toggle" data-step="${i}"><span class="ft">${esc(st.title || st.id || 'Untitled step')}</span><span class="fs">${st.as ? `signed by ${esc(st.as)} · ` : ''}${ev ? `<span class="kn">${ev.kind}</span> ${esc(label(ev.kind))}${type === 'wrap' ? ' in a gift wrap' : st.encrypt ? ', encrypted' : ''}` : 'check only'} · ${esc(expectSentence(st))}</span></button><button class="copy" data-action="sed-step-remove" data-step="${i}" aria-label="Remove step">Remove</button></div></div>`;
    return `<div class="sed-step" data-step="${i}"><div class="sed-step-h">${chevron}<span class="kn">${i + 1}</span>${field(`${p}.title`, st.title, { placeholder: 'What this step does', wide: true })}
        <div class="seg" role="group" aria-label="Step type"><button data-action="sed-type" data-step="${i}" data-type="event" aria-pressed="${type === 'event'}">Publish</button><button data-action="sed-type" data-step="${i}" data-type="wrap" aria-pressed="${type === 'wrap'}">Gift Wrap</button><button data-action="sed-type" data-step="${i}" data-type="query" aria-pressed="${type === 'query'}">Check Only</button></div>
        <label class="asl">signed by ${select(`${p}.as`, st.as || '', idOptions, type === 'query' ? 'nobody' : 'identity…')}</label>
        <button class="copy" data-action="sed-step-remove" data-step="${i}" aria-label="Remove step">Remove</button></div>
      <div class="sed-step-b"><label class="stepid">id ${field(`${p}.id`, st.id, { placeholder: 'note' })}<span class="hint">later steps can refer to <code>$${esc(st.id || 'id')}.id</code></span></label>${evHtml}${expectHtml(st, i, stepRefs, identities)}</div></div>`;
  }).join('') + `<button class="copy" data-action="sed-step-add">+ Step</button>`;
}
const tokenChips = (identities, stepRefs, selfId) => [...identities.map(n => `$${n}`), ...stepRefs.filter(r => r !== selfId).flatMap(r => [`$${r}.id`, `$${r}.address`]), '$now', '$now+30d'].map(t => `<button class="tokchip" data-action="sed-token" data-token="${esc(t)}">${esc(t)}</button>`).join('');
const tagText = t => t.length === 1 ? t[0] : `${t[0]}=${t.slice(1).join(';')}`;
const tagFromText = text => { const s = text.trim(); if (!s) return null; const i = s.indexOf('='); return i < 0 ? [s] : [s.slice(0, i), ...s.slice(i + 1).split(';')]; };

/** One sentence says what the step expects; the controls behind it open on demand. */
function expectSentence(st) {
  const ex = st.expect || {}; const parts = [];
  const phrase = (v, yes, no) => {
    if (v === null) return `${yes} (observed, not judged)`;
    if (v && typeof v === 'object') {
      const d = v.default; const others = Object.entries(v).filter(([k, x]) => k !== 'default' && x !== d);
      const opposite = others.filter(([, x]) => x !== null).map(([k]) => k); const observed = others.filter(([, x]) => x === null).map(([k]) => k);
      return `${d === false ? no : d === null ? `${yes} (observed only)` : yes}${opposite.length ? ` everywhere except ${opposite.join(' and ')}` : ''}${observed.length ? ` (${observed.join(' and ')} observed only)` : ''}`;
    }
    return v === false ? no : yes;
  };
  if ('accepted' in ex) parts.push(phrase(ex.accepted, 'accept it', 'refuse it'));
  if ('stored' in ex) parts.push(phrase(ex.stored, 'keep it', 'not keep it'));
  if (ex.latest) parts.push('return only this newest version');
  if (ex.count) { const c = ex.count; parts.push(`return ${c.eq !== undefined ? `exactly ${c.eq}` : c.min !== undefined && c.max !== undefined ? `${c.min} to ${c.max}` : c.min !== undefined ? `at least ${c.min}` : c.max !== undefined ? `at most ${c.max}` : 'some'} matching events`); }
  if (ex.gone) parts.push(`no longer return ${String(ex.gone).replace(/^\$/, '').replace(/\.id$/, '')}`);
  const tail = ex.opens_as ? ` ${ex.opens_as}’s key should open it${ex.kind ? `, finding kind ${ex.kind}` : ''}.` : '';
  return (parts.length ? `Every relay should ${parts.join(', ')}.` : 'Nothing is checked yet.') + tail;
}
function expectHtml(st, i, stepRefs, identities) {
  const ex = st.expect || {}; const p = `steps.${i}.expect`; const relays = settings.relays; const open = openExpect.has(st.id);
  const perRelay = (key, value) => { const v = value && typeof value === 'object' && !Array.isArray(value) ? value : { default: value }; return `<div class="sed-relays">${relays.map(r => { const name = relayLabel(r); const cur = name in v ? v[name] : 'inherit'; return `<label>${esc(name)}${select(`${p}.${key}.${name}`, cur === 'inherit' ? '' : String(cur), [['true', 'yes'], ['false', 'no'], ['null', 'observe']], 'as every relay')}</label>`; }).join('')}</div>`; };
  const boolRow = (key, title, help) => { const on = key in ex; const v = ex[key]; const dflt = v && typeof v === 'object' ? v.default : v; return `<div class="sed-exp ${on ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="${key}" ${on ? 'checked' : ''}> ${title} <span class="hint">${help}</span></label>${on ? `<div class="exb"><label>Every relay ${select(`${p}.${key}.default`, dflt === undefined ? 'true' : String(dflt), [['true', 'yes'], ['false', 'no'], ['null', 'observe only']])}</label><details class="disc"><summary>Differences per relay</summary>${perRelay(key, v)}</details></div>` : ''}</div>`; };
  const filterRow = (key, title, help, extra = '') => { const on = key in ex; const v = ex[key] || {}; const f = key === 'count' ? v.filter : v; return `<div class="sed-exp ${on ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="${key}" ${on ? 'checked' : ''}> ${title} <span class="hint">${help}</span></label>${on ? `<div class="exb"><label class="span">Which events (a NIP-01 filter as JSON)${field(`${p}.${key}${key === 'count' ? '.filter' : ''}`, JSON.stringify(f || {}), { placeholder: '{"kinds":[0],"authors":["$creator"]}', wide: true })}</label>${extra}</div>` : ''}</div>`; };
  const countExtra = `<div class="sed-grid3"><label>at least${field(`${p}.count.min`, ex.count?.min ?? '', { kind: 'number' })}</label><label>at most${field(`${p}.count.max`, ex.count?.max ?? '', { kind: 'number' })}</label><label>exactly${field(`${p}.count.eq`, ex.count?.eq ?? '', { kind: 'number' })}</label></div>`;
  const goneOn = 'gone' in ex; const opensOn = 'opens_as' in ex;
  return `<div class="span sed-expects"><div class="sed-expsum"><span class="lbl">Every relay should…</span><span class="sentence">${esc(expectSentence(st))}</span><button class="copy" data-action="sed-expect-toggle" data-step="${esc(st.id)}" aria-expanded="${open}">${open ? 'Done' : 'Change'}</button></div>
    ${open ? `<div class="sed-expbody">
    ${boolRow('accepted', 'Accept it', 'the relay says OK to the event')}${boolRow('stored', 'Keep it', 'asked for by id a moment later, the relay returns it')}
    ${filterRow('latest', 'Return only this newest version', 'for replaceable kinds: the filter returns just this event')}${filterRow('count', 'Return a number of matching events', 'how many events the filter returns', countExtra)}
    <div class="sed-exp ${goneOn ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="gone" ${goneOn ? 'checked' : ''}> No longer return an earlier event <span class="hint">after a deletion request</span></label>${goneOn ? `<div class="exb"><label>Which ${select(`${p}.gone`, ex.gone || '', stepRefs.filter(r => r !== st.id).map(r => [`$${r}.id`, r]), 'earlier step…')}</label></div>` : ''}</div>
    <div class="sed-exp ${opensOn ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="opens_as" ${opensOn ? 'checked' : ''}> A held key opens it <span class="hint">for sealed events: decrypt with an identity’s key</span></label>${opensOn ? `<div class="exb sed-grid3"><label>Whose key ${select(`${p}.opens_as`, ex.opens_as || '', identities.map(n => [n, n]), 'identity…')}</label><label>Kind inside ${field(`${p}.kind`, ex.kind ?? '', { kind: 'number', placeholder: 'any' })}</label></div>` : ''}</div></div>` : ''}</div>`;
}
function jsonHtml() { return `<details class="disc sed-json"><summary>JSON</summary><textarea data-json rows="14" spellcheck="false">${esc(JSON.stringify(draft, null, 2))}</textarea><div class="row" style="margin-top:6px"><button class="copy" data-action="sed-json-apply">Apply JSON</button><span class="hint">the same file the agent saves; edit either side</span></div></details>`; }

// ---------- edits ----------
/** Every input carries data-path into the draft; a change writes it back and refreshes only what depends on it. */
export function onInput(el) {
  if (el.dataset.json !== undefined) return;
  const path = el.dataset.path; if (!path) return;
  const raw = el.value; const parts = path.split('.');
  let v = raw;
  const last = parts.at(-1); const parent = parts.at(-2);
  if (last === 'kind' || last === 'min' || last === 'max' || last === 'eq') v = raw === '' ? undefined : Number(raw);
  if (parent === 'tags') v = tagFromText(raw) || [''];
  if (parts[0] === 'steps' && parts[2] === 'expect') {
    const key = parts[3];
    if (last === 'default' || (parts.length === 5 && ['accepted', 'stored'].includes(key))) v = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : undefined;
    if ((key === 'latest' && parts.length === 4) || (key === 'count' && last === 'filter')) { try { v = JSON.parse(raw || '{}'); el.classList.remove('bad'); } catch { el.classList.add('bad'); return; } }
    if (key === 'gone' || key === 'opens_as') v = raw;
    if (last !== 'default' && parts.length === 5 && ['accepted', 'stored'].includes(key)) { setPerRelay(parts, v); persist(); refreshJson(); refreshSentence(+parts[1]); return; }
  }
  setPath(draft, parts, v);
  if (last === 'title' && parts.length === 1 && !editingId && !draft.id) $('sheetBody').querySelector('[data-path="id"]').placeholder = slugOf(raw);
  if (last === 'kind') { const lbl = el.parentElement.querySelector('.kindlbl'); if (lbl) lbl.textContent = `· ${label(Number(raw))}`; }
  if (parts[0] === 'steps' && parts[2] === 'expect') refreshSentence(+parts[1]);
  persist(); refreshJson(); renderFooter();
}
function setPerRelay(parts, v) {   // steps.i.expect.key.<relay>
  const st = draft.steps[+parts[1]]; const key = parts[3]; const name = parts[4]; const cur = st.expect[key];
  const obj = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : { default: cur === undefined ? true : cur };
  if (v === undefined) delete obj[name]; else obj[name] = v;
  st.expect[key] = Object.keys(obj).length === 1 ? obj.default : obj;
}
function setPath(obj, parts, value) {
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { const k = Array.isArray(o) ? +parts[i] : parts[i]; if (o[k] === undefined || o[k] === null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[k]; }
  const k = Array.isArray(o) ? +parts.at(-1) : parts.at(-1);
  if (value === undefined || value === '') delete o[k]; else o[k] = value;
  if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) if (o[i] === undefined) o.splice(i, 1); }
}
function refreshJson() { const ta = $('sheetBody').querySelector('[data-json]'); if (ta && document.activeElement !== ta) ta.value = JSON.stringify(draft, null, 2); }
function refreshSentence(i) { const el = $('sheetBody').querySelector(`.sed-step[data-step="${i}"] .sentence`); if (el) el.textContent = expectSentence(draft.steps[i]); }
function insertToken(token) {
  const el = lastField && lastField.isConnected && lastField.closest('.sed') && lastField.dataset.path ? lastField : null;
  if (!el) { navigator.clipboard?.writeText(token).catch(() => {}); return; }
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
  el.value = el.value.slice(0, a) + token + el.value.slice(b); el.focus(); el.setSelectionRange(a + token.length, a + token.length);
  onInput(el);
}
export function rememberField(el) { if (el.matches('.sed input[type="text"], .sed textarea') && el.dataset.path) lastField = el; }
export const actions = {
  'sed-template': el => startFrom(el.dataset.id),
  'sed-identity': el => { const n = el.dataset.name; const i = draft.identities.indexOf(n); i >= 0 ? draft.identities.splice(i, 1) : draft.identities.push(n); persist(); render(); },
  'sed-mint': async el => { const input = el.parentElement.querySelector('[data-mint-name]'); const name = input.value.trim(); if (!name) { input.focus(); return; } try { await ids.create({ name, profile: { name }, relays: [] }); if (!draft.identities.includes(name)) draft.identities.push(name); error = ''; } catch (e) { error = e.message; } persist(); render(); },
  'sed-step-add': () => { const n = draft.steps.length + 1; draft.steps.push({ id: uniqueStepId(n === 1 ? 'note' : `step-${n}`), title: n === 1 ? 'Publish a note' : '', as: draft.identities[0] || store.identities[0]?.name || '', event: { kind: 1, content: n === 1 ? 'Hello from a scenario.' : '', tags: [] }, expect: { accepted: true, stored: true } }); showOnly(draft.steps.at(-1)); persist(); render(); const t = $('sheetBody').querySelector(`.sed-step[data-step="${n - 1}"] [data-path$=".title"]`); t?.focus(); },
  'sed-step-toggle': el => { const st = draft.steps[+el.dataset.step]; openSteps.has(st) ? openSteps.delete(st) : openSteps.add(st); renderSteps(); },
  'sed-step-remove': el => { draft.steps.splice(+el.dataset.step, 1); persist(); render(); },
  'sed-type': el => { const st = draft.steps[+el.dataset.step]; const type = el.dataset.type; const ev = st.event || st.wrap?.rumor || { kind: 1, content: '', tags: [] }; delete st.event; delete st.wrap; delete st.encrypt; if (type === 'event') st.event = ev; else if (type === 'wrap') { st.wrap = { to: draft.identities.find(n => n !== st.as) || '', rumor: ev }; if (!st.expect?.opens_as) st.expect = { ...(st.expect || {}), opens_as: draft.identities.find(n => n !== st.as) || '' }; } else { delete st.expect?.accepted; delete st.expect?.stored; } persist(); render(); },
  'sed-tag-add': el => { const st = draft.steps[+el.dataset.step]; const ev = st.event || st.wrap.rumor; (ev.tags ||= []).push(['p', '']); persist(); render(); },
  'sed-tag-remove': el => { const st = draft.steps[+el.dataset.step]; const ev = st.event || st.wrap.rumor; ev.tags.splice(+el.dataset.tag, 1); persist(); render(); },
  'sed-expect-toggle': el => { const id = el.dataset.step; openExpect.has(id) ? openExpect.delete(id) : openExpect.add(id); renderSteps(); },
  'sed-expect': el => { const st = draft.steps[+el.dataset.step]; const key = el.dataset.key; st.expect ||= {}; if (el.checked) st.expect[key] = key === 'latest' ? { kinds: [st.event?.kind ?? 1], authors: [st.as ? `$${st.as}` : ''] } : key === 'count' ? { filter: { kinds: [st.event?.kind ?? 1] }, min: 1 } : key === 'gone' ? '' : key === 'opens_as' ? (st.wrap?.to || draft.identities[0] || '') : true; else { delete st.expect[key]; if (key === 'opens_as') delete st.expect.kind; } persist(); renderSteps(); refreshJson(); renderFooter(); },
  'sed-token': el => insertToken(el.dataset.token),
  'sed-record': () => toggleRecording(),
  'sed-json-apply': () => { const ta = $('sheetBody').querySelector('[data-json]'); try { const next = JSON.parse(ta.value); if (!next || typeof next !== 'object') throw new Error('not an object'); draft = { id: '', title: '', summary: '', identities: [], steps: [], ...next }; error = ''; persist(); render(); } catch (e) { error = `JSON: ${e.message}`; renderFooter(); } },
  'sed-cancel': () => discard(),
  'sed-save': () => save(false),
  'sed-save-run': () => save(true),
};
