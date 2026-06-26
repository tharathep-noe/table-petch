import { getPool } from './manager'
import type {
  Change,
  CommitResult,
  PreparedStatement,
  RowKey,
  TableRef
} from '@shared/types'

const ident = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
const qualified = (t: TableRef): string => `${ident(t.schema)}.${ident(t.name)}`

const NO_UNIQUE_WARNING =
  'No primary key or unique constraint — this WHERE matches on all column ' +
  'values and may affect more than one row.'

/** Build the WHERE clause for a row, appending params. Returns SQL fragment. */
function whereFor(key: RowKey, params: (string | null)[]): string {
  const parts: string[] = []
  for (const [col, val] of Object.entries(key.where)) {
    if (val === null) {
      parts.push(`${ident(col)} is null`)
    } else {
      params.push(val)
      parts.push(`${ident(col)} = $${params.length}`)
    }
  }
  return parts.join(' and ')
}

/** Turn one staged change into a parameterized statement. */
export function prepareChange(change: Change): PreparedStatement {
  const params: (string | null)[] = []

  if (change.kind === 'insert') {
    const cols = Object.keys(change.values)
    const placeholders = cols.map((c) => {
      params.push(change.values[c])
      return `$${params.length}`
    })
    const sql =
      `insert into ${qualified(change.table)} ` +
      `(${cols.map(ident).join(', ')}) values (${placeholders.join(', ')})`
    return { sql, params }
  }

  if (change.kind === 'update') {
    const setCols = Object.keys(change.set)
    const sets = setCols.map((c) => {
      params.push(change.set[c])
      return `${ident(c)} = $${params.length}`
    })
    const where = whereFor(change.key, params)
    const sql = `update ${qualified(change.table)} set ${sets.join(', ')} where ${where}`
    return {
      sql,
      params,
      warning: change.key.identity === 'allColumns' ? NO_UNIQUE_WARNING : undefined
    }
  }

  // delete
  const where = whereFor(change.key, params)
  const sql = `delete from ${qualified(change.table)} where ${where}`
  return {
    sql,
    params,
    warning: change.key.identity === 'allColumns' ? NO_UNIQUE_WARNING : undefined
  }
}

export function prepareChanges(changes: Change[]): PreparedStatement[] {
  return changes.map(prepareChange)
}

/** Apply all staged changes in a single transaction (all-or-nothing). */
export async function commitChanges(
  connectionId: string,
  changes: Change[]
): Promise<CommitResult> {
  const pool = getPool(connectionId)
  const client = await pool.connect()
  let applied = 0
  try {
    await client.query('begin')
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i]
      const stmt = prepareChange(change)
      const res = await client.query(stmt.sql, stmt.params)
      // Optimistic concurrency: an update/delete that hits nothing means the
      // row changed or vanished underneath us — abort rather than silently no-op.
      if (change.kind !== 'insert' && (res.rowCount ?? 0) === 0) {
        throw new Error(
          `A ${change.kind} on ${change.table.schema}.${change.table.name} matched no rows ` +
            `— the row was modified or removed by someone else. Refresh and retry.`
        )
      }
      applied += res.rowCount ?? 0
    }
    await client.query('commit')
    return { ok: true, applied }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    return { ok: false, applied: 0, error: err instanceof Error ? err.message : String(err) }
  } finally {
    client.release()
  }
}
