# Multi-engine support via a Driver / Dialect / Capabilities abstraction

table-petch becomes multi-engine: alongside **Postgres** it will support
**MySQL**, **MSSQL**, and **Oracle**. Today every line below the IPC seam
(`src/main/db/*`) assumes Postgres — the `pg` driver, `pg_catalog` introspection,
`$n` placeholders, `"`-quoting, `LIMIT/OFFSET`, and the `getTypeParser`
"everything as text" trick. The seam itself is clean (the renderer never touches
the DB; everything funnels through `TablePetchApi` → `ipc.ts` → `src/main/db/*`),
so this work is not "add a driver" but "introduce the concept of a **driver**."
We are designing the interface against all four engines at once (not proving it
with one second engine first); the protection against a leaky abstraction is that
each decision below was stress-tested against a concrete divergence in MySQL,
MSSQL, or Oracle. See the glossary: [[engine]], [[driver]], [[dialect]],
[[catalog]], [[capabilities]].

## Decisions

1. **Namespace is always three levels — `server → catalog → schema → object` —
   and each driver collapses the levels it lacks.** Postgres/MSSQL map
   catalog = _database_; MySQL maps catalog = _database_ with a synthetic single
   schema (MySQL has no separate schema level); Oracle maps catalog = _service/
   instance_, schema = _user_. `TableRef` gains an optional `catalog`. We rejected
   "each driver declares its own depth" (forces variable-depth handling into the
   renderer, `TableRef`, and every SQL builder) and "flatten to `schema.object`"
   (drops the database/catalog switcher that PG/MSSQL/MySQL users expect). The
   old Postgres-only "database switcher" becomes the **catalog switcher**.

2. **The `string | null` cell contract is kept; each driver owns native→text
   normalization.** Postgres's `getTypeParser` text trick is engine-only;
   `mysql2`, `mssql`/tedious, and `oracledb` hand back native JS values (numbers,
   `Date`, `Buffer`, decimals, LOB streams). Each driver renders every value to a
   canonical text form on read and parses text back to a driver-acceptable value
   on write. Binary/LOB get a non-editable sentinel (e.g. `[blob N bytes]`) for
   now. We rejected a tagged `CellValue` union end-to-end (rewrites the grid,
   edit-state, and commit param handling) and "native values, renderer coerces"
   (scatters type logic into the UI and breaks the very text contract the glossary
   fixed).

