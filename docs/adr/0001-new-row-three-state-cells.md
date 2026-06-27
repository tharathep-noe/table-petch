# New-row cells are three-state: unset, value, or NULL

When composing a new row, a cell can be *unset* (omitted from the `INSERT` so
Postgres applies the column's DEFAULT/identity), an explicit *value*, or an
explicit *NULL*. We deliberately keep "unset" distinct from "NULL" rather than
collapsing blank cells to NULL, because the two produce different rows: omitting
a column lets serial/identity/`DEFAULT now()` columns work, while sending NULL
overrides the default (and fails on NOT NULL columns).

The distinction lives only in renderer state (`NewRow.values`: a key is present
iff the cell is set). On the wire `InsertChange.values` simply omits unset
columns, so `CellValue` stays `string | null` and no shared types changed for it.

## Consequences

- The grid shows `DEFAULT` (muted) and `NULL` (italic) as visibly different cell
  states; "empty" is never a meaningful state for a new row.
- Introspection must report `hasDefault` and `isGenerated` per column so we can
  compute required columns (NOT NULL, no default, not generated) and lock
  generated/identity-always columns out of editing.
- Inserts carry no row identity, so the optimistic-concurrency fail-on-0-rows
  check in `commit.ts` applies to updates/deletes only.
