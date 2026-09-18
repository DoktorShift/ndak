#!/usr/bin/env node
// Seeds a fresh install once: three demo identities with profiles and relay lists, and a small conversation across the
// relays, so the window has something to show and the terminal has $creator, $subscriber and $platform to sign with.
//
//   docker compose --profile seed run --rm seed        (or, with nak installed: node agent/seed.js)
//
// Environment: IDENTITIES_DIR (../identities), RELAYS (comma separated; the five local relays), GROUP_RELAY (the NIP-29
// relay, ws://localhost:7781), RELAY_MAP and RELAY_HOST (how "localhost" is dialled from inside a container, see keys.js).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, dialer } from './keys.js';

const here = dirname(fileURLToPath(import.meta.url)); const env = process.env;
const DIR = resolve(here, env.IDENTITIES_DIR || '../identities'); mkdirSync(DIR, { recursive: true });
const FILE = resolve(DIR, 'demo-keys.env');
const RELAYS = (env.RELAYS || 'ws://localhost:7777,ws://localhost:7779,ws://localhost:7780,ws://localhost:7781,ws://localhost:7782').split(',').map(s => s.trim()).filter(Boolean);
const GROUP_RELAY = env.GROUP_RELAY || 'ws://localhost:7781';
const { toDial: dial } = dialer(env.RELAY_MAP, (env.RELAY_HOST || '').trim());
const nak = (...args) => execFileSync('nak', args, { encoding: 'utf8', input: '', env: { ...env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const now = Math.floor(Date.now() / 1000);

// 1. keys: minted only when missing, so running the seed twice keeps the same identities
const keys = parseEnv(FILE);
for (const name of ['creator', 'subscriber', 'platform']) {
  if (keys[name]) continue;
  keys[name] = nak('key', 'generate'); appendFileSync(FILE, `${name}=${keys[name]}\n`, { mode: 0o600 }); console.log(`minted $${name}`);
}
const pk = Object.fromEntries(['creator', 'subscriber', 'platform'].map(n => [n, nak('key', 'public', keys[n])]));

// 2. publishing: one signed event to a set of relays; a relay that rejects it is reported, not fatal
const published = []; const failed = [];
function publish(who, kind, content, tags = [], relays = RELAYS) {
  const args = ['event', '-k', String(kind), '-c', content, ...tags.flatMap(t => ['-t', t]), '--sec', keys[who], ...relays.map(dial)];
  try {
    const out = nak(...args); const ev = out.split('\n').find(l => l.startsWith('{'));
    published.push(kind); return ev ? JSON.parse(ev).id : null;
  } catch (e) { failed.push(`${who} kind ${kind}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); return null; }
}

const profiles = {
  creator: { name: 'creator', display_name: 'Milena writes', about: 'Writes about relays. A demo identity of this test bed.' },
  subscriber: { name: 'subscriber', display_name: 'alice', about: 'Reads everything and pays for some of it. A demo identity.' },
  platform: { name: 'platform', display_name: 'Relay Window', about: 'The platform key of this test bed: it signs receipts. A demo identity.' },
};
for (const [who, p] of Object.entries(profiles)) { publish(who, 0, JSON.stringify(p)); publish(who, 10002, '', RELAYS.map(r => `r=${r}`)); }

// 3. a conversation: notes, a reply, reactions, a repost, an article, a mention
const note1 = publish('creator', 1, 'Hello from the seed. Every relay in this window received this note.');
const note2 = publish('creator', 1, 'A second note with a hashtag, so there is something to filter: #nostr', ['t=nostr']);
publish('creator', 30023, 'The first paragraph is for everyone.\n\nA relay is a small database with a WebSocket in front of it. This article exists so the window has a long-form post to render, with a title, a summary and a publication date.', ['d=welcome', 'title=Welcome to the test bed', 'summary=What this window shows and why the relays differ.', `published_at=${now}`]);
if (note1) { publish('subscriber', 1, 'Hello back. A reply from the seed.', [`e=${note1};;reply`, `p=${pk.creator}`]); publish('subscriber', 7, '+', [`e=${note1}`, `p=${pk.creator}`]); }
if (note2) { publish('platform', 7, '🔥', [`e=${note2}`, `p=${pk.creator}`]); publish('subscriber', 6, '', [`e=${note2}`, `p=${pk.creator}`]); }
publish('platform', 1, `Welcome, nostr:${nak('encode', 'npub', pk.creator)}. This note mentions you.`, [`p=${pk.creator}`]);

// 4. a NIP-29 group on the group relay: created, described, joined, two messages
publish('creator', 9007, '', ['h=demo'], [GROUP_RELAY]);
publish('creator', 9002, '', ['h=demo', 'name=Demo group', 'about=Seeded by the test bed', 'public', 'open'], [GROUP_RELAY]);
publish('subscriber', 9021, '', ['h=demo'], [GROUP_RELAY]);
publish('creator', 9000, '', ['h=demo', `p=${pk.subscriber};member`], [GROUP_RELAY]);
publish('creator', 9, 'First message in the demo group.', ['h=demo'], [GROUP_RELAY]);
publish('subscriber', 9, 'Second message, from a member.', ['h=demo'], [GROUP_RELAY]);

// 5. a paid tier, a subscription and its receipt (nostr-gate kinds), and a wallet info event
const tier = `37001:${pk.creator}:gold`;
publish('creator', 37001, 'Weekly essays, a private relay, and early access.', ['d=gold', 'title=Gold', 'amount=21000000;msats;monthly', 'perk=Weekly essays', 'perk=Private relay', 'gate_v=0.5.0']);
publish('subscriber', 7001, '', [`p=${pk.creator}`, `a=${tier}`, 'amount=21000000;msats;monthly', 'gate_v=0.5.0']);
publish('platform', 7003, '', [`p=${pk.creator}`, `P=${pk.subscriber}`, `valid=${now};${now + 30 * 86400}`, 'tier=gold', `a=${tier}`, 'gate_v=0.5.0']);
publish('platform', 13194, 'pay_invoice get_balance make_invoice lookup_invoice list_transactions get_info notifications', ['encryption=nip44_v2 nip04', 'notifications=payment_received payment_sent']);

console.log(`published ${published.length} events as $creator, $subscriber and $platform to ${RELAYS.length} relays`);
for (const f of failed) console.log(`  not accepted: ${f}`);
process.exit(published.length ? 0 : 1);
