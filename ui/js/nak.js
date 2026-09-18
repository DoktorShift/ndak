// nak command builders. The window only reads; every write is offered as a command to paste into a terminal.
// nak reads stdin when it is not a terminal, so every command ends with "< /dev/null" to make it safe in scripts.
import { tag, address, isAddressable, tags } from './nostr.js';
import { shellQuote } from './format.js';

const TAIL = '< /dev/null';
const SEC = '--sec <nsec>';   // or export NOSTR_SECRET_KEY and drop the flag
/** group: read (fetch and watch), write (publishes, needs a key), share (codes for other people). */
const cmd = (group, title, parts, note) => ({ group, title, cmd: [...parts.filter(Boolean)].join(' '), note });

export function forEvent(ev, relay) {
  const list = [
    cmd('read', 'Fetch this event', ['nak req -i', ev.id, relay, TAIL], 'the event as stored on this relay'),
    cmd('read', 'Verify hash and signature', ['nak req -i', ev.id, relay, TAIL, '| nak verify'], 'prints nothing when the event is valid'),
    cmd('read', 'Watch replies, reactions and zaps', ['nak req -e', ev.id, '--stream', relay, TAIL], 'stays open; stop with Ctrl-C'),
    cmd('read', 'Pretty-print the JSON', ['nak req -i', ev.id, relay, TAIL, '| jq']),
  ];
  if (isAddressable(ev.kind)) {
    list.push(cmd('read', 'Fetch by address (latest version)', ['nak req -k', ev.kind, '-a', ev.pubkey, '-d', shellQuote(tag(ev, 'd') ?? ''), relay, TAIL]));
    list.push(cmd('read', 'Everything that references this address', ['nak req -t', shellQuote(`a=${address(ev)}`), relay, TAIL]));
  }
  if (ev.kind === 37001) {
    list.push(cmd('read', 'Receipts for this tier', ['nak req -k 7003 -t', shellQuote(`a=${address(ev)}`), relay, TAIL]));
    list.push(cmd('write', 'Subscribe to this tier (template)', ['nak event -k 7001 -p', ev.pubkey, '-t', shellQuote(`a=${address(ev)}`), '-t', shellQuote(`amount=${tag(ev, 'amount')};msats;${tags(ev, 'amount')[0]?.[3] || 'monthly'}`), SEC, relay, TAIL], 'signs as the subscriber'));
  }
  if (ev.kind === 1 || ev.kind === 1111 || ev.kind === 30023) {
    list.push(cmd('write', 'Reply (template)', ['nak event -k 1 -c', shellQuote('your reply'), '-t', shellQuote(`e=${ev.id};;reply`), '-p', ev.pubkey, SEC, relay, TAIL]));
    list.push(cmd('write', 'React with ❤️', ['nak event -k 7 -c', shellQuote('+'), '-e', ev.id, '-p', ev.pubkey, SEC, relay, TAIL]));
    list.push(cmd('write', 'Repost', ['nak event -k 6 -e', ev.id, '-p', ev.pubkey, SEC, relay, TAIL]));
  }
  if (ev.kind === 30078 && tag(ev, 'd') === 'clink-node') {
    list.push(cmd('read', 'Watch CLINK traffic to this node', ['nak req -k 21001 -k 21002 -p', ev.pubkey, '--stream', relay, TAIL], 'ephemeral and encrypted; you see who talks to the node, not what they say'));
  }
  if (ev.kind === 13194) {
    list.push(cmd('read', 'Wallet capabilities', ['nak req -k 13194 -a', ev.pubkey, relay, TAIL], 'the info event a NWC wallet service publishes'));
    list.push(cmd('read', 'Watch requests to this wallet', ['nak req -k 23194 -p', ev.pubkey, '--stream', relay, TAIL], 'ephemeral; content is encrypted'));
  }
  const group = tag(ev, 'h') || (ev.kind >= 39000 && ev.kind <= 39005 ? tag(ev, 'd') : undefined);
  if (group) {
    list.push(cmd('read', 'Everything in this group', ['nak req -t', shellQuote(`h=${group}`), relay, TAIL]));
    list.push(cmd('read', 'Group metadata, admins and members', ['nak req -k 39000 -k 39001 -k 39002 -t', shellQuote(`d=${group}`), relay, TAIL]));
    list.push(cmd('write', 'Post into this group (template)', ['nak event -k 9 -c', shellQuote('hello'), '-t', shellQuote(`h=${group}`), SEC, relay, TAIL], 'the relay checks membership'));
    list.push(cmd('write', 'Ask to join (NIP-29)', ['nak event -k 9021 -t', shellQuote(`h=${group}`), SEC, relay, TAIL]));
  }
  list.push(cmd('write', 'Ask the relay to delete it (NIP-09, author only)', ['nak event -k 5 -e', ev.id, SEC, relay, TAIL], 'only works with the key that signed the event'));
  list.push(cmd('share', 'Share code with relay hint', ['nak encode nevent --relay', relay, '--author', ev.pubkey, ev.id], 'an nevent other clients can open'));
  return list;
}

export function forProfile(pubkey, relay) {
  return [
    cmd('read', 'Everything by this person', ['nak req -a', pubkey, relay, TAIL]),
    cmd('read', 'Profile as JSON', ['nak req -k 0 -a', pubkey, relay, TAIL, "| jq '.content | fromjson'"]),
    cmd('read', 'Relay list (NIP-65)', ['nak req -k 10002 -a', pubkey, relay, TAIL, "| jq -c '.tags'"]),
    cmd('read', 'Everything that mentions them', ['nak req -p', pubkey, relay, TAIL]),
    cmd('read', 'Their tiers', ['nak req -k 37001 -a', pubkey, relay, TAIL]),
    cmd('read', 'Receipts they paid for', ['nak req -k 7003 -t', shellQuote(`P=${pubkey}`), relay, TAIL]),
    cmd('share', 'Share code with relay hint', ['nak encode nprofile --relay', relay, pubkey], 'an nprofile other clients can open'),
  ];
}

export function forRelay(relay) {
  return [
    cmd('read', 'Relay information (NIP-11)', ['nak relay', relay.replace(/^wss?:\/\//, '')]),
    cmd('read', 'Latest 50 events', ['nak req -l 50', relay, TAIL]),
    cmd('read', 'Count everything (NIP-45)', ['nak count', relay, TAIL]),
    cmd('read', 'Stream live', ['nak req --stream', relay, TAIL]),
    cmd('write', 'Publish a test note', ['nak event -k 1 -c', shellQuote('hello from nak'), SEC, relay, TAIL]),
  ];
}

/** The technical window's current filter as a query, so what you see can be reproduced in the terminal. */
export function forFilter({ kind, search, author }, relay) {
  const filter = [kind !== 'all' && kind !== undefined ? `-k ${kind}` : '', author ? `-a ${author}` : '', search ? `--search ${shellQuote(search)}` : ''].filter(Boolean).join(' ');
  return [
    cmd('read', 'This view as a query', ['nak req', filter, '-l 200', relay, TAIL], search ? 'NIP-50 search; the relay must support it' : 'the same filter the window is showing'),
    cmd('read', 'Count instead of fetch', ['nak count', filter, relay, TAIL]),
  ];
}
