#!/usr/bin/env node
// Terminal agent: runs nak (and jq) for the browser UI and streams the output.
// Security model: binds to localhost by default, accepts only the UI's origin, allows only nak and jq, never uses a shell,
// and replaces $name tokens with keys from the identities folder on this side so secrets never travel to the page.
//
//   node agent/agent.js                          # 127.0.0.1:7790, identities in ../identities
//   node agent/agent.js --port 7790 --host 127.0.0.1 --identities ../identities
//
// Environment, set by the Docker image: PORT, HOST (0.0.0.0 inside the container; the host publishes it on 127.0.0.1 only),
// UI_ORIGIN (comma separated), IDENTITIES_DIR, RELAY_MAP and RELAY_HOST: inside a container "localhost" is not the machine
// that publishes the relay ports, so relay URLs given as localhost are dialled by service name (RELAY_MAP) or through
// RELAY_HOST (host.docker.internal), and mapped back in the output so what people read matches what they typed.
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv, dialer } from './keys.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]] : []).filter(Boolean));
const env = process.env;
const PORT = Number(args.port || env.PORT || 7790);
const HOST = args.host || env.HOST || '127.0.0.1';
const IDENTITIES_DIR = resolve(here, args.identities || env.IDENTITIES_DIR || '../identities');
const IDENTITIES = resolve(IDENTITIES_DIR, 'demo-keys.env');      // seeded demo keys
const MANAGED = resolve(IDENTITIES_DIR, 'relay-window.env');      // identities minted from the UI
const CWD = resolve(here, '..');
const ORIGINS = new Set((env.UI_ORIGIN || 'http://localhost:7778,http://127.0.0.1:7778').split(',').map(o => o.trim()).filter(Boolean));
const RELAY_HOST = (env.RELAY_HOST || '').trim();
const { toDial, fromDial } = dialer(env.RELAY_MAP, RELAY_HOST);
mkdirSync(IDENTITIES_DIR, { recursive: true });
const ALLOWED = new Set(['nak', 'jq']);

/** Demo keys first, then the managed file; a managed name never overrides a demo name. */
function loadIdentities() { return { ...parseEnv(MANAGED), ...parseEnv(IDENTITIES) }; }
/** ws://localhost:7777 → ws://host.docker.internal:7777 when RELAY_HOST is set; only whole-URL arguments qualify. */
const nak = (args, input) => execFileSync('nak', args, { encoding: 'utf8', input: input ?? '', cwd: CWD, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const pubkeyOf = sec => { try { return nak(['key', 'public', sec]); } catch { return null; } };
/** Public view of every identity: name, pubkey, which file. Secrets never leave this process. */
function listIdentities() {
  const demo = parseEnv(IDENTITIES), managed = parseEnv(MANAGED);
  return [...Object.entries(demo).map(([name, sec]) => ({ name, pubkey: pubkeyOf(sec), source: 'demo' })), ...Object.entries(managed).filter(([n]) => !(n in demo)).map(([name, sec]) => ({ name, pubkey: pubkeyOf(sec), source: 'managed' }))].filter(i => i.pubkey);
}
/** Mint a key, store it, publish kind 0 and the NIP-65 relay list to the chosen relays. Returns what happened. */
function createIdentity({ name, profile = {}, relays = [] }) {
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(name || '')) throw new Error('name: lowercase letters, digits and _ only, 1 to 32 characters');
  if (loadIdentities()[name]) throw new Error(`"${name}" already exists`);
  const sec = nak(['key', 'generate']); const pubkey = pubkeyOf(sec);
  appendFileSync(MANAGED, `${name}=${sec}\n`, { mode: 0o600 });
  const urls = relays.filter(r => r.url).map(r => r.url);
  const results = [];
  const publish = (label, args) => { try { const out = nak([...args, '--sec', sec, ...urls.map(toDial)]); const ev = out.split('\n').find(l => l.startsWith('{')); results.push({ label, ok: true, id: ev ? JSON.parse(ev).id : null }); } catch (e) { results.push({ label, ok: false, error: String(e.stderr || e.message).slice(0, 300) }); } };
  const content = JSON.stringify(Object.fromEntries(Object.entries({ name: profile.name || name, display_name: profile.display_name || '', about: profile.about || '', picture: profile.picture || '', nip05: profile.nip05 || '', lud16: profile.lud16 || '' }).filter(([, v]) => v)));
  if (urls.length) {
    publish('profile (kind 0)', ['event', '-k', '0', '-c', content]);
    const tags = relays.filter(r => r.url).flatMap(r => ['-t', `r=${r.url}${r.read && r.write ? '' : r.write ? ';write' : ';read'}`]);
    publish('relay list (kind 10002, NIP-65)', ['event', '-k', '10002', '-c', '', ...tags]);
  }
  return { name, pubkey, npub: nak(['encode', 'npub', pubkey]), results };
}
function removeIdentity(name) {
  const file = name in parseEnv(MANAGED) ? MANAGED : name in parseEnv(IDENTITIES) ? IDENTITIES : null;
  if (!file) throw new Error(`no identity named "${name}"`);
  const kept = readFileSync(file, 'utf8').split('\n').filter(l => !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(l)).join('\n');
  writeFileSync(file, kept, { mode: file === MANAGED ? 0o600 : undefined });
}

/** Minimal shell-like tokenizer: quotes and backslashes, pipes between commands. Anything else shell-ish is refused. */
function tokenize(text) {
  const commands = [[]]; let cur = ''; let quote = null; let has = false;
  const push = () => { if (has) { commands[commands.length - 1].push(cur); cur = ''; has = false; } };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) { quote = null; } else if (ch === '\\' && quote === '"' && i + 1 < text.length) { cur += text[++i]; } else { cur += ch; } has = true; continue; }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < text.length) { cur += text[++i]; has = true; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === '|') { push(); commands.push([]); continue; }
    if (';&><`()'.includes(ch)) throw new Error(`"${ch}" is not allowed here: only nak and jq, optionally joined with a pipe`);
    cur += ch; has = true;
  }
  if (quote) throw new Error('unclosed quote');
  push();
  return commands.filter(c => c.length);
}

