# ndak

**Nostr Dev Army Knife**: a local Nostr test bed in Docker. Five different relays, the Relay Window observability UI and an agent that runs `nak` for it. Clone it, start it, open one page.

```sh
git clone https://github.com/DoktorShift/ndak.git && cd ndak
docker compose up -d                            # first start builds two small images (about two minutes)
open http://localhost:7778/
docker compose --profile seed run --rm seed     # optional, once: demo identities and sample events
```

Requirements: Docker with Compose v2 (Docker Desktop on macOS or Windows, Docker Engine on Linux). Nothing else is installed on your machine; `nak` lives in the agent container.

## What runs

| Port | Service | Why it is here |
| --- | --- | --- |
| 7778 | **ui**, nginx | the Relay Window page |
| 7790 | **agent**, Node + nak + jq | runs commands for the page's terminal and holds the identity keys; reachable from this machine only |
| 7777 | [rnostr](https://github.com/rnostr/rnostr) | many NIPs, COUNT (NIP-45) and search (NIP-50) |
| 7779 | [nostr-rs-relay](https://github.com/scsibug/nostr-rs-relay) | reference behaviour; passes ephemeral events on without storing them |
| 7780 | [strfry](https://github.com/hoytech/strfry) | NIP-42 AUTH for kinds 4 and 1059, COUNT, NIP-77 negentropy sync |
| 7781 | [obelisk-relay](https://github.com/obelisk-app/obelisk-relay) | NIP-29 groups including subgroups, NIP-42, NIP-50; open, any key can create groups |
| 7782 | [khatru](https://pkg.go.dev/fiatjaf.com/nostr/khatru) | a small relay built from source with one custom policy (`relays/khatru/main.go`): it rejects kinds 13 and 21088, which must never travel unwrapped |

Every relay is named after its repository, in the compose file and in the NIP-11 name the window shows. Relay data lives in Docker volumes; configs are in `relays/`. rnostr and nostr-rs-relay publish amd64 images only and run under emulation on Apple Silicon.

## The window

Relay Window connects to all five relays at once, keeps every event with the relays it was seen on, explains any kind in plain words, inspects it down to the serialized bytes, compares what each relay holds, and runs nak from an integrated terminal.

**Social** reads the relays like a timeline: who did what. **Relay View** explains every event, including relay-only kinds. **Client View** renders the same events the way an editorial social client would: relay-only kinds hidden, replies folded, media embedded, articles with a paywall, tiers as membership cards, money as ledger rows. Reply, Repost, React, Zap, Subscribe and Join open a preview with the exact nak command, Copy and Run in Terminal.

**Technical** lists every event as a sortable row with the inspector beside it: Summary (kind and NIP with a link to the spec, the NIP-01 class, id and signature checks, created versus received, seen on, content analysis), Tags (each tag with its meaning, references resolved), Refs (what it points at and what points back), Raw (JSON and the serialized form that is hashed), nak (fetch, verify, watch, reply, react, subscribe, delete, share; every command has Copy and Run). Kind names and NIP links come from the official NIP index (`ui/js/registry.js`, regenerated with `scripts/registry.py`); everything else is derived from the event itself, so a kind nobody has heard of still gets a class, verification, annotated tags and commands.

**Sidebar**: relays (click to scope, dot to connect, ··· for details), identities (click to act as), Show bundles (Notes and Articles, Subscriptions and Payments, Keys and Sealed Messages, Groups, NWC, CLINK, Profiles and Relays), Kinds (Seen with counts, or the whole catalogue By NIP), People. The field on top filters every section.

**Search** tokens: `kind:1 author:alice id:hex #t:tag tag:name=value relay:strfry since:2h until:2026-09-18 nip:56` plus free text. **Query and Compare** (`Q`) runs one filter against any set of relays on separate sockets and shows status, latency, returned and COUNT per relay, then a presence matrix. **Relay Details** shows the NIP-11 document, read-only behaviour probes and the protocol log. **Import…** loads JSONL; **Export** writes it.

**Busy relays**: add a public relay (Manage Relays…) and the window copes. Banners coalesce into one per burst and come from local relays only by default (Settings → Notification banners). The Live pill shows the arrival rate. Rendering is throttled, the table shows the first 500 rows and the timeline the latest 300 posts, and the window keeps the newest 5,000 events (Settings → Events to keep).

**Tours**: Help (`?`) holds a two-minute Quick Start and short tours per area; a small **?** next to a section title explains it in place.

## Terminal and identities

The Terminal (`T`) runs nak through the agent and shows every run as a block: command, output, status rail, duration. Event lines become rows you can inspect; ids, npubs and relay URLs are clickable. `clear`, `history` and `help` work as typed; `↑ ↓` history, `⌘K` clear, `⌘F` find, `⌘.` stop, `⌘↑ ⌘↓` between commands. nak's relay narration folds into one status line per run.

An **identity** is a named key the agent holds. **New Identity…** mints one, publishes a profile and a NIP-65 relay list, and stores the key in `identities/relay-window.env`. **Acting as** (toolbar, `A`) chooses who signs the commands the window generates; names like `$creator` stand in for keys, and the agent fills them in on its side. Keys never reach the page.

The seed mints `creator`, `subscriber` and `platform` into `identities/demo-keys.env` and publishes profiles, relay lists, notes, a reply, reactions, a repost, an article, a NIP-29 group with two messages, a paid tier with a subscription and its receipt, and a wallet info event. Run it once.

## Start, stop, reset

| What you want | Command |
| --- | --- |
| Start everything | `docker compose up -d` |
| See what runs | `docker compose ps` |
| Follow a relay's log | `docker compose logs -f obelisk-relay` |
| Stop, keep data | `docker compose down` |
| Stop and delete all relay data | `docker compose down -v` |
| Restart one relay after a config edit | `docker compose restart strfry` |
| Rebuild after editing the agent or khatru | `docker compose up -d --build agent khatru` |
| Update the pinned images | edit the tags in `docker-compose.yml`, then `docker compose pull && docker compose up -d` |

Identities survive `down -v`: they are files in `identities/`, not volume data. Delete the files to start over.

## How it fits together

```
ui/                 the page: index.html, css/app.css, js/ (ES modules, no build step), data/sample.jsonl
agent/              agent.js (the runner), seed.js (demo data), keys.js (shared), Dockerfile
nginx/ui.conf       serves ui/ with Cache-Control: no-cache, so edits show on reload
relays/             one folder per relay: config, and for khatru the Go source and Dockerfile
identities/         keys the agent holds (git-ignored)
scripts/registry.py regenerates ui/js/registry.js from the NIP index
```

The page talks to relays directly over WebSocket and to the agent on `127.0.0.1:7790`. The agent binds to localhost only (published on this machine's loopback address), accepts requests from the page's origin only, runs `nak` and `jq` only, pipes allowed and no shell, and replaces `$name` tokens with the keys it holds. Inside its container "localhost" is not this machine, so relay URLs given as localhost are dialled through `host.docker.internal` and mapped back in the output. The seed uses the same image.

obelisk-relay needs a relay key of its own; `obelisk-init` writes one into `relays/obelisk/settings.local.yml` on first start, so every install has a different key and the checked-in `settings.yml` holds none.

## Development

- Syntax-check every module: `npm run check` (only Node is needed).
- Registry refresh: `python3 scripts/registry.py` fetches the NIP index and rewrites `ui/js/registry.js`.
- Views render HTML strings from state; clicks are handled once, in `ui/js/app.js`, by the `data-action` attribute on the element. Views never import `app.js`; they ask for navigation through `bus.js`.
- Interface text follows the macOS Human Interface Guidelines; where they are silent, nostrdesign.org: names over keys, relays without the protocol prefix, NIP-05 as a label, never as verification.
