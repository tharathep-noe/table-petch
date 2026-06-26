import { getPool } from './manager'
import type { ColumnMeta, SchemaInfo, TableRef } from '@shared/types'

// Introspection queries against the Postgres catalog. Kept read-only.

export async function listSchema(connectionId: string): Promise<SchemaInfo> {
  const pool = getPool(connectionId)

  const dbsP = pool.query<{ datname: string }>(
    `select datname from pg_database where datistemplate = false order by datname`
  )
  const currentP = pool.query<{ current_database: string }>(`select current_database()`)
  const objsP = pool.query<{ schema: string; name: string; kind: string }>(
    `select n.nspname as schema, c.relname as name,
            case c.relkind when 'r' then 'table' when 'v' then 'view' else c.relkind::text end as kind
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','v')
        and n.nspname not in ('pg_catalog','information_schema')
        and n.nspname not like 'pg_toast%'
      order by n.nspname, c.relname`
  )

  const [dbs, current, objs] = await Promise.all([dbsP, currentP, objsP])

  const bySchema = new Map<string, TableRef[]>()
  for (const r of objs.rows) {
    const list = bySchema.get(r.schema) ?? []
    list.push({ schema: r.schema, name: r.name, kind: r.kind as TableRef['kind'] })
    bySchema.set(r.schema, list)
  }

  return {
    database: current.rows[0].current_database,
    databases: dbs.rows.map((r) => r.datname),
    schemas: [...bySchema.entries()].map(([name, tables]) => ({ name, tables }))
  }
}

/** Columns + primary-key + unique-constraint info for one table. */
export async function getColumns(connectionId: string, table: TableRef): Promise<ColumnMeta[]> {
  const pool = getPool(connectionId)
  const { rows } = await pool.query<{
    name: string
    data_type: string
    nullable: boolean
    is_pk: boolean
  }>(
    `select a.attname as name,
            format_type(a.atttypid, a.atttypmod) as data_type,
            not a.attnotnull as nullable,
            coalesce(pk.is_pk, false) as is_pk
       from pg_attribute a
       left join (
         select unnest(i.indkey) as attnum
           from pg_index i
           join pg_class c on c.oid = i.indrelid
           join pg_namespace n on n.oid = c.relnamespace
          where i.indisprimary and c.relname = $2 and n.nspname = $1
       ) pk on pk.attnum = a.attnum,
            (select c.oid from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where c.relname = $2 and n.nspname = $1) t
      where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
      order by a.attnum`,
    [table.schema, table.name]
  )

  // De-dup: the join above can repeat rows when multiple pk columns exist.
  const seen = new Set<string>()
  const cols: ColumnMeta[] = []
  for (const r of rows) {
    if (seen.has(r.name)) continue
    seen.add(r.name)
    cols.push({
      name: r.name,
      dataType: r.data_type,
      nullable: r.nullable,
      isPrimaryKey: r.is_pk
    })
  }
  return cols
}
