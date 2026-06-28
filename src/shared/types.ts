// Shared types: the contract between renderer and main. No runtime deps here.

/** The database product a connection targets (see CONTEXT.md "Engine"). */
export type Engine = 'postgres' | 'mysql' | 'mssql' | 'oracle';

/** Fields every engine shares. Password is never stored here in plaintext; it
 *  lives in safeStorage. `engine` is fixed at creation (CONTEXT.md "Engine"). */
interface BaseConn {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  ssl?: boolean;
}

export interface PostgresConn extends BaseConn {
  engine: 'postgres';
  database: string;
}

export interface MysqlConn extends BaseConn {
  engine: 'mysql';
  database: string;
}

export interface MssqlConn extends BaseConn {
  engine: 'mssql';
  database: string;
  /** Named instance, e.g. "SQLEXPRESS" (host\instance). Optional. */
  instance?: string;
  /** TLS encryption; defaults on for SQL Server. */
  encrypt?: boolean;
}

export interface OracleConn extends BaseConn {
  engine: 'oracle';
  /** Oracle connects by service name (preferred) or SID, not a "database". */
  serviceName?: string;
  sid?: string;
}

/** A saved connection — a discriminated union on `engine` (ADR 0006). Existing
 *  engine-less records are migrated to the postgres variant on load. */
export type ConnectionConfig =
  | PostgresConn
  | MysqlConn
  | MssqlConn
  | OracleConn;

/** The shape sent to saveConnection/testConnection: a config without a persisted
 *  id, plus the (write-only) password. */
type AsInput<T> = Omit<T, 'id'> & { id?: string; password?: string };

export type ConnectionInput =
  | AsInput<PostgresConn>
  | AsInput<MysqlConn>
  | AsInput<MssqlConn>
  | AsInput<OracleConn>;

/** Engine-neutral classification of a column's type, derived by the driver.
 *  Drives type-aware UI (the JSON expander now; per-type editors later) so the
 *  renderer never branches on an engine's type names. See CONTEXT.md. */
export type TypeCategory =
  | 'text'
  | 'number'
  | 'boolean'
  | 'temporal'
  | 'json'
  | 'binary'
  | 'lob'
  | 'uuid'
  | 'other';

export interface ColumnMeta {
  name: string;
  dataType: string; // engine-native type name, e.g. "int4"/"varchar" — DISPLAY ONLY
  /** Engine-neutral category for type-aware UI (driver-derived). */
  category: TypeCategory;
  /** Whether native→text→native round-trips exactly enough to match in a WHERE.
   *  False for floats/binary/LOB/some datetimes; drives the all-columns warning. */
  textRoundTripSafe: boolean;
  nullable: boolean;
  isPrimaryKey: boolean;
  /** Column has a DEFAULT (or identity sequence) — may be omitted on INSERT. */
  hasDefault: boolean;
  /** GENERATED ALWAYS (stored generated, or identity always) — never insertable. */
  isGenerated: boolean;
}

export interface TableRef {
  /** Top namespace level (server → catalog → schema → object). Optional: single
   *  active catalog today, so the driver fills it. See CONTEXT.md "Catalog". */
  catalog?: string;
  schema: string;
  name: string;
  kind: 'table' | 'view';
}

/** A user-defined function or procedure. Identified by an opaque, driver-defined
 *  `handle` (Postgres oid, MSSQL object_id, MySQL/Oracle qualified name);
 *  `signature` is for display only. See ADR 0006. */
export interface RoutineRef {
  schema: string;
  name: string;
  kind: 'function' | 'procedure';
  /** Opaque driver identity, passed straight back to getRoutineSource. */
  handle: string;
  /** Identity arguments for display, e.g. "integer, integer". Distinguishes
   *  overloads in the tree; not used for identity. */
  signature: string;
}

/** What a driver can do, so the renderer adapts from data, never an engine name
 *  (ADR 0006). Surfaced to the renderer in a later increment. */
export interface Capabilities {
  engine: Engine;
  /** Whether the active connection can switch catalogs (vs a single fixed one). */
  catalogs: 'switchable' | 'single';
  /** Whether the server lists its other catalogs for the switcher. */
  listsCatalogs: boolean;
  /** Whether one runQuery may contain multiple statements. */
  multiStatement: boolean;
  /** Whether routines are surfaced in the tree. */
  routines: boolean;
  /** CodeMirror SQL dialect token for the editor. */
  sqlDialect: Engine;
}

export interface SchemaInfo {
  database: string;
  databases: string[]; // all databases on the server, for the switcher
  schemas: Array<{
    name: string;
    tables: TableRef[];
    routines: RoutineRef[];
  }>;
}

/** A query/page result. Values are pre-rendered to their text form (or null). */
export interface QueryResult {
  columns: ColumnMeta[];
  rows: Array<Array<string | null>>;
  rowCount: number;
  /** True when results map to exactly one base table and are therefore editable. */
  editable: boolean;
  table?: TableRef;
  /** Column-name sets that uniquely identify a row (PK + unique indexes).
   *  Present for editable single-table results. */
  uniqueKeys?: string[][];
}

