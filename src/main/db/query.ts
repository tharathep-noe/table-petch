import { randomUUID } from 'crypto';
import type { FieldDef, QueryResult as PgResult } from 'pg';
import { ensureConnected, getDatabase } from './manager';
import { getColumns } from './introspect';
import * as history from '../historyStore';
import type {
  ColumnMeta,
  LoadRowsRequest,
  QueryResult,
  TableRef,
} from '@shared/types';

const ident = (s: string): string => '"' + s.replace(/"/g, '""') + '"';
const qualified = (t: TableRef): string =>
  `${ident(t.schema)}.${ident(t.name)}`;

/** Paged read of a single table — the table browser's read path. */
export async function loadRows(req: LoadRowsRequest): Promise<QueryResult> {
  const pool = await ensureConnected(req.connectionId);
  const { columns, uniqueKeys } = await getColumns(req.connectionId, req.table);

  const order = req.orderBy
    ? ` order by ${ident(req.orderBy.column)} ${req.orderBy.desc ? 'desc' : 'asc'}`
    : '';
  const sql = `select * from ${qualified(req.table)}${order} limit $1 offset $2`;
  const res = await pool.query({
    text: sql,
    rowMode: 'array',
    values: [req.limit, req.offset],
  });

  return {
    columns,
    rows: res.rows as Array<Array<string | null>>,
    rowCount: res.rowCount ?? res.rows.length,
    editable: true,
    table: req.table,
    uniqueKeys,
  };
}

const READ_COMMANDS = new Set(['SELECT', 'EXPLAIN', 'SHOW']);

/** The most significant command tag of a (possibly multi-statement) result: a
 *  write wins over a read, so history classifies a mixed script as a write. */
function significantCommand(results: PgResult[]): string | null {
  const commands = results.map((r) => r.command).filter(Boolean);
  if (commands.length === 0) return null;
  return commands.find((c) => !READ_COMMANDS.has(c)) ?? commands[0];
}

/** Arbitrary SQL from the editor. Results are editable only for simple
 *  single-table selects (detected heuristically; refined later).
 *
 *  Every run is logged to the per-connection query history here — the single
 *  main-side chokepoint where the pg command tag and timing are in hand, so the
 *  renderer never logs and can't bypass it. Failures are logged too, then
 *  rethrown unchanged. */
export async function runQuery(
  connectionId: string,
  sql: string,
): Promise<QueryResult> {
  const pool = await ensureConnected(connectionId);
  const started = Date.now();

  try {
    const res = await pool.query({ text: sql, rowMode: 'array' });
    // node-postgres returns an array of results for a multi-statement script.
    const results = (Array.isArray(res) ? res : [res]) as PgResult[];
    const last = results[results.length - 1];

    history.append({
      id: randomUUID(),
      source: 'query',
      connectionId,
      database: getDatabase(connectionId),
      sql,
      command: significantCommand(results),
      executedAt: started,
      ok: true,
      rowCount: last.rowCount ?? last.rows.length,
      durationMs: Date.now() - started,
      error: null,
    });

    const columns: ColumnMeta[] = (last.fields ?? []).map((f: FieldDef) => ({
      name: f.name,
      dataType: String(f.dataTypeID),
      nullable: true,
      isPrimaryKey: false,
      hasDefault: false,
      isGenerated: false,
    }));

    return {
      columns,
      rows: (last.rows as Array<Array<string | null>>) ?? [],
      rowCount: last.rowCount ?? 0,
      editable: false, // TODO: detect single-table SELECT and enrich with getColumns
    };
  } catch (e) {
    history.append({
      id: randomUUID(),
      source: 'query',
      connectionId,
      database: getDatabase(connectionId),
      sql,
      command: null,
      executedAt: started,
      ok: false,
      rowCount: null,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
