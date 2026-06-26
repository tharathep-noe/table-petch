import type { FieldDef } from 'pg'
import { getPool } from './manager'
import { getColumns } from './introspect'
import type { ColumnMeta, LoadRowsRequest, QueryResult, TableRef } from '@shared/types'

const ident = (s: string): string => '"' + s.replace(/"/g, '""') + '"'
const qualified = (t: TableRef): string => `${ident(t.schema)}.${ident(t.name)}`

/** Paged read of a single table — the table browser's read path. */
export async function loadRows(req: LoadRowsRequest): Promise<QueryResult> {
  const pool = getPool(req.connectionId)
  const cols = await getColumns(req.connectionId, req.table)

  const order = req.orderBy
    ? ` order by ${ident(req.orderBy.column)} ${req.orderBy.desc ? 'desc' : 'asc'}`
    : ''
  const sql = `select * from ${qualified(req.table)}${order} limit $1 offset $2`
  const res = await pool.query({ text: sql, rowMode: 'array', values: [req.limit, req.offset] })

  return {
    columns: cols,
    rows: res.rows as Array<Array<string | null>>,
    rowCount: res.rowCount ?? res.rows.length,
    editable: true,
    table: req.table
  }
}

/** Arbitrary SQL from the editor. Results are editable only for simple
 *  single-table selects (detected heuristically; refined later). */
export async function runQuery(connectionId: string, sql: string): Promise<QueryResult> {
  const pool = getPool(connectionId)
  const res = await pool.query({ text: sql, rowMode: 'array' })

  const columns: ColumnMeta[] = (res.fields ?? []).map((f: FieldDef) => ({
    name: f.name,
    dataType: String(f.dataTypeID),
    nullable: true,
    isPrimaryKey: false
  }))

  return {
    columns,
    rows: (res.rows as Array<Array<string | null>>) ?? [],
    rowCount: res.rowCount ?? 0,
    editable: false // TODO: detect single-table SELECT and enrich with getColumns
  }
}
