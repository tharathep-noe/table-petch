import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { HistoryEntry } from '@shared/types';

// The automatic, per-connection run log lives in queryHistory.json under
// userData, the same fail-safe JSON pattern as session.json / connections.json.
// Entries are stored newest-first; the file is read and written whole.

const CAP = 500;

interface Persisted {
  version: 1;
  entries: HistoryEntry[];
}

const file = (): string => join(app.getPath('userData'), 'queryHistory.json');

/** Read the whole log. Fails safe to empty on a missing, unparseable, or
 *  unrecognized-version file (forward-only; we read version 1). */
function load(): Persisted {
  const path = file();
  if (!existsSync(path)) return { version: 1, entries: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Persisted;
    if (data?.version !== 1 || !Array.isArray(data.entries))
      return { version: 1, entries: [] };
    return data;
  } catch {
    return { version: 1, entries: [] };
  }
}

function save(data: Persisted): void {
  const path = file();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

const READ_COMMANDS = new Set(['SELECT', 'EXPLAIN', 'SHOW']);

/** A pure read (or a failure, whose command is null) may collapse with an
 *  identical predecessor; a write is always recorded separately. */
function isCollapsible(command: string | null): boolean {
  return command === null || READ_COMMANDS.has(command);
}

/** Append an execution to the log. Consecutive identical reads/failures (same
 *  sql + connection + database) fold into the existing newest entry instead of
 *  adding a row; writes never collapse. Caps at the newest CAP entries. */
export function append(entry: HistoryEntry): void {
  const data = load();
  const top = data.entries[0];
  const collapses =
    top &&
    isCollapsible(entry.command) &&
    isCollapsible(top.command) &&
    top.sql === entry.sql &&
    top.connectionId === entry.connectionId &&
    top.database === entry.database;

  if (collapses) {
    // Refresh the existing entry's outcome to the latest run; keep its id.
    data.entries[0] = { ...entry, id: top.id };
  } else {
    data.entries.unshift(entry);
    if (data.entries.length > CAP) data.entries.length = CAP;
  }
  save(data);
}

/** This connection's entries, newest-first. */
export function list(connectionId: string): HistoryEntry[] {
  return load().entries.filter((e) => e.connectionId === connectionId);
}

export function clear(connectionId: string): void {
  const data = load();
  data.entries = data.entries.filter((e) => e.connectionId !== connectionId);
  save(data);
}

export function clearAll(): void {
  save({ version: 1, entries: [] });
}
