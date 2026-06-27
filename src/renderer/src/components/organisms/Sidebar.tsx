import type { ConnectionConfig, SchemaInfo, TableRef } from "@shared/types";
import { Button } from "../atoms/Button";
import { Select } from "../atoms/Select";
import logo from "../../assets/main-logo.png";

const sectionLabel =
  "text-[11px] font-semibold uppercase tracking-wider text-muted";

interface Props {
  connections: ConnectionConfig[];
  activeId: string | null;
  schema: SchemaInfo | null;
  currentTable?: TableRef | null;
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
  currentTable,
  onNewConnection,
  onConnect,
  onConnectionMenu,
  onSwitchDatabase,
  onOpenTable,
}: Props): JSX.Element {
  return (
    <aside className="w-64 bg-panel border-r border-border flex flex-col">
      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto ps-3 pe-2 pb-2">
        {/* Draggable header; pt clears the macOS traffic-light buttons. */}
        <div className="app-drag flex items-center justify-between mb-2 pt-[53px]">
          <span className={sectionLabel}>Connections</span>
          <Button
            variant="ghost"
            className="app-no-drag px-2 py-0.5 text-xs rounded-md"
            onClick={onNewConnection}
          >
            ＋ New
          </Button>
        </div>

        {connections.length === 0 && (
          <div className="text-muted text-xs px-2 py-3">No connections yet.</div>
        )}
        <div className="flex flex-col gap-0.5">
          {connections.map((c) => {
            const isActive = c.id === activeId;
            return (
              <div
                key={c.id}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                  isActive ? "bg-accent/15 text-text" : "text-text hover:bg-border/60"
                }`}
                onClick={() => onConnect(c.id)}
                onContextMenu={(e) => onConnectionMenu(e, c)}
                title={`${c.user}@${c.host}`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                    isActive ? "bg-success" : "bg-muted/50 group-hover:bg-muted"
                  }`}
                />
                <span className="truncate text-sm">
                  {c.name || `${c.user}@${c.host}`}
                </span>
              </div>
            );
          })}
        </div>

        {schema && (
          <div className="mt-5">
            <div className={`${sectionLabel} mb-1.5 px-1`}>Database</div>
            <Select
              className="w-full"
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
              <div key={s.name} className="mt-4">
                <div className={`${sectionLabel} mb-1 px-1`}>{s.name}</div>
                <div className="flex flex-col gap-0.5 ms-1.5 ps-2 border-s border-border">
                  {s.tables.map((t) => {
                    const isOpen =
                      currentTable?.schema === t.schema &&
                      currentTable?.name === t.name;
                    return (
                      <div
                        key={`${t.schema}.${t.name}`}
                        className={`flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm transition-colors ${
                          isOpen
                            ? "bg-accent/15 text-text font-medium"
                            : "text-text/90 hover:bg-border/60"
                        }`}
                        onClick={() => onOpenTable(t)}
                        title={`${t.schema}.${t.name}`}
                      >
                        <span
                          className={`shrink-0 ${t.kind === "view" ? "text-muted" : "text-accent"}`}
                        >
                          {t.kind === "view" ? "◇" : "▦"}
                        </span>
                        <span className="truncate">{t.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: brand logo pinned to the bottom of the sidebar. */}
      <div className="relative flex flex-col items-center gap-1.5 border-t border-border bg-linear-to-b from-transparent to-bg/40 px-3 py-4">
        <div className="relative flex items-center justify-center">
          {/* soft accent glow behind the logo */}
          <div className="absolute h-20 w-20 rounded-full bg-accent/20 blur-2xl" />
          <img
            src={logo}
            alt="tablePetch"
            className="relative h-28 w-28 object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
          />
        </div>
        <span className="text-[10px] uppercase tracking-widest text-muted">
          v0.0.1
        </span>
      </div>
    </aside>
  );
}
