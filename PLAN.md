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

## Open (business layer — decide before launch, not before coding)
1. Monetization / licensing (license-key validation, trial, payment provider)
2. Packaging: code signing + notarization (macOS) / signing (Windows); auto-update
3. App-state persistence: saved queries, query history, open tabs across restarts

## Suggested build order
1. Project boots (Electron + React window). ✅ scaffolded
2. Connection store + secure passwords (`safeStorage`).
3. Connect/disconnect + schema introspection → sidebar.
4. Table browser read path (paged `loadRows`).
5. SQL editor + `runQuery`.
6. Staged edit model + `commitChanges` (the write path).
7. Type handling polish (NULL, expander modal).
