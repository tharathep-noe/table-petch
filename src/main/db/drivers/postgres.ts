// The Postgres driver — the first concrete Driver (ADR 0006). All pg-specific
// code lives here: the `pg` pool, the "everything as text" type trick, the
// pg_catalog introspection (moved verbatim from the old introspect.ts), and the
// pg Dialect. Lazy-loaded via the registry.

import pg from 'pg';
import type {
  Capabilities,
  ColumnMeta,
  ConnectionConfig,
  PostgresConn,
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

function poolConfig(input: {
  host: string;
  port: number;
  database: string;
  user: string;
  ssl?: boolean;
  password?: string;
}): pg.PoolConfig {
  return {
    host: input.host,
    port: input.port,
    database: input.database,
    user: input.user,
    password: input.password,
    ssl: input.ssl ? { rejectUnauthorized: false } : undefined,
    max: 4,
    // Return all values as text; the grid renders text and NULL distinctly.
    types: {
      getTypeParser: () => (v: string) => v,
    } as unknown as pg.CustomTypesConfig,
  };
}

type QueryArg = { text: string; rowMode: 'array'; values?: (string | null)[] };

function toRaw(res: pg.QueryArrayResult): RawResult {
  return {
    fields: (res.fields ?? []).map((f) => ({ name: f.name })),
    rows: (res.rows as Array<Array<string | null>>) ?? [],
    command: res.command ?? null,
    rowCount: res.rowCount ?? null,
  };
}

/** Concrete pg connection. Exposes object-mode `objects()` for the driver's own
 *  catalog queries, kept off the EngineConnection interface (only this driver
 *  needs it). */
class PgConnection implements EngineConnection {
  constructor(private readonly pool: pg.Pool) {}

  async query(sql: string, params?: (string | null)[]): Promise<RawResult> {
    const arg: QueryArg = { text: sql, rowMode: 'array', values: params };
    return toRaw(await this.pool.query(arg));
  }

  async queryScript(sql: string): Promise<RawResult[]> {
    // node-postgres returns an array of results for a multi-statement script.
    const res = await this.pool.query({ text: sql, rowMode: 'array' });
    const arr = (Array.isArray(res) ? res : [res]) as pg.QueryArrayResult[];
    return arr.map(toRaw);
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const tx: Tx = {
        query: async (sql, params) =>
          toRaw(
            await client.query({
              text: sql,
              rowMode: 'array',
              values: params,
            } as QueryArg),
          ),
      };
      const out = await fn(tx);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Object-mode read for catalog introspection only. */
  objects<T extends pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    return this.pool.query<T>(sql, params).then((r) => r.rows);
  }
}

const dialect: Dialect = {
  quoteIdent: (s) => '"' + s.replace(/"/g, '""') + '"',
  placeholder: (i) => '$' + i,
  paginate: (base, limit, offset) => `${base} limit ${limit} offset ${offset}`,
};

const capabilities: Capabilities = {
  engine: 'postgres',
  catalogs: 'switchable',
  listsCatalogs: true,
  multiStatement: true,
  routines: true,
  sqlDialect: 'postgres',
};

// --- value-type semantics (drives the JSON expander + all-columns warning) ---

function pgTypeMeta(dataType: string): {
  category: TypeCategory;
  textRoundTripSafe: boolean;
} {
  const t = dataType.toLowerCase();
  if (t.endsWith('[]')) return { category: 'other', textRoundTripSafe: true };
  const base = t.replace(/\(.*\)/, '').trim();
  if (
    base === 'real' ||
    base === 'double precision' ||
    base.startsWith('float')
  )
    return { category: 'number', textRoundTripSafe: false };
  if (
    /^(smallint|integer|bigint|int2|int4|int8|numeric|decimal|money)$/.test(
      base,
    )
  )
    return { category: 'number', textRoundTripSafe: true };
  if (base === 'boolean' || base === 'bool')
    return { category: 'boolean', textRoundTripSafe: true };
  if (
    base.startsWith('timestamp') ||
    base.startsWith('time') ||
    base === 'date' ||
    base === 'interval'
  )
    return { category: 'temporal', textRoundTripSafe: true };
  if (base === 'json' || base === 'jsonb')
    return { category: 'json', textRoundTripSafe: true };
  if (base === 'uuid') return { category: 'uuid', textRoundTripSafe: true };
  if (base === 'bytea') return { category: 'binary', textRoundTripSafe: false };
  if (/(text|char|varchar|character|citext|name)/.test(base))
    return { category: 'text', textRoundTripSafe: true };
  return { category: 'other', textRoundTripSafe: true };
}

// --- catalog-text helpers (text pool ⇒ booleans arrive as "t"/"f", etc.) ---

function toBool(v: unknown): boolean {
  return v === true || v === 't' || v === 'true';
}

/** Parse a Postgres array literal like {id} or {"a,b",c} into a string[]. */
function parsePgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== 'string') return [];
  const inner = v.replace(/^\{/, '').replace(/\}$/, '');
  if (inner === '') return [];
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '"') {
      i++;
      let s = '';
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === '\\') i++;
        s += inner[i++];
      }
      i++; // closing quote
      out.push(s);
    } else {
      let s = '';
      while (i < inner.length && inner[i] !== ',') s += inner[i++];
      out.push(s);
    }
    if (inner[i] === ',') i++;
  }
  return out;
}

