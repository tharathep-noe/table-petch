# Row detail pane as a second editing surface

We add a [[row detail pane]] (`CONTEXT.md`): a toggleable, resizable right-hand
pane that shows the active row's columns as a vertical list of always-on inputs,
so wide rows can be read and edited without horizontal scroll. It is the home for
long/JSON values the grid truncates, superseding the deferred "cell expander
modal" (`PLAN.md` type-handling note).

## The decision

The pane is a **second editing surface, not a separate one**: its fields write
into the _same_ staged-change set as the grid and commit through the grid's one
footer Commit/Discard. To make one change set serve two surfaces, the staged-edit
state (`edits` / `newRows` / `deleted` / `selected` / `focused`, plus
`commit`/`discard`/`countChanges`) is **lifted out of `DataGrid` into a
`useTableEditing(result, connectionId)` hook owned by `App`**. `DataGrid` and the
new `RecordDetailPane` become pure consumers of that hook's output. `App` threads
the active tab's hook output both down to the grid and across to a new right slot
in `AppLayout`.

The pane is **global** (one instance in the `AppLayout` shell) but its content is
**per active tab**: the hook is instantiated for the active tab and remounts on
tab switch (like `DataGrid`'s `key={active.id}` today), so staged edits reset on
tab switch — accepted, matching current behaviour. The **active row** is the
anchor of the grid selection; new-row composition stays in the grid (existing
rows only). The pane's open flag and width persist in `session.json`
(`recordPane: { open, width }`); the active row does not.

## Considered options

- **Read-only inspector** — rejected: we want one commit covering edits made in
  either surface, which is more useful for wide tables and absorbs the cell
  expander cleanly.
- **Keep edit state in `DataGrid`, render the pane as its child** — rejected: it
  entrenches an 870-line god-component and makes the pane's layout the grid's
  problem.
- **Per-tab `TableWorkspace` owning the split** (pane lives inside the tab's main
  area) — rejected in favour of a global `AppLayout` pane; the global pane binds
  to the active tab via the lifted hook (B1).
- **Move editing state into the per-tab `Tab` objects so staged edits survive tab
  switches** (B2) — rejected this pass; edits reset on tab switch as they do
  today. Revisit if per-tab persistent edits are wanted.

## Consequences

- `DataGrid` shrinks to a consumer; the edit state machine moves to a hook with no
  JSX, which is more testable.
- The pane introduces `AppLayout`'s first resizable splitter.
- Always-on inputs make the unset/NULL/empty-string distinction load-bearing;
  scoping the pane to existing rows (no `unset`) keeps it to empty-string-vs-NULL.
- A new `PersistedSession` field (`recordPane`) rides the existing fail-safe
  versioned load.
