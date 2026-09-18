# identities

The agent keeps its keys here, on your machine, never in the page:

- `demo-keys.env`: the three demo identities the seed mints (`creator`, `subscriber`, `platform`).
- `relay-window.env`: identities minted from the UI with New Identity…, one `name=secret` per line, mode 600.

Both files are ignored by git. Removing an identity in the UI deletes its line. Delete the files to start over.
