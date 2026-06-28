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

- SQLite engine (MySQL / MSSQL / Oracle now scoped — see "Multi-engine" below)
- SSH tunnel / SSL certificates
- Materialized views, sequences, types, indexes in the tree (functions &
  procedures now scoped — see "Routines" below)
- Rich per-type editors (date pickers, JSON tree editor, array chips)
- Keyset pagination
- **Grid virtualization** (`@tanstack/react-virtual`) — add when result sets
  exceed the 500-row page cap; the grid is on TanStack Table already
- **Column resize** in the grid (sorting now scoped — see "Sorting" below)

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

## Routines (functions & procedures) — build steps (next pass)

Surface user-defined **routines** in the schema tree and let the user view a
routine's source. Scope: `pg_proc.prokind in ('f','p')` in non-system schemas
(same filter as tables); aggregates/window functions deferred. A routine is
identified by `oid` and displayed by its signature (overloads share a name).
Clicking a routine opens its real `CREATE OR REPLACE …` definition into a fresh,
un-run, **editable** SQL [[tab]] — no dedicated viewer. See ADR 0004.

Decisions fixed during design:

- **List metadata eager, source lazy.** `listSchema` returns routine metadata
  (`oid`, `name`, `kind`, signature) per schema; the source body is fetched on
  click via a new `getRoutineSource`, never bundled into the list (bodies can be
  huge).
- **Identity by `oid`, display by signature** (`pg_get_function_identity_arguments`).
  Routines are never persisted into the session, so oid instability across
  restarts is a non-issue — the opened source rides existing `sqlText` persistence.
- **Section label is "Routines"** (not "Functions" — that would overload the
  glossary term); per-row icons distinguish function (`ƒ`) from procedure. The
  sub-label renders only when a schema has ≥1 routine.

1. **Shared contract** — add `RoutineRef { schema; name; kind: 'function' |
'procedure'; oid; signature }` to `src/shared/types.ts`; extend
   `SchemaInfo.schemas[]` with `routines: RoutineRef[]`. Add
   `getRoutineSource(connectionId, oid): Promise<string>` to `TablePetchApi` and a
   channel name in `src/shared/channels.ts`.
2. **Introspection** — in `src/main/db/introspect.ts`, add a 4th parallel query to
   `listSchema`: join `pg_proc`/`pg_namespace`, filter `prokind in ('f','p')` and
   the existing non-system-schema filter, select `oid`, `proname`,
   `prokind`, and `pg_get_function_identity_arguments(oid)` for the signature;
   group into each schema's `routines`. Add `getRoutineSource(connectionId, oid)`
   running `pg_get_functiondef($1)` (read-only).
3. **Preload + IPC** — expose `getRoutineSource` on `window.api`; register the
   handler in `src/main/ipc.ts`.
4. **Renderer tree** — in `Sidebar`'s `DatabaseView`, after each schema's tables
   render a conditional "Routines" sub-label (only when `s.routines.length > 0`)
   then the routines: per-row function/procedure icon + signature label, click →
   new handler `onOpenRoutine(ref)`.
5. **Open flow** — in `App.tsx`, `onOpenRoutine` calls `getRoutineSource`, then
   `onOpenSql(source)` (existing un-run SQL-tab path), titling the tab by the
   routine name. A dropped routine (fetch fails) surfaces a per-tab error, same as
   a dropped-table restore.

## Sorting (table browser) — build steps (next pass)

Click a column header to sort a browsed table. Sorting is **server-side** (the
[[active sort]]): it re-fetches the page with an `ORDER BY` so "top N" means the
table's true top N, not the loaded window's. The SQL plumbing already exists
(`buildLoadRows`, `LoadRowsRequest.orderBy`, the `loadRows` pass-through), so this
pass is **renderer-only**. See [ADR 0008](./docs/adr/0008-sorting-blocked-while-dirty.md).

Decisions fixed during design (all in ADR 0008):

