import { getPool } from "./manager";
import type { ColumnMeta, SchemaInfo, TableRef } from "@shared/types";

// Introspection queries against the Postgres catalog. Kept read-only.

export async function listSchema(connectionId: string): Promise<SchemaInfo> {
  const pool = getPool(connectionId);

  const dbsP = pool.query<{ datname: string }>(
    `select datname from pg_database where datistemplate = false order by datname`,
  );
  const currentP = pool.query<{ current_database: string }>(
    `select current_database()`,
  );
  const objsP = pool.query<{ schema: string; name: string; kind: string }>(
    `select n.nspname as schema, c.relname as name,
            case c.relkind when 'r' then 'table' when 'v' then 'view' else c.relkind::text end as kind
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','v')
        and n.nspname not in ('pg_catalog','information_schema')
        and n.nspname not like 'pg_toast%'
      order by n.nspname, c.relname`,
  );

  const [dbs, current, objs] = await Promise.all([dbsP, currentP, objsP]);

  const bySchema = new Map<string, TableRef[]>();
  for (const r of objs.rows) {
    const list = bySchema.get(r.schema) ?? [];
    list.push({
      schema: r.schema,
      name: r.name,
      kind: r.kind as TableRef["kind"],
    });
    bySchema.set(r.schema, list);
  }

  return {
    database: current.rows[0].current_database,
    databases: dbs.rows.map((r) => r.datname),
    schemas: [...bySchema.entries()].map(([name, tables]) => ({
      name,
      tables,
    })),
  };
}

export interface TableColumns {
  columns: ColumnMeta[];
  /** Column-name sets that uniquely identify a row (primary key + unique
   *  indexes). Used to build a precise WHERE for UPDATE/DELETE. */
  uniqueKeys: string[][];
}

// The connection pool returns every value as raw text (so the grid renders
// text), which means catalog booleans arrive as "t"/"f" and array_agg() arrives
// as a "{a,b}" string. These helpers turn them back into real JS types.
function toBool(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

/** Parse a Postgres array literal like {id} or {"a,b",c} into a string[]. */
function parsePgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== "string") return [];
  const inner = v.replace(/^\{/, "").replace(/\}$/, "");
  if (inner === "") return [];
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === '"') {
      i++;
      let s = "";
      while (i < inner.length && inner[i] !== '"') {
        if (inner[i] === "\\") i++;
        s += inner[i++];
      }
      i++; // closing quote
      out.push(s);
    } else {
      let s = "";
      while (i < inner.length && inner[i] !== ",") s += inner[i++];
      out.push(s);
    }
    if (inner[i] === ",") i++;
  }
  return out;
}

/** Columns + primary-key + unique-constraint info for one table. */
export async function getColumns(
  connectionId: string,
  table: TableRef,
): Promise<TableColumns> {
  const pool = getPool(connectionId);
  // NOTE: indkey is int2vector, which unnest() does NOT accept. Use
  // `attnum = any(i.indkey)`, the canonical idiom, instead.
  const columnsP = pool.query<{
    name: string;
    data_type: string;
    nullable: unknown;
    is_pk: unknown;
  }>(
    `select a.attname as name,
            format_type(a.atttypid, a.atttypmod) as data_type,
            not a.attnotnull as nullable,
            coalesce(bool_or(i.indisprimary), false) as is_pk
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_index i
         on i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey)
      where n.nspname = $1 and c.relname = $2
        and a.attnum > 0 and not a.attisdropped
      group by a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.attnum
      order by a.attnum`,
    [table.schema, table.name],
  );

  // Every unique index (primary key included), as column-name sets.
  const uniqueP = pool.query<{ cols: unknown }>(
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

  const [{ rows }, unique] = await Promise.all([columnsP, uniqueP]);

  // De-dup: the join above can repeat rows when multiple pk columns exist.
  const seen = new Set<string>();
  const cols: ColumnMeta[] = [];
  for (const r of rows) {
    if (seen.has(r.name)) continue;
    seen.add(r.name);
    cols.push({
      name: r.name,
      dataType: r.data_type,
      nullable: toBool(r.nullable),
      isPrimaryKey: toBool(r.is_pk),
    });
  }

  return { columns: cols, uniqueKeys: unique.rows.map((r) => parsePgArray(r.cols)) };
}
