// Scenarios: declarative relay tests. A scenario is a JSON file with steps; each step publishes an event (or a gift wrap,
// or only queries) as a held identity and states what every relay is expected to do. The runner streams one line per check,
// so the window can draw the matrix while the run is still going. See scenarios/README.md for the format.
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { nak, nakOut, eventLines } from './nak.js';
import { openSealed } from './sealed.js';

const relayHost = url => String(url).replace(/^wss?:\/\//, '').replace(/\/$/, '');
const settle = ms => new Promise(r => setTimeout(r, ms));

// ---------- files ----------
function readAll(dir) {
  let files = []; try { files = readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return []; }
  return files.map(file => { try { return { file, scenario: JSON.parse(readFileSync(resolve(dir, file), 'utf8')) }; } catch (e) { return { file, error: e.message }; } });
}
/** What the page lists: no step bodies, just enough to choose. */
export function listScenarios(dir) {
  return readAll(dir).map(({ file, scenario: s, error }) => error
    ? { id: basename(file, '.json'), title: file, error, steps: [], identities: [] }
    : { id: s.id || basename(file, '.json'), title: s.title || file, summary: s.summary || '', identities: s.identities || [], steps: (s.steps || []).map(st => ({ id: st.id, title: st.title || st.id, as: st.as || null, type: st.wrap ? 'wrap' : st.event ? (st.encrypt ? 'encrypted' : 'event') : 'query', expect: Object.keys(st.expect || {}).filter(k => k !== 'kind') })), definition: s, file });
}
/** Full definitions travel with the list so the window can edit or duplicate a scenario without a second round trip. */
// ---------- saving ----------
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EXPECT_KEYS = new Set(['accepted', 'stored', 'latest', 'count', 'gone', 'opens_as', 'kind']);
const isTag = t => Array.isArray(t) && t.length >= 1 && t.every(v => typeof v === 'string');
function checkEvent(ev, where) {
  if (!ev || typeof ev !== 'object') throw new Error(`${where}: an event object is needed`);
  if (!Number.isInteger(ev.kind) || ev.kind < 0 || ev.kind > 65535) throw new Error(`${where}: kind must be a whole number between 0 and 65535`);
  if (ev.content !== undefined && typeof ev.content !== 'string') throw new Error(`${where}: content must be text`);
  if (ev.tags !== undefined && !(Array.isArray(ev.tags) && ev.tags.every(isTag))) throw new Error(`${where}: tags must be arrays of strings, such as ["p", "$subscriber"]`);
}
/** Throws a readable message on the first problem; returns the scenario tidied for writing. */
export function validateScenario(s) {
  if (!s || typeof s !== 'object') throw new Error('a scenario object is needed');
  if (!SLUG.test(s.id || '')) throw new Error('id: lowercase letters, digits and dashes, up to 41 characters');
  if (!s.title || typeof s.title !== 'string') throw new Error('title is needed');
  if (!Array.isArray(s.steps) || !s.steps.length) throw new Error('at least one step is needed');
  if (s.identities !== undefined && !(Array.isArray(s.identities) && s.identities.every(n => /^[a-z][a-z0-9_]{0,31}$/.test(n)))) throw new Error('identities: names of held identities');
  const ids = new Set();
  const steps = s.steps.map((st, i) => {
    const where = `step ${i + 1}`;
    if (!SLUG.test(st.id || '')) throw new Error(`${where}: id must be a slug such as "note"`);
    if (ids.has(st.id)) throw new Error(`${where}: id "${st.id}" is used twice`); ids.add(st.id);
    if (st.as !== undefined && st.as !== null && !/^[a-z][a-z0-9_]{0,31}$/.test(st.as)) throw new Error(`${where}: "as" must name an identity`);
    if (st.event && st.wrap) throw new Error(`${where}: either an event or a wrap, not both`);
    if (st.event) checkEvent(st.event, where);
    if (st.wrap) { if (!st.wrap.to) throw new Error(`${where}: wrap needs "to", the recipient identity`); checkEvent(st.wrap.rumor, `${where} rumor`); }
    if ((st.event || st.wrap) && !st.as) throw new Error(`${where}: publishing needs "as", the identity that signs`);
    if (st.encrypt !== undefined && !['nip04', 'nip44'].includes(st.encrypt)) throw new Error(`${where}: encrypt is nip04 or nip44`);
    const expect = st.expect || {};
    for (const k of Object.keys(expect)) if (!EXPECT_KEYS.has(k)) throw new Error(`${where}: unknown expectation "${k}"`);
    if (expect.opens_as !== undefined && typeof expect.opens_as !== 'string') throw new Error(`${where}: opens_as names an identity`);
    if (expect.count !== undefined && (!expect.count || typeof expect.count.filter !== 'object')) throw new Error(`${where}: count needs a filter`);
    if (expect.latest !== undefined && typeof expect.latest !== 'object') throw new Error(`${where}: latest needs a filter`);
    const out = { id: st.id, title: st.title || st.id };
    if (st.as) out.as = st.as; if (st.event) out.event = st.event; if (st.encrypt) out.encrypt = st.encrypt; if (st.wrap) out.wrap = st.wrap;
    if (Object.keys(expect).length) out.expect = expect;
    return out;
  });
  return { id: s.id, title: s.title, summary: s.summary || '', identities: s.identities || [], steps };
}
export function saveScenario(dir, scenario) {
  const tidy = validateScenario(scenario);
  writeFileSync(resolve(dir, `${tidy.id}.json`), JSON.stringify(tidy, null, 2) + '\n');
  return { id: tidy.id, file: `${tidy.id}.json` };
}
export function removeScenario(dir, id) {
  const hit = readAll(dir).find(x => x.scenario && (x.scenario.id || basename(x.file, '.json')) === id) || (SLUG.test(id || '') && existsSync(resolve(dir, `${id}.json`)) ? { file: `${id}.json` } : null);
  if (!hit) throw new Error(`no scenario "${id}"`);
  unlinkSync(resolve(dir, hit.file)); return { removed: id };
}
export function loadScenario(dir, id) { return readAll(dir).find(x => x.scenario && (x.scenario.id || basename(x.file, '.json')) === id)?.scenario || null; }

// ---------- tokens ----------
/** "$creator" is a pubkey, "$note.id" the id of an earlier step, "$note.address" its kind:pubkey:d, "$now+30d" a time. */
function resolveToken(key, ctx) {
  const m = /^now(?:\+(\d+)([smhd]))?$/.exec(key);
  if (m) return String(ctx.now + (m[1] ? +m[1] * { s: 1, m: 60, h: 3600, d: 86400 }[m[2]] : 0));
  const [name, field] = key.split('.');
  if (ctx.pubkeys[name] && (!field || field === 'pubkey')) return ctx.pubkeys[name];
  const step = ctx.steps[name]; if (!step) return undefined;
  if (field === 'id' || !field) return step.id;
  if (field === 'pubkey') return step.pubkey;
  if (field === 'address') return `${step.kind}:${step.pubkey}:${(step.tags || []).find(t => t[0] === 'd')?.[1] || ''}`;
  return undefined;
}
function fill(value, ctx, missing) {
  if (typeof value === 'string') return value.replace(/\$(now(?:\+\d+[smhd])?|[a-z][a-z0-9_-]*(?:\.(?:id|pubkey|address))?)/g, (m, key) => { const v = resolveToken(key, ctx); if (v === undefined) missing.add(m); return v ?? m; });
  if (Array.isArray(value)) return value.map(v => fill(v, ctx, missing));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, ctx, missing)]));
  return value;
}

