import type { ConnectionConfig, ConnectionInput } from '@shared/types';
import { getConnection, getPassword } from '../store';
import { getDriver } from './registry';
import type { Driver, EngineConnection } from './driver';

// One open session per active connection id. A session pairs the engine's
// Driver with its live EngineConnection and the catalog it's pointed at.
// Switching catalog re-opens the connection.
interface Session {
  driver: Driver;
  conn: EngineConnection;
  catalog: string;
}

const sessions = new Map<string, Session>();

// Remember which catalog each connection is on, so we can transparently
// re-establish a connection that was lost (e.g. main-process restart in dev).
const lastCatalog = new Map<string, string>();

export async function connect(
  connectionId: string,
  catalog?: string,
): Promise<void> {
  const cfg = getConnection(connectionId);
  if (!cfg) throw new Error(`Unknown connection: ${connectionId}`);
  await disconnect(connectionId);

  const driver = await getDriver(cfg.engine);
  // The driver supplies its own default catalog from the config when none is
  // given (engines differ: pg/mysql/mssql have a `database`, Oracle a service).
  const target = catalog ?? lastCatalog.get(connectionId);
  const conn = await driver.connect(cfg, getPassword(connectionId), target);
  const current = await driver.currentCatalog(conn);

  sessions.set(connectionId, { driver, conn, catalog: current });
  lastCatalog.set(connectionId, current);
}

/** Return the session, transparently reconnecting if it was dropped. */
export async function ensureConnected(connectionId: string): Promise<Session> {
  if (!sessions.has(connectionId)) {
    await connect(connectionId, lastCatalog.get(connectionId));
  }
  return getSession(connectionId);
}

export async function disconnect(connectionId: string): Promise<void> {
  const session = sessions.get(connectionId);
  if (session) {
    sessions.delete(connectionId);
    await session.conn.close();
  }
}

/** The catalog a connection is currently on (for history entries). */
export function getDatabase(connectionId: string): string {
  return lastCatalog.get(connectionId) ?? '';
}

export function getSession(connectionId: string): Session {
  const session = sessions.get(connectionId);
  if (!session) throw new Error('Not connected. Open the connection first.');
  return session;
}

export async function testConnection(
  input: ConnectionInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const driver = await getDriver(input.engine);
    // ConnectionInput is a config minus the persisted id.
    const conn = await driver.connect(
      { ...input, id: '' } as ConnectionConfig,
      input.password,
    );
    await conn.close();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
