import { app, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { ConnectionConfig, ConnectionInput, Engine } from '@shared/types';
import * as history from './historyStore';

// Connection metadata lives in a JSON file under userData.
// Passwords are encrypted with the OS keychain (safeStorage) and kept in a
// separate file so the config can be inspected/shared without leaking secrets.

interface Persisted {
  connections: ConnectionConfig[];
  // id -> base64 of safeStorage-encrypted password
  secrets: Record<string, string>;
}

const file = () => join(app.getPath('userData'), 'connections.json');

function load(): Persisted {
  const path = file();
  if (!existsSync(path)) return { connections: [], secrets: {} };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Persisted;
    // Lazy migration (ADR 0006): records predating multi-engine have no engine
    // field — coerce them to postgres (the only engine that existed), per record
    // so one bad record can't wipe the rest. Rewritten on next save. Typed loose
    // because the discriminant defeats narrowing on data that may lack it.
    for (const c of data.connections as Array<{ engine?: Engine }>) {
      if (!c.engine) c.engine = 'postgres';
    }
    return data;
  } catch {
    return { connections: [], secrets: {} };
  }
}

function save(data: Persisted): void {
  const path = file();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export function listConnections(): ConnectionConfig[] {
  return load().connections;
}

export function saveConnection(input: ConnectionInput): ConnectionConfig {
  const data = load();
  const id = input.id ?? randomUUID();
  // Persist the engine-specific variant as-is, minus the write-only password.
  const config = { ...input, id } as ConnectionConfig;
  delete (config as { password?: string }).password;

  const idx = data.connections.findIndex((c) => c.id === id);
  if (idx >= 0) data.connections[idx] = config;
  else data.connections.push(config);

  if (input.password !== undefined && input.password !== '') {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'OS secure storage is unavailable; cannot store password safely.',
      );
    }
    data.secrets[id] = safeStorage
      .encryptString(input.password)
      .toString('base64');
  }

  save(data);
  return config;
}

export function deleteConnection(id: string): void {
  const data = load();
  data.connections = data.connections.filter((c) => c.id !== id);
  delete data.secrets[id];
  save(data);
  // Don't leave privacy-sensitive history behind for a connection that's gone.
  history.clear(id);
}

export function getPassword(id: string): string | undefined {
  const enc = load().secrets[id];
  if (!enc) return undefined;
  return safeStorage.decryptString(Buffer.from(enc, 'base64'));
}

export function getConnection(id: string): ConnectionConfig | undefined {
  return load().connections.find((c) => c.id === id);
}
