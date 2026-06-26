import { useEffect, useState } from 'react'
import type { ConnectionConfig, QueryResult, SchemaInfo, TableRef } from '@shared/types'

// v1 skeleton UI: connection picker -> connect -> schema sidebar -> table grid.
// Editing/SQL-editor/commit wiring comes in later build steps (see PLAN.md).

export function App(): JSX.Element {
  const [connections, setConnections] = useState<ConnectionConfig[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [schema, setSchema] = useState<SchemaInfo | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listConnections().then(setConnections)
  }, [])

  async function connect(id: string): Promise<void> {
    setError(null)
    try {
      await window.api.connect(id)
      setActiveId(id)
      setSchema(await window.api.listSchema(id))
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

  return (
    <div className="app">
      <aside className="sidebar">
        <strong>Connections</strong>
        {connections.length === 0 && <div className="empty">No connections yet.</div>}
        {connections.map((c) => (
          <div
            key={c.id}
            className="tree-item"
            style={{ fontWeight: c.id === activeId ? 700 : 400 }}
            onClick={() => connect(c.id)}
          >
            {c.name || `${c.user}@${c.host}`}
          </div>
        ))}

        {schema && (
          <>
            <div className="tree-schema">{schema.database}</div>
            {schema.schemas.map((s) => (
              <div key={s.name}>
                <div className="tree-schema">{s.name}</div>
                {s.tables.map((t) => (
                  <div
                    key={`${t.schema}.${t.name}`}
                    className="tree-item"
                    onClick={() => openTable(t)}
                  >
                    {t.kind === 'view' ? '◇' : '▦'} {t.name}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </aside>

      <main className="main">
        <div className="toolbar">
          <span style={{ color: 'var(--muted)' }}>
            {activeId ? 'Connected' : 'Pick a connection'}
          </span>
          {error && <span style={{ color: '#ff6b6b' }}>{error}</span>}
        </div>
        <div className="results">
          {result ? <Grid result={result} /> : <div className="empty">Select a table.</div>}
        </div>
      </main>
    </div>
  )
}

function Grid({ result }: { result: QueryResult }): JSX.Element {
  return (
    <table>
      <thead>
        <tr>
          {result.columns.map((c) => (
            <th key={c.name} title={c.dataType}>
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
              <td key={j}>{v === null ? <span className="null">NULL</span> : v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
