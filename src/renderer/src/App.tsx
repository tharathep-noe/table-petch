import { useEffect, useMemo, useState } from "react";
import type {
  ConnectionConfig,
  QueryResult,
  SchemaInfo,
  TableRef,
} from "@shared/types";
import { ConnectionModal } from "./ConnectionModal";
import { EditableGrid } from "./EditableGrid";
import { SqlEditor } from "./SqlEditor";

// v1 skeleton UI: connection picker -> connect -> schema sidebar -> table grid.
// Editing/SQL-editor/commit wiring comes in later build steps (see PLAN.md).

interface ModalState {
  open: boolean;
  editing?: ConnectionConfig;
}

interface MenuState {
  x: number;
  y: number;
  conn: ConnectionConfig;
}

const treeItem = "px-1.5 py-0.5 rounded cursor-pointer hover:bg-border";
const schemaLabel = "text-muted mt-1.5 font-semibold";

export function App(): JSX.Element {
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [currentTable, setCurrentTable] = useState<TableRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [sqlText, setSqlText] = useState("select * from ");

  // Table/column names for SQL autocomplete.
  const sqlSchema = useMemo(() => {
    const map: Record<string, string[]> = {};
    schema?.schemas.forEach((s) =>
      s.tables.forEach((t) => {
        map[t.name] = [];
        map[`${s.name}.${t.name}`] = [];
      }),
    );
    return map;
  }, [schema]);

  async function refreshConnections(): Promise<ConnectionConfig[]> {
    const list = await window.api.listConnections();
    setConnections(list);
    return list;
  }

  useEffect(() => {
    refreshConnections();
  }, []);

  // Dismiss the context menu on any outside click.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  async function connect(id: string): Promise<void> {
    setError(null);
    try {
      await window.api.connect(id);
      setActiveId(id);
      setSchema(await window.api.listSchema(id));
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadTable(id: string, table: TableRef): Promise<void> {
    setError(null);
    try {
      setResult(
        await window.api.loadRows({
          connectionId: id,
          table,
          limit: 500,
          offset: 0,
        }),
      );
      setCurrentTable(table);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function openTable(table: TableRef): void {
    if (!activeId) return;
    // Show the table's data, and mirror the equivalent SELECT into the editor.
    const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    setSqlText(`select * from ${ident(table.schema)}.${ident(table.name)} limit 100`);
    loadTable(activeId, table);
  }

  function reload(): void {
    if (activeId && currentTable) loadTable(activeId, currentTable);
  }

  async function switchDatabase(db: string): Promise<void> {
    if (!activeId) return;
    setError(null);
    try {
      await window.api.switchDatabase(activeId, db);
      setSchema(await window.api.listSchema(activeId));
      setResult(null);
      setCurrentTable(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSaved(
    saved: ConnectionConfig,
    changedTarget: boolean,
  ): Promise<void> {
    setModal({ open: false });
    await refreshConnections();
    // Auto-connect a new connection (or a reconnect-worthy edit of the active one).
    if (!modal.editing || (saved.id === activeId && changedTarget)) {
      await connect(saved.id);
    }
  }

  async function deleteConnection(conn: ConnectionConfig): Promise<void> {
    setMenu(null);
    const ok = window.confirm(
      `Delete connection "${conn.name}"? This also removes its password.`,
    );
    if (!ok) return;
    if (conn.id === activeId) {
      await window.api.disconnect(conn.id).catch(() => {});
      setActiveId(null);
      setSchema(null);
      setResult(null);
    }
    await window.api.deleteConnection(conn.id);
    await refreshConnections();
  }

  return (
    <div className="flex h-screen">
      <aside className="w-60 bg-panel border-r border-border overflow-y-auto px-2 pb-2">
        {/* Draggable header; pt-7 clears the macOS traffic-light buttons. */}
        <div className="app-drag flex items-center justify-between mb-1.5 pt-12">
          <strong>Connections</strong>
          <button
            className="app-no-drag rounded border border-border px-2 py-0.5 text-xs cursor-pointer hover:bg-border"
            onClick={() => setModal({ open: true })}
          >
            ＋ New
          </button>
        </div>

        {connections.length === 0 && (
          <div className="text-muted p-6">No connections yet.</div>
        )}
        {connections.map((c) => (
          <div
            key={c.id}
            className={treeItem}
            style={{ fontWeight: c.id === activeId ? 700 : 400 }}
            onClick={() => connect(c.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, conn: c });
            }}
          >
            {c.name || `${c.user}@${c.host}`}
          </div>
        ))}

        {schema && (
          <>
            <select
              className="w-full mt-2 bg-bg text-text border border-border rounded px-2 py-1 cursor-pointer"
              value={schema.database}
              onChange={(e) => switchDatabase(e.target.value)}
              title="Switch database"
            >
              {schema.databases.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {schema.schemas.map((s) => (
              <div key={s.name}>
                <div className={schemaLabel}>{s.name}</div>
                {s.tables.map((t) => (
                  <div
                    key={`${t.schema}.${t.name}`}
                    className={treeItem}
                    onClick={() => openTable(t)}
                  >
                    {t.kind === "view" ? "◇" : "▦"} {t.name}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="app-drag flex gap-2 items-center p-2 border-b border-border">
          <button
            className="app-no-drag rounded border border-border px-2 py-0.5 text-xs cursor-pointer hover:bg-border disabled:opacity-40"
            onClick={() => setShowSql((v) => !v)}
            disabled={!activeId}
            title="Toggle SQL editor"
          >
            {showSql ? "▾ SQL" : "▸ SQL"}
          </button>
          <span className="text-muted">
            {activeId ? "Connected" : "Pick a connection"}
          </span>
          {error && <span className="text-danger">{error}</span>}
        </div>
        {showSql && activeId && (
          <SqlEditor
            connectionId={activeId}
            value={sqlText}
            onChange={setSqlText}
            schema={sqlSchema}
            onResult={(r) => {
              setResult(r);
              setCurrentTable(null);
              setError(null);
            }}
            onError={setError}
          />
        )}
        <div className="flex-1 overflow-hidden">
          {result && activeId ? (
            <EditableGrid connectionId={activeId} result={result} onReload={reload} />
          ) : (
            <div className="text-muted p-6">Select a table or run a query.</div>
          )}
        </div>
      </main>

      {menu && (
        <div
          className="fixed z-20 bg-panel border border-border rounded-md p-1 min-w-[140px] shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <div
            className="px-2.5 py-1.5 rounded cursor-pointer hover:bg-border"
            onClick={() => {
              setMenu(null);
              setModal({ open: true, editing: menu.conn });
            }}
          >
            Edit…
          </div>
          <div
            className="px-2.5 py-1.5 rounded cursor-pointer hover:bg-border text-danger"
            onClick={() => deleteConnection(menu.conn)}
          >
            Delete
          </div>
        </div>
      )}

      {modal.open && (
        <ConnectionModal
          initial={modal.editing}
          onClose={() => setModal({ open: false })}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
