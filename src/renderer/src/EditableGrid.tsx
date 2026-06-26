import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  CellValue,
  Change,
  ColumnMeta,
  PreparedStatement,
  QueryResult,
} from "@shared/types";
import {
  buildChanges,
  cellValue,
  countChanges,
  type Edits,
  isDirty,
  setEdit,
} from "./editState";

interface Props {
  connectionId: string;
  result: QueryResult;
  onReload: () => void;
}

type Row = CellValue[];
interface CellPos {
  row: number;
  col: string;
}
interface CellMenu extends CellPos {
  x: number;
  y: number;
}

function buildColumnDefs(columns: ColumnMeta[]): ColumnDef<Row>[] {
  return columns.map((c, ci) => ({
    id: c.name,
    accessorFn: (row) => row[ci],
    header: c.name,
  }));
}

const cellCls =
  "border border-border px-2 py-1 text-left whitespace-nowrap max-w-[360px] overflow-hidden text-ellipsis [font-variant-numeric:tabular-nums]";

export function EditableGrid({
  connectionId,
  result,
  onReload,
}: Props): JSX.Element {
  const editable = result.editable && !!result.table;
  const columns = useMemo(
    () => buildColumnDefs(result.columns),
    [result.columns],
  );
  const table = useReactTable({
    data: result.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (_r, i) => String(i),
  });
  const colMeta = useMemo(
    () => new Map(result.columns.map((c) => [c.name, c])),
    [result.columns],
  );

  const [edits, setEdits] = useState<Edits>({});
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focused, setFocused] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<CellPos | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<CellMenu | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [warning, setWarning] = useState<{
    changes: Change[];
    statements: PreparedStatement[];
  } | null>(null);
  const anchorRef = useRef<number | null>(null);

  // New page loaded (table switch or post-commit reload) → drop staged state.
  useEffect(() => {
    setEdits({});
    setDeleted(new Set());
    setSelected(new Set());
    setFocused(null);
    setEditing(null);
    setCommitError(null);
  }, [result]);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const counts = countChanges(result, edits, deleted);
  const colIndex = (name: string): number =>
    result.columns.findIndex((c) => c.name === name);

  function startEdit(pos: CellPos): void {
    if (!editable) return;
    const original = result.rows[pos.row][colIndex(pos.col)];
    setEditing(pos);
    setDraft(original === null ? "" : String(original));
  }

  function commitEdit(value: CellValue): void {
    if (!editing) return;
    const original = result.rows[editing.row][colIndex(editing.col)];
    setEdits((e) => setEdit(e, editing.row, editing.col, original, value));
    setEditing(null);
  }

  function setNull(pos: CellPos): void {
    const meta = colMeta.get(pos.col);
    if (!meta?.nullable) return;
    const original = result.rows[pos.row][colIndex(pos.col)];
    setEdits((e) => setEdit(e, pos.row, pos.col, original, null));
    setMenu(null);
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
    setSelected(next);
  }

  function toggleDelete(rows: Iterable<number>): void {
    setDeleted((d) => {
      const next = new Set(d);
      for (const r of rows) next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  }

  function discard(): void {
    setEdits({});
    setDeleted(new Set());
    setCommitError(null);
  }

  async function doCommit(changes: Change[]): Promise<void> {
    setCommitting(true);
    setCommitError(null);
    setWarning(null);
    try {
      const res = await window.api.commitChanges(connectionId, changes);
      if (res.ok) onReload();
      else setCommitError(res.error ?? "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  async function commit(): Promise<void> {
    const changes = buildChanges(result, edits, deleted);
    if (changes.length === 0) return;
    const hasWarn = changes.some(
      (c) => "key" in c && c.key.identity === "allColumns",
    );
    if (hasWarn) {
      const statements = await window.api.prepareChanges(connectionId, changes);
      setWarning({ changes, statements });
    } else {
      await doCommit(changes);
    }
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (editing) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      commit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Backspace" && focused) {
      e.preventDefault();
      setNull(focused);
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      selected.size > 0
    ) {
      e.preventDefault();
      toggleDelete(selected);
    } else if (e.key === "Enter" && focused) {
      e.preventDefault();
      startEdit(focused);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <table className="border-collapse w-full">
          <thead>
            <tr>
              <th
                className={`${cellCls} bg-panel sticky top-0 left-0 z-10 w-10 text-muted`}
              >
                #
              </th>
              {table.getFlatHeaders().map((h) => {
                const meta = colMeta.get(h.column.id);
                return (
                  <th
                    key={h.id}
                    title={meta?.dataType}
                    className={`${cellCls} bg-panel sticky top-0`}
                  >
                    {meta?.isPrimaryKey ? "🔑 " : ""}
                    {h.column.id}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const ri = Number(row.id);
              const isDel = deleted.has(ri);
              const isSel = selected.has(ri);
              return (
                <tr key={row.id} className={isDel ? "opacity-60" : ""}>
                  <td
                    className={`${cellCls} text-muted cursor-pointer select-none ${
                      isSel ? "bg-accent/30" : "bg-panel"
                    }`}
                    onClick={(e) => selectRow(ri, e)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (!selected.has(ri)) setSelected(new Set([ri]));
                      setMenu({ x: e.clientX, y: e.clientY, row: ri, col: "" });
                    }}
                  >
                    {ri + 1}
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const colName = cell.column.id;
                    const original = cell.getValue() as CellValue;
                    const val = cellValue(edits, ri, colName, original);
                    const dirty = isDirty(edits, ri, colName);
                    const isEditing =
                      editing?.row === ri && editing?.col === colName;
                    const isFocused =
                      focused?.row === ri && focused?.col === colName;
                    return (
                      <td
                        key={cell.id}
                        className={`${cellCls} ${dirty ? "bg-accent/20" : ""} ${
                          isFocused ? "ring-1 ring-accent ring-inset" : ""
                        } ${isDel ? "line-through" : ""}`}
                        onClick={() =>
                          editable && setFocused({ row: ri, col: colName })
                        }
                        onDoubleClick={() =>
                          startEdit({ row: ri, col: colName })
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setFocused({ row: ri, col: colName });
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            row: ri,
                            col: colName,
                          });
                        }}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="w-full bg-bg text-text border border-accent rounded px-1 outline-none"
                            defaultValue={draft}
                            onBlur={(e) => commitEdit(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit(
                                  (e.target as HTMLInputElement).value,
                                );
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditing(null);
                              }
                            }}
                          />
                        ) : val === null ? (
                          <span className="text-null italic">NULL</span>
                        ) : (
                          val
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {counts.total > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 border-t border-border bg-panel">
          <span className="text-muted">
            {counts.total} pending: {counts.updates} update
            {counts.updates !== 1 && "s"}, {counts.deletes} delete
            {counts.deletes !== 1 && "s"}
          </span>
          {commitError && <span className="text-danger">{commitError}</span>}
          <div className="ml-auto flex gap-2">
            <button
              className="bg-transparent text-text border border-border rounded px-2.5 py-1 cursor-pointer hover:bg-border"
              onClick={discard}
              disabled={committing}
            >
              Discard
            </button>
            <button
              className="bg-accent text-white rounded px-2.5 py-1 cursor-pointer disabled:opacity-50"
              onClick={commit}
              disabled={committing}
              title="Cmd/Ctrl+S"
            >
              {committing ? "Committing…" : "Commit"}
            </button>
          </div>
        </div>
      )}

      {menu && (
        <div
          className="fixed z-20 bg-panel border border-border rounded-md p-1 min-w-[150px] shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.col && colMeta.get(menu.col)?.nullable && (
            <div
              className="px-2.5 py-1.5 rounded cursor-pointer hover:bg-border"
              onClick={() => setNull({ row: menu.row, col: menu.col })}
            >
              Set NULL
            </div>
          )}
          <div
            className="px-2.5 py-1.5 rounded cursor-pointer hover:bg-border text-danger"
            onClick={() => {
              toggleDelete(selected.size > 0 ? selected : [menu.row]);
              setMenu(null);
            }}
          >
            {deleted.has(menu.row) ? "Undo delete" : "Delete row"}
          </div>
        </div>
      )}

      {warning && (
        <WarningDialog
          warning={warning}
          committing={committing}
          onCancel={() => setWarning(null)}
          onConfirm={() => doCommit(warning.changes)}
        />
      )}
    </div>
  );
}

function WarningDialog({
  warning,
  committing,
  onCancel,
  onConfirm,
}: {
  warning: { changes: Change[]; statements: PreparedStatement[] };
  committing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const [showSql, setShowSql] = useState(false);
  const warned = warning.statements.filter((s) => s.warning);
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-30"
      onMouseDown={onCancel}
    >
      <div
        className="bg-panel border border-border rounded-[10px] p-5 w-[520px] max-h-[80vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 mb-3 text-base text-danger">
          ⚠️ Some rows can't be uniquely identified
        </h2>
        <p className="text-muted mb-3">
          {warned.length} statement{warned.length !== 1 && "s"} match on all
          column values and may affect more than one row. Commit anyway?
        </p>
        <button
          className="bg-transparent text-text border border-border rounded px-2.5 py-1 cursor-pointer hover:bg-border mb-2"
          onClick={() => setShowSql((s) => !s)}
        >
          {showSql ? "Hide SQL" : "View SQL"}
        </button>
        {showSql && (
          <pre className="bg-bg border border-border rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">
            {warning.statements.map((s) => `${s.sql};`).join("\n")}
          </pre>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="bg-transparent text-text border border-border rounded px-2.5 py-1.5 cursor-pointer hover:bg-border"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="bg-accent text-white rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-50"
            onClick={onConfirm}
            disabled={committing}
          >
            {committing ? "Committing…" : "Commit anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
