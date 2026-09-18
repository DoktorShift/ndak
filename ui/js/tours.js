// Tour content: the Quick Start, the feature tours and the contextual tips. Copy only, no mechanics.
// Steps point at real controls; an action prepares the interface so the control is on screen.
import { emit } from './bus.js';
import { store } from './state.js';

const kbd = k => `<kbd>${k}</kbd>`;
const social = () => emit('window', 'social');
const technical = () => emit('window', 'technical');

export const NAK_INTRO = `<b>nak</b> is the <a href="https://github.com/fiatjaf/nak" target="_blank" rel="noopener">Nostr army knife</a>, a small command-line tool by <a href="https://github.com/fiatjaf" target="_blank" rel="noopener">fiatjaf</a> that fetches events from relays, publishes signed events, encrypts and wraps, decodes keys and codes, and streams what a relay sends. You never have to type a key: names like <code>$creator</code> stand in for them, and a helper on this Mac fills them in.`;

const QUICK_START = {
  id: 'quick', title: 'Quick Start',
  steps: [
    { target: '#relayBtn', label: 'Relays', title: 'Pick the relays to watch', text: 'This pop-up lists your local relays. Connect one or several; every event remembers where it was seen. The green pill next to it says <b>Live</b> while events flow in, and pausing it holds the timeline still without losing anything.', tip: `Press ${kbd('R')} any time to open it.` },
    { target: '#feed article.post, #feed article.cpost, #feed', label: 'Social', title: 'Every event, in plain words', text: 'Social reads the relays like a timeline: who did what. A receipt says who paid whom for which tier, a tier shows its price and perks, a key request says who asked for what.', tip: 'Two views: <b>Relay View</b> explains everything, <b>Client View</b> shows the same events the way a social app would render them.', action: async () => { social(); emit('feedmode', 'relay'); } },
    { target: '#detail', label: 'Details', title: 'One post, all its technical detail', text: 'The ⓘ on any post opens its details beside the feed: kind and NIP, verified id and signature, every tag explained, what points at it, the raw JSON and ready-made nak commands.', tip: `${kbd('I')} shows or hides the panel; ${kbd('Esc')} closes it.`, action: async () => { social(); emit('details-first'); }, wait: 200, placement: 'left' },
    { target: '#inspector', label: 'Technical', title: 'The inspector works for any kind', text: 'Technical lists every event as a row: time, kind, author, tags, and the relays it was seen on. The inspector on the right is the same one as in Social, and it copes with kinds nobody has heard of.', tip: `${kbd('↑')} ${kbd('↓')} move through rows; click a column header to sort.`, action: async () => { technical(); emit('select-first'); }, wait: 150, placement: 'left' },
    { target: '#sbScroll', label: 'Sidebar', title: 'Two ways to narrow the view', text: '<b>Show</b> bundles events by what you are researching: subscriptions, keys, groups, wallets. <b>Kinds</b> lists what is really on the relays, flat or grouped by NIP. The field on top filters every section as you type.', tip: `Type <code>report</code> up there: NIP-56 appears before any report exists.`, action: async () => emit('sidebar-open'), placement: 'right' },
    { target: '#terminal', label: 'Terminal', title: 'Run nak without leaving the window', text: '<b>nak</b> is the Nostr army knife, a small command-line tool that talks to relays and signs events. Every nak list in the app has a <b>Run</b> button; results come back as blocks, and event lines become rows you can inspect. Keys are named, never pasted.', tip: `${kbd('T')} opens it; ${kbd('⌘K')} clears; ${kbd('⌘.')} stops a running command.`, action: async () => emit('terminal-open'), wait: 250, placement: 'above' },
    { target: '#actBtn', label: 'Acting as', title: 'Do things as someone', text: 'Pick an identity here and every write command signs as it. Mint a new one with a profile and relay list in a minute, then reply, react or subscribe straight from a post.', tip: 'The key never leaves your Mac; the app only knows the name.', action: async () => emit('terminal-close') },
    { target: '#scenariosBtn', label: 'Scenarios', title: 'Test the relays with a recipe', text: 'A scenario publishes a small flow as the demo identities and checks what every relay did: accepted, stored, replaced, refused. The result is a matrix, one row per step and one column per relay.', tip: 'Add your own as a JSON file in <code>scenarios/</code>; it appears without a rebuild.', action: async () => technical() },
    { label: 'Done', title: 'You are set', text: 'Five keys worth remembering: <b>1</b> and <b>2</b> switch windows, <b>I</b> details, <b>T</b> terminal, <b>/</b> search. Everything else is one click from the toolbar.', tip: 'Help (?) keeps short tours for each area, and a small ? next to a section title explains it in place.', cta: 'Finish' },
  ],
};

