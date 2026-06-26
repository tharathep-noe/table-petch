import { useEffect, useState } from 'react'
import type { ConnectionConfig, QueryResult, SchemaInfo, TableRef } from '@shared/types'
import { ConnectionModal } from './ConnectionModal'

// v1 skeleton UI: connection picker -> connect -> schema sidebar -> table grid.
// Editing/SQL-editor/commit wiring comes in later build steps (see PLAN.md).

interface ModalState {
  open: boolean
  editing?: ConnectionConfig
}

interface MenuState {
  x: number
  y: number
  conn: ConnectionConfig
}

const treeItem = 'px-1.5 py-0.5 rounded cursor-pointer hover:bg-border'
const schemaLabel = 'text-muted mt-1.5 font-semibold'

export function App(): JSX.Element {
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [schema, setSchema] = useState<SchemaInfo | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false })
  const [menu, setMenu] = useState<MenuState | null>(null)

  async function refreshConnections(): Promise<ConnectionConfig[]> {
    const list = await window.api.listConnections()
    setConnections(list)
    return list
  }

  useEffect(() => {
    refreshConnections()
  }, [])

  // Dismiss the context menu on any outside click.
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  async function connect(id: string): Promise<void> {
    setError(null)
    try {
      await window.api.connect(id)
      setActiveId(id)
      setSchema(await window.api.listSchema(id))
      setResult(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function openTable(table: TableRef): Promise<void> {
    if (!activeId) return
    setError(null)
    try {
      setResult(await window.api.loadRows({ connectionId: activeId, table, limit: 500, offset: 0 }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleSaved(saved: ConnectionConfig, changedTarget: boolean): Promise<void> {
    setModal({ open: false })
    await refreshConnections()
    // Auto-connect a new connection (or a reconnect-worthy edit of the active one).
    if (!modal.editing || (saved.id === activeId && changedTarget)) {
      await connect(saved.id)
    }
  }

  async function deleteConnection(conn: ConnectionConfig): Promise<void> {
    setMenu(null)
    const ok = window.confirm(`Delete connection "${conn.name}"? This also removes its password.`)
    if (!ok) return
    if (conn.id === activeId) {
      await window.api.disconnect(conn.id).catch(() => {})
      setActiveId(null)
      setSchema(null)
      setResult(null)
    }
    await window.api.deleteConnection(conn.id)
    await refreshConnections()
  }

  return (
    <div className="flex h-screen">
      <aside className="w-60 bg-panel border-r border-border overflow-y-auto p-2">
        <div className="flex items-center justify-between mb-1.5">
          <strong>Connections</strong>
          <button
            className="rounded border border-border px-2 py-0.5 text-xs cursor-pointer hover:bg-border"
            onClick={() => setModal({ open: true })}
          >
            ＋ New
          </button>
        </div>

        {connections.length === 0 && <div className="text-muted p-6">No connections yet.</div>}
        {connections.map((c) => (
          <div
            key={c.id}
            className={treeItem}
            style={{ fontWeight: c.id === activeId ? 700 : 400 }}
            onClick={() => connect(c.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, conn: c })
            }}
          >
            {c.name || `${c.user}@${c.host}`}
          </div>
        ))}

        {schema && (
          <>
            <div className={schemaLabel}>{schema.database}</div>
            {schema.schemas.map((s) => (
              <div key={s.name}>
                <div className={schemaLabel}>{s.name}</div>
                {s.tables.map((t) => (
                  <div key={`${t.schema}.${t.name}`} className={treeItem} onClick={() => openTable(t)}>
                    {t.kind === 'view' ? '◇' : '▦'} {t.name}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex gap-2 items-center p-2 border-b border-border">
          <span className="text-muted">{activeId ? 'Connected' : 'Pick a connection'}</span>
          {error && <span className="text-danger">{error}</span>}
        </div>
        <div className="flex-1 overflow-auto">
          {result ? <Grid result={result} /> : <div className="text-muted p-6">Select a table.</div>}
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
              setMenu(null)
              setModal({ open: true, editing: menu.conn })
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
  )
}

function Grid({ result }: { result: QueryResult }): JSX.Element {
  const cell = 'border border-border px-2 py-1 text-left whitespace-nowrap [font-variant-numeric:tabular-nums]'
  return (
    <table className="border-collapse w-full">
      <thead>
        <tr>
          {result.columns.map((c) => (
            <th key={c.name} title={c.dataType} className={`${cell} bg-panel sticky top-0`}>
              {c.isPrimaryKey ? '🔑 ' : ''}
              {c.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => (
              <td key={j} className={cell}>
                {v === null ? <span className="text-null italic">NULL</span> : v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