function prepare(text, identities) {
  // The UI appends "< /dev/null" for terminals; stdin is always closed here, so drop it.
  const cleaned = text.replace(/\s*<\s*\/dev\/null\s*/g, ' ').trim();
  const commands = tokenize(cleaned);
  if (!commands.length) throw new Error('empty command');
  return commands.map(argv => {
    if (!ALLOWED.has(argv[0])) throw new Error(`"${argv[0]}" is not allowed: this terminal runs nak and jq only`);
    return argv.map(a => toDial(a.replace(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/, (m, name) => identities[name] !== undefined ? identities[name] : m)));
  });
}

function nakVersion() { try { return execFileSync('nak', ['--version'], { encoding: 'utf8' }).trim(); } catch { return null; } }

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const headers = { 'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' };
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
  if (origin && !ORIGINS.has(origin)) { res.writeHead(403, headers); return res.end('origin not allowed'); }
  if (req.method === 'GET' && req.url === '/health') {
    const identities = loadIdentities();
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, nak: nakVersion(), identities: Object.keys(identities), identitiesDir: IDENTITIES_DIR, relayMap: env.RELAY_MAP || null, relayHost: RELAY_HOST || null }));
  }
  if (req.method === 'GET' && req.url === '/identities') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ identities: listIdentities(), managedFile: MANAGED }));
  }
  if (req.method === 'POST' && (req.url === '/identities' || req.url === '/identities/remove')) {
    let body = ''; req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const out = req.url === '/identities' ? createIdentity(data) : (removeIdentity(data.name), { removed: data.name });
        res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
      } catch (e) { res.writeHead(400, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/run') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
    req.on('end', () => {
      let commands;
      try { commands = prepare(JSON.parse(body).cmd || '', loadIdentities()); }
      catch (e) { res.writeHead(400, { ...headers, 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: e.message })); }
      res.writeHead(200, { ...headers, 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' });
      const send = obj => res.write(JSON.stringify(obj) + '\n');
      // Pipeline: stdout of each command feeds the next; stdin of the first is closed (nak would otherwise wait on it).
      const children = commands.map((argv, i) => spawn(argv[0], argv.slice(1), { cwd: CWD, env: { ...process.env, NO_COLOR: '1' }, stdio: [i === 0 ? 'ignore' : 'pipe', 'pipe', 'pipe'] }));
      children.forEach((child, i) => {
        if (i > 0) children[i - 1].stdout.pipe(child.stdin);
        child.stderr.on('data', d => send({ e: fromDial(d.toString()) }));
        child.on('error', err => send({ e: `${argv0(commands[i])}: ${err.message}\n` }));
      });
      const last = children[children.length - 1];
      last.stdout.on('data', d => send({ o: fromDial(d.toString()) }));
      last.on('close', code => { send({ x: code }); res.end(); });
      // The request's own close fires as soon as its body is read; the response closes when the browser aborts.
      res.on('close', () => { if (!res.writableFinished) for (const c of children) if (c.exitCode === null) c.kill('SIGTERM'); });
    });
    return;
  }
  res.writeHead(404, headers); res.end('not found');
});
const argv0 = argv => argv[0];
server.listen(PORT, HOST, () => {
  console.log(`agent on http://${HOST}:${PORT}  identities=${IDENTITIES_DIR}  relays via ${env.RELAY_MAP ? 'service names' : RELAY_HOST || 'localhost'}  nak=${nakVersion() || 'NOT FOUND in PATH'}`);
});
