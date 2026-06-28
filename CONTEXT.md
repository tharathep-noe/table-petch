# table-petch

A Postgres GUI client. This glossary fixes the language used across the renderer,
the IPC contract, and the database layer so the same concept has the same name
everywhere.

## Language

### Engines & drivers (multi-engine)

**Engine**:
The database product a connection targets — one of **Postgres**, **MySQL**,
**MSSQL** (SQL Server), or **Oracle**. An [[engine]] determines the [[driver]],
the [[dialect]], and how the [[catalog]]/[[schema]] levels are filled. A
connection targets exactly one engine, fixed at creation.
_Avoid_: database type, vendor, flavor, db (ambiguous with catalog)

**Driver**:
The main-process adapter for one [[engine]] — the only engine-specific code below
the IPC seam. A driver owns its native client/pool, its catalog introspection,
its value text-normalization (native JS → canonical text and back), and its
[[dialect]]. The renderer and the IPC contract never name an engine; they speak
to the driver abstraction.
_Avoid_: adapter, connector, backend, provider

**Dialect**:
The small value object a [[driver]] supplies for the _mechanical_ SQL differences
the shared CRUD builders need: identifier quoting, placeholder style, and
pagination. It is not a SQL builder — it is the per-engine knobs the one shared
builder turns. A driver may override a whole builder method only when a dialect
genuinely can't be parameterized (e.g. Oracle pagination).
_Avoid_: syntax, grammar, flavor

**Catalog**:
The top namespace level under a server, above [[schema]]. The canonical object
path is **server → catalog → schema → object**, and each [[driver]] maps its
engine onto it: Postgres/MSSQL catalog = a _database_; MySQL catalog = a
_database_ (and the schema level is synthetic, since MySQL has no separate
schema); Oracle catalog = the _service/instance_ and schema = a _user_. The
catalog switcher replaces the old Postgres-only "database switcher".
_Avoid_: database (use only inside a driver, never in the shared model)

**Capabilities**:
The descriptor a [[driver]] advertises so the renderer can adapt without ever
naming an [[engine]] (e.g. whether catalogs are switchable or single, whether the
server lists its catalogs, whether multi-statement scripts run in one call,
whether [[routine]]s are supported). The UI hides or disables affordances from
this data alone. Adding an engine never edits the renderer.
_Avoid_: feature flags, support matrix

**Type category**:
A driver-derived classification of a column's type into one engine-neutral bucket
— `text`, `number`, `boolean`, `temporal`, `json`, `binary`, `lob`, `uuid`, or
`other`. Distinct from a column's `dataType`, which is the engine's own type name
kept for **display only**. The category drives type-aware UI (the JSON
cell-expander now; per-type editors later) so the renderer never branches on an
engine's type names.
_Avoid_: data type (that is the raw display string), type affinity

**Text round-trip safe**:
A per-column boolean a [[driver]] sets: whether the column's value survives the
native → canonical-text → native round-trip exactly enough to match in a `WHERE`.
Floats, decimals, money, binary, LOBs, and some datetimes are _not_ safe. It
drives the all-columns commit warning (the keyless [[row identity]] path): an
unsafe column in that `WHERE` escalates the warning or is excluded from the match.
Separate from [[type category]] because they don't collapse — an integer is
`number` _and_ safe; a double is `number` _and_ unsafe.
_Avoid_: comparable, exact, lossless

### Editing & the write path

**Staged change**:
A pending edit held in the renderer and not yet sent to Postgres. The three kinds
are update, insert, and delete. All staged changes are committed together in one
transaction.
_Avoid_: pending edit, dirty change

**New row**:
A staged insert — a row the user is composing in the grid that does not yet exist
in the table. Distinct from an existing row (which has a database identity). New
rows carry a renderer-local `tempId`, never a database key.
_Avoid_: blank row, draft row, added row

**Cell state** (new rows only):
Each new-row cell is in exactly one of three states. _Unset_ means the column is
omitted from the `INSERT` so Postgres applies its DEFAULT/identity. _Value_ is an
explicit text value. _NULL_ is an explicit null (only valid on a nullable column).
Unset and NULL are different things and are shown differently in the grid.
_Avoid_: empty, blank (these blur the unset/NULL distinction)

**Unset**:
The default state of a new-row cell: the column is left out of the `INSERT`
entirely. Rendered as a muted `DEFAULT`. The opposite of being _set_ (an explicit
value or explicit NULL).
_Avoid_: default value, empty

