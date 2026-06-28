import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CellValue,
  Change,
  ColumnMeta,
  PreparedStatement,
  QueryResult,
} from '@shared/types';
import {
  buildChanges,
  countChanges,
  type Edits,
  invalidNewRows,
  type NewRow,
  requiredColumns,
  setEdit,
  setNewRowCell,
  unsetNewRowCell,
} from './editState';

/** A cell address. For existing rows `row` is the page index; for new rows it is
 *  the negative `tempId` and `isNew` is set. Shared by the grid and the pane. */
export interface CellPos {
  row: number;
  col: string;
  isNew?: boolean;
}

export interface PendingWarning {
  changes: Change[];
  statements: PreparedStatement[];
}

/** The one staged-edit state machine for a single loaded page, lifted out of the
 *  grid (ADR 0009) so the grid and the row detail pane are two surfaces over one
 *  change set, committed together. Owns selection too, since the pane's active
 *  row is the selection anchor. Grid-only chrome (context menu, copy toast, drag
 *  refs, the transient cell editor) stays in the components.
 *
 *  The state resets whenever `result` changes identity — table switch, sort,
 *  post-commit reload, tab switch (a different tab's result), and also a filter
 *  keystroke (a fresh `visibleResult`). That last one discards staged edits, as
 *  it did before this refactor: edits are page-index-keyed, and the filtered rows
 *  are a different index space, so resetting is the safe choice until edits are
 *  re-keyed by row identity. Feed this hook the SAME result the grid renders so
 *  indices always line up. */
