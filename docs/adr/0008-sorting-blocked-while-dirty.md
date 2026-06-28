# Column sorting is server-side and blocked while the grid has staged changes

Sorting a browsed table is **server-side**: clicking a header re-fetches the page
with an `ORDER BY` ([[active sort]]), reusing the existing `buildLoadRows` /
`LoadRowsRequest.orderBy` plumbing. This is deliberate over a client-side sort of
the loaded rows: the read path always takes the first page (`offset 0`) of a
capped (~500-row) window, so only sorting at the source makes "top N by this
column" mean the **table's** true top N rather than the loaded window's. A
client-side sort would look authoritative while silently sorting a partial
window.

Because the sort is a re-fetch, it produces a brand-new `result`, and the grid
already drops all staged state on any new `result` (`DataGrid.tsx`, "table switch
or post-commit reload → drop staged state"). Staged edits are keyed by **page
index**, which a re-ordered re-fetch invalidates. **We therefore disable the sort
headers whenever the grid has uncommitted changes** (`countChanges > 0`), with a
tooltip telling the user to commit or discard first — rather than silently
discarding their edits on the first header click.

We rejected **preserving edits across the sort** (re-mapping staged edits onto the
re-fetched rows by [[row identity]]): it fights the page-index data model, and new
rows and all-columns-identity rows make a correct re-map leaky and expensive — far
too much machinery for a v1 of sorting. We also rejected **confirm-then-discard**
(prompt, then drop edits and sort): blocking is simpler, loses no work, and needs
no new dialog.

## Consequences

- **Sorting forces a clean grid.** A future reader will wonder why sort is greyed
  out mid-edit; the reason is the page-index coupling above, not an oversight.
  If edits ever become keyed by row identity instead of page index, this block
  can be relaxed.
- **Single-column only, for now.** The contract stays `orderBy?: { column; desc }`.
  Multi-column is a clean later extension (`{column,desc}[]`) plus a shift-click
  affordance; not built.
- **Three-state header cycle** — unsorted → asc → desc → unsorted. The third
  click clears the sort and re-fetches with no `ORDER BY` (`buildLoadRows` already
  omits it when `orderBy` is undefined), returning the table to its natural order.
- **The indicator commits only after a successful re-fetch.** A sort can fail at
  the engine (e.g. Postgres cannot `ORDER BY` a `json` column). On failure the
  existing error path shows the error and leaves the prior rows and arrow intact,
  so the arrow is always a fact about the rows on screen, never a wish.
- **Table browser only.** Sort is gated on `result.table`; arbitrary SQL-editor
  results are untouched (the user owns the `ORDER BY` in their own query), so the
  word "sort" never means two different things.
- **The active sort is not persisted.** It is live renderer view state; a restored
  [[tab]] reloads in natural order. No change to `PersistedSession` / `PersistedTab`.