// ---------- nak arguments ----------
const tagArg = t => t.length === 1 ? t[0] : `${t[0]}=${t.slice(1).join(';')}`;
const eventArgs = ev => ['event', '-k', String(ev.kind), '-c', ev.content || '', ...(ev.tags || []).flatMap(t => ['-t', tagArg(t)])];
function filterArgs(f) {
  const out = [];
  for (const k of f.kinds || []) out.push('-k', String(k));
  for (const a of f.authors || []) out.push('-a', a);
  for (const i of f.ids || []) out.push('-i', i);
  for (const [key, vals] of Object.entries(f)) if (key.startsWith('#')) for (const v of vals) out.push(key === '#p' ? '-p' : key === '#e' ? '-e' : key === '#d' ? '-d' : '-t', key === '#p' || key === '#e' || key === '#d' ? v : `${key.slice(1)}=${v}`);
  if (f.since) out.push('--since', String(f.since)); if (f.until) out.push('--until', String(f.until));
  out.push('-l', String(f.limit || 50));
  return out;
}
/** nak narrates per relay on stderr: "publishing to X... success." / "failed: why" / "connecting to X... connection refused". */
function publishResults(stderr, relays, fromDial) {
  const byHost = new Map(relays.map(r => [relayHost(r.url), r.url])); const out = new Map();
  for (const raw of fromDial(stderr).split('\n')) {
    const m = /^(connecting|publishing) to (\S+?)\.\.\.\s*(.*)$/i.exec(raw.trim()); if (!m) continue;
    const url = byHost.get(relayHost(m[2])); if (!url) continue;
    const result = m[3].trim();
    if (m[1].toLowerCase() === 'publishing') out.set(url, { accepted: /^success/i.test(result), reason: result.replace(/^(success\.?|failed:?\s*(msg:\s*)?)/i, '') });
    else if (!/^ok\.?$/i.test(result)) out.set(url, { accepted: false, reason: result || 'no connection' });
  }
  for (const r of relays) if (!out.has(r.url)) out.set(r.url, { accepted: false, reason: 'no answer' });
  return out;
}
const expectedFor = (value, relayName) => value && typeof value === 'object' && !Array.isArray(value) && ('default' in value || relayName in value) ? (relayName in value ? value[relayName] : value.default) : value;

