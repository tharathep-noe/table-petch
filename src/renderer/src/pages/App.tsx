import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionConfig,
  HistoryEntry,
  PersistedSession,
  QueryResult,
  RoutineRef,
  SavedQuery,
  SchemaInfo,
  TableRef,
} from '@shared/types';
import { AppLayout } from '../components/templates/AppLayout';
import { Sidebar, type SidebarView } from '../components/organisms/Sidebar';
import { TabBar } from '../components/organisms/TabBar';
import { Toolbar } from '../components/organisms/Toolbar';
import { SqlEditor } from '../components/organisms/SqlEditor';
import { DataGrid } from '../components/organisms/DataGrid';
import { RecordDetailPane } from '../components/organisms/RecordDetailPane';
import { useTableEditing } from '../lib/useTableEditing';
import { ConnectionModal } from '../components/organisms/ConnectionModal';
import { Menu } from '../components/molecules/Menu';
import { Modal } from '../components/molecules/Modal';
import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';

interface ModalState {
  open: boolean;
  editing?: ConnectionConfig;
}

interface ConnMenuState {
  x: number;
  y: number;
  conn: ConnectionConfig;
}

// A tab owns its own editor text and result data, so switching tabs preserves
// both. Connection/schema stay global (shared across tabs).
interface Tab {
  id: string;
  tabCode: string;
  title: string;
  sqlText: string;
  showSql: boolean;
  result: QueryResult | null;
  currentTable: TableRef | null;
  // The active sort (ADR 0008): live, renderer-only view state — never persisted,
  // so a restored tab reloads in natural order.
  sort: { column: string; desc: boolean } | null;
  error: string | null;
}

// A stable empty result so the editing hook (which keys its reset effect on the
// result's identity) doesn't reset every render while no table is loaded.
const EMPTY_RESULT: QueryResult = {
  columns: [],
  rows: [],
  rowCount: 0,
  editable: false,
};

function makeTab(): Tab {
  return {
    id: crypto.randomUUID(),
    title: 'Query',
    tabCode: 'query',
    sqlText: 'select * from ',
    showSql: false,
    result: null,
    currentTable: null,
    sort: null,
    error: null,
  };
}

