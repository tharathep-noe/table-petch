import type { CellValue, Change, ColumnMeta, QueryResult, RowKey } from '@shared/types'

// Staged edits for one loaded page. Rows are keyed by their index in the page.
export type Edits = Record<number, Record<string, CellValue>>

/** Resolve the displayed value of a cell: staged edit if any, else original. */
export function cellValue(
  edits: Edits,
  rowIndex: number,
  colName: string,
  original: CellValue
): CellValue {
  const rowEdits = edits[rowIndex]
  if (rowEdits && colName in rowEdits) return rowEdits[colName]
  return original
}

export function isDirty(edits: Edits, rowIndex: number, colName: string): boolean {
  return !!edits[rowIndex] && colName in edits[rowIndex]
}

/** Immutably set/clear a staged edit. Setting a value equal to the original
 *  clears the dirty mark instead of recording a no-op change. */
export function setEdit(
  edits: Edits,
  rowIndex: number,
  colName: string,
  original: CellValue,
  value: CellValue
): Edits {
  const next: Edits = { ...edits }
  const rowEdits = { ...(next[rowIndex] ?? {}) }
  if (value === original) delete rowEdits[colName]
  else rowEdits[colName] = value
  if (Object.keys(rowEdits).length > 0) next[rowIndex] = rowEdits
  else delete next[rowIndex]
  return next
}

/** Build the WHERE key for a row: primary key → a fully-non-null unique key →
 *  all columns. NULL columns disqualify a unique key (NULLs are distinct). */
export function buildRowKey(
  row: CellValue[],
  columns: ColumnMeta[],
  uniqueKeys: string[][]
): RowKey {
  const indexOf = new Map(columns.map((c, i) => [c.name, i]))
  const valueOf = (name: string): CellValue => row[indexOf.get(name) ?? -1] ?? null
  const keyFrom = (names: string[], identity: RowKey['identity']): RowKey => ({
    where: Object.fromEntries(names.map((n) => [n, valueOf(n)])),
    identity
  })

  const pk = columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  if (pk.length > 0) return keyFrom(pk, 'primaryKey')

  const usable = uniqueKeys.find((cols) => cols.every((n) => valueOf(n) !== null))
  if (usable) return keyFrom(usable, 'unique')

  return keyFrom(columns.map((c) => c.name), 'allColumns')
}

/** Turn staged edits + deletions into the Change[] the backend commits. */
export function buildChanges(
  result: QueryResult,
  edits: Edits,
  deleted: Set<number>
): Change[] {
  if (!result.table) return []
  const table = result.table
  const uniqueKeys = result.uniqueKeys ?? []
  const changes: Change[] = []

  for (const [key, set] of Object.entries(edits)) {
    const rowIndex = Number(key)
    if (deleted.has(rowIndex)) continue // deletion supersedes an edit
    if (Object.keys(set).length === 0) continue
    changes.push({
      kind: 'update',
      table,
      key: buildRowKey(result.rows[rowIndex], result.columns, uniqueKeys),
      set
    })
  }

  for (const rowIndex of deleted) {
    changes.push({
      kind: 'delete',
      table,
      key: buildRowKey(result.rows[rowIndex], result.columns, uniqueKeys)
    })
  }

  return changes
}

export function countChanges(
  result: QueryResult,
  edits: Edits,
  deleted: Set<number>
): { updates: number; deletes: number; total: number } {
  let updates = 0
  for (const [key, set] of Object.entries(edits)) {
    if (!deleted.has(Number(key)) && Object.keys(set).length > 0) updates++
  }
  return { updates, deletes: deleted.size, total: updates + deleted.size }
}
