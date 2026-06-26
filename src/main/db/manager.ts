import pg from 'pg'
import type { ConnectionInput } from '@shared/types'
import { getConnection, getPassword } from '../store'

// One pool per active connection id. Switching database swaps the pool.
// Every value is returned as its Postgres text form (see `types` below) so the
// renderer never deals with JS coercion; NULL stays null, everything else text.
const pools = new Map<string, pg.Pool>()

function poolConfig(input: {
  host: string
  port: number
  database: string
  user: string
  ssl?: boolean
  password?: string
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
    types: { getTypeParser: () => (v: string) => v } as unknown as pg.CustomTypesConfig
  }
}

// Remember which database each connection is on, so we can transparently
// re-establish a pool that was lost (e.g. main-process restart during dev).
const lastDatabase = new Map<string, string>()

export async function connect(connectionId: string, database?: string): Promise<void> {
  const cfg = getConnection(connectionId)
  if (!cfg) throw new Error(`Unknown connection: ${connectionId}`)
  await disconnect(connectionId)
  const db = database ?? cfg.database
  const pool = new pg.Pool(
    poolConfig({
      host: cfg.host,
      port: cfg.port,
      database: db,
      user: cfg.user,
      ssl: cfg.ssl,
      password: getPassword(connectionId)
    })
  )
  // Fail fast so the UI can report a bad connection immediately.
  const client = await pool.connect()
  client.release()
  pools.set(connectionId, pool)
  lastDatabase.set(connectionId, db)
}

/** Return the pool, transparently reconnecting if it was dropped. */
export async function ensureConnected(connectionId: string): Promise<pg.Pool> {
  if (!pools.has(connectionId)) {
    await connect(connectionId, lastDatabase.get(connectionId))
  }
  return getPool(connectionId)
}

export async function disconnect(connectionId: string): Promise<void> {
  const pool = pools.get(connectionId)
  if (pool) {
    pools.delete(connectionId)
    await pool.end()
  }
}

export function getPool(connectionId: string): pg.Pool {
  const pool = pools.get(connectionId)
  if (!pool) throw new Error('Not connected. Open the connection first.')
  return pool
}

export async function testConnection(
  input: ConnectionInput
): Promise<{ ok: boolean; error?: string }> {
  const pool = new pg.Pool(poolConfig(input))
  try {
    const client = await pool.connect()
    client.release()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    await pool.end()
  }
}