export function App(): JSX.Element {
  const [connections, setConnections] = useState<ConnectionConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [menu, setMenu] = useState<ConnMenuState | null>(null);
  const [filterShown, setFilterShown] = useState(false);
  const [filterText, setFilterText] = useState('');

  // The row detail pane (ADR 0009). Open flag + width persist in the session; the
  // active row it shows does not (it's reconstructed from the grid selection).
  const [recordPaneOpen, setRecordPaneOpen] = useState(false);
  const [recordPaneWidth, setRecordPaneWidth] = useState(380);

  // Saved-query library (global) and the active connection's history.
  const [sidebarView, setSidebarView] = useState<SidebarView>('database');
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [queryHistory, setQueryHistory] = useState<HistoryEntry[]>([]);
  // Naming dialog for "Save query"; holds the SQL being saved.
  const [saveModal, setSaveModal] = useState<{ sql: string } | null>(null);
  const [saveName, setSaveName] = useState('');

  const initialTab = useMemo(makeTab, []);
  const [tabs, setTabs] = useState<Tab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = useState(initialTab.id);
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Session restore runs once on launch; saving is gated until it completes so
  // the default blank tab never overwrites a saved session.
  const [hydrated, setHydrated] = useState(false);
  const restoreStarted = useRef(false);

  const updateTab = (id: string, patch: Partial<Tab>): void =>
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

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

  // Client-side row filter over the active tab's result.
  const visibleResult = useMemo(() => {
    if (!active.result || !filterShown || !filterText.trim())
      return active.result;
    const q = filterText.toLowerCase();
    return {
      ...active.result,
      rows: active.result.rows.filter((r) =>
        r.some((v) => v != null && v.toLowerCase().includes(q)),
      ),
    };
  }, [active.result, filterShown, filterText]);

  async function refreshConnections(): Promise<ConnectionConfig[]> {
    const list = await window.api.listConnections();
    setConnections(list);
    return list;
  }

  async function refreshSavedQueries(): Promise<void> {
    setSavedQueries(await window.api.listSavedQueries());
  }

  async function refreshHistory(connId: string | null): Promise<void> {
    setQueryHistory(connId ? await window.api.listHistory(connId) : []);
  }

  useEffect(() => {
    refreshConnections();
    refreshSavedQueries();
  }, []);

  // History is scoped to the active connection; refetch when it changes.
  useEffect(() => {
    void refreshHistory(activeId);
  }, [activeId]);

  // Restore the last session on launch (ADR 0002): rebuild tabs, best-effort
  // auto-reconnect, then auto-load table tabs only — never auto-run SQL tabs.
  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    void (async () => {
      try {
        const saved = await window.api.loadSession();
        if (!saved || saved.tabs.length === 0) return;

        const restored: Tab[] = saved.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          tabCode: t.tabCode,
          sqlText: t.sqlText,
          showSql: t.showSql,
          currentTable: t.currentTable,
          result: null,
          sort: null,
          error: null,
        }));
        setTabs(restored);
        const focus =
          restored.find((t) => t.id === saved.activeTabId) ?? restored[0];
        setActiveTabId(focus.id);

        if (saved.recordPane) {
          setRecordPaneOpen(saved.recordPane.open);
          setRecordPaneWidth(saved.recordPane.width);
        }

        const connId = saved.activeConnectionId;
        if (!connId) return;
        try {
          await window.api.connect(connId);
          setActiveId(connId);
          setSchema(await window.api.listSchema(connId));
        } catch {
          return; // tabs are restored; leave the workspace disconnected
        }
        // Re-derive only the read-only table browses; SQL tabs keep their text.
        for (const t of restored) {
          if (t.currentTable) void loadTable(t.id, connId, t.currentTable);
        }
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Debounced save of the session-relevant slice. Strips result/error and waits
  // for hydration so we never persist (or clobber with) the default blank tab.
  useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      const payload: PersistedSession = {
        version: 1,
        activeConnectionId: activeId,
        activeTabId,
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          tabCode: t.tabCode,
          sqlText: t.sqlText,
          showSql: t.showSql,
          currentTable: t.currentTable,
        })),
        recordPane: { open: recordPaneOpen, width: recordPaneWidth },
      };
      void window.api.saveSession(payload);
    }, 500);
    return () => clearTimeout(handle);
  }, [hydrated, tabs, activeTabId, activeId, recordPaneOpen, recordPaneWidth]);

  // Block the browser's "select all" (Cmd/Ctrl+A) from highlighting the whole
  // window chrome. Still allowed inside real text editors (inputs, textareas,
  // and CodeMirror's contenteditable), where select-all is expected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a') return;
      const el = e.target as HTMLElement | null;
      const inEditor =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable);
      if (!inEditor) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tab shortcuts from the application menu (ADR 0005). Cmd+W closes the active
  // tab, except on the last tab where it closes the window (the tab-bar × button
  // instead resets to a blank tab — a deliberate divergence). Re-subscribe when
  // tab state changes so the handlers close over the current tabs/active id.
  useEffect(() => {
    const offNew = window.api.onMenuNewTab(() => newTab());
    const offClose = window.api.onMenuCloseTab(() => {
      if (tabs.length > 1) closeTab(activeTabId);
      else window.close();
    });
    return () => {
      offNew();
      offClose();
    };
  }, [tabs, activeTabId]);

  // Dismiss the connection context menu on any outside click.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  async function connect(id: string): Promise<void> {
    try {
      await window.api.connect(id);
      setActiveId(id);
      setSchema(await window.api.listSchema(id));
    } catch (e) {
      updateTab(activeTabId, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function loadTable(
    tabId: string,
    connId: string,
    table: TableRef,
    orderBy?: { column: string; desc: boolean },
  ): Promise<void> {
    try {
      const res = await window.api.loadRows({
        connectionId: connId,
        table,
        limit: 500,
        offset: 0,
        orderBy,
      });
      updateTab(tabId, {
        result: res,
        currentTable: table,
        // Commit the active sort only on a successful load, so the header arrow
        // is always a fact about the rows on screen (ADR 0008).
        sort: orderBy ?? null,
        error: null,
        title: table.name,
      });
    } catch (e) {
      updateTab(tabId, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  function openTable(table: TableRef): void {
    if (!activeId) return;
    // One tab per table: focus the existing tab if we already opened this one.
    const tabCode = `${table.schema}.${table.name}`.toLowerCase();
    const existingTab = tabs.find((tab) => tab.tabCode === tabCode);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    // Show the table's data, and mirror the equivalent SELECT into the editor.
    const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    const query = `select * from ${ident(table.schema)}.${ident(table.name)} limit 100`;
    const t: Tab = {
      ...makeTab(),
      tabCode,
      title: table.name,
      sqlText: query,
      showSql: true,
    };
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
    loadTable(t.id, activeId, table);
  }

  function reload(): void {
    if (activeId && active.currentTable)
      loadTable(
        active.id,
        activeId,
        active.currentTable,
        active.sort ?? undefined,
      );
  }

  // One staged-edit + selection state machine for the active tab's result, shared
  // by the grid and the row detail pane (ADR 0009). Fed the SAME visibleResult the
  // grid renders, so indices align; it resets on any result-identity change (table
  // switch, sort, reload, tab switch, filter), as before the lift.
  const tableEditing = useTableEditing(
    visibleResult ?? EMPTY_RESULT,
    activeId,
    reload,
    () => setRecordPaneOpen(true), // clicking a row reveals the detail pane
  );

  // Re-fetch the active table browse with a new active sort (ADR 0008). Sorting is
  // server-side (ORDER BY) so "top N" means the table's true top N, not the loaded
  // window's; loadTable commits the indicator only on a successful load.
  function sortTable(
    orderBy: { column: string; desc: boolean } | undefined,
  ): void {
    if (activeId && active.currentTable)
      loadTable(active.id, activeId, active.currentTable, orderBy);
  }

  async function switchDatabase(db: string): Promise<void> {
    if (!activeId) return;
    try {
      await window.api.switchDatabase(activeId, db);
      setSchema(await window.api.listSchema(activeId));
      updateTab(activeTabId, { result: null, currentTable: null, error: null });
    } catch (e) {
      updateTab(activeTabId, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function newTab(): void {
    const t = makeTab();
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  }

  function closeTab(id: string): void {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    if (next.length === 0) {
      const fresh = makeTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      return;
    }
    setTabs(next);
    if (id === activeTabId) setActiveTabId(next[Math.max(0, idx - 1)].id);
  }

  // Open a saved query or history entry in a fresh, un-run SQL tab.
  function openSql(sql: string): void {
    const t: Tab = {
      ...makeTab(),
      title: 'Query',
      sqlText: sql,
      showSql: true,
    };
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  }

  // Open a routine's CREATE OR REPLACE source in a fresh, un-run SQL tab. The
  // tab appears immediately (titled by name); the source streams in, or a
  // per-tab error shows if the routine was dropped between listing and click.
  function openRoutine(routine: RoutineRef): void {
    if (!activeId) return;
    const t: Tab = {
      ...makeTab(),
      title: routine.name,
      showSql: true,
    };
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
    window.api
      .getRoutineSource(activeId, routine.handle)
      .then((sql) => updateTab(t.id, { sqlText: sql, error: null }))
      .catch((e) =>
        updateTab(t.id, { error: e instanceof Error ? e.message : String(e) }),
      );
  }

  async function submitSaveQuery(): Promise<void> {
    if (!saveModal || !saveName.trim()) return;
    await window.api.saveQuery({
      name: saveName.trim(),
      sql: saveModal.sql,
      connectionId: activeId,
    });
    setSaveModal(null);
    setSaveName('');
    await refreshSavedQueries();
  }

  async function deleteSavedQuery(q: SavedQuery): Promise<void> {
    const ok = window.confirm(`Delete saved query "${q.name}"?`);
    if (!ok) return;
    await window.api.deleteSavedQuery(q.id);
    await refreshSavedQueries();
  }

  async function clearHistory(): Promise<void> {
    if (!activeId) return;
    await window.api.clearHistory(activeId);
    await refreshHistory(activeId);
  }

  async function clearAllHistory(): Promise<void> {
    await window.api.clearAllHistory();
    await refreshHistory(activeId);
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
    }
    await window.api.deleteConnection(conn.id);
    await refreshConnections();
  }

  return (
    <AppLayout
      sidebar={
        <Sidebar
          view={sidebarView}
          onChangeView={setSidebarView}
          connections={connections}
          activeId={activeId}
          schema={schema}
          currentTable={active.currentTable}
          onNewConnection={() => setModal({ open: true })}
          onConnect={connect}
          onConnectionMenu={(e, conn) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, conn });
          }}
          onSwitchDatabase={switchDatabase}
          onOpenTable={openTable}
          onOpenRoutine={openRoutine}
          savedQueries={savedQueries}
          queryHistory={queryHistory}
          onOpenSql={openSql}
          onDeleteSavedQuery={deleteSavedQuery}
          onSaveToLibrary={(sql) => {
            setSaveName('');
            setSaveModal({ sql });
          }}
          onClearHistory={clearHistory}
          onClearAllHistory={clearAllHistory}
        />
      }
      rightPane={
        recordPaneOpen && visibleResult ? (
          <RecordDetailPane
            result={visibleResult}
            edit={tableEditing}
            width={recordPaneWidth}
            onResize={setRecordPaneWidth}
            onClose={() => setRecordPaneOpen(false)}
          />
        ) : undefined
      }
    >
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNew={newTab}
      />

      <Toolbar
        connected={!!activeId}
        showSql={active.showSql}
        onToggleSql={() => updateTab(active.id, { showSql: !active.showSql })}
        filterShown={filterShown}
        onToggleFilter={() => setFilterShown((v) => !v)}
        hasResult={!!visibleResult}
        recordPaneShown={recordPaneOpen}
        onToggleRecordPane={() => setRecordPaneOpen((v) => !v)}
        error={active.error}
      />

      {filterShown && (
        <div className="px-2 py-1 border-b border-border bg-panel">
          <Input
            placeholder="Filter visible rows…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      )}

      {active.showSql && activeId && (
        <SqlEditor
          connectionId={activeId}
          value={active.sqlText}
          onChange={(v) => updateTab(active.id, { sqlText: v })}
          schema={sqlSchema}
          onResult={(r) => {
            updateTab(active.id, {
              result: r,
              currentTable: null,
              error: null,
            });
            void refreshHistory(activeId);
          }}
          onError={(m) => {
            updateTab(active.id, { error: m });
            void refreshHistory(activeId);
          }}
          onSaveQuery={(sql) => {
            setSaveName('');
            setSaveModal({ sql });
          }}
        />
      )}

      <div className="flex-1 overflow-hidden">
        {visibleResult && activeId ? (
          <DataGrid
            key={active.id}
            result={visibleResult}
            edit={tableEditing}
            sort={active.sort}
            onSort={sortTable}
          />
        ) : active.error ? (
          <div className="p-6 text-danger whitespace-pre-wrap">
            {active.error}
          </div>
        ) : (
          <div className="text-muted p-6">Select a table or run a query.</div>
        )}
      </div>

      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          items={[
            {
              label: 'Edit…',
              onClick: () => {
                setMenu(null);
                setModal({ open: true, editing: menu.conn });
              },
            },
            {
              label: 'Delete',
              danger: true,
              onClick: () => deleteConnection(menu.conn),
            },
          ]}
        />
      )}

      {modal.open && (
        <ConnectionModal
          initial={modal.editing}
          onClose={() => setModal({ open: false })}
          onSaved={handleSaved}
        />
      )}

      {saveModal && (
        <Modal onClose={() => setSaveModal(null)}>
          <h2 className="text-sm font-semibold mb-3">Save query</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitSaveQuery();
            }}
          >
            <Input
              autoFocus
              placeholder="Query name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
            <pre className="mt-3 max-h-32 overflow-auto rounded bg-bg p-2 text-xs text-muted whitespace-pre-wrap">
              {saveModal.sql}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSaveModal(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!saveName.trim()}>
                Save
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </AppLayout>
  );
}
