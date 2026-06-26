// Shared types: the contract between renderer and main. No runtime deps here.

export interface ConnectionConfig {
  id: string
  name: string
  host: string
  port: number
  database: string
  user: string
  ssl?: boolean
  /** Password is never stored here in plaintext; it lives in safeStorage. */
}

export interface ConnectionInput extends Omit<ConnectionConfig, 'id'> {
  id?: string
  password?: string
}

export interface ColumnMeta {
  name: string
  dataType: string // postgres type name, e.g. "int4", "jsonb", "timestamptz"
  nullable: boolean
  isPrimaryKey: boolean
}

export interface TableRef {
  schema: string
  name: string
  kind: 'table' | 'view'
}

export interface SchemaInfo {
  database: string
  databases: string[] // all databases on the server, for the switcher
  schemas: Array<{
    name: string
    tables: TableRef[]
  }>
}

/** A query/page result. Values are pre-rendered to their text form (or null). */
export interface QueryResult {
  columns: ColumnMeta[]
  rows: Array<Array<string | null>>
  rowCount: number
  /** True when results map to exactly one base table and are therefore editable. */
  editable: boolean
  table?: TableRef
  /** Column-name sets that uniquely identify a row (PK + unique indexes).
   *  Present for editable single-table results. */
  uniqueKeys?: string[][]
}

export interface LoadRowsRequest {
  connectionId: string
  table: TableRef
  limit: number
  offset: number
  orderBy?: { column: string; desc: boolean }
}

// ---- Staged changes (the write path) ----

export type CellValue = string | null

export interface RowKey {
  /** Original values for the columns used to locate the row (PK/unique/all). */
  where: Record<string, CellValue>
  /** How the WHERE was derived — drives the commit-time warning. */
  identity: 'primaryKey' | 'unique' | 'allColumns'
}

export interface UpdateChange {
  kind: 'update'
  table: TableRef
  key: RowKey
  set: Record<string, CellValue>
}

export interface InsertChange {
  kind: 'insert'
  table: TableRef
  values: Record<string, CellValue>
}

export interface DeleteChange {
  kind: 'delete'
  table: TableRef
  key: RowKey
}

export type Change = UpdateChange | InsertChange | DeleteChange

export interface PreparedStatement {
  sql: string
  params: CellValue[]
  /** Non-blocking warning, e.g. WHERE may match more than one row. */
  warning?: string
}

export interface CommitResult {
  ok: boolean
  applied: number
  error?: string
}

// ---- The RPC surface exposed on window.api ----

export interface TablePetchApi {
  listConnections(): Promise<ConnectionConfig[]>
  saveConnection(input: ConnectionInput): Promise<ConnectionConfig>
  deleteConnection(id: string): Promise<void>
  testConnection(input: ConnectionInput): Promise<{ ok: boolean; error?: string }>

  connect(connectionId: string): Promise<void>
  disconnect(connectionId: string): Promise<void>
  switchDatabase(connectionId: string, database: string): Promise<void>

  listSchema(connectionId: string): Promise<SchemaInfo>
  loadRows(req: LoadRowsRequest): Promise<QueryResult>
  runQuery(connectionId: string, sql: string): Promise<QueryResult>

  prepareChanges(connectionId: string, changes: Change[]): Promise<PreparedStatement[]>
  commitChanges(connectionId: string, changes: Change[]): Promise<CommitResult>
}
