# table-petch — Plan

A shippable, sellable Postgres GUI client (TablePlus-like): view, update, and delete
data, plus a SQL editor.

## v1 scope

- Connection management (add/edit/list connections, secure password storage)
- Schema sidebar: database switcher → schemas → tables & views
- Table browser: paged row loading, inline edit, insert, delete
- Staged edits committed together in one transaction (with preview)
- SQL editor with results in the same editable grid

## Stack

- **Electron** + **electron-vite** build tooling
- **React + TypeScript** renderer (sandboxed: `contextIsolation` on, no Node)
- **`pg`** driver runs in the **main process**
- Renderer ⇄ main over a **typed IPC/RPC bridge** via `preload` + `contextBridge`
  (`connect`, `disconnect`, `listSchema`, `runQuery`, `loadRows`, `commitChanges`)
- Grid: **TanStack Table + Virtual**
- SQL editor: **CodeMirror 6** (SQL language + schema-aware autocomplete)

## Key decisions

### Credentials

- Non-secret connection fields in a local JSON config (app `userData`).
- Passwords encrypted at rest via Electron **`safeStorage`** (OS keychain).

### Process model

- `pg` lives in main; renderer never opens sockets.
- IPC is a small RPC surface so the DB layer can later move to a `utilityProcess`
  without touching the renderer.

### Row loading

- **`LIMIT`/`OFFSET`** paging, ~500–1000 rows per chunk, load-more on scroll.
- Upgrade to keyset pagination later only if deep scroll lags.

### Editing model

- Edits are **staged** (dirty cells highlighted), then flushed in **one
  transaction** on save, after a SQL preview.
- Row identity for `WHERE`: **primary key → unique constraint → all-column match**.
- If no unique identity can be guaranteed, the statement still runs, but a
  **non-blocking warning** is shown in the commit preview (user owns the risk).
- **New rows** are staged in the grid with a three-state cell model: _unset_
  (omitted from the `INSERT` so Postgres applies the column DEFAULT/identity),
  an explicit value, or explicit NULL. Generated/identity-always columns are
  never insertable; NOT-NULL columns without a default are **required** and
  block commit until provided.

### Type handling

- Render/edit values as their **Postgres text representation**.
- `NULL` shown distinctly with an explicit "set NULL" action (never confused with `''`).
- Long values open a **cell expander modal** with pretty-printed JSON.
- Validation happens on commit (let Postgres reject bad input); rich per-type
  editors deferred.

### SQL editor execution

- `Cmd+Enter` → statement under cursor.
- `Cmd+Shift+Enter` → whole script.
- Selection → run selection.
- Single-statement results are editable when they're a simple single-table select.

## Deferred (post-v1)

- MySQL / SQLite engines
- SSH tunnel / SSL certificates
- Materialized views, functions, sequences, types, indexes in the tree
- Rich per-type editors (date pickers, JSON tree editor, array chips)
- Keyset pagination
- **Grid virtualization** (`@tanstack/react-virtual`) — add when result sets
  exceed the 500-row page cap; the grid is on TanStack Table already
- **Sorting / column resize** in the grid

## Open (business layer — decide before launch, not before coding)

1. Monetization / licensing (license-key validation, trial, payment provider)
2. Packaging: code signing + notarization (macOS) / signing (Windows); auto-update
3. App-state persistence — split into three distinct concerns (see glossary):
   - **Session** (open tabs + active tab + active connection across restarts) —
     scoped in now; see [ADR 0002](./docs/adr/0002-session-persistence.md) and the
     build steps below.
   - **Saved queries** (curated, named SQL library) — scoped in now; see the
     build steps below.
   - **Query history** (automatic, append-only run log) — scoped in now; see the
     build steps below.

## Session persistence — build steps (current pass)

Persist only reconstruction inputs; never the fetched `result`. Storage mirrors
`store.ts` (main-process `session.json` in `userData`, reached via IPC). Restore
auto-loads table tabs but never auto-runs SQL-editor tabs. See ADR 0002.

1. **Shared contract** — add `PersistedSession` / `PersistedTab` types and
   `loadSession()` / `saveSession(session)` to `TablePetchApi` in
   `src/shared/types.ts`; add channel names in `src/shared/channels.ts`.
2. **Main store** — `src/main/sessionStore.ts`: read/write `session.json` with the
   `store.ts` error-swallowing pattern; `load` fails safe to "no session" on
   missing/unparseable/unknown-`version`. Register handlers in `src/main/ipc.ts`.
3. **Preload** — expose `loadSession` / `saveSession` on `window.api`.
4. **Renderer save** — in `App.tsx`, a debounced (~500 ms) effect watching
   `tabs` / `activeTabId` / `activeConnectionId` calls `saveSession`, stripping
   `result` and `error` from each tab.
5. **Renderer restore** — on mount, `loadSession()`; rebuild tabs (text + pane +
   `currentTable`), then best-effort auto-reconnect to `activeConnectionId`. On
   connect success, auto-load `currentTable` tabs; leave SQL-editor tabs un-run.
   A dropped table surfaces a per-tab error without aborting the restore.

## Saved queries & query history — build steps (next pass)

