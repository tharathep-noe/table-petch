import { ensureConnected, getSession } from './manager';
import { prepareChange } from './sql';
import type { Change, CommitResult, PreparedStatement } from '@shared/types';

/** Build the parameterized statements for a preview, using the connection's
 *  dialect. No DB round-trip. */
export function prepareChanges(
  connectionId: string,
  changes: Change[],
): PreparedStatement[] {
  const { driver } = getSession(connectionId);
  return changes.map((c) => prepareChange(driver.dialect, c));
}

/** Apply all staged changes in a single transaction (all-or-nothing). */
export async function commitChanges(
  connectionId: string,
  changes: Change[],
): Promise<CommitResult> {
  const { driver, conn } = await ensureConnected(connectionId);
  let applied = 0;
  try {
    await conn.transaction(async (tx) => {
      for (const change of changes) {
        const stmt = prepareChange(driver.dialect, change);
        const res = await tx.query(stmt.sql, stmt.params);
        // Optimistic concurrency: an update/delete that hits nothing means the
        // row changed or vanished underneath us — abort rather than silently no-op.
        if (change.kind !== 'insert' && (res.rowCount ?? 0) === 0) {
          throw new Error(
            `A ${change.kind} on ${change.table.schema}.${change.table.name} matched no rows ` +
              `— the row was modified or removed by someone else. Refresh and retry.`,
          );
        }
        applied += res.rowCount ?? 0;
      }
    });
    return { ok: true, applied };
  } catch (err) {
    return {
      ok: false,
      applied: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
