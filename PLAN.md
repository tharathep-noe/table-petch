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
3. App-state persistence: saved queries, query history, open tabs across restarts

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