- **Server-side, single-column.** Contract stays `orderBy?: { column; desc }`;
  multi-column (`{column,desc}[]` + shift-click) deferred.
- **Three-state header cycle** — unsorted → asc → desc → unsorted; the third click
  clears the sort (no `ORDER BY`, natural order).
- **Blocked while the grid is dirty.** Sort headers are inert when
  `countChanges > 0` (staged edits are page-index-keyed; a re-fetch reorders rows).
  Tooltip: commit or discard first. We rejected re-mapping edits by row identity.
- **Indicator commits after a successful re-fetch**, never optimistically — the
  arrow always reflects the rows on screen; a failed sort (e.g. `ORDER BY` a `json`
  column) leaves the prior order and arrow intact via the existing error path.
- **Table browser only** (gated on `result.table`); SQL-editor results keep their
  user-authored `ORDER BY`.
- **Ephemeral** — the active sort lives only in the renderer; not persisted, so a
  restored [[tab]] reloads in natural order. No `PersistedTab` change.

1. **Tab state** — `App.tsx` holds an in-memory active sort per browsed tab
   (`{ column; desc } | undefined`). `loadTable` takes an `orderBy` param and
   passes it to `window.api.loadRows`; set the active sort only on a successful
   load. `reload()` preserves the current sort.
2. **Sort callback** — pass an `onSort(orderBy | undefined)` prop into `DataGrid`;
   it calls back up to `App` to re-fetch (no client-side reordering in the grid).
3. **Header UI** — in `DataGrid`, make headers clickable when `result.table` is
   present **and** `countChanges === 0`: three-state cycle, asc/desc arrow on the
   active column, disabled-with-tooltip styling while dirty.

## Row detail pane — build steps ✅

A toggleable, resizable right-hand pane showing the [[active row]]'s columns as a
vertical list of always-on inputs, editing into the **same** staged-change set as
the grid and committed by the grid's one footer Commit/Discard. Existing rows
only; it absorbs the deferred cell-expander modal. See
[ADR 0009](./docs/adr/0009-row-detail-pane.md).

Decisions fixed during design (all in ADR 0009):

- **Second surface, one change set.** Edit state lifts out of `DataGrid` into a
  `useTableEditing(result, connectionId)` hook owned by `App`; `DataGrid` and the
  new pane are pure consumers. No second commit button.
- **Global pane, per-tab content.** One pane in the `AppLayout` shell, bound to
  the active [[tab]]'s hook instance; remounts on tab switch, so edits reset on
  switch (as today). **Active row** = the grid selection's anchor; resets to none
  on any result change.
- **Always-on inputs.** Empty input = `''`; NULL only via an explicit Set-NULL
  action. Generated/identity columns shown locked. Long/JSON values get a growing
  textarea (replaces the cell-expander modal).
- **Existing rows only** — new-row composition stays in the grid.
- **Open flag + width persist** in `session.json` (`recordPane: { open, width }`);
  the active row does not.

1. **Lift edit state** — extracted `src/renderer/src/lib/useTableEditing.ts` from
   `DataGrid` (the `edits`/`newRows`/`deleted`/`selected`/`focused` cluster +
   `commit`/`discard`/`countChanges`, plus the global Cmd+S commit); `App` owns one
   instance for the active tab, `DataGrid` consumes its output as props. The hook
   also owns selection so the pane's **active row** = the selection anchor. ✅
2. **Shared contract** — added `recordPane?: { open: boolean; width: number }` to
   `PersistedSession`; `sessionStore` load stays fail-safe (optional field). ✅
3. **Pane component** — `RecordDetailPane.tsx`: vertical field list of the active
   row, always-on growing textareas, locked generated columns (and locked when the
   row is staged-deleted, with a banner), explicit Set-NULL (`∅`) and Set-value
   affordances, dirty highlight mirroring the grid. ✅
