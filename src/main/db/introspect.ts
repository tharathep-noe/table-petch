import { ensureConnected, getSession } from './manager';
import type { SchemaInfo } from '@shared/types';

// Shared introspection orchestration. The engine-specific catalog queries live
// in each Driver; this just assembles the SchemaInfo and routes routine-source
// fetches to the active connection's driver.

export async function listSchema(connectionId: string): Promise<SchemaInfo> {
  const { driver, conn, catalog } = await ensureConnected(connectionId);
  const [catalogs, schemas] = await Promise.all([
    driver.capabilities.listsCatalogs
      ? driver.listCatalogs(conn)
      : Promise.resolve([catalog]),
    driver.introspectObjects(conn),
  ]);
  return { database: catalog, databases: catalogs, schemas };
}

/** The source definition of a routine, by its opaque handle. Read-only. */
export async function getRoutineSource(
  connectionId: string,
  handle: string,
): Promise<string> {
  const { driver, conn } = getSession(connectionId);
  return driver.getRoutineSource(conn, handle);
}
