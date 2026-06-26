# table-petch

A fast Postgres GUI client (TablePlus-like): browse, edit, and delete rows, and
run SQL. Built with **Electron + React + TypeScript**.

> For the product decisions and roadmap, see [`PLAN.md`](./PLAN.md).

## Requirements

- Node.js 20+
- npm 10+
- A reachable PostgreSQL server to connect to

## Getting started

```bash
npm install      # install dependencies
npm run dev      # launch the app in development (hot reload)
```

Other scripts:

```bash
npm run typecheck   # type-check both the Node and web sides
npm run build       # production build into out/
npm run start       # preview the production build
```

## How the app is structured

This is an Electron app, so there are **three runtime contexts**, and the code is
split to match them. Understanding this split is the key to navigating the repo.

| Context        | Runs in        | Has Node access? | Folder            |
| -------------- | -------------- | ---------------- | ----------------- |
| **Main**       | Node process   | Yes              | `src/main/`       |
| **Preload**    | Bridge         | Limited          | `src/preload/`    |
| **Renderer**   | Chromium (UI)  | No (sandboxed)   | `src/renderer/`   |
| **Shared**     | imported by all | n/a             | `src/shared/`     |

The renderer (the UI) is **sandboxed** and cannot touch the database or the
filesystem directly. It talks to the main process over a typed IPC bridge. All
database work happens in `src/main/`.

```
table-petch/
├── PLAN.md                  # product decisions & roadmap
├── README.md                # you are here
├── electron.vite.config.ts  # build config for main / preload / renderer
├── tsconfig.node.json       # TS config for main + preload (Node side)
├── tsconfig.web.json        # TS config for renderer (browser side)
│
└── src/
    ├── shared/              # 👉 code imported by BOTH sides — no runtime deps
    │   ├── types.ts         #    the IPC contract (TablePetchApi) + domain types
    │   └── channels.ts      #    IPC channel-name constants
    │
    ├── main/                # 👉 the Node backend — everything that touches the DB
    │   ├── index.ts         #    app entry: creates the window, registers IPC
    │   ├── ipc.ts           #    maps IPC channels -> handler functions
    │   ├── store.ts         #    connection configs + passwords (OS keychain)
    │   └── db/              #    the database layer (uses the `pg` driver)
    │       ├── manager.ts   #    connection pools, connect/disconnect, test
    │       ├── introspect.ts#    read schema: databases, schemas, tables, columns
    │       ├── query.ts     #    read rows: paged loadRows + arbitrary runQuery
    │       └── commit.ts    #    write path: build SQL, commit in a transaction
    │
    ├── preload/             # 👉 the secure bridge between renderer and main
    │   └── index.ts         #    exposes `window.api` (mirrors TablePetchApi)
    │
    └── renderer/            # 👉 the React UI (sandboxed, no Node/DB access)
        ├── index.html       #    HTML entry + Content-Security-Policy
        └── src/
            ├── main.tsx     #    React mount point
            ├── App.tsx      #    top-level UI: sidebar + grid
            ├── styles.css   #    app styles
            └── global.d.ts  #    types `window.api` for the renderer
```

## The one rule to remember

**The renderer never talks to Postgres directly.** Data flows like this:

```
React (renderer)
  └─ window.api.loadRows(...)        ← defined in src/preload/index.ts
       └─ IPC channel                ← names in src/shared/channels.ts
            └─ handler in src/main/ipc.ts
                 └─ src/main/db/*     ← the only place the `pg` driver lives
```

So when you add a feature that needs the database, you touch **four files in
order**:

1. `src/shared/types.ts` — add the method to `TablePetchApi` (and any new types).
2. `src/shared/channels.ts` — add a channel name.
3. `src/main/` — implement the logic (usually in `src/main/db/`) and register it
   in `src/main/ipc.ts`.
4. `src/preload/index.ts` — expose the method on `window.api`.

Then call `window.api.yourMethod(...)` from the renderer.

## Path aliases

- `@shared/*` → `src/shared/*` (available everywhere)
- `@renderer/*` → `src/renderer/src/*` (renderer only)

## Conventions

- **All DB values are returned as text** (or `null`). The renderer renders text
  and shows `NULL` distinctly; it does not do JS type coercion.
- **Writes are staged, then committed together in one transaction.** The write
  SQL is built in `src/main/db/commit.ts`, which derives the row's `WHERE` from
  primary key → unique constraint → all columns.
- **Secrets never sit in plaintext.** Passwords are encrypted with the OS
  keychain via Electron `safeStorage` (see `src/main/store.ts`).
