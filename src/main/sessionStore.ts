import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { PersistedSession } from '@shared/types';

// The restorable workspace (open tabs + active tab + active connection) lives in
// session.json under userData, the same pattern as connections.json. Only the
// inputs needed to reconstruct a view are stored — never fetched rows.

const file = (): string => join(app.getPath('userData'), 'session.json');

/** Read the saved session. Fails safe to null (→ a fresh session) on a missing,
 *  unparseable, or unrecognized-version file. Forward-only: we read version 1. */
export function loadSession(): PersistedSession | null {
  const path = file();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as PersistedSession;
    if (data?.version !== 1 || !Array.isArray(data.tabs)) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveSession(session: PersistedSession): void {
  const path = file();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf8');
}
