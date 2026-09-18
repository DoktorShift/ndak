# Scenarios

A scenario is a JSON file in this folder. The agent lists them; the window runs them and draws a matrix of what every relay did. Drop in a file and it appears in the Scenarios sheet, no rebuild. The sheet's **New Scenario…** editor writes the same files (and **Add to Scenario…** in any event's menu turns a loaded event into a step), so a scenario can start in the window and be finished by hand, or the other way round.

```json
{
  "id": "relay-basics",
  "title": "Relay basics",
  "summary": "One sentence on what the run shows.",
  "identities": ["creator", "platform"],
  "steps": [ … ]
}
```

Each step runs as a held identity (`as`) and does one of three things:

- `"event": { "kind", "content", "tags" }` publishes a signed event to the chosen relays. Add `"encrypt": "nip04"` or `"nip44"` and the content is encrypted for the `p` tag first.
- `"wrap": { "to": "subscriber", "rumor": { "kind", "content", "tags" } }` seals the rumor for `to` (NIP-59) and publishes the gift wrap.
- neither: a query-only step that just checks.

Then `expect` says what every relay should do. Each value is either one answer for all relays or `{ "default": …, "<relay name>": … }` with overrides by NIP-11 name. `null` means observe without judging: the matrix shows a dash and the detail. Steps publish at least one second apart, so a newer version always carries a newer `created_at`.

| Check | Meaning |
| --- | --- |
| `"accepted": true` | the relay answered OK true when the event was published |
| `"stored": true` | a REQ for the id returns the event a moment later (false for ephemeral kinds) |
| `"latest": { filter }` | the filter returns exactly this event: the newest version replaced the older ones |
| `"count": { "filter", "min", "max", "eq" }` | how many events the filter returns |
| `"gone": "$note.id"` | that id is no longer returned (after a deletion) |
| `"opens_as": "subscriber", "kind": 21088` | the published wrap decrypts with that identity's key and carries an event of that kind |

Tokens: `$creator` is the public key of a held identity, `$note.id` the id of an earlier step, `$note.address` its `kind:pubkey:d`, `$now` and `$now+30d` are times. Tags are arrays exactly as in the event; a one-element tag such as `["public"]` is allowed.