**Required column**:
A column the user must provide a value for on insert: NOT NULL, no default, and
not generated. Marked `*` in the header; an unset or NULL required cell blocks
commit.
_Avoid_: mandatory field, not-null column

**Generated column**:
A column Postgres always fills itself — a stored generated column or an identity
column declared `GENERATED ALWAYS`. Never insertable; always shown as `DEFAULT`
and not editable on a new row.
_Avoid_: computed column, auto column

**Row identity**:
How a row is located for UPDATE/DELETE: primary key → a fully-non-null unique key
→ all columns. When only all-columns is possible, the commit shows a non-blocking
warning. New rows have no row identity (nothing to locate yet).
_Avoid_: row key (ambiguous with primary key)

### Routines (functions & procedures)

**Routine**:
The umbrella term for a user-defined **function** or **procedure** stored in the
database (Postgres `pg_proc`, `prokind in ('f','p')`). The canonical name across
the renderer, the IPC contract, and the database layer — chosen over "function"
(which would overload the `kind`) to match the SQL standard (`information_schema.routines`,
`DROP ROUTINE`). A routine is identified by an opaque, driver-defined
`handle` carried on `RoutineRef` (Postgres `oid`, MSSQL `object_id`,
MySQL/Oracle qualified name — see
[ADR 0006](docs/adr/0006-multi-engine-driver-architecture.md));
`schema`/`name`/`kind` are for display, mirroring [[tab]]/`TableRef`. Only
user-defined routines in non-system schemas are listed (the driver-owned system
filter). **Standalone routines only** — Oracle package members, aggregates, and
window functions are out of scope for now.
_Avoid_: function (as an umbrella), proc, stored proc, sproc

**Routine kind**:
Either `function` (returns a value) or `procedure` (PG11+, no return, invoked with
`CALL`). The discriminator on a [[routine]], exactly as `kind: 'table' | 'view'`
discriminates a table from a view.
_Avoid_: type, prokind

### App state (what survives a restart)

Three distinct concerns, never conflated. None of them stores fetched row data —
they store only the inputs needed to reconstruct a view.

**Session**:
The restorable workspace: the open [[tab]]s, which one is active, and the active
connection. Overwritten continuously; only the most recent state matters. Restored
on launch. Persisted as `session.json` in `userData` and reached only through IPC
(never the renderer's own storage), the same pattern as connections.
_Avoid_: workspace state, layout, last state

**Tab**:
One editor+result surface in the session. Persists its inputs (SQL text, the
browsed table, whether the SQL pane is shown) — never its fetched `result`, which
is re-derived by re-running the SQL or re-loading the table.
_Avoid_: page, view, window

**Saved query**:
A user-named SQL snippet kept deliberately in a curated library. Frozen text;
lives until the user deletes it. The library is **global** — not tied to a
connection — though a saved query may carry an optional _originating connection_
(the one it was saved from) for later filtering. Opening one prefills a new
[[tab]]. Distinct from a tab (live, disposable) and from query history
(automatic).
_Avoid_: snippet, bookmark, favorite

**Query history**:
An automatic, append-only log of statements the user ran, capped and rotated.
Logs only **user-authored** statements — those executed from the SQL editor —
never the synthesized commit statements behind a [[staged change]] nor the
`SELECT`s generated by browsing a table. Scoped **per connection**: each
[[history entry]] belongs to the connection it ran against, and the view shows
only the active connection's entries. Privacy-sensitive (may contain literal
values). Distinct from saved queries, which are explicit and curated.
_Avoid_: log, recents, audit

**History entry**:
One record in the [[query history]]: the statement text, when it ran, the
connection and database it ran against, and the outcome — success with a row
count, or a failure with its error message. A re-run of an identical _read_ folds
into the existing entry rather than adding a new one; each _write_ is always
recorded separately, because it is a distinct change to the data.
_Avoid_: log line, record

**Read / Write (execution)**:
The two kinds of execution the history distinguishes. A **read** observes without
changing data (`SELECT`, `EXPLAIN`, `SHOW`); a **write** changes data or schema
(`INSERT`, `UPDATE`, `DELETE`, DDL). The distinction is why repeated reads
collapse in history while repeated writes do not. A failed execution is treated
as a read for collapsing purposes (an aborted attempt changed nothing).
_Avoid_: query vs command, mutation
