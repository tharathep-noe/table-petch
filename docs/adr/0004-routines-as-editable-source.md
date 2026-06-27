# Routines are viewed as editable source in a SQL tab, identified by oid

The sidebar gains a third object kind alongside tables and views: the **routine**
(a user-defined function or procedure; see the glossary). Unlike a table, a routine
has no rowset to browse, so "open it" cannot mean the table-browser tab the rest of
the app is built around. This ADR fixes how a routine is surfaced. Each decision
below was a real choice with a simpler-looking alternative we rejected.

1. **Clicking a routine opens its source in an ordinary, editable SQL tab — not a
   dedicated read-only viewer.** We fetch the genuine `CREATE OR REPLACE …`
   definition (`pg_get_functiondef`) and drop it, un-run, into a normal SQL-editor
   tab via the existing `onOpenSql` path — the same path saved queries and history
   already use. We rejected two richer alternatives: a structured read-only
   **detail panel** (signature / language / args / body in its own pane) and a
   **call-template** prefill (`SELECT fn(:a)` / `CALL proc(:a)`). The SQL-tab
   approach is the smallest thing that delivers the real ask ("let me see the
   function's source"), adds zero new view/tab type to design-persist-restore, and
   because the prefilled text is the actual definition, editing-then-running it is a
   working "redefine routine" path for free. The detail panel and call template
   become additive post-v1 follow-ups, not prerequisites.

2. **A routine is identified by its `oid`, displayed by its signature.** Postgres
   allows overloading, so `(schema, name)` does **not** identify a routine the way it
   identifies a table — `make_point(int, int)` and `make_point(float, float)` are
   two `pg_proc` rows sharing a name. `RoutineRef` therefore carries the `oid` (exact,
   passed straight to `pg_get_functiondef`) plus a human-readable **signature** from
   `pg_get_function_identity_arguments` used only for the tree label, so overloads are
   visually distinct. We rejected resolving by name+signature (more code, and still
   needs the identity-args string anyway). The oid is unstable across `DROP`/recreate,
   which is harmless here because a routine is never persisted into the session — it
   is clicked, its source is opened as plain text, and the `RoutineRef` is discarded.

3. **List metadata is eager; the source body is lazy.** `listSchema` gains one
   parallel `pg_proc` query and returns `routines: RoutineRef[]` on each schema, so
   routines appear in the tree the instant you connect — same lifecycle as tables,
   no new loading state. But the **source** is fetched on click through a new
   `getRoutineSource(connectionId, oid)`, not bundled into the list. A function body
   can be thousands of lines; eager-loading every definition would bloat the
   connect-time payload for text the user may never open. This mirrors the existing
   split between `listSchema` (lightweight tree) and `loadRows` (fetched when a table
   is actually opened).

## Consequences

- A routine tab is an ordinary editable SQL tab, which means a user can edit the
  prefilled definition and run it — i.e. **accidentally redefine the routine**. This
  is accepted: it is the same "you own the risk" stance the commit-preview path
  already takes, and it doubles as the only "edit routine" affordance in v1. A
  read-only inspection mode is deferred.
- Because the tab is a normal SQL tab, the opened source rides existing session
  persistence (`sqlText`) for free; no routine-specific persistence is added, and
  oid instability across restarts never bites.
- `getRoutineSource` failing (e.g. the routine was dropped between list and click)
  surfaces a per-tab error, the same handling as a dropped-table on session restore.
- Routines refresh whenever `listSchema` re-runs (connect, database switch); there is
  no separate routine-refresh path.
- Scope is `prokind in ('f','p')` in non-system schemas. Aggregates and window
  functions, a structured detail panel, and call-template invocation are all
  deferred and additive — none requires revisiting this decision.