Two more app-state concerns, persisted with the same fail-safe main-process
JSON-in-`userData` pattern as `store.ts` / `sessionStore.ts` (reached only via
IPC; never the renderer's storage). **Query history** is scoped per connection;
the **saved-query** library is global. Both surface in a new three-view sidebar
switcher and open into a fresh SQL [[tab]] (prefilled, never auto-run). Build
**history first**, then saved queries, then the switcher. See ADR 0003.

Decisions fixed during design:

- **History logs only user-authored `runQuery` executions** — not synthesized
  commit statements nor table-browse `SELECT`s. The entry shape carries a
  `source: 'query' | 'commit'` discriminator so commit logging can be added later
  with no migration (`'query'` only for now).
- **Capture is main-side**, inside the `runQuery` IPC handler, where the `pg`
  command tag and wall-clock duration are already in hand. No renderer-facing
  `appendHistory`.
- **Cap 500 entries, FIFO.** Consecutive identical executions collapse **iff**
  the execution is a pure read (every `pg` command tag is `SELECT`/read) or a
  failure; writes (`INSERT`/`UPDATE`/`DELETE`/DDL) are always recorded separately.
- **History scoped per connection** (filtered at display); **saved queries
  global**, each tagged with an optional originating `connectionId` (tag stored
  now, filter UI deferred).
- Deferred: per-row history delete, a disable/pause toggle, saved-query
  folders/tags, the saved-query connection filter UI.

### Shared contract

1. Add `HistoryEntry`, `SavedQuery`, `SavedQueryInput` to `src/shared/types.ts`;
   extend `TablePetchApi` with `listHistory(connectionId)`,
   `clearHistory(connectionId)`, `clearAllHistory()`, `listSavedQueries()`,
   `saveQuery(input)` (upsert), `deleteSavedQuery(id)`. Add channel names to
   `src/shared/channels.ts`. (No `appendHistory` — capture is internal to main.)

   `HistoryEntry`: `id`, `source: 'query' | 'commit'`, `connectionId`,
   `database`, `sql`, `command: string | null` (pg command tag), `executedAt`,
   `ok`, `rowCount: number | null`, `durationMs: number | null`, `error: string | null`.

   `SavedQuery`: `id`, `name`, `sql`, `connectionId: string | null`, `createdAt`,
   `updatedAt`.

### History (build first)

2. **Main store** — `src/main/historyStore.ts`: read/write `queryHistory.json`
   (`{ version: 1, entries: HistoryEntry[] }`) with the `sessionStore.ts`
   fail-safe pattern. `append(entry)` applies the 500-cap FIFO + read/failure
   collapse rule; `list(connectionId)` returns that connection's entries
   newest-first; `clear(connectionId)` and `clearAll()`.
3. **Capture** — in the `runQuery` handler (`src/main/ipc.ts`): time the run,
   read the `pg` command tag(s), classify read vs write, build the
   `HistoryEntry` (`source: 'query'`), call `historyStore.append`. The query's
   own result still returns unchanged; logging is a contained side effect.
4. **Cascade** — `deleteConnection` (`src/main/store.ts`) also clears that
   connection's history.
5. **Preload + IPC** — expose `listHistory` / `clearHistory` / `clearAllHistory`
   on `window.api`; register handlers in `ipc.ts`.
6. **Renderer** — the History view (see step 11): list scoped to the active
   connection, newest-first; row click opens a new SQL tab prefilled (not run);
   "Clear history" (this connection) and "Clear all" actions; an empty state
   ("Connect to a database to see its history.") when disconnected.

### Saved queries

7. **Main store** — `src/main/savedQueryStore.ts`: `savedQueries.json`
   (`{ version: 1, queries: SavedQuery[] }`); `list()`, `save(input)` upsert
   (`id ?? randomUUID()`, set `createdAt` once / bump `updatedAt`), `delete(id)`.
8. **Preload + IPC** — `listSavedQueries` / `saveQuery` / `deleteSavedQuery`.
9. **Renderer** — the Queries view (see step 11): global list sorted
   `updatedAt` desc; row click opens a new SQL tab prefilled; delete behind a
   confirm (matching the connection-delete pattern in `App.tsx`).
10. **Save flows** — a "Save query" action in the `SqlEditor` toolbar (capture
    current editor text, name via `Modal` + `Input`, tag the active connection)
    and a "Save to library" action on a history row; both funnel into the single
    `saveQuery` upsert.

### Sidebar switcher

11. Add a three-view segmented switcher (**Database / Queries / History**) at the
    top of `Sidebar`; the selected view swaps the sidebar body. Connection and
    active-tab state stay global across views. Database remains the existing
    connections → databases → schemas → tables tree.

## Suggested build order

1. Project boots (Electron + React window). ✅ scaffolded
2. Connection store + secure passwords (`safeStorage`). ✅
3. Connect/disconnect + schema introspection → sidebar. ✅
4. Table browser read path (paged `loadRows`). ✅
5. SQL editor + `runQuery`. ✅ (CodeMirror, runs selection-or-all via ⌘↵;
   results shown read-only. Refinement TODO: run _statement under cursor_,
   and make simple single-table SELECT results editable.)
6. Staged edit model + `commitChanges` (UPDATE + DELETE + INSERT). ✅
   New rows are added in the grid; each cell is _unset_ (DB DEFAULT), an explicit
   value, or explicit NULL. Required columns (NOT NULL, no default, not generated)
   are marked `*` and block commit until provided.
7. Type handling polish (NULL ✅; expander modal still TODO).
8. Database switcher in the sidebar. ✅

Also done: Add/Edit/Delete connection modal, Tailwind, draggable window,
unique-key introspection, optimistic-concurrency (fail-on-0-rows).
