import type { ConnectionConfig, SchemaInfo, TableRef } from "@shared/types";
import { Button } from "../atoms/Button";
import { Select } from "../atoms/Select";
import logo from "../../assets/main-logo.png";

const treeItem = "px-1.5 py-0.5 rounded cursor-pointer hover:bg-border";
const schemaLabel = "text-muted mt-1.5 font-semibold";

interface Props {
  connections: ConnectionConfig[];
  activeId: string | null;
  schema: SchemaInfo | null;
  onNewConnection: () => void;
  onConnect: (id: string) => void;
  onConnectionMenu: (e: React.MouseEvent, conn: ConnectionConfig) => void;
  onSwitchDatabase: (db: string) => void;
  onOpenTable: (table: TableRef) => void;
}

export function Sidebar({
  connections,
  activeId,
  schema,
  onNewConnection,
  onConnect,
  onConnectionMenu,
  onSwitchDatabase,
  onOpenTable,
}: Props): JSX.Element {
  return (
    <aside className="w-64 bg-panel border-r border-border flex flex-col">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Draggable header; pt-12 clears the macOS traffic-light buttons. */}
        <div className="app-drag flex items-center justify-between mb-1.5 pt-12">
          <strong>Connections</strong>
          <Button
            variant="ghost"
            className="app-no-drag px-2 py-0.5 text-xs"
            onClick={onNewConnection}
          >
            ＋ New
          </Button>
        </div>

        {connections.length === 0 && (
          <div className="text-muted p-6">No connections yet.</div>
        )}
        {connections.map((c) => (
          <div
            key={c.id}
            className={treeItem}
            style={{ fontWeight: c.id === activeId ? 700 : 400 }}
            onClick={() => onConnect(c.id)}
            onContextMenu={(e) => onConnectionMenu(e, c)}
          >
            {c.name || `${c.user}@${c.host}`}
          </div>
        ))}

        {schema && (
          <>
            <Select
              className="w-full mt-2"
              value={schema.database}
              onChange={(e) => onSwitchDatabase(e.target.value)}
              title="Switch database"
            >
              {schema.databases.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            {schema.schemas.map((s) => (
              <div key={s.name}>
                <div className={schemaLabel}>{s.name}</div>
                {s.tables.map((t) => (
                  <div
                    key={`${t.schema}.${t.name}`}
                    className={treeItem}
                    onClick={() => onOpenTable(t)}
                  >
                    {t.kind === "view" ? "◇" : "▦"} {t.name}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer: brand logo pinned to the bottom of the sidebar. */}
      <div className="flex items-center justify-center border-t border-border p-2">
        <img src={logo} alt="tablePetch" className="h-36 w-36 object-contain" />
      </div>
    </aside>
  );
}
