import { app } from 'electron';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { SavedQuery, SavedQueryInput } from '@shared/types';

// The curated, global saved-query library lives in savedQueries.json under
// userData — the same fail-safe JSON pattern as connections.json. Kept separate
// from query history: explicit user action, not an automatic append.

interface Persisted {
  version: 1;
  queries: SavedQuery[];
}

const file = (): string => join(app.getPath('userData'), 'savedQueries.json');

/** Read the library. Fails safe to empty on a missing, unparseable, or
 *  unrecognized-version file (forward-only; we read version 1). */
function load(): Persisted {
  const path = file();
  if (!existsSync(path)) return { version: 1, queries: [] };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Persisted;
    if (data?.version !== 1 || !Array.isArray(data.queries))
      return { version: 1, queries: [] };
    return data;
  } catch {
    return { version: 1, queries: [] };
  }
}

function save(data: Persisted): void {
  const path = file();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

export function list(): SavedQuery[] {
  return load().queries;
}

/** Upsert: create when `id` is absent (same pattern as saveConnection), else
 *  update the existing query's name/sql/tag and bump updatedAt. */
export function saveQuery(input: SavedQueryInput): SavedQuery {
  const data = load();
  const now = Date.now();
  const idx = input.id ? data.queries.findIndex((q) => q.id === input.id) : -1;

  if (idx >= 0) {
    const updated: SavedQuery = {
      ...data.queries[idx],
      name: input.name,
      sql: input.sql,
      connectionId: input.connectionId,
      updatedAt: now,
    };
    data.queries[idx] = updated;
    save(data);
    return updated;
  }

  const created: SavedQuery = {
    id: input.id ?? randomUUID(),
    name: input.name,
    sql: input.sql,
    connectionId: input.connectionId,
    createdAt: now,
    updatedAt: now,
  };
  data.queries.push(created);
  save(data);
  return created;
}

export function deleteQuery(id: string): void {
  const data = load();
  data.queries = data.queries.filter((q) => q.id !== id);
  save(data);
}
