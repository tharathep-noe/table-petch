# Tab keyboard shortcuts are driven by a custom application menu, not a renderer keydown

`Cmd+T` opens a new [[tab]] and `Cmd+W` closes the current one. The obvious
implementation — a `window` `keydown` listener in the renderer, mirroring the
existing `Cmd+A` blocker in `App.tsx` — does **not** work for `Cmd+W`. On macOS
the default application menu binds `Cmd+W` to the native "Close Window" role; that
accelerator fires at the OS level and a renderer `keydown` + `preventDefault()`
cannot reliably stop it, so the whole window would close instead of the tab.

**We therefore install a custom application `Menu` in the main process** (`src/main/menu.ts`)
with `New Tab` (`CmdOrCtrl+T`) and `Close Tab` (`CmdOrCtrl+W`) items that
`webContents.send` one-way intents (`menu:newTab` / `menu:closeTab`) to the
renderer over typed channels. The renderer subscribes via two `on…` methods added
to `TablePetchApi` (the first **main→renderer push** on the bridge; everything else
is request/response `invoke`).

We rejected the renderer-only `keydown` (fragile for the one key that matters) and
"keep the keydown but strip just the Close role from the default menu" (you still
have to take over the menu in main, but end up with a half-overridden menu and no
menu items to show for it).

## Consequences

- **Taking over the application menu means owning all of it.** Setting a custom menu
  replaces Electron's default, so `menu.ts` must re-declare the standard macOS roles
  (app menu, Edit with copy/paste/selectAll, Window, etc.) or the user loses them.
  This is the hard-to-reverse part of the decision and the reason it is surprising
  without context — a reader expecting the `App.tsx` keydown pattern needs to know
  why these two shortcuts live in main instead.
- **Accelerators fire window-wide**, including while the CodeMirror editor is
  focused. That is the desired behaviour here (unlike `Cmd+A`, which defers to the
  editor), so no focus/`isContentEditable` guard is needed.
- **`Cmd+W` on the last tab closes the window**, diverging deliberately from the
  tab-bar `×` button: the renderer handler closes the active tab when
  `tabs.length > 1`, else calls `window.close()`. The `×` button keeps its existing
  "reset to a fresh blank tab" behaviour. The two affordances differ on purpose —
  `Cmd+W` matches native expectations, the click does not close the window.
- **No unsaved-changes guard.** Staged changes live only in `DataGrid` local state
  and are already dropped on tab switch, so closing a tab silently discarding them
  is consistent with current behaviour and the app's "you own the risk" stance.