export interface LoadRowsRequest {
  connectionId: string;
  table: TableRef;
  limit: number;
  offset: number;
  orderBy?: { column: string; desc: boolean };
}

// ---- Staged changes (the write path) ----

export type CellValue = string | null;

export interface RowKey {
  /** Original values for the columns used to locate the row (PK/unique/all). */
  where: Record<string, CellValue>;
  /** How the WHERE was derived — drives the commit-time warning. */
  identity: 'primaryKey' | 'unique' | 'allColumns';
}

export interface UpdateChange {
  kind: 'update';
  table: TableRef;
  key: RowKey;
  set: Record<string, CellValue>;
}

export interface InsertChange {
  kind: 'insert';
  table: TableRef;
  values: Record<string, CellValue>;
}

export interface DeleteChange {
  kind: 'delete';
  table: TableRef;
  key: RowKey;
}

export type Change = UpdateChange | InsertChange | DeleteChange;

export interface PreparedStatement {
  sql: string;
  params: CellValue[];
  /** Non-blocking warning, e.g. WHERE may match more than one row. */
  warning?: string;
}

export interface CommitResult {
  ok: boolean;
  applied: number;
  error?: string;
}

// ---- Session (restored on launch) ----

/** One tab's reconstruction inputs — never its fetched result/error. */
export interface PersistedTab {
  id: string;
  title: string;
  tabCode: string;
  sqlText: string;
  showSql: boolean;
  currentTable: TableRef | null;
}

/** The restorable workspace. Stored as session.json in userData via IPC. */
export interface PersistedSession {
  /** Bumped (with a migration) whenever the shape changes; unknown → discarded. */
  version: 1;
  activeConnectionId: string | null;
  activeTabId: string;
  tabs: PersistedTab[];
  /** The row detail pane's open flag and width (ADR 0009). Live view state — the
   *  active row it shows is never persisted, only these two scalars. Optional so
   *  an older session.json loads fine; absence means "closed, default width". */
  recordPane?: { open: boolean; width: number };
}

// ---- Query history (automatic, per-connection run log) ----

/** One logged execution. Only user-authored editor runs are logged today;
 *  `source` reserves room to log synthesized commit statements later. */
export interface HistoryEntry {
  id: string;
  /** 'query' = user-authored editor run (the only value emitted now).
   *  'commit' is reserved for synthesized staged-change statements. */
  source: 'query' | 'commit';
  connectionId: string;
  database: string;
  sql: string;
  /** pg command tag of the statement (e.g. "SELECT", "UPDATE"); null on error.
   *  For multi-statement scripts this is the most significant tag (a write wins
   *  over a read) so read/write collapsing classifies correctly. */
  command: string | null;
  executedAt: number; // epoch ms
  ok: boolean;
  rowCount: number | null;
  durationMs: number | null;
  error: string | null;
}

// ---- Saved queries (curated, global library) ----

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  /** Connection it was saved from, if any. The library is global; this is only
   *  an optional tag for later filtering. */
  connectionId: string | null;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

export interface SavedQueryInput {
  /** Omitted for a new query; present to update an existing one. */
  id?: string;
  name: string;
  sql: string;
  connectionId: string | null;
}

// ---- The RPC surface exposed on window.api ----

export interface TablePetchApi {
  listConnections(): Promise<ConnectionConfig[]>;
  saveConnection(input: ConnectionInput): Promise<ConnectionConfig>;
  deleteConnection(id: string): Promise<void>;
  testConnection(
    input: ConnectionInput,
  ): Promise<{ ok: boolean; error?: string }>;

  connect(connectionId: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  switchDatabase(connectionId: string, database: string): Promise<void>;

  listSchema(connectionId: string): Promise<SchemaInfo>;
  /** The `CREATE OR REPLACE …` definition of a routine, fetched on click. The
   *  handle is the opaque driver identity from RoutineRef. */
  getRoutineSource(connectionId: string, handle: string): Promise<string>;
  loadRows(req: LoadRowsRequest): Promise<QueryResult>;
  runQuery(connectionId: string, sql: string): Promise<QueryResult>;

  prepareChanges(
    connectionId: string,
    changes: Change[],
  ): Promise<PreparedStatement[]>;
  commitChanges(connectionId: string, changes: Change[]): Promise<CommitResult>;

  loadSession(): Promise<PersistedSession | null>;
  saveSession(session: PersistedSession): Promise<void>;

  /** Query history, scoped per connection and returned newest-first. */
  listHistory(connectionId: string): Promise<HistoryEntry[]>;
  clearHistory(connectionId: string): Promise<void>;
  clearAllHistory(): Promise<void>;

  /** Saved-query library (global). */
  listSavedQueries(): Promise<SavedQuery[]>;
  saveQuery(input: SavedQueryInput): Promise<SavedQuery>;
  deleteSavedQuery(id: string): Promise<void>;

  /**
   * Subscribe to the application menu's tab commands (ADR 0005). Each returns an
   * unsubscribe function. `Cmd+T` → onMenuNewTab, `Cmd+W` → onMenuCloseTab.
   */
  onMenuNewTab(cb: () => void): () => void;
  onMenuCloseTab(cb: () => void): () => void;
}
