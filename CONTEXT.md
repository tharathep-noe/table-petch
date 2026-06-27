# table-petch

A Postgres GUI client. This glossary fixes the language used across the renderer,
the IPC contract, and the database layer so the same concept has the same name
everywhere.

## Language

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