3. **SQL is built once by shared CRUD builders, parameterized by a per-driver
   [[dialect]] value object.** The CRUD _shape_ is near-identical across all four;
   only mechanical bits differ. The `Dialect` exposes `quote(ident)`,
   `placeholder(n)`, and `paginate(sql, limit, offset)` — covering `"`/`` ` ``/`[]`
   quoting, `$n`/`?`/`@p1`/`:1` placeholders, and `LIMIT/OFFSET` vs MSSQL/Oracle
   `OFFSET…FETCH`. A driver may override a whole builder method only when a dialect
   genuinely can't be parameterized (e.g. Oracle pagination). We rejected a full
   SQL builder per driver (duplicates identity-derivation, staged-change, and
   optimistic-concurrency logic four ways) and a query-builder library like Knex
   (large dependency, hides the generated SQL — and we show a commit preview where
   that SQL matters — while still needing custom per-engine introspection anyway).

4. **`ConnectionConfig` becomes a discriminated union per engine.** Connection
   params genuinely differ: Oracle connects by service name / SID (and the `user`
   _is_ the schema, with no "list other databases"); MSSQL adds named instances
   and a different TLS default; default ports differ (5432/3306/1433/1521).
   `ConnectionConfig = PostgresConn | MysqlConn | MssqlConn | OracleConn`, each
   `{ engine } +` only its real fields; the connection modal renders the right
   form per engine. Matches the repo's existing union idiom (`Change`, the history
   `source` tag). Rejected: a common core + `driverOptions` blob (loses
   compile-time safety, pushes validation to runtime) and a flat superset of
   optional fields (the union rebuilt by hand at every use site).

5. **A routine is identified by an opaque `handle: string`, not a `pg` oid.**
   ADR 0004's `oid: number` is Postgres-only. `RoutineRef.handle` is a
   driver-defined token the renderer treats as opaque: Postgres stores its oid as
   a string, MSSQL its `object_id`, MySQL/Oracle the qualified name.
   `getRoutineSource(connectionId, handle)` hands it back to the originating
   driver, which knows how to fetch the source (`pg_get_functiondef`,
   `OBJECT_DEFINITION`, `SHOW CREATE …`, `DBMS_METADATA.GET_DDL`). Rejected:
   always `(schema, name, kind)` (ambiguous for PG/Oracle overloads) and keeping
   `oid` plus per-engine fields (the flat-superset smell rejected in #4).

6. **The no-unique-key edit path stays, but a driver flags text-unsafe columns
   and escalates the commit warning.** The all-columns optimistic-concurrency
   fallback (`commit.ts`) relies on exact text round-trip, which holds on Postgres
   (`getTypeParser`) but can silently fail off-PG for floats, decimals, money,
   some datetimes, and binary — producing a bogus "modified by someone else"
   abort. Each driver classifies a column type as text-round-trip-safe or not;
   when an all-columns `WHERE` would include an unsafe column, the existing
   non-blocking warning escalates (or that column is excluded from the match).
   Rejected: physical row locators (`ctid`/`ROWID`/`%%physloc%%` — no stable
   MySQL/InnoDB equivalent, so an inconsistent capability) and blocking keyless
   editing entirely (removes a capability that works today and TablePlus users
   expect).

7. **Each driver advertises a [[capabilities]] descriptor; the renderer adapts
   from that data, never from an engine name.** Engines differ in catalog
   switching (Oracle has no comparable single-connection catalog switch),
   multi-statement scripts in one `runQuery` (Oracle's driver rejects them),
   catalog listing, and routine support. Capabilities (surfaced at
   connect/`listSchema`) let the UI hide/disable affordances and also carries a
   `sqlDialect: 'postgres'|'mysql'|'mssql'|'oracle'` token the CodeMirror editor
   maps to the matching dialect + keyword set (autocomplete still feeds from
   `listSchema`). This upholds the standing rule that **the renderer never names
   an engine** — a new engine needs no renderer edits. Rejected: renderer
   `switch (engine)` (breaks that rule, touches renderer per engine) and
   assume-uniform-error-at-runtime (dead buttons and raw driver errors).

8. **All four driver packages ship in the app but are lazy-loaded on first use.**
   `pg`, `mysql2`, `mssql`/tedious are pure JS; `oracledb` is pinned to its
   pure-JS **thin mode** to avoid the native Instant Client and keep macOS
   notarization simple. A driver registry maps `engine → loader`; each engine's
   module is dynamically imported only when its first connection opens — light
   startup, no dead init, one signed installer. Rejected: eager import of all
   drivers (pays every init cost on launch; one native issue blocks boot) and
   optional downloadable per-engine plugins (a plugin system, update channel, and
   per-plugin signing story — far too much machinery for four engines).

9. **Existing engine-less connections default to the Postgres variant on load.**
   Today's `connections.json` records predate the `engine` field; the store's
   fail-safe "swallow and return empty" loader would otherwise silently erase
   every saved connection on upgrade. Instead, per record, a connection missing
   `engine` is coerced to the `postgres` variant (the only engine that existed)
   and rewritten on next save — a lazy, lossless migration that survives one bad
   record. Rejected: an explicit versioned migration (more machinery than a
   one-field default needs; the file has no version field today) and no special
   handling (silently wipes users' connections — unacceptable for a sold app).

## Consequences

- The `db/` layer is restructured around a `Driver` interface (native pool,
  introspection, value normalization, dialect, capabilities, routine source).
  `manager.ts`, `introspect.ts`, `query.ts`, `commit.ts` become _shared
  orchestration_ that delegates engine specifics to the active driver. The
  Postgres code becomes the first driver, not the baseline.
- `SchemaInfo` reshapes around `catalog`; `ColumnMeta.dataType` becomes an
  engine-native, display-only type string (no longer "a postgres type name").
- The IPC contract (`TablePetchApi`) stays engine-agnostic; `ConnectionConfig`,
  `RoutineRef`, `SchemaInfo`, and a new `Capabilities` type are the shared shapes
  that change.
- Per-engine introspection (catalog/schema/table/column/unique-key/routine
  discovery) is genuinely four implementations and is the bulk of the remaining
  work; the shared seam does not reduce it. **The catalog-source choice is
  revised by [ADR 0007](./0007-per-engine-introspection.md): native catalogs
  uniformly (`pg_catalog` / `sys.*` / `ALL_*` / `SHOW`+`STATISTICS`), not
  `information_schema` — that view can't report identity/computed columns on
  MSSQL.**
- Capabilities-gated UI means some affordances (catalog switcher, multi-statement
  run) are conditionally hidden; the renderer must treat their absence as normal,
  not as an error state.
