// The engine-neutral driver abstraction (ADR 0006). Everything Postgres-specific
// lives in a Driver implementation under ./drivers; the rest of src/main/db is
// shared orchestration that talks only to these interfaces.

import type {
  Capabilities,
  ColumnMeta,
  ConnectionConfig,
  Engine,
  SchemaInfo,
  TableRef,
} from '@shared/types';

/** A single result set, already normalized to canonical text by the driver. */
export interface RawResult {
  /** Output column names, in order. */
  fields: { name: string }[];
  /** Rows as text (or null) — the renderer's `string | null` cell contract. */
  rows: Array<Array<string | null>>;
  /** The engine's command tag (e.g. "SELECT", "UPDATE"); null when unavailable. */
  command: string | null;
  rowCount: number | null;
}

/** A transactional handle: every query runs on the same physical connection. */
export interface Tx {
  query(sql: string, params?: (string | null)[]): Promise<RawResult>;
}

/** One open connection to a database. The driver owns native value→text
 *  normalization inside these methods. */
export interface EngineConnection {
  /** A single, autocommit statement with positional params. */
  query(sql: string, params?: (string | null)[]): Promise<RawResult>;
  /** A (possibly multi-statement) script; one RawResult per statement. */
  queryScript(sql: string): Promise<RawResult[]>;
  /** Run `fn` inside a transaction; commit on success, roll back on throw. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The mechanical SQL differences the shared CRUD builders need (ADR 0006). */
export interface Dialect {
  /** Quote an identifier (table/column/schema name). */
  quoteIdent(name: string): string;
  /** A 1-based positional placeholder, e.g. `$1` / `?` / `@p1` / `:1`. */
  placeholder(index: number): string;
  /** Append pagination to a base SELECT. limit/offset are app-controlled
   *  integers and are inlined (never user input). */
  paginate(baseSql: string, limit: number, offset: number): string;
}

export interface TableColumns {
  columns: ColumnMeta[];
  /** Column-name sets that uniquely identify a row (primary key + unique
   *  indexes). Used to build a precise WHERE for UPDATE/DELETE. */
  uniqueKeys: string[][];
}

/** One engine's adapter — the only engine-specific code below the IPC seam. */
export interface Driver {
  readonly engine: Engine;
  readonly dialect: Dialect;
  readonly capabilities: Capabilities;

  /** Open a connection. `catalog` overrides the config's default when switching. */
  connect(
    config: ConnectionConfig,
    password: string | undefined,
    catalog?: string,
  ): Promise<EngineConnection>;

  /** The catalogs visible on the server (for the switcher); may be just one. */
  listCatalogs(conn: EngineConnection): Promise<string[]>;
  /** The catalog this connection is currently pointed at. */
  currentCatalog(conn: EngineConnection): Promise<string>;

  /** The schema→table/view/routine tree of the active catalog. */
  introspectObjects(conn: EngineConnection): Promise<SchemaInfo['schemas']>;
  /** Columns + unique-key sets for one table. */
  getColumns(conn: EngineConnection, table: TableRef): Promise<TableColumns>;
  /** The source definition of a routine, by its opaque handle. */
  getRoutineSource(conn: EngineConnection, handle: string): Promise<string>;
}
