// The MySQL driver (ADR 0006/0007). Uses mysql2 (pure JS). Namespace mapping:
// catalog = database (switchable, listed); the schema level is synthetic — the
// active database is presented as a single schema whose name is the database, so
// the shared CRUD builders' `schema.table` qualification is valid MySQL.

import mysql from 'mysql2/promise';
import type {
  Capabilities,
  ColumnMeta,
  ConnectionConfig,
  MysqlConn,
  RoutineRef,
  SchemaInfo,
  TableRef,
  TypeCategory,
} from '@shared/types';
import type {
  Dialect,
  Driver,
  EngineConnection,
  RawResult,
  TableColumns,
  Tx,
} from '../driver';

// --- value normalization (mysql2 returns native JS; we keep the text contract) ---

function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return `[binary ${v.length} bytes]`; // non-editable sentinel
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v); // JSON columns
  return String(v);
}

function toRaw(
  result: unknown,
  fields: mysql.FieldPacket[] | undefined,
): RawResult {
  // A write (INSERT/UPDATE/DELETE/DDL) is a ResultSetHeader, not a rows array.
  if (!Array.isArray(result)) {
    const header = result as mysql.ResultSetHeader;
    return {
      fields: [],
      rows: [],
      // mysql2 exposes no command tag; emit a non-read tag so history treats a
      // write as a write — null or 'SELECT' would wrongly collapse it (see
      // historyStore.isCollapsible).
      command: 'OK',
      rowCount: header?.affectedRows ?? 0,
    };
  }
  const rows = (result as unknown[][]).map((r) => r.map(toText));
  return {
    fields: (fields ?? []).map((f) => ({ name: f.name })),
    rows,
    command: 'SELECT', // any result set counts as a read for history
    rowCount: rows.length,
  };
}

const q = (s: string): string => '`' + s.replace(/`/g, '``') + '`';

/** Concrete MySQL connection over a mysql2 pool. `objects()` gives object-mode
 *  rows for the driver's own catalog queries (off the EngineConnection iface). */
class MysqlConnection implements EngineConnection {
  constructor(private readonly pool: mysql.Pool) {}

  async query(sql: string, params?: (string | null)[]): Promise<RawResult> {
    const [result, fields] = await this.pool.query({
      sql,
      values: params,
      rowsAsArray: true,
    });
    return toRaw(result, fields as mysql.FieldPacket[]);
  }

  async queryScript(sql: string): Promise<RawResult[]> {
    const [result, fields] = await this.pool.query({ sql, rowsAsArray: true });
    // Multi-statement: mysql2 returns `fields` as an array of FieldPacket arrays.
    const multi =
      Array.isArray(fields) && fields.length > 0 && Array.isArray(fields[0]);
    if (multi) {
      const sets = result as unknown[];
      const fieldSets = fields as unknown as mysql.FieldPacket[][];
      return sets.map((r, i) => toRaw(r, fieldSets[i]));
    }
    return [toRaw(result, fields as mysql.FieldPacket[])];
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const tx: Tx = {
        query: async (sql, params) => {
          const [result, fields] = await c.query({
            sql,
            values: params,
            rowsAsArray: true,
          });
          return toRaw(result, fields as mysql.FieldPacket[]);
        },
      };
      const out = await fn(tx);
      await c.commit();
      return out;
    } catch (err) {
      await c.rollback().catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Object-mode read for catalog introspection only. */
  async objects<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }
}

const dialect: Dialect = {
  quoteIdent: q,
  placeholder: () => '?', // MySQL uses positional `?`
  paginate: (base, limit, offset) => `${base} limit ${limit} offset ${offset}`,
};

const capabilities: Capabilities = {
  engine: 'mysql',
  catalogs: 'switchable',
  listsCatalogs: true,
  multiStatement: true,
  routines: true,
  sqlDialect: 'mysql',
};

// --- value-type semantics (DATA_TYPE, lowercased) ---

function mysqlTypeMeta(base: string): {
  category: TypeCategory;
  textRoundTripSafe: boolean;
} {
  if (base === 'float' || base === 'double' || base === 'real')
    return { category: 'number', textRoundTripSafe: false };
  if (
    /^(decimal|numeric|int|integer|tinyint|smallint|mediumint|bigint)$/.test(
      base,
    )
  )
    return { category: 'number', textRoundTripSafe: true };
  if (/^(date|datetime|timestamp|time|year)$/.test(base))
    return { category: 'temporal', textRoundTripSafe: true };
  if (base === 'json') return { category: 'json', textRoundTripSafe: true };
  if (/blob|binary|bit/.test(base))
    return { category: 'binary', textRoundTripSafe: false };
  if (/(char|text|enum|set)/.test(base))
    return { category: 'text', textRoundTripSafe: true };
  return { category: 'other', textRoundTripSafe: true };
}

async function connect(
  config: ConnectionConfig,
  password: string | undefined,
  catalog?: string,
): Promise<EngineConnection> {
  const cfg = config as MysqlConn; // the registry only routes mysql here
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password,
    database: catalog ?? cfg.database,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 4,
    // Keep values as text (the renderer's contract); big ints & dates as strings.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: true,
  });
  // Fail fast so the UI can report a bad connection immediately.
  const c = await pool.getConnection();
  c.release();
  return new MysqlConnection(pool);
}