async function connect(
  config: ConnectionConfig,
  password: string | undefined,
  catalog?: string,
): Promise<EngineConnection> {
  const cfg = config as PostgresConn; // the registry only routes pg here
  const pool = new pg.Pool(
    poolConfig({
      host: cfg.host,
      port: cfg.port,
      database: catalog ?? cfg.database,
      user: cfg.user,
      ssl: cfg.ssl,
      password,
    }),
  );
  // Fail fast so the UI can report a bad connection immediately.
  const client = await pool.connect();
  client.release();
  return new PgConnection(pool);
}

async function listCatalogs(conn: EngineConnection): Promise<string[]> {
  const rows = await (conn as PgConnection).objects<{ datname: string }>(
    `select datname from pg_database where datistemplate = false order by datname`,
  );
  return rows.map((r) => r.datname);
}

async function currentCatalog(conn: EngineConnection): Promise<string> {
  const rows = await (conn as PgConnection).objects<{
    current_database: string;
  }>(`select current_database()`);
  return rows[0].current_database;
}

async function introspectObjects(
  conn: EngineConnection,
): Promise<SchemaInfo['schemas']> {
  const pgc = conn as PgConnection;

  const objsP = pgc.objects<{ schema: string; name: string; kind: string }>(
    `select n.nspname as schema, c.relname as name,
            case c.relkind when 'r' then 'table' when 'v' then 'view' else c.relkind::text end as kind
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','v')
        and n.nspname not in ('pg_catalog','information_schema')
        and n.nspname not like 'pg_toast%'
      order by n.nspname, c.relname`,
  );

  // User-defined functions and procedures (prokind 'f'/'p') in user schemas.
  const routinesP = pgc.objects<{
    schema: string;
    name: string;
    kind: string;
    oid: string;
    signature: string;
  }>(
    `select n.nspname as schema, p.proname as name,
            case p.prokind when 'f' then 'function' when 'p' then 'procedure' end as kind,
            p.oid::text as oid,
            pg_get_function_identity_arguments(p.oid) as signature
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where p.prokind in ('f','p')
        and n.nspname not in ('pg_catalog','information_schema')
        and n.nspname not like 'pg_toast%'
      order by n.nspname, p.proname, signature`,
  );

  const [objs, routines] = await Promise.all([objsP, routinesP]);

  const tablesBySchema = new Map<string, TableRef[]>();
  for (const r of objs) {
    const list = tablesBySchema.get(r.schema) ?? [];
    list.push({
      schema: r.schema,
      name: r.name,
      kind: r.kind as TableRef['kind'],
    });
    tablesBySchema.set(r.schema, list);
  }

  const routinesBySchema = new Map<string, RoutineRef[]>();
  for (const r of routines) {
    const list = routinesBySchema.get(r.schema) ?? [];
    list.push({
      schema: r.schema,
      name: r.name,
      kind: r.kind as RoutineRef['kind'],
      handle: r.oid,
      signature: r.signature,
    });
    routinesBySchema.set(r.schema, list);
  }

  // Union of schema names: a schema may hold only routines, or only tables.
  const schemaNames = [
    ...new Set([...tablesBySchema.keys(), ...routinesBySchema.keys()]),
  ].sort();

  return schemaNames.map((name) => ({
    name,
    tables: tablesBySchema.get(name) ?? [],
    routines: routinesBySchema.get(name) ?? [],
  }));
}

