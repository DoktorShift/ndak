// The scenario editor: a form for people, the JSON beside it for people who think in JSON, both editing the same draft.
// The draft survives a reload until it is saved or discarded. Saving writes a file into scenarios/ through the agent.
import { esc, plural } from '../format.js';
import { label } from '../kinds.js';
import { settings, saveSettings, store, relayLabel } from '../state.js';
import { agentJson } from '../agent.js';
import * as ids from '../identities.js';
import { nameOf } from '../people.js';

const $ = id => document.getElementById(id);
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const slugOf = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41);
const EXPECTS = [['accepted', 'Accepted', 'the relay answered OK true'], ['stored', 'Stored', 'a REQ for the id returns it a moment later'], ['latest', 'Latest', 'this filter returns only this version'], ['count', 'Count', 'how many events this filter returns'], ['gone', 'Gone', 'an earlier event is no longer returned'], ['opens_as', 'Opens as', 'a held key decrypts what was published']];
let draft = null;           // the scenario being edited
let onDone = null;          // called with the saved id, or null on cancel
let error = '';             // last save or JSON problem, shown in the footer
let editingId = null;       // the id the draft was opened from, for the title

// ---------- entry points ----------
export function current() { return draft; }
/** Open the editor on a definition (edit or duplicate) or on a fresh draft. */
export function edit(definition, done) {
  draft = definition ? structuredClone(definition) : (settings.scenarioDraft || blank());
  editingId = definition?.id || null; onDone = done; error = ''; persist(); render();
}
/** Turn a loaded event into a step and add it to the draft, opening the editor. */
export function addStepFromEvent(ev, done) {
  if (!draft) draft = settings.scenarioDraft || blank();
  const as = store.identities.find(i => i.pubkey === ev.pubkey)?.name || draft.identities[0] || store.identities[0]?.name || '';
  const n = draft.steps.length + 1;
  draft.steps.push({ id: uniqueStepId(`step-${n}`), title: `${label(ev.kind)} from ${nameOf(ev.pubkey)}`, as, event: { kind: ev.kind, content: ev.content || '', tags: ev.tags.map(t => [...t]) }, expect: { accepted: true, stored: true } });
  if (as && !draft.identities.includes(as)) draft.identities.push(as);
  onDone = done; editingId = null; error = ''; persist(); render();
}
export function discard() { draft = null; settings.scenarioDraft = null; saveSettings(); $('sheetDone').hidden = false; onDone?.(null); }
export async function save() {
  error = '';
  if (!draft.id) draft.id = slugOf(draft.title);
  try { const r = await agentJson('/scenarios/save', { scenario: draft }); const id = r.id; draft = null; settings.scenarioDraft = null; saveSettings(); $('sheetDone').hidden = false; onDone?.(id); }
  catch (e) { error = e.message; renderFooter(); }
}
const blank = () => ({ id: '', title: '', summary: '', identities: store.identities.slice(0, 1).map(i => i.name), steps: [] });
const persist = () => { settings.scenarioDraft = draft; saveSettings(); };
const uniqueStepId = base => { let id = base, n = 2; while (draft.steps.some(s => s.id === id)) id = `${base}-${n++}`; return id; };

// ---------- the form ----------
function render() { if (!draft || !$('sheet').open) return; $('sheetTitle').textContent = editingId ? 'Edit Scenario' : 'New Scenario'; $('sheetDone').hidden = true; const body = $('sheetBody'); body.innerHTML = `<div class="sed">${headHtml()}${identitiesHtml()}${stepsHtml()}${jsonHtml()}</div>`; renderFooter(); }
function renderFooter() {
  const problems = quickProblems();
  $('sheetFoot').innerHTML = `<span class="hint ${error || problems ? 'no' : ''}">${esc(error || problems || (editingId ? `Editing ${editingId}.json` : 'Saved into scenarios/ as a JSON file you can also edit by hand.'))}</span><button class="copy" data-action="sed-cancel">Cancel</button><button class="cprimary" data-action="sed-save" ${problems ? 'disabled' : ''}>Save Scenario</button>`;
  $('sheetFoot').hidden = false;
}
function quickProblems() {
  if (!draft.title.trim()) return 'A title is needed.';
  if (draft.id && !SLUG.test(draft.id)) return 'The identifier may only hold lowercase letters, digits and dashes.';
  if (!draft.steps.length) return 'Add at least one step.';
  const missing = draft.identities.filter(n => !store.identities.some(i => i.name === n));
  if (missing.length) return `${missing.join(', ')}: not held by the agent. Create it below or remove it.`;
  for (const st of draft.steps) { if ((st.event || st.wrap) && !st.as) return `Step "${st.title || st.id}" needs an identity to sign.`; if (st.wrap && !st.wrap.to) return `Step "${st.title || st.id}" needs a recipient.`; }
  return '';
}
const field = (path, value, { placeholder = '', kind = 'text', wide = false, rows = 0 } = {}) => rows
  ? `<textarea data-path="${path}" rows="${rows}" placeholder="${esc(placeholder)}" class="${wide ? 'wide' : ''}">${esc(value ?? '')}</textarea>`
  : `<input type="${kind}" data-path="${path}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" class="${wide ? 'wide' : ''}">`;
