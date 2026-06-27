import { useEffect, useMemo, useState } from 'react';
import type {
  ConnectionConfig,
  QueryResult,
  SchemaInfo,
  TableRef,
} from '@shared/types';
import { AppLayout } from '../components/templates/AppLayout';
import { Sidebar } from '../components/organisms/Sidebar';
import { TabBar } from '../components/organisms/TabBar';
import { Toolbar } from '../components/organisms/Toolbar';
import { SqlEditor } from '../components/organisms/SqlEditor';
import { DataGrid } from '../components/organisms/DataGrid';
import { ConnectionModal } from '../components/organisms/ConnectionModal';
import { Menu } from '../components/molecules/Menu';
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
  title: string;
  sqlText: string;
  showSql: boolean;
  result: QueryResult | null;
  currentTable: TableRef | null;
  error: string | null;
}

function makeTab(): Tab {
  return {
    id: crypto.randomUUID(),
    title: 'Query',
    sqlText: 'select * from ',
    showSql: false,
    result: null,
    currentTable: null,
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

  const initialTab = useMemo(makeTab, []);
  const [tabs, setTabs] = useState<Tab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = useState(initialTab.id);
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

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

  useEffect(() => {
    refreshConnections();
  }, []);

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
  ): Promise<void> {
    try {
      const res = await window.api.loadRows({
        connectionId: connId,
        table,
        limit: 500,
        offset: 0,
      });
      updateTab(tabId, {
        result: res,
        currentTable: table,
        error: null,
        title: table.name,
      });
    } catch (e) {
      updateTab(tabId, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  function openTable(table: TableRef): void {
    if (!activeId) return;
    // Show the table's data, and mirror the equivalent SELECT into the editor.
    const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    updateTab(activeTabId, {
      sqlText: `select * from ${ident(table.schema)}.${ident(table.name)} limit 100`,
    });
    loadTable(activeTabId, activeId, table);
  }

  function reload(): void {
    if (activeId && active.currentTable)
      loadTable(active.id, activeId, active.currentTable);
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
        />
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
          onResult={(r) =>
            updateTab(active.id, { result: r, currentTable: null, error: null })
          }
          onError={(m) => updateTab(active.id, { error: m })}
        />
      )}

      <div className="flex-1 overflow-hidden">
        {visibleResult && activeId ? (
          <DataGrid
            key={active.id}
            connectionId={activeId}
            result={visibleResult}
            onReload={reload}
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
    </AppLayout>
  );
}