export function useTableEditing(
  result: QueryResult,
  connectionId: string | null,
  onReload: () => void,
  /** Fired when the user picks a row by click/drag (not on programmatic selects),
   *  so the caller can reveal the row detail pane. Tied to the gesture, not to the
   *  active-row state, so closing the pane doesn't immediately reopen it. */
  onSelect?: () => void,
): {
  edits: Edits;
  deleted: Set<number>;
  newRows: NewRow[];
  selected: Set<number>;
  /** The selection anchor — the row the detail pane reflects. */
  activeRowIndex: number | null;
  focused: CellPos | null;
  setFocused: (pos: CellPos | null) => void;
  counts: ReturnType<typeof countChanges>;
  invalidRows: Set<number>;
  requiredNames: Set<string>;
  colMeta: Map<string, ColumnMeta>;
  committing: boolean;
  commitError: string | null;
  setCommitError: (msg: string | null) => void;
  warning: PendingWarning | null;
  setWarning: (w: PendingWarning | null) => void;
  setCellEdit: (rowIndex: number, col: string, value: CellValue) => void;
  setNewRowValue: (tempId: number, col: string, value: CellValue) => void;
  unsetNewRowValue: (tempId: number, col: string) => void;
  addRow: () => void;
  removeNewRow: (tempId: number) => void;
  toggleDelete: (rows: Iterable<number>) => void;
  setNull: (pos: CellPos) => void;
  setDefault: (pos: CellPos) => void;
  selectRow: (rowIndex: number, e: React.MouseEvent) => void;
  selectRange: (a: number, b: number) => void;
  setSelected: (rows: Set<number>) => void;
  discard: () => void;
  commit: () => void;
  doCommit: (changes: Change[]) => Promise<void>;
} {
  const [edits, setEdits] = useState<Edits>({});
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [selected, setSelectedState] = useState<Set<number>>(new Set());
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [focused, setFocused] = useState<CellPos | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [warning, setWarning] = useState<PendingWarning | null>(null);
  const anchorRef = useRef<number | null>(null);
  const tempIdRef = useRef(-1);
  const commitRef = useRef<() => void>(() => {});

  const colMeta = useMemo(
    () => new Map(result.columns.map((c) => [c.name, c])),
    [result.columns],
  );
  const requiredNames = useMemo(
    () => new Set(requiredColumns(result.columns).map((c) => c.name)),
    [result.columns],
  );
  const counts = countChanges(result, edits, deleted, newRows);
  const invalidRows = useMemo(
    () => invalidNewRows(result.columns, newRows),
    [result.columns, newRows],
  );
  const colIndex = (name: string): number =>
    result.columns.findIndex((c) => c.name === name);

  // New page (table switch, sort, post-commit reload, tab switch, filter change)
  // → drop all staged state. See the header note on why filtering resets too.
  useEffect(() => {
    setEdits({});
    setDeleted(new Set());
    setNewRows([]);
    setSelectedState(new Set());
    setActiveRowIndex(null);
    anchorRef.current = null;
    setFocused(null);
    setCommitError(null);
    setWarning(null);
  }, [result]);

  // Global Cmd/Ctrl+S commits, regardless of which surface holds focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        commitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function setCellEdit(rowIndex: number, col: string, value: CellValue): void {
    const original = result.rows[rowIndex][colIndex(col)];
    setEdits((e) => setEdit(e, rowIndex, col, original, value));
  }

  function setNewRowValue(tempId: number, col: string, value: CellValue): void {
    setNewRows((rows) => setNewRowCell(rows, tempId, col, value));
  }

  function unsetNewRowValue(tempId: number, col: string): void {
    setNewRows((rows) => unsetNewRowCell(rows, tempId, col));
  }

  function addRow(): void {
    const tempId = tempIdRef.current--;
    setNewRows((rows) => [...rows, { tempId, values: {} }]);
  }

  function removeNewRow(tempId: number): void {
    setNewRows((rows) => rows.filter((r) => r.tempId !== tempId));
  }

  function toggleDelete(rows: Iterable<number>): void {
    setDeleted((d) => {
      const next = new Set(d);
      for (const r of rows) next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  }

  function setNull(pos: CellPos): void {
    if (!colMeta.get(pos.col)?.nullable) return;
    if (pos.isNew) setNewRowValue(pos.row, pos.col, null);
    else setCellEdit(pos.row, pos.col, null);
  }

  function setDefault(pos: CellPos): void {
    unsetNewRowValue(pos.row, pos.col);
  }

  function selectRow(rowIndex: number, e: React.MouseEvent): void {
    const next = new Set(selected);
    if (e.shiftKey && anchorRef.current !== null) {
      const [a, b] = [anchorRef.current, rowIndex].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) next.add(i);
    } else if (e.metaKey || e.ctrlKey) {
      next.has(rowIndex) ? next.delete(rowIndex) : next.add(rowIndex);
      anchorRef.current = rowIndex;
    } else {
      next.clear();
      next.add(rowIndex);
      anchorRef.current = rowIndex;
    }
    setSelectedState(next);
    // The pane tracks the just-clicked row, even when extending a range.
    setActiveRowIndex(rowIndex);
    onSelect?.();
  }

  function selectRange(a: number, b: number): void {
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    const next = new Set<number>();
    for (let i = lo; i <= hi; i++) next.add(i);
    anchorRef.current = a;
    setSelectedState(next);
    setActiveRowIndex(b);
    onSelect?.();
  }

  function setSelected(rows: Set<number>): void {
    setSelectedState(rows);
    if (rows.size === 1) setActiveRowIndex([...rows][0]);
  }

  function discard(): void {
    setEdits({});
    setDeleted(new Set());
    setNewRows([]);
    setCommitError(null);
    setSelectedState(new Set());
    setActiveRowIndex(null);
  }

  async function doCommit(changes: Change[]): Promise<void> {
    if (!connectionId) return;
    setCommitting(true);
    setCommitError(null);
    setWarning(null);
    try {
      const res = await window.api.commitChanges(connectionId, changes);
      if (res.ok) onReload();
      else setCommitError(res.error ?? 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }

  async function commit(): Promise<void> {
    if (!connectionId) return;
    const changes = buildChanges(result, edits, deleted, newRows);
    if (changes.length === 0) return;
    if (invalidRows.size > 0) {
      setCommitError(
        `${invalidRows.size} new row${invalidRows.size !== 1 ? 's are' : ' is'} ` +
          `missing a required value.`,
      );
      return;
    }
    const hasWarn = changes.some(
      (c) => 'key' in c && c.key.identity === 'allColumns',
    );
    if (hasWarn) {
      const statements = await window.api.prepareChanges(connectionId, changes);
      setWarning({ changes, statements });
    } else {
      await doCommit(changes);
    }
  }
  commitRef.current = commit;

  return {
    edits,
    deleted,
    newRows,
    selected,
    activeRowIndex,
    focused,
    setFocused,
    counts,
    invalidRows,
    requiredNames,
    colMeta,
    committing,
    commitError,
    setCommitError,
    warning,
    setWarning,
    setCellEdit,
    setNewRowValue,
    unsetNewRowValue,
    addRow,
    removeNewRow,
    toggleDelete,
    setNull,
    setDefault,
    selectRow,
    selectRange,
    setSelected,
    discard,
    commit,
    doCommit,
  };
}

export type TableEditing = ReturnType<typeof useTableEditing>;
