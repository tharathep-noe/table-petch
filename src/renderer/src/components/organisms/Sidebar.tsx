import type {
  ConnectionConfig,
  HistoryEntry,
  RoutineRef,
  SavedQuery,
  SchemaInfo,
  TableRef,
} from '@shared/types';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button';
import { Select } from '../atoms/Select';

const sectionLabel =
  'text-[11px] font-semibold uppercase tracking-wider text-muted';

/** A collapsible section with a clickable header that toggles its body. */
function CollapsibleSection({
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className={`${sectionLabel} mb-1 mt-2 px-1 flex w-full items-center gap-1 cursor-pointer hover:text-text transition-colors`}
      >
        <span
          className={`inline-block text-[9px] transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
        >
          ▶
        </span>
        <span>{label}</span>
        <span className="text-muted/60 normal-case font-normal">{count}</span>
      </button>
      {expanded && children}
    </>
  );
}

// Resizable-width chrome. Persisted in localStorage (renderer-only UI
// preference — not session/domain state, so it stays off the IPC contract).
const SIDEBAR_MIN_W = 180;
const SIDEBAR_MAX_W = 480;
const SIDEBAR_DEFAULT_W = 256; // the former hard-coded w-64
const SIDEBAR_WIDTH_KEY = 'sidebarWidth';

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

function useSidebarWidth(): readonly [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return saved >= SIDEBAR_MIN_W && saved <= SIDEBAR_MAX_W
      ? saved
      : SIDEBAR_DEFAULT_W;
  });
  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width]);
  return [width, setWidth] as const;
}

export type SidebarView = 'database' | 'queries' | 'history';

interface Props {
  view: SidebarView;
  onChangeView: (view: SidebarView) => void;

  connections: ConnectionConfig[];
  activeId: string | null;
  schema: SchemaInfo | null;
  currentTable?: TableRef | null;
  onNewConnection: () => void;
  onConnect: (id: string) => void;
  onConnectionMenu: (e: React.MouseEvent, conn: ConnectionConfig) => void;
  onSwitchDatabase: (db: string) => void;
  onOpenTable: (table: TableRef) => void;
  onOpenRoutine: (routine: RoutineRef) => void;

  savedQueries: SavedQuery[];
  queryHistory: HistoryEntry[];
  /** Open the given SQL in a fresh, un-run tab. */
  onOpenSql: (sql: string) => void;
  onDeleteSavedQuery: (q: SavedQuery) => void;
  onSaveToLibrary: (sql: string) => void;
  onClearHistory: () => void;
  onClearAllHistory: () => void;
}

const VIEWS: Array<{ key: SidebarView; label: string }> = [
  { key: 'database', label: 'Database' },
  { key: 'queries', label: 'Queries' },
  { key: 'history', label: 'History' },
];

export function Sidebar(props: Props): JSX.Element {
  const { view, onChangeView } = props;
  const [width, setWidth] = useSidebarWidth();
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  function onResizeStart(e: React.PointerEvent): void {
    drag.current = { startX: e.clientX, startW: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onResizeMove(e: React.PointerEvent): void {
    if (!drag.current) return;
    setWidth(
      clamp(
        drag.current.startW + (e.clientX - drag.current.startX),
        SIDEBAR_MIN_W,
        SIDEBAR_MAX_W,
      ),
    );
  }
  function onResizeEnd(e: React.PointerEvent): void {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <aside
      style={{ width }}
      className="relative bg-panel border-r border-border flex flex-col"
    >
      <div className="flex-1 overflow-y-auto ps-3 pe-2 pb-2">
        {/* Draggable header; pt clears the macOS traffic-light buttons. */}
        <div className="app-drag pt-[53px] mb-2">
          <div className="app-no-drag flex gap-0.5 rounded-md bg-bg/60 p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => onChangeView(v.key)}
                className={`flex-1 rounded-[5px] px-2 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  view === v.key
                    ? 'bg-accent/20 text-text'
                    : 'text-muted hover:text-text'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {view === 'database' && <DatabaseView {...props} />}
        {view === 'queries' && <QueriesView {...props} />}
        {view === 'history' && <HistoryView {...props} />}
      </div>

      {/* Right-edge drag handle. app-no-drag so it resizes (not move-window)
          where it overlaps the draggable header strip at the top. */}
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        title="Drag to resize"
        className="app-no-drag absolute top-0 -right-0.5 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent/40 active:bg-accent/60 transition-colors"
      />
    </aside>
  );
}

function DatabaseView({
  connections,
  activeId,
  schema,
  currentTable,
  onNewConnection,
  onConnect,
  onConnectionMenu,
  onSwitchDatabase,
  onOpenTable,
  onOpenRoutine,
}: Props): JSX.Element {
  // Per-section collapse state, keyed by `${schema}:tables|routines`.
  // Sections default to expanded; only collapsed keys are tracked.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className={sectionLabel}>Connections</span>
        <Button
          variant="ghost"
          className="px-2 py-0.5 text-xs rounded-md"
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
                isActive
                  ? 'bg-accent/15 text-text'
                  : 'text-text hover:bg-border/60'
              }`}
              onClick={() => onConnect(c.id)}
              onContextMenu={(e) => onConnectionMenu(e, c)}
              title={`${c.user}@${c.host}`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
                  isActive ? 'bg-success' : 'bg-muted/50 group-hover:bg-muted'
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

              <CollapsibleSection
                label="Tables"
                count={s.tables.length}
                expanded={!collapsed.has(`${s.name}:tables`)}
                onToggle={() => toggle(`${s.name}:tables`)}
              >
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
                            ? 'bg-accent/15 text-text font-medium'
                            : 'text-text/90 hover:bg-border/60'
                        }`}
                        onClick={() => onOpenTable(t)}
                        title={`${t.schema}.${t.name}`}
                      >
                        <span
                          className={`shrink-0 ${t.kind === 'view' ? 'text-muted' : 'text-accent'}`}
                        >
                          {t.kind === 'view' ? '◇' : '▦'}
                        </span>
                        <span className="truncate">{t.name}</span>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>

              {s.routines.length > 0 && (
                <CollapsibleSection
                  label="Routines"
                  count={s.routines.length}
                  expanded={!collapsed.has(`${s.name}:routines`)}
                  onToggle={() => toggle(`${s.name}:routines`)}
                >
                  <div className="flex flex-col gap-0.5 ms-1.5 ps-2 border-s border-border">
                    {s.routines.map((r) => (
                      <div
                        key={r.handle}
                        className="flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm text-text/90 hover:bg-border/60 transition-colors"
                        onClick={() => onOpenRoutine(r)}
                        title={`${r.schema}.${r.name}(${r.signature})`}
                      >
                        <span
                          className={`shrink-0 ${r.kind === 'procedure' ? 'text-muted' : 'text-accent'}`}
                        >
                          {r.kind === 'procedure' ? '▷' : 'ƒ'}
                        </span>
                        <span className="truncate">
                          {r.name}
                          <span className="text-muted">({r.signature})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </CollapsibleSection>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function QueriesView({
  savedQueries,
  onOpenSql,
  onDeleteSavedQuery,
}: Props): JSX.Element {
  if (savedQueries.length === 0) {
    return (
      <div className="text-muted text-xs px-2 py-3">
        No saved queries yet. Save one from the SQL editor.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {savedQueries.map((q) => (
        <div
          key={q.id}
          className="group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-text hover:bg-border/60"
          onClick={() => onOpenSql(q.sql)}
          title={q.sql}
        >
          <span className="text-accent shrink-0">★</span>
          <span className="truncate text-sm flex-1">{q.name}</span>
          <button
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger px-1 cursor-pointer"
            title="Delete saved query"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteSavedQuery(q);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function HistoryView({
  activeId,
  queryHistory,
  onOpenSql,
  onSaveToLibrary,
  onClearHistory,
  onClearAllHistory,
}: Props): JSX.Element {
  if (!activeId) {
    return (
      <div className="text-muted text-xs px-2 py-3">
        Connect to a database to see its history.
      </div>
    );
  }
  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className={sectionLabel}>History</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs rounded-md"
            onClick={onClearHistory}
            disabled={queryHistory.length === 0}
            title="Clear this connection's history"
          >
            Clear
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-0.5 text-xs rounded-md"
            onClick={onClearAllHistory}
            title="Clear history for all connections"
          >
            All
          </Button>
        </div>
      </div>

      {queryHistory.length === 0 && (
        <div className="text-muted text-xs px-2 py-3">No history yet.</div>
      )}
      <div className="flex flex-col gap-0.5">
        {queryHistory.map((h) => (
          <div
            key={h.id}
            className="group px-2 py-1.5 rounded-md cursor-pointer hover:bg-border/60"
            onClick={() => onOpenSql(h.sql)}
            title={h.error ?? h.sql}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  h.ok ? 'bg-success' : 'bg-danger'
                }`}
              />
              <span className="truncate text-xs font-mono flex-1 text-text/90">
                {h.sql}
              </span>
              <button
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent px-1 cursor-pointer"
                title="Save to library"
                onClick={(e) => {
                  e.stopPropagation();
                  onSaveToLibrary(h.sql);
                }}
              >
                ★
              </button>
            </div>
            <div className="flex items-center gap-2 ps-3 text-[10px] text-muted">
              <span>{new Date(h.executedAt).toLocaleTimeString()}</span>
              {h.database && <span>· {h.database}</span>}
              {h.ok ? (
                h.rowCount != null && <span>· {h.rowCount} rows</span>
              ) : (
                <span className="text-danger">· failed</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