export const TOURS = [
  { id: 'sidebar', title: 'Sidebar', promise: 'Filter by bundle, NIP or kind, find anything, resize and collapse.', steps: [
    { target: '#sbFilterBox', title: 'One field, every section', text: 'Type a name, a NIP number, a kind, a relay or a person. Sections with no match disappear; Return opens the first match; Esc clears.', tip: `${kbd('F')} focuses it.`, action: async () => emit('sidebar-open'), placement: 'right' },
    { target: '#sbScroll [data-section="show"]', title: 'Show: research bundles', text: 'Notes, subscriptions and payments, keys and sealed messages, groups, NWC, CLINK, profiles. One click shows a whole flow, such as tier, subscribe and receipt together.', placement: 'right' },
    { target: '.seg.mini', title: 'Kinds: seen, or by NIP', text: '<b>Seen</b> is the flat list with counts. <b>By NIP</b> groups kinds under the spec that defines them; a chevron reveals the kinds, and Show all NIPs lists the whole catalogue.', placement: 'right' },
    { target: '#sbResize', title: 'Make room', text: 'Drag this edge to resize the sidebar; double-click it to reset. Hover a section title for Hide and Show.', tip: `${kbd('S')} hides the whole sidebar.`, placement: 'right' },
  ] },
  { id: 'details', title: 'Details Panel', promise: 'Read Summary, Tags and Refs, follow a receipt to its tier, verify a signature.', steps: [
    { target: '#detail [data-tab="summary"]', title: 'Summary', text: 'Kind and NIP with a link to the spec, the NIP-01 class, whether the id matches the content and the signature is valid, when it was created and received, and where it was seen.', action: async () => { social(); emit('details-first'); emit('dtab', 'summary'); }, wait: 200, placement: 'left' },
    { target: '#detail [data-tab="tags"]', title: 'Tags, explained', text: 'Each tag with its meaning and NIP. References to events and people resolve to what is loaded, with Open and Profile buttons; times become dates; addresses split into kind, author and identifier.', action: async () => emit('dtab', 'tags'), placement: 'left' },
    { target: '#detail [data-tab="refs"]', title: 'Refs, both directions', text: 'What this event points at, and everything loaded that points back at it: replies, reactions, zaps, receipts, group changes.', action: async () => emit('dtab', 'refs'), placement: 'left' },
    { target: '#detail [data-tab="nak"]', title: 'nak, ready to run', text: 'Fetch, verify, watch, reply, react, subscribe, delete, share. Copy takes the command to your clipboard; Run puts it in the terminal.', action: async () => emit('dtab', 'nak'), placement: 'left' },
    { target: '#detail [data-action="to-technical"]', title: 'Over to Technical', text: 'This opens the same event in the Technical window, selected in the table, so you can compare it with its neighbours.', placement: 'left' },
  ] },
  { id: 'query', title: 'Query and Compare', promise: 'Ask several relays the same question and see who has what.', steps: [
    { target: '#queryBtn', title: 'One filter, many relays', text: 'Query… opens a sheet where you write a filter with the same tokens as the search field, tick the relays, and run it on separate connections.', tip: `${kbd('Q')} opens it with the current search as the filter.`, action: technical },
    { target: '#search', title: 'The token language', text: '<code>kind:1</code>, <code>author:alice</code>, <code>id:…</code>, <code>#t:gold</code>, <code>relay:strfry</code>, <code>since:2h</code>, <code>nip:56</code>, plus free text. In the search field it filters the window; in Query it becomes the relay filter.' },
    { target: '#queryBtn', title: 'What comes back', text: 'Per relay: status, latency, how many events it returned and how many it counted. Then a presence matrix: which relay has which event, differences first. Results join the window with their relays.' },
    { target: '#sbScroll [data-action="relay-scope"]', title: 'Per-relay view', text: 'Click a relay in the sidebar to show only what was seen on it; the dot connects or disconnects; ··· opens details with NIP-11, behaviour probes and the protocol log.', placement: 'right' },
  ] },
  { id: 'relay', title: 'Relay Details', promise: 'NIP-11, behaviour probes and the protocol log per relay.', steps: [
    { target: '#sbScroll [data-action="relay-scope"]', title: 'Every relay is a row', text: 'The dot shows its state, the count says how many events were seen on it. Hover for ··· or right-click for the menu.', action: async () => emit('sidebar-open'), placement: 'right' },
    { target: '#sbScroll [data-action="relay-more"]', title: 'Relay Details…', text: 'The whole NIP-11 document with links to every listed NIP, read-only probes (connect time, EOSE, COUNT, search, a filter above the limit, AUTH), and the last protocol messages.', placement: 'right' },
    { target: '#relayBtn', title: 'Connect all, or one', text: 'The toolbar pop-up connects or disconnects any set of relays, adds new ones and manages the list. Names come from each relay itself.' },
  ] },
  { id: 'identities', title: 'Identities', promise: 'Mint a key with a relay list, act as it, reply and react from a preview.', steps: [
    { target: '#actBtn', title: 'Acting as', text: 'Whoever is chosen here signs the write commands the app generates. No identity means commands carry a placeholder you fill in yourself.', tip: `${kbd('A')} opens it.` },
    { target: '#sbScroll [data-action="identity-new"]', title: 'New Identity…', text: 'A name for commands, a profile, and a NIP-65 relay list. The key is minted on this Mac and stored next to the demo keys; the profile and relay list are published to the relays you tick.', action: async () => emit('sidebar-open'), placement: 'right' },
    { target: '#sbScroll [data-identity]', title: 'One click to switch', text: 'Click an identity to act as it; hover for ··· with Open Profile, nak commands and Remove.', placement: 'right' },
    { target: '.cact[data-what="react"], .cbar', title: 'Previews that really run', text: 'In Client View, Reply, React, Repost, Subscribe and Join open a small preview with the exact command. Run in Terminal publishes it as the acting identity, and the result appears on the post seconds later.', action: async () => { social(); emit('feedmode', 'client'); }, wait: 200 },
    { target: '#terminal', title: 'Placeholders ask first', text: 'A command that still carries <code>&lt;nsec&gt;</code>, <code>&lt;npub&gt;</code> or <code>&lt;pubkey&gt;</code> asks which identity to use before it runs.', action: async () => emit('terminal-open'), wait: 250, placement: 'above' },
  ] },
  { id: 'terminal', title: 'Terminal', promise: 'Blocks, find, stop, jump between commands, inspect a result.', steps: [
    { target: '#termIn', title: 'Type nak, get blocks', text: `${NAK_INTRO}`, tip: `${kbd('↑')} ${kbd('↓')} walk the history; <code>clear</code>, <code>history</code> and <code>help</code> work as typed.`, action: async () => emit('terminal-open'), wait: 250, placement: 'above' },
    { target: '#termOut', title: 'Each run is a block', text: 'Command on top, output below, a coloured rail for the state: blue running, green done, red failed, grey stopped, with the duration on the right. Hover the command for Stop, Run Again and Copy Output; right-click for more.', placement: 'above' },
    { target: '#termOut', title: 'Events become rows', text: 'A line that is a signed event turns into a row with Inspect, Copy JSON and the raw text. Hex ids, npubs and relay URLs in any output are clickable.', placement: 'above' },
    { target: '#terminal .thd', title: 'Find and the More menu', text: `${kbd('⌘F')} opens find with a match count, ${kbd('⌘G')} steps through matches. The ··· menu holds Clear, Copy All, Export and the agent status.`, placement: 'above' },
    { target: '#terminal .thd', title: 'Long output and streams', text: `Blocks show up to 5,000 lines and offer an export of the rest. A stream keeps running while you inspect; ${kbd('⌘.')} stops it. When you scroll up, new output waits behind a small chip.`, placement: 'above' },
    { target: '#termResize', title: 'Room to work', text: 'Drag the top edge to resize; double-click the header to maximize and back.', placement: 'above' },
  ] },
  { id: 'client', title: 'Client View', promise: 'How a real client would render the same events, paywall included.', steps: [
    { target: '.feedmode', title: 'Same events, client eyes', text: 'Relay-only kinds are hidden, replies fold under their post, media and quotes are embedded, and money events become ledger rows.', action: async () => { social(); emit('feedmode', 'client'); }, wait: 150 },
    { target: '.carticle, .ctier, .cpost', title: 'Articles and memberships', text: 'A members-only article ends in a paywall that quotes the tier price; a tier is a membership card with perks and a Subscribe button that shows the real command.', placement: 'right' },
    { target: '.cbar', title: 'The action bar', text: 'Reply, repost, react and zap with counts. Each opens a preview: what a client would do, and the nak command that does it, ready to run as the acting identity.' },
  ] },
  { id: 'sealed', title: 'Sealed Content', promise: 'Open a gift wrap or an encrypted message with a key the agent holds.', steps: [
    { target: '#inspector [data-action="sealed-open"], #inspector [data-action="sealed-forget"], #inspector', title: 'Where sealed content shows', text: 'A gift wrap (kind 1059), an old-style message (kind 4) or any NIP-44 payload gets a <b>Sealed content</b> group in Summary: the scheme, who it is for, and whether a held key is a party to it.', action: async () => { technical(); const ev = [...store.events.values()].find(e => e.kind === 1059 || e.kind === 4); if (ev) emit('technical', ev.id); else emit('select-first'); }, wait: 250, placement: 'left' },
    { target: '#inspector [data-action="sealed-open"], #inspector [data-action="sealed-forget"], #inspector', title: 'Decrypt with a held key', text: 'Decrypt sends the event to the agent, which opens it with the key it holds and returns the layers. The key never reaches the page; the plaintext stays in this window until you reload or press Forget.', tip: '<b>Copy nak</b> gives the same operation as a terminal command; <b>Run</b> puts it in the terminal.', placement: 'left' },
    { target: '#inspector', title: 'Seal, rumor, plaintext', text: 'A gift wrap opens twice. The seal (kind 13) is signed by the real sender and its signature is checked. The rumor inside is unsigned by design and carries the actual event, for example a content key delivery, with its tags and content.', tip: 'The sealed-messages scenario publishes examples you can open as $subscriber.', placement: 'left' },
  ] },
  { id: 'scenarios', title: 'Scenarios', promise: 'Run a relay test recipe and read the matrix.', steps: [
    { target: '#scenariosBtn', title: 'Relay tests as recipes', text: 'A scenario is a JSON file: steps that publish events as the demo identities, and what every relay is expected to do with each of them.', action: async () => technical() },
    { target: '.slist', title: 'Pick one', text: 'Four ship with the test bed: relay basics, a subscription flow with a sealed key delivery, sealed messages, and NIP-29 groups. Drop your own JSON into <code>scenarios/</code> and it appears here.', action: async () => { technical(); emit('scenarios'); }, wait: 500, placement: 'right' },
    { target: '.scen-setup', title: 'Who signs, which relays', text: 'The identities a scenario signs as must be held by the agent; the seed mints them. Tick the relays to run against; the connected ones are ticked already.', placement: 'right' },
    { target: '.smatrix, [data-action="scenario-run"]', title: 'Run, and read the matrix', placement: 'left', text: 'One row per step, one column per relay. <b>✓</b> the relay did what the recipe expected, <b>✗</b> it did not, <b>–</b> the step only observed. Hover a cell for every check behind it.' },
    { target: '[data-action="scenario-new"], .slist', title: 'Make your own', text: '<b>New Scenario…</b> opens an editor: who signs, steps with kind, content and tags in nak style, and expectations per relay, with the JSON beside it. Any event\'s ··· menu has <b>Add to Scenario…</b>, which turns what you just saw into a step.', placement: 'right' },
    { target: '.sdet, .scen-empty', title: 'Every check, spelled out', text: 'Below the matrix each step lists its checks with expected and actual. Failed steps open by themselves. <b>Export Report</b> saves the whole run as Markdown.', placement: 'above' },
  ] },
  { id: 'keys', title: 'Keyboard', promise: 'The single-key shortcuts, on one card.', steps: [
    { title: 'Shortcuts', label: 'Keyboard', text: `${kbd('1')} Social ${kbd('2')} Technical ${kbd('I')} Details ${kbd('/')} Search ${kbd('R')} Relays ${kbd('A')} Acting as ${kbd('S')} Sidebar ${kbd('F')} Filter sidebar ${kbd('Q')} Query ${kbd('T')} Terminal ${kbd('C')} Client View ${kbd(',')} Settings ${kbd('?')} Help ${kbd('Esc')} Close`, tip: `Single keys work when no text field has focus, because browsers keep the ⌘ combinations for themselves. In the terminal: ${kbd('⌘K')} clear, ${kbd('⌘F')} find, ${kbd('⌘.')} stop, ${kbd('⌘↑')} ${kbd('⌘↓')} between commands.`, cta: 'Close' },
  ] },
];

