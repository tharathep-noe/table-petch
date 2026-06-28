// Shared CRUD SQL builders (ADR 0006). One implementation for all engines; the
// only per-engine differences come from the Dialect (quoting, placeholders,
// pagination). A driver overrides a whole builder only when a dialect genuinely
// can't be parameterized.

import type {
  Change,
  PreparedStatement,
  RowKey,
  TableRef,
} from '@shared/types';
import type { Dialect } from './driver';

const NO_UNIQUE_WARNING =
  'No primary key or unique constraint — this WHERE matches on all column ' +
  'values and may affect more than one row.';

/** schema.name (optionally catalog.schema.name), each part quoted. */
function qualified(dialect: Dialect, t: TableRef): string {
  const parts = t.catalog ? [t.catalog, t.schema, t.name] : [t.schema, t.name];
  return parts.map((p) => dialect.quoteIdent(p)).join('.');
}

/** Paged read of one table. limit/offset are app integers, inlined by the dialect. */
export function buildLoadRows(
  dialect: Dialect,
  table: TableRef,
  orderBy: { column: string; desc: boolean } | undefined,
  limit: number,
  offset: number,
): string {
  const order = orderBy
    ? ` order by ${dialect.quoteIdent(orderBy.column)} ${orderBy.desc ? 'desc' : 'asc'}`
    : '';
  const base = `select * from ${qualified(dialect, table)}${order}`;
  return dialect.paginate(base, limit, offset);
}

/** Build a WHERE for a row, appending params. Returns the SQL fragment. */
function whereFor(
  dialect: Dialect,
  key: RowKey,
  params: (string | null)[],
): string {
  const parts: string[] = [];
  for (const [col, val] of Object.entries(key.where)) {
    if (val === null) {
      parts.push(`${dialect.quoteIdent(col)} is null`);
    } else {
      params.push(val);
      parts.push(
        `${dialect.quoteIdent(col)} = ${dialect.placeholder(params.length)}`,
      );
    }
  }
  return parts.join(' and ');
}

/** Turn one staged change into a parameterized statement. */
export function prepareChange(
  dialect: Dialect,
  change: Change,
): PreparedStatement {
  const params: (string | null)[] = [];
  const table = qualified(dialect, change.table);

  if (change.kind === 'insert') {
    const cols = Object.keys(change.values);
    const placeholders = cols.map((c) => {
      params.push(change.values[c]);
      return dialect.placeholder(params.length);
    });
    const sql =
      `insert into ${table} ` +
      `(${cols.map((c) => dialect.quoteIdent(c)).join(', ')}) ` +
      `values (${placeholders.join(', ')})`;
    return { sql, params };
  }

  if (change.kind === 'update') {
    const setCols = Object.keys(change.set);
    const sets = setCols.map((c) => {
      params.push(change.set[c]);
      return `${dialect.quoteIdent(c)} = ${dialect.placeholder(params.length)}`;
    });
    const where = whereFor(dialect, change.key, params);
    const sql = `update ${table} set ${sets.join(', ')} where ${where}`;
    return {
      sql,
      params,
      warning:
        change.key.identity === 'allColumns' ? NO_UNIQUE_WARNING : undefined,
    };
  }

  // delete
  const where = whereFor(dialect, change.key, params);
  const sql = `delete from ${table} where ${where}`;
  return {
    sql,
    params,
    warning:
      change.key.identity === 'allColumns' ? NO_UNIQUE_WARNING : undefined,
  };
}