4. **Layout** — `AppLayout` grew an optional `rightPane` slot; the pane carries its
   own left-edge resize splitter (first one in the app). Opened by **clicking a
   row** (the hook's `onSelect` gesture callback) or the `Toolbar`'s `Row detail`
   toggle; closed by the toggle or the pane's `✕`. ✅
5. **Persistence wiring** — `recordPane` open/width ride the existing debounced
   session-save effect in `App.tsx`; restored on hydrate. ✅

## Tab keyboard shortcuts — build steps ✅

`Cmd+T` opens a new [[tab]]; `Cmd+W` closes the current one. Driven by a custom
application menu in the main process, not a renderer keydown, because macOS binds
`Cmd+W` to the native close-window role that a keydown can't intercept. See ADR 0005.

1. **Channels** — add one-way `menuNewTab` / `menuCloseTab` (main → renderer) to
   `src/shared/channels.ts`; add `onMenuNewTab` / `onMenuCloseTab` (each returns an
   unsubscribe) to `TablePetchApi`. ✅
2. **App menu** — `src/main/menu.ts`: a custom `Menu` (re-declaring the standard
   roles) with `New Tab` (CmdOrCtrl+T) / `Close Tab` (CmdOrCtrl+W) items that
   `webContents.send` the intents; installed per-window in `index.ts`. ✅
3. **Preload** — bridge the two `on…` subscriptions over `ipcRenderer.on`. ✅
4. **Renderer** — `App.tsx` subscribes: new-tab → `newTab()`; close-tab →
   `closeTab(active)` when >1 tab, else `window.close()`. ✅

## Multi-engine (MySQL / MSSQL / Oracle) — design fixed, build pending

Postgres becomes the first **driver** behind an engine-neutral abstraction, not the
baseline. The renderer and IPC contract never name an engine. See ADR 0006 and the
glossary ([[engine]], [[driver]], [[dialect]], [[catalog]], [[capabilities]]).

Decisions fixed during design (all in [ADR 0006](./docs/adr/0006-multi-engine-driver-architecture.md)):

- **Namespace is always 3-level** `server → catalog → schema → object`; each driver
  collapses levels it lacks. The "database switcher" becomes the **catalog switcher**.
- **`string | null` cell contract kept**; each driver owns native→text normalization
  (binary/LOB → non-editable sentinel for now).
- **Shared CRUD builders + a per-driver `Dialect`** (quote / placeholder / paginate);
  whole-method override only where a dialect can't be parameterized (Oracle paging).
- **`ConnectionConfig` is a discriminated union per engine**; the modal renders the
  right form per engine.
- **Routines identified by an opaque `handle: string`**, not the pg `oid`
  (supersedes ADR 0004's identity field).
- **Keyless edit path stays**; a driver flags text-unsafe columns and escalates the
  all-columns commit warning.
- **Each driver advertises a `Capabilities` descriptor** (catalog switching,
  multi-statement, routines, `sqlDialect`); the renderer adapts from data, never an
  engine name.
- **All four drivers bundled, lazy-loaded on first use**; `oracledb` pinned to
  pure-JS thin mode. Existing engine-less connections default to the postgres variant.

Build order (per ADR 0006): (1) shared types — `Capabilities`, engine-union
`ConnectionConfig`, `catalog` on `TableRef`/`SchemaInfo`, `handle` on `RoutineRef`;
(2) extract a `Driver` interface and refactor the Postgres code into the first driver

- driver registry; (3) `Dialect` value object + shared CRUD builders; (4) per-engine
  introspection — **native catalogs uniformly** (`pg_catalog` / `sys.*` / `ALL_*` /
  `SHOW`+`STATISTICS`), eager per active catalog, driver-owned system filter,
  `category` + `textRoundTripSafe` on `ColumnMeta`, standalone routines only; see
  [ADR 0007](./docs/adr/0007-per-engine-introspection.md); (5) the
  non-PG drivers one at a time; (6) capabilities-gated renderer (catalog switcher,
  editor dialect, disabled affordances); (7) connection-modal per-engine forms +
  load-time migration.

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
