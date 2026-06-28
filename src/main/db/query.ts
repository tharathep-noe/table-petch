import { randomUUID } from 'crypto';
import { ensureConnected, getDatabase } from './manager';
import { buildLoadRows } from './sql';
import * as history from '../historyStore';
import type { ColumnMeta, LoadRowsRequest, QueryResult } from '@shared/types';
import type { RawResult } from './driver';

/** Paged read of a single table — the table browser's read path. */
export async function loadRows(req: LoadRowsRequest): Promise<QueryResult> {
  const { driver, conn } = await ensureConnected(req.connectionId);
  const { columns, uniqueKeys } = await driver.getColumns(conn, req.table);

  const sql = buildLoadRows(
    driver.dialect,
    req.table,
    req.orderBy,
    req.limit,
    req.offset,
  );
  const res = await conn.query(sql);

  return {
    columns,
    rows: res.rows,
    rowCount: res.rowCount ?? res.rows.length,
    editable: true,
    table: req.table,
    uniqueKeys,
  };
}

const READ_COMMANDS = new Set(['SELECT', 'EXPLAIN', 'SHOW']);

/** The most significant command tag of a (possibly multi-statement) result: a
 *  write wins over a read, so history classifies a mixed script as a write. */
function significantCommand(results: RawResult[]): string | null {
  const commands = results
    .map((r) => r.command)
    .filter((c): c is string => Boolean(c));
  if (commands.length === 0) return null;
  return commands.find((c) => !READ_COMMANDS.has(c)) ?? commands[0];
}

/** Arbitrary SQL from the editor. Results are editable only for simple
 *  single-table selects (detected heuristically; refined later).
 *
 *  Every run is logged to the per-connection query history here — the single
 *  main-side chokepoint where the command tag and timing are in hand, so the
 *  renderer never logs and can't bypass it. Failures are logged too, then
 *  rethrown unchanged. */
export async function runQuery(
  connectionId: string,
  sql: string,
): Promise<QueryResult> {
  const { conn } = await ensureConnected(connectionId);
  const started = Date.now();

  try {
    const results = await conn.queryScript(sql);
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

    const columns: ColumnMeta[] = last.fields.map((f) => ({
      name: f.name,
      dataType: '',
      category: 'other',
      textRoundTripSafe: true,
      nullable: true,
      isPrimaryKey: false,
      hasDefault: false,
      isGenerated: false,
    }));

    return {
      columns,
      rows: last.rows,
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