// ---------- the run ----------
/** Yields one object per line: step start, the published event, each check per relay, step done, and a final summary. */
export async function* runScenario(scenario, { relays, identities, toDial, fromDial, aborted = () => false }) {
  const ctx = { now: Math.floor(Date.now() / 1000), pubkeys: Object.fromEntries(identities.map(([n, , pk]) => [n, pk])), steps: {} };
  const secOf = name => identities.find(([n]) => n === name)?.[1];
  let passed = 0, failed = 0;
  let skipped = 0, lastPublish = 0;
  /** An expected value of null means: observe, do not judge. It shows as a dash in the matrix. */
  const check = (step, relay, name, ok, expected, actual, detail) => { if (expected === null) { skipped++; return { step: step.id, relay, check: name, ok: null, expected, actual, detail }; } ok ? passed++ : failed++; return { step: step.id, relay, check: name, ok, expected, actual, detail }; };
  /** Two publishes in the same second would tie on created_at; relays then keep the lower id, not the later one. */
  const nextSecond = async () => { const now = Math.floor(Date.now() / 1000); if (now === lastPublish) await settle(1000 - (Date.now() % 1000) + 20); lastPublish = Math.floor(Date.now() / 1000); };
  const query = async (filter, relay) => { const r = await nak(['req', ...filterArgs(filter), toDial(relay.url)]); return { events: eventLines(r.out), reachable: !/connection refused|no such host|timeout|failed to connect/i.test(fromDial(r.err)) }; };

  for (const step of scenario.steps || []) {
    if (aborted()) return;
    const missing = new Set(); const st = fill(step, ctx, missing);
    yield { step: st.id, phase: 'start', title: st.title || st.id, as: st.as || null };
    if (missing.size) { failed++; yield { step: st.id, phase: 'done', ok: false, error: `unresolved ${[...missing].join(', ')}: an earlier step did not publish` }; continue; }
    const sec = st.as ? secOf(st.as) : null;
    if (st.as && !sec) { failed++; yield { step: st.id, phase: 'done', ok: false, error: `identity $${st.as} is not held: run the seed or mint it` }; continue; }
    const expect = st.expect || {}; let stepFailed = 0; const before = failed;
    let published = null;
    try {
      if (st.event || st.wrap) {
        let json;
        if (st.wrap) {   // rumor → seal → wrap, then the wrap is published as is
          const to = ctx.pubkeys[st.wrap.to]; if (!to) throw new Error(`recipient $${st.wrap.to} is not held`);
          const rumor = await nak([...eventArgs(st.wrap.rumor), '--sec', sec]); if (rumor.code !== 0) throw new Error(rumor.err.split('\n').pop());
          const wrap = await nak(['gift', 'wrap', '--sec', sec, '-p', to], { input: rumor.out }); if (wrap.code !== 0) throw new Error(wrap.err.split('\n').pop());
          json = eventLines(wrap.out)[0]; if (!json) throw new Error('nak produced no wrap');
        }
        if (st.event && st.encrypt) {   // "encrypt": "nip04" | "nip44": the content is sealed for the p tag before publishing
          const to = (st.event.tags || []).find(t => t[0] === 'p')?.[1]; if (!to) throw new Error('encrypt needs a p tag naming the recipient');
          st.event = { ...st.event, content: await nakOut(['encrypt', st.event.content || '', '--sec', sec, '-p', to, ...(st.encrypt === 'nip04' ? ['--nip04'] : [])]) };
        }
        await nextSecond();
        const r = st.wrap
          ? await nak(['event', ...relays.map(x => toDial(x.url))], { input: JSON.stringify(json) })
          : await nak([...eventArgs(st.event), '--sec', sec, ...relays.map(x => toDial(x.url))]);
        published = eventLines(r.out)[0] || json; if (!published) throw new Error(r.err.split('\n').pop() || 'nak produced no event');
        ctx.steps[st.id] = published;
        yield { step: st.id, event: { id: published.id, kind: published.kind, pubkey: published.pubkey } };
        const results = publishResults(r.err, relays, fromDial);
        if ('accepted' in expect) for (const relay of relays) { const want = expectedFor(expect.accepted, relay.name); const got = results.get(relay.url); yield check(st, relay.url, 'accepted', got.accepted === want, want, got.accepted, got.reason || (got.accepted ? 'the relay said OK' : 'the relay refused it')); }
        await settle(250);
      }
      const target = published || (st.expect?.gone ? { id: st.expect.gone } : null);
      for (const relay of relays) {
        if (aborted()) return;
        if ('stored' in expect && published) { const want = expectedFor(expect.stored, relay.name); const q = await query({ ids: [published.id], limit: 1 }, relay); const found = q.events.some(e => e.id === published.id); yield check(st, relay.url, 'stored', q.reachable && found === want, want, found, !q.reachable ? 'relay unreachable' : found ? 'returned when asked for by id' : 'not returned when asked for by id'); }
        if (expect.gone) { const q = await query({ ids: [expect.gone], limit: 1 }, relay); const found = q.events.some(e => e.id === expect.gone); yield check(st, relay.url, 'gone', q.reachable && !found, false, found, !q.reachable ? 'relay unreachable' : found ? 'still returned' : 'no longer returned'); }
        if (expect.latest && published) { const q = await query({ ...expect.latest, limit: 10 }, relay); const only = q.events.length === 1 && q.events[0].id === published.id; yield check(st, relay.url, 'latest', q.reachable && only, 'only this version', `${q.events.length} returned`, !q.reachable ? 'relay unreachable' : only ? 'exactly this event' : q.events.length ? `returned ${q.events.length}: ${q.events.map(e => e.id.slice(0, 8)).join(', ')}` : 'nothing returned'); }
        if (expect.count) { const { filter, min, max, eq } = expect.count; const q = await query(filter, relay); const n = q.events.length; const ok = (eq === undefined || n === eq) && (min === undefined || n >= min) && (max === undefined || n <= max); yield check(st, relay.url, 'count', q.reachable && ok, eq !== undefined ? eq : [min, max].filter(x => x !== undefined).join('–'), n, !q.reachable ? 'relay unreachable' : `${n} returned`); }
      }
      if (expect.opens_as && published) {
        const who = expect.opens_as; const s = secOf(who);
        let ok = false, detail;
        if (!s) detail = `identity $${who} is not held`;
        else { try { const opened = await openSealed(published, s, ctx.pubkeys[who]); const inner = opened.layers.at(-1).event; ok = !expect.kind || inner?.kind === expect.kind; detail = inner ? `opens as $${who}: kind ${inner.kind} inside` : `opens as $${who}`; } catch (e) { detail = e.message; } }
        yield check(st, null, 'opens_as', ok, who, ok ? who : 'no', detail);
      }
    } catch (e) { stepFailed++; failed++; yield { step: st.id, phase: 'done', ok: false, error: e.message }; continue; }
    yield { step: st.id, phase: 'done', ok: failed === before, failed: failed - before };
  }
  yield { done: true, passed, failed, skipped };
}