/** Contextual tips: one paragraph next to the thing, with a tour step to show it live. */
export const TIPS = {
  relay: { title: 'Relays', text: 'Click a relay to see only what was seen on it. The dot connects or disconnects. ··· opens details, nak commands and removal.', tour: 'relay', step: 0 },
  identities: { title: 'Identities', text: 'Click one to act as it; write commands then sign with it. New Identity… mints a key with a profile and relay list.', tour: 'identities', step: 1 },
  show: { title: 'Show', text: 'Bundles for what you research. Subscriptions and Payments collects tiers, subscribes and receipts, so one click shows the whole money flow.', tour: 'sidebar', step: 1 },
  kinds: { title: 'Kinds', text: 'Seen lists what is really on the relays with counts. By NIP groups kinds under their spec and can list the whole catalogue.', tour: 'sidebar', step: 2 },
  people: { title: 'People', text: 'Everyone who signed an event. Click a person for everything related to them: written by them, or tagging them.', tour: 'sidebar', step: 0 },
  details: { title: 'Details', text: 'The inspector for one post: Summary, Tags, Refs, Raw and nak. Press I to hide or show it.', tour: 'details', step: 0 },
  inspector: { title: 'Inspector', text: 'Select a row. Summary names the NIP and verifies the event; Tags and Refs explain its connections; nak gives commands.', tour: 'details', step: 0 },
  scenarios: { title: 'Scenarios', text: 'Relay tests as recipes: each step publishes as a demo identity and states what every relay should do. The matrix shows what happened, cell by cell.', tour: 'scenarios', step: 0 },
  sealed: { title: 'Sealed content', text: 'This event carries ciphertext. When the agent holds a key that is a party to it, Decrypt opens it here; the key never leaves the agent and the plaintext never leaves this window.', tour: 'sealed', step: 0 },
  terminal: { title: 'Terminal', text: 'Runs nak on this Mac. Each command is a block; event lines become inspectable rows. clear, history and help work as typed.', tour: 'terminal', step: 0 },
};
export const tourById = id => id === 'quick' ? QUICK_START : TOURS.find(t => t.id === id);