const select = (path, value, options, blankLabel) => `<select data-path="${path}">${blankLabel ? `<option value="" ${!value ? 'selected' : ''}>${esc(blankLabel)}</option>` : ''}${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

function headHtml() {
  return `<div class="sed-head"><div class="sed-grid">
      <label>Title${field('title', draft.title, { placeholder: 'What this run shows', wide: true })}</label>
      <label>Identifier${field('id', draft.id, { placeholder: slugOf(draft.title) || 'file name, lowercase-with-dashes' })}</label>
      <label class="span">Summary${field('summary', draft.summary, { placeholder: 'One or two sentences a reader sees in the list', wide: true, rows: 2 })}</label>
    </div></div>`;
}
function identitiesHtml() {
  const held = store.identities;
  const chips = held.map(i => `<button class="chip ${draft.identities.includes(i.name) ? 'on' : ''}" data-action="sed-identity" data-name="${esc(i.name)}" aria-pressed="${draft.identities.includes(i.name)}" title="${esc(nameOf(i.pubkey))} · in commands: $${esc(i.name)}">${esc(i.name)}</button>`).join('');
  const missing = draft.identities.filter(n => !held.some(i => i.name === n)).map(n => `<span class="chip warn" title="not held by the agent">${esc(n)} · missing</span>`).join('');
  return `<div class="sect">Signs as</div><div class="sed-ids"><div class="chips">${chips}${missing}</div>
    <div class="sed-newid"><input type="text" data-mint-name placeholder="new identity name, as in bob" pattern="[a-z][a-z0-9_]{0,31}" title="lowercase letters, digits and underscore"><button class="copy" data-action="sed-mint">Create Identity</button><span class="hint">mints a key the agent holds; a profile can follow later from the sidebar</span></div></div>`;
}
function stepsHtml() {
  const identities = draft.identities.length ? draft.identities : store.identities.map(i => i.name);
  const idOptions = identities.map(n => [n, `$${n}`]);
  const stepRefs = draft.steps.map(s => s.id).filter(Boolean);
  return `<div class="sect">Steps</div>` + draft.steps.map((st, i) => {
    const p = `steps.${i}`; const type = st.wrap ? 'wrap' : st.event ? 'event' : 'query';
    const ev = st.wrap ? st.wrap.rumor : st.event;
    const evHtml = ev ? `<div class="sed-ev"><label><span>Kind <span class="hint kindlbl">· ${esc(label(ev.kind))}</span></span>${field(`${p}.${type === 'wrap' ? 'wrap.rumor' : 'event'}.kind`, ev.kind, { kind: 'number' })}</label>
        ${type === 'wrap' ? `<label>To${select(`${p}.wrap.to`, st.wrap.to, idOptions, 'recipient…')}</label>` : `<label>Encrypt${select(`${p}.encrypt`, st.encrypt || '', [['nip44', 'NIP-44 for the p tag'], ['nip04', 'NIP-04 for the p tag']], 'no')}</label>`}
        <label class="span">Content${field(`${p}.${type === 'wrap' ? 'wrap.rumor' : 'event'}.content`, ev.content, { placeholder: 'text, or JSON for kinds that carry it', wide: true, rows: 2 })}</label>
        <div class="span sed-tags"><span class="lbl">Tags</span>${(ev.tags || []).map((t, j) => `<div class="sed-tag"><input type="text" data-path="${p}.${type === 'wrap' ? 'wrap.rumor' : 'event'}.tags.${j}" value="${esc(tagText(t))}" placeholder="name=value;value" spellcheck="false"><button class="copy" data-action="sed-tag-remove" data-step="${i}" data-tag="${j}" aria-label="Remove tag">−</button></div>`).join('')}<button class="copy" data-action="sed-tag-add" data-step="${i}">+ Tag</button><div class="hint" style="margin-top:6px">Written as nak takes them: <code>p=$subscriber</code>, <code>e=$note.id;;reply</code> (two semicolons skip a position), <code>public</code>. Tokens: <code>$creator</code>, <code>$note.id</code>, <code>$note.address</code>, <code>$now+30d</code>.</div></div></div>` : '';
    return `<div class="sed-step" data-step="${i}"><div class="sed-step-h"><span class="kn">${i + 1}</span>${field(`${p}.title`, st.title, { placeholder: 'What this step does', wide: true })}
        <div class="seg" role="group" aria-label="Step type"><button data-action="sed-type" data-step="${i}" data-type="event" aria-pressed="${type === 'event'}">Publish</button><button data-action="sed-type" data-step="${i}" data-type="wrap" aria-pressed="${type === 'wrap'}">Gift Wrap</button><button data-action="sed-type" data-step="${i}" data-type="query" aria-pressed="${type === 'query'}">Query Only</button></div>
        <label class="asl">as ${select(`${p}.as`, st.as || '', idOptions, type === 'query' ? 'nobody' : 'identity…')}</label>
        <button class="copy" data-action="sed-step-remove" data-step="${i}" aria-label="Remove step">Remove</button></div>
      <div class="sed-step-b"><label class="stepid">id ${field(`${p}.id`, st.id, { placeholder: 'note' })}<span class="hint">referenced as <code>$${esc(st.id || 'id')}.id</code></span></label>${evHtml}${expectHtml(st, i, stepRefs, identities)}</div></div>`;
  }).join('') + `<button class="copy" data-action="sed-step-add">+ Step</button>`;
}
const tagText = t => t.length === 1 ? t[0] : `${t[0]}=${t.slice(1).join(';')}`;
const tagFromText = text => { const s = text.trim(); if (!s) return null; const i = s.indexOf('='); return i < 0 ? [s] : [s.slice(0, i), ...s.slice(i + 1).split(';')]; };
function expectHtml(st, i, stepRefs, identities) {
  const ex = st.expect || {}; const p = `steps.${i}.expect`; const relays = settings.relays;
  const perRelay = (key, value) => { const v = value && typeof value === 'object' && !Array.isArray(value) ? value : { default: value }; return `<div class="sed-relays">${relays.map(r => { const name = relayLabel(r); const cur = name in v ? v[name] : 'inherit'; return `<label>${esc(name)}${select(`${p}.${key}.${name}`, cur === 'inherit' ? '' : String(cur), [['true', 'yes'], ['false', 'no'], ['null', 'observe']], 'as default')}</label>`; }).join('')}</div>`; };
  const boolRow = (key, title, help) => { const on = key in ex; const v = ex[key]; const dflt = v && typeof v === 'object' ? v.default : v; return `<div class="sed-exp ${on ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="${key}" ${on ? 'checked' : ''}> ${title} <span class="hint">${help}</span></label>${on ? `<div class="exb"><label>Every relay ${select(`${p}.${key}.default`, dflt === undefined ? 'true' : String(dflt), [['true', 'yes'], ['false', 'no'], ['null', 'observe only']])}</label><details class="disc"><summary>Per relay</summary>${perRelay(key, v)}</details></div>` : ''}</div>`; };
  const filterRow = (key, title, help, extra = '') => { const on = key in ex; const v = ex[key] || {}; const f = key === 'count' ? v.filter : v; return `<div class="sed-exp ${on ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="${key}" ${on ? 'checked' : ''}> ${title} <span class="hint">${help}</span></label>${on ? `<div class="exb"><label class="span">Filter (NIP-01 JSON)${field(`${p}.${key}${key === 'count' ? '.filter' : ''}`, JSON.stringify(f || {}), { placeholder: '{"kinds":[0],"authors":["$creator"]}', wide: true })}</label>${extra}</div>` : ''}</div>`; };
  const countExtra = `<div class="sed-grid3"><label>min${field(`${p}.count.min`, ex.count?.min ?? '', { kind: 'number' })}</label><label>max${field(`${p}.count.max`, ex.count?.max ?? '', { kind: 'number' })}</label><label>exactly${field(`${p}.count.eq`, ex.count?.eq ?? '', { kind: 'number' })}</label></div>`;
  const goneOn = 'gone' in ex; const opensOn = 'opens_as' in ex;
  return `<div class="span sed-expects"><span class="lbl">Expect</span>
    ${boolRow('accepted', 'Accepted', 'the relay said OK to the event')}${boolRow('stored', 'Stored', 'asked for by id a moment later, the relay returns it')}
    ${filterRow('latest', 'Latest', 'this filter returns only this version')}${filterRow('count', 'Count', 'how many events the filter returns', countExtra)}
    <div class="sed-exp ${goneOn ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="gone" ${goneOn ? 'checked' : ''}> Gone <span class="hint">an earlier event is no longer returned</span></label>${goneOn ? `<div class="exb"><label>Event ${select(`${p}.gone`, ex.gone || '', stepRefs.filter(r => r !== st.id).map(r => [`$${r}.id`, `$${r}.id`]), 'earlier step…')}</label></div>` : ''}</div>
    <div class="sed-exp ${opensOn ? 'on' : ''}"><label class="exh"><input type="checkbox" data-action="sed-expect" data-step="${i}" data-key="opens_as" ${opensOn ? 'checked' : ''}> Opens as <span class="hint">a held key decrypts what was published</span></label>${opensOn ? `<div class="exb sed-grid3"><label>Identity ${select(`${p}.opens_as`, ex.opens_as || '', identities.map(n => [n, `$${n}`]), 'identity…')}</label><label>Inner kind ${field(`${p}.kind`, ex.kind ?? '', { kind: 'number', placeholder: 'any' })}</label></div>` : ''}</div></div>`;
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
    if (last !== 'default' && parts.length === 5 && ['accepted', 'stored'].includes(key)) { setPerRelay(parts, v); persist(); refreshJson(); return; }
  }
  setPath(draft, parts, v);
  if (last === 'title' && parts.length === 1 && !editingId && !draft.id) el.closest('.sed').querySelector('[data-path="id"]').placeholder = slugOf(raw);
  if (last === 'kind') { const lbl = el.parentElement.querySelector('.kindlbl'); if (lbl) lbl.textContent = `· ${label(Number(raw))}`; }
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
export const actions = {
  'sed-identity': el => { const n = el.dataset.name; const i = draft.identities.indexOf(n); i >= 0 ? draft.identities.splice(i, 1) : draft.identities.push(n); persist(); render(); },
  'sed-mint': async el => { const input = el.parentElement.querySelector('[data-mint-name]'); const name = input.value.trim(); if (!name) { input.focus(); return; } try { await ids.create({ name, profile: { name }, relays: [] }); if (!draft.identities.includes(name)) draft.identities.push(name); error = ''; } catch (e) { error = e.message; } persist(); render(); },
  'sed-step-add': () => { const n = draft.steps.length + 1; draft.steps.push({ id: uniqueStepId(`step-${n}`), title: '', as: draft.identities[0] || '', event: { kind: 1, content: '', tags: [] }, expect: { accepted: true, stored: true } }); persist(); render(); },
  'sed-step-remove': el => { draft.steps.splice(+el.dataset.step, 1); persist(); render(); },
  'sed-type': el => { const st = draft.steps[+el.dataset.step]; const type = el.dataset.type; const ev = st.event || st.wrap?.rumor || { kind: 1, content: '', tags: [] }; delete st.event; delete st.wrap; delete st.encrypt; if (type === 'event') st.event = ev; else if (type === 'wrap') { st.wrap = { to: draft.identities.find(n => n !== st.as) || '', rumor: ev }; if (!st.expect?.opens_as) st.expect = { ...(st.expect || {}), opens_as: draft.identities.find(n => n !== st.as) || '' }; } else { delete st.expect?.accepted; delete st.expect?.stored; } persist(); render(); },
  'sed-tag-add': el => { const st = draft.steps[+el.dataset.step]; const ev = st.event || st.wrap.rumor; (ev.tags ||= []).push(['p', '']); persist(); render(); },
  'sed-tag-remove': el => { const st = draft.steps[+el.dataset.step]; const ev = st.event || st.wrap.rumor; ev.tags.splice(+el.dataset.tag, 1); persist(); render(); },
  'sed-expect': el => { const st = draft.steps[+el.dataset.step]; const key = el.dataset.key; st.expect ||= {}; if (el.checked) st.expect[key] = key === 'latest' ? { kinds: [st.event?.kind ?? 1], authors: [st.as ? `$${st.as}` : ''] } : key === 'count' ? { filter: { kinds: [st.event?.kind ?? 1] }, min: 1 } : key === 'gone' ? '' : key === 'opens_as' ? (st.wrap?.to || draft.identities[0] || '') : true; else { delete st.expect[key]; if (key === 'opens_as') delete st.expect.kind; } persist(); render(); },
  'sed-json-apply': () => { const ta = $('sheetBody').querySelector('[data-json]'); try { const next = JSON.parse(ta.value); if (!next || typeof next !== 'object') throw new Error('not an object'); draft = { id: '', title: '', summary: '', identities: [], steps: [], ...next }; error = ''; persist(); render(); } catch (e) { error = `JSON: ${e.message}`; renderFooter(); } },
  'sed-cancel': () => discard(),
  'sed-save': () => save(),
};
