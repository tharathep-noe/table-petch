# Session persistence: restore the workspace, but never the data or the writes

The open tabs, the active tab, and the active connection are persisted so the app
reopens where the user left off. Three decisions shape how, and each was a real
choice with a safer-but-less-convenient alternative:

1. **Main process owns the file, reached only via IPC.** Session lives in
   `session.json` under `userData`, with `loadSession`/`saveSession` on
   `TablePetchApi` — the same shape as `connections.json` and `store.ts`. We did
   _not_ use renderer `localStorage`, even though it would be zero-IPC, because it
   would be the only durable state living in the sandboxed renderer (breaking the
   repo's "renderer never touches storage" rule), it's tied to the Chromium
   partition (wiped by cache clears), and it wouldn't sit with the user's other
   data in `userData`.

2. **We persist reconstruction inputs, never fetched rows.** A tab stores its SQL
   text, browsed table, and pane state — not its `result`. On restore the rows are
   re-derived (re-load the table / the user re-runs the SQL), so we never serialize
   a copy of someone's data to disk.

3. **Restoring never executes a write and never auto-runs editor SQL.** After a
   best-effort auto-reconnect, table-browse tabs auto-load (read-only `select`),
   but SQL-editor tabs only restore their text — the user must press run. The SQL
   editor executes arbitrary statements, so auto-running persisted text could
   silently re-run a `DELETE`/`UPDATE` on launch. That risk is unacceptable for a
   convenience feature, so auto-run is off by design.

## Consequences

- Saves are debounced (~500 ms) from the renderer on change to `tabs` /
  `activeTabId` / `activeConnectionId`; an abrupt kill loses at most the last
  ~half-second of typing. No `before-quit` scrape of renderer state.
- `loadSession` fails safe to a fresh single-tab session when the file is missing,
  unparseable, or carries an unrecognized `version` (forward-only; bump to
  `version: 2` with an explicit migration when the shape changes).
- Auto-reconnect is best-effort: if it fails, tabs still restore in a disconnected
  state and the user connects manually.