async function currentCatalog(conn: EngineConnection): Promise<string> {
  const rows = await (conn as MysqlConnection).objects<{ db: string | null }>(
    `select database() as db`,
  );
  return rows[0]?.db ?? '';
}

async function listCatalogs(conn: EngineConnection): Promise<string[]> {
  const rows = await (conn as MysqlConnection).objects<{ name: string }>(
    `select schema_name as name from information_schema.schemata
      where schema_name not in ('information_schema','mysql','performance_schema','sys')
      order by schema_name`,
  );
  return rows.map((r) => r.name);
}

async function introspectObjects(
  conn: EngineConnection,
): Promise<SchemaInfo['schemas']> {
  const c = conn as MysqlConnection;
  const db = await currentCatalog(conn);
  if (!db) return [];

  const tablesP = c.objects<{ name: string; kind: string }>(
    `select table_name as name,
            case table_type when 'VIEW' then 'view' else 'table' end as kind
       from information_schema.tables
      where table_schema = ?
      order by table_name`,
    [db],
  );
  const routinesP = c.objects<{ name: string; kind: string }>(
    `select routine_name as name, lower(routine_type) as kind
       from information_schema.routines
      where routine_schema = ?
      order by routine_name`,
    [db],
  );
  const [tables, routines] = await Promise.all([tablesP, routinesP]);

  return [
    {
      name: db, // synthetic single schema = the active database
      tables: tables.map((t) => ({
        schema: db,
        name: t.name,
        kind: t.kind as TableRef['kind'],
      })),
      routines: routines.map((r) => ({
        schema: db,
        name: r.name,
        kind: r.kind as RoutineRef['kind'],
        // Opaque handle: kind is needed to pick SHOW CREATE FUNCTION/PROCEDURE.
        handle: JSON.stringify({ kind: r.kind, schema: db, name: r.name }),
        signature: '', // MySQL has no routine overloading
      })),
    },
  ];
}

async function getColumns(
  conn: EngineConnection,
  table: TableRef,
): Promise<TableColumns> {
  const c = conn as MysqlConnection;

  const colsP = c.objects<{
    name: string;
    data_type: string;
    base_type: string;
    is_nullable: string;
    column_key: string | null;
    extra: string | null;
    column_default: string | null;
  }>(
    `select column_name as name, column_type as data_type, data_type as base_type,
            is_nullable, column_key, extra, column_default
       from information_schema.columns
      where table_schema = ? and table_name = ?
      order by ordinal_position`,
    [table.schema, table.name],
  );

  // Unique indexes (PRIMARY included). column_name is null for expression parts.
  const uniqP = c.objects<{ index_name: string; column_name: string }>(
    `select index_name, column_name
       from information_schema.statistics
      where table_schema = ? and table_name = ? and non_unique = 0
        and column_name is not null
      order by index_name, seq_in_index`,
    [table.schema, table.name],
  );

  const [cols, uniq] = await Promise.all([colsP, uniqP]);

  const columns: ColumnMeta[] = cols.map((r) => {
    const extra = String(r.extra ?? '');
    const meta = mysqlTypeMeta(String(r.base_type ?? '').toLowerCase());
    return {
      name: r.name,
      dataType: r.data_type ?? r.base_type ?? '',
      category: meta.category,
      textRoundTripSafe: meta.textRoundTripSafe,
      nullable: String(r.is_nullable).toUpperCase() === 'YES',
      isPrimaryKey: r.column_key === 'PRI',
      // auto_increment is a default (omittable), not a generated/never-insertable
      // column; only STORED/VIRTUAL GENERATED columns are isGenerated.
      hasDefault:
        r.column_default !== null ||
        /auto_increment|default_generated/i.test(extra),
      isGenerated: /\bgenerated\b/i.test(extra),
    };
  });

  const byIndex = new Map<string, string[]>();
  for (const r of uniq) {
    const list = byIndex.get(r.index_name) ?? [];
    list.push(r.column_name);
    byIndex.set(r.index_name, list);
  }

  return { columns, uniqueKeys: [...byIndex.values()] };
}

async function getRoutineSource(
  conn: EngineConnection,
  handle: string,
): Promise<string> {
  const { kind, schema, name } = JSON.parse(handle) as {
    kind: string;
    schema: string;
    name: string;
  };
  const verb = kind === 'function' ? 'FUNCTION' : 'PROCEDURE';
  const rows = await (conn as MysqlConnection).objects<Record<string, unknown>>(
    `SHOW CREATE ${verb} ${q(schema)}.${q(name)}`,
  );
  const row = rows[0];
  // SHOW CREATE …'s DDL is in the "Create Function"/"Create Procedure" column.
  const key = row && Object.keys(row).find((k) => /^create /i.test(k));
  const ddl = key ? row[key] : null;
  if (ddl == null) {
    throw new Error(`Routine ${name} not found (it may have been dropped).`);
  }
  return String(ddl);
}

export const mysqlDriver: Driver = {
  engine: 'mysql',
  dialect,
  capabilities,
  connect,
  listCatalogs,
  currentCatalog,
  introspectObjects,
  getColumns,
  getRoutineSource,
};
