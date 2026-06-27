import type {
  CellValue,
  Change,
  ColumnMeta,
  QueryResult,
  RowKey,
} from "@shared/types";

// Staged edits for one loaded page. Rows are keyed by their index in the page.
export type Edits = Record<number, Record<string, CellValue>>;

// A staged new (uncommitted) row. A column is in one of three states:
//   - present in `values` with a string  → explicit value
//   - present in `values` with null       → explicit NULL
//   - absent from `values`                → unset: the DB applies its DEFAULT
// `tempId` is a renderer-local identity (negative-going counter) so React keys
// and focus/edit targets stay stable as rows are added/removed.
export interface NewRow {
  tempId: number;
  values: Record<string, CellValue>;
}

/** Is a new-row cell explicitly set (value or NULL), vs. unset/default? */
export function isCellSet(row: NewRow, colName: string): boolean {
  return colName in row.values;
}

/** Immutably set a new-row cell to an explicit value or NULL. */
export function setNewRowCell(
  rows: NewRow[],
  tempId: number,
  colName: string,
  value: CellValue,
): NewRow[] {
  return rows.map((r) =>
    r.tempId === tempId ? { ...r, values: { ...r.values, [colName]: value } } : r,
  );
}

/** Immutably clear a new-row cell back to unset (DB default). */
export function unsetNewRowCell(
  rows: NewRow[],
  tempId: number,
  colName: string,
): NewRow[] {
  return rows.map((r) => {
    if (r.tempId !== tempId) return r;
    const values = { ...r.values };
    delete values[colName];
    return { ...r, values };
  });
}

/** Columns the user MUST provide on insert: NOT NULL, no default, not generated. */
export function requiredColumns(columns: ColumnMeta[]): ColumnMeta[] {
  return columns.filter((c) => !c.nullable && !c.hasDefault && !c.isGenerated);
}

/** tempIds of new rows missing a required column (unset or explicit NULL). */
export function invalidNewRows(
  columns: ColumnMeta[],
  newRows: NewRow[],
): Set<number> {
  const required = requiredColumns(columns);
  const bad = new Set<number>();
  for (const row of newRows) {
    const missing = required.some(
      (c) => !(c.name in row.values) || row.values[c.name] === null,
    );
    if (missing) bad.add(row.tempId);
  }
  return bad;
}

/** Coerce one unique-key entry into a list of column names. The backend may
 *  send a parsed string[] or a raw Postgres array literal like "{id}". */
function toColumnNames(entry: unknown): string[] {
  if (Array.isArray(entry)) return entry as string[];
  if (typeof entry !== "string") return [];
  const inner = entry.replace(/^\{/, "").replace(/\}$/, "");
  return inner === "" ? [] : inner.split(",").map((s) => s.replace(/^"|"$/g, ""));
}

/** Resolve the displayed value of a cell: staged edit if any, else original. */
export function cellValue(
  edits: Edits,
  rowIndex: number,
  colName: string,
  original: CellValue,
): CellValue {
  const rowEdits = edits[rowIndex];
  if (rowEdits && colName in rowEdits) return rowEdits[colName];
  return original;
}

export function isDirty(
  edits: Edits,
  rowIndex: number,
  colName: string,
): boolean {
  return !!edits[rowIndex] && colName in edits[rowIndex];
}

/** Immutably set/clear a staged edit. Setting a value equal to the original
 *  clears the dirty mark instead of recording a no-op change. */
export function setEdit(
  edits: Edits,
  rowIndex: number,
  colName: string,
  original: CellValue,
  value: CellValue,
): Edits {
  const next: Edits = { ...edits };
  const rowEdits = { ...(next[rowIndex] ?? {}) };
  if (value === original) delete rowEdits[colName];
  else rowEdits[colName] = value;
  if (Object.keys(rowEdits).length > 0) next[rowIndex] = rowEdits;
  else delete next[rowIndex];
  return next;
}

/** Build the WHERE key for a row: primary key → a fully-non-null unique key →
 *  all columns. NULL columns disqualify a unique key (NULLs are distinct). */
export function buildRowKey(
  row: CellValue[],
  columns: ColumnMeta[],
  uniqueKeys: string[][],
): RowKey {
  const indexOf = new Map(columns.map((c, i) => [c.name, i]));
  const valueOf = (name: string): CellValue =>
    row[indexOf.get(name) ?? -1] ?? null;
  const keyFrom = (names: string[], identity: RowKey["identity"]): RowKey => ({
    where: Object.fromEntries(names.map((n) => [n, valueOf(n)])),
    identity,
  });

  const pk = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pk.length > 0) return keyFrom(pk, "primaryKey");

  const usable = uniqueKeys
    .map(toColumnNames)
    .find((cols) => cols.length > 0 && cols.every((n) => valueOf(n) !== null));
  if (usable) return keyFrom(usable, "unique");

  return keyFrom(
    columns.map((c) => c.name),
    "allColumns",
  );
}

/** Turn staged edits + insertions + deletions into the Change[] the backend
 *  commits. Inserts are emitted last so any DEFAULT/identity values settle
 *  before the page is reloaded. */
export function buildChanges(
  result: QueryResult,
  edits: Edits,
  deleted: Set<number>,
  newRows: NewRow[] = [],
): Change[] {
  if (!result.table) return [];
  const table = result.table;
  const uniqueKeys = result.uniqueKeys ?? [];
  const changes: Change[] = [];

  for (const [key, set] of Object.entries(edits)) {
    const rowIndex = Number(key);
    if (deleted.has(rowIndex)) continue; // deletion supersedes an edit
    if (Object.keys(set).length === 0) continue;
    changes.push({
      kind: "update",
      table,
      key: buildRowKey(result.rows[rowIndex], result.columns, uniqueKeys),
      set,
    });
  }

  for (const rowIndex of deleted) {
    changes.push({
      kind: "delete",
      table,
      key: buildRowKey(result.rows[rowIndex], result.columns, uniqueKeys),
    });
  }

  for (const row of newRows) {
    changes.push({ kind: "insert", table, values: row.values });
  }

  return changes;
}

export function countChanges(
  _result: QueryResult,
  edits: Edits,
  deleted: Set<number>,
  newRows: NewRow[] = [],
): { updates: number; inserts: number; deletes: number; total: number } {
  let updates = 0;
  for (const [key, set] of Object.entries(edits)) {
    if (!deleted.has(Number(key)) && Object.keys(set).length > 0) updates++;
  }
  return {
    updates,
    inserts: newRows.length,
    deletes: deleted.size,
    total: updates + newRows.length + deleted.size,
  };
}
