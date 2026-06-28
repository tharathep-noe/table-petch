# Per-engine introspection: native catalogs, eager per catalog, two type-semantic fields

ADR 0006 established the [[driver]] abstraction and noted that per-engine
introspection (discovering catalogs, schemas, tables/views, columns, unique keys,
and routines) is "genuinely four implementations." This ADR fixes _how_ each
driver introspects, because several choices are hard to reverse (they shape the
shared `ColumnMeta`/`SchemaInfo` types) and one of them corrects ADR 0006.

## Decisions

1. **Native catalogs uniformly — not `information_schema`** (corrects ADR 0006).
   Every driver reads its engine's native catalog: `pg_catalog` (Postgres),
   `sys.*` with a little `information_schema` (MSSQL), `ALL_*`/`USER_*` (Oracle),
   and `information_schema` + `STATISTICS` / `SHOW` (MySQL). The deciding factor is
   the [[required column]] / [[generated column]] metadata the three-state new-row
   model (ADR 0001) depends on: `information_schema` cannot report **identity or
   computed columns on MSSQL**, and Oracle has no `information_schema` at all.
   Postgres already uses native `pg_catalog` precisely because
   `information_schema` reported unique indexes and generated columns too poorly.
   We rejected "`information_schema` where it works, native where it doesn't"
   (each driver then mixes two query styles with a fragile boundary) and
   "`information_schema`-first, accept reduced metadata" (would make
   generated/identity columns wrongly insertable off-Postgres, breaking ADR 0001).

2. **Eager per active catalog, as today.** On connect / catalog switch, one
   `listSchema` call loads the active [[catalog]]'s full
   schema → table/view/routine tree; other catalogs are listed by name only for
   the switcher. This is the existing Postgres behavior, kept unchanged. We
   rejected lazy-per-schema loading (a new `getSchemaObjects` IPC method, a
   per-node loading state, and a sidebar data-flow rework) and eager-capped-plus-
   search (paging/search UI the tree doesn't need yet). The known risk — a large
   Oracle catalog (every user's schema) or a big MSSQL/MySQL server producing a
   slow connect and large payload — is accepted as a post-v1 follow-up, matching
   the project's standing "simple now, optimize if it lags" stance (cf. the
   `LIMIT/OFFSET`-now / keyset-later decision).

3. **System-vs-user filtering is a driver-owned predicate using the best native
   signal.** There is no portable flag, so each driver hardcodes its own
   exclusion as part of its introspection: Postgres keeps its
   `pg_catalog`/`information_schema`/`pg_toast%` denylist; MySQL excludes
   `mysql`/`sys`/`performance_schema`/`information_schema`; MSSQL excludes
   `sys`/`INFORMATION_SCHEMA` (and the system databases at the catalog level);
   Oracle prefers `ALL_USERS.ORACLE_MAINTAINED = 'Y'` (12c+) and falls back to a
   denylist of default schemas. We rejected a shared, user-overridable denylist
   config (Oracle's signal is a flag, not a name list — it doesn't fit one shape,
   and it lets users break their own tree) and showing everything unfiltered
   (Oracle/MSSQL trees become unusable walls of system objects).

4. **`ColumnMeta` gains two driver-derived semantic fields** beyond the
   display-only `dataType` string: `category`
   (`'text' | 'number' | 'boolean' | 'temporal' | 'json' | 'binary' | 'lob' |
'uuid' | 'other'`) and `textRoundTripSafe: boolean`. `category` drives
   type-aware UI (the JSON cell-expander now, per-type editors later);
   `textRoundTripSafe` drives the all-columns `WHERE` warning from ADR 0006 #6.
   They are kept separate because they do not collapse — an `integer` is `number`
   _and_ safe, a `double` is `number` _and_ unsafe. Each driver maps its native
   types to both. The renderer and `commit.ts` branch on these fields, never on an
   engine name (upholding the engine-agnostic-renderer rule). We rejected a single
   `category` enum with safety derived from it (over-flags integers/dates as
   risky, producing spurious commit warnings) and keeping only the `dataType`
   string (forces the renderer to string-match engine type names — the engine
   coupling the design forbids — and makes the unsafe-column warning impossible to
   do precisely).

5. **Routines are standalone only; Oracle packages are deferred.** v1 lists
   top-level `FUNCTION`/`PROCEDURE` objects, matching the flat [[routine]] model
   the other three engines share. Oracle package-encapsulated routines are
   deferred: a package is a _container_ of routines — a tree level no other engine
   has, and a compound `handle` ("member X of package Y") nothing else uses.
   We rejected packages-as-expandable-containers (an engine-specific tree level
   and handle shape, now, for one engine) and flattening members into the list as
   `pkg.routine` (long flat lists, an ambiguous member-vs-package source fetch, and
   an Oracle-only naming scheme). Packages become an additive Oracle-only
   follow-up.

## Consequences

- `SchemaInfo` reshapes around [[catalog]] (per ADR 0006); `ColumnMeta` grows
  `category` and `textRoundTripSafe`; `dataType` is now explicitly display-only.
- Each driver's introspection is one coherent native-catalog implementation —
  no shared "system schema list" or "info_schema adapter" abstraction, because
  the queries are irreducibly per-engine.
- The eager-load risk on large Oracle/MSSQL servers is a named, accepted
  follow-up; revisiting it means adding lazy-per-schema loading (a new IPC method
  - tree loading states), not changing this ADR.
- The JSON cell-expander and the all-columns commit warning become engine-neutral
  features driven by `category` / `textRoundTripSafe`, available on every engine
  the moment its driver populates those fields.