async function getColumns(
  conn: EngineConnection,
  table: TableRef,
): Promise<TableColumns> {
  const pgc = conn as PgConnection;
  // NOTE: indkey is int2vector, which unnest() does NOT accept. Use
  // `attnum = any(i.indkey)`, the canonical idiom, instead.
  const columnsP = pgc.objects<{
    name: string;
    data_type: string;
    nullable: unknown;
    is_pk: unknown;
    has_default: unknown;
    is_generated: unknown;
  }>(
    `select a.attname as name,
            format_type(a.atttypid, a.atttypmod) as data_type,
            not a.attnotnull as nullable,
            coalesce(bool_or(i.indisprimary), false) as is_pk,
            a.atthasdef as has_default,
            (a.attgenerated <> '' or a.attidentity = 'a') as is_generated
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_index i
         on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)
      where n.nspname = $1 and c.relname = $2
        and a.attnum > 0 and not a.attisdropped
      group by a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.attnum,
               a.atthasdef, a.attgenerated, a.attidentity
      order by a.attnum`,
    [table.schema, table.name],
  );

  // Every unique index (primary key included), as column-name sets.
  const uniqueP = pgc.objects<{ cols: unknown }>(
    `select array_agg(a.attname) as cols
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indisunique and c.relname = $2 and n.nspname = $1
        and i.indpred is null               -- skip partial indexes
        and i.indexprs is null              -- skip expression indexes
      group by i.indexrelid`,
    [table.schema, table.name],
  );

  const [rows, unique] = await Promise.all([columnsP, uniqueP]);

  // De-dup: the join above can repeat rows when multiple pk columns exist.
  const seen = new Set<string>();
  const cols: ColumnMeta[] = [];
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    const meta = pgTypeMeta(r.data_type);
    cols.push({
      name: r.name,
      dataType: r.data_type,
      category: meta.category,
      textRoundTripSafe: meta.textRoundTripSafe,
      nullable: toBool(r.nullable),
      isPrimaryKey: toBool(r.is_pk),
      hasDefault: toBool(r.has_default),
      isGenerated: toBool(r.is_generated),
    });
  }

  return { columns: cols, uniqueKeys: unique.map((r) => parsePgArray(r.cols)) };
}

async function getRoutineSource(
  conn: EngineConnection,
  handle: string,
): Promise<string> {
  const rows = await (conn as PgConnection).objects<{ def: string | null }>(
    `select pg_get_functiondef($1::oid) as def`,
    [handle],
  );
  if (rows.length === 0 || rows[0].def == null) {
    throw new Error(`Routine ${handle} not found (it may have been dropped).`);
  }
  return rows[0].def;
}

export const postgresDriver: Driver = {
  engine: 'postgres',
  dialect,
  capabilities,
  connect,
  listCatalogs,
  currentCatalog,
  introspectObjects,
  getColumns,
  getRoutineSource,
};
