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
  invalidNewRows,
  isCellSet,
  isDirty,
  type NewRow,
  requiredColumns,
  setEdit,
  setNewRowCell,
  unsetNewRowCell,
} from "../../lib/editState";
import { Button } from "../atoms/Button";
import { Menu, type MenuItemDef } from "../molecules/Menu";
import { Modal } from "../molecules/Modal";

interface Props {
  connectionId: string;
  result: QueryResult;
  onReload: () => void;
}

type Row = CellValue[];
interface CellPos {
  row: number; // existing: page index; new: tempId
  col: string;
  isNew?: boolean;
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

export function DataGrid({
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
  const requiredNames = useMemo(
    () => new Set(requiredColumns(result.columns).map((c) => c.name)),
    [result.columns],
  );

  const [edits, setEdits] = useState<Edits>({});
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [newRows, setNewRows] = useState<NewRow[]>([]);
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
  const tempIdRef = useRef(-1);
  // Drag-to-select existing rows. pressRowRef is where the mouse went down;
  // draggingRef flips true once the drag crosses into another row, and stays
  // true through the trailing click so the click doesn't collapse the range.
  const pressRowRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // Lets the global keydown listener call the latest commit() closure.
  const commitRef = useRef<() => void>(() => {});

  // New page loaded (table switch or post-commit reload) → drop staged state.
  useEffect(() => {
    setEdits({});
    setDeleted(new Set());
    setNewRows([]);
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

  // Global Cmd/Ctrl+S commits pending changes, regardless of where focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        commitRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // End any in-progress row drag when the button is released anywhere.
  useEffect(() => {
    const onUp = (): void => {
      pressRowRef.current = null;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const counts = countChanges(result, edits, deleted, newRows);
  const invalidRows = useMemo(
    () => invalidNewRows(result.columns, newRows),
    [result.columns, newRows],
  );
  const colIndex = (name: string): number =>
    result.columns.findIndex((c) => c.name === name);
  const newRowOf = (tempId: number): NewRow | undefined =>
    newRows.find((r) => r.tempId === tempId);

  function addRow(): void {
    const tempId = tempIdRef.current--;
    setNewRows((rows) => [...rows, { tempId, values: {} }]);
  }

  function removeNewRow(tempId: number): void {
    setNewRows((rows) => rows.filter((r) => r.tempId !== tempId));
    setMenu(null);
  }

  function startEdit(pos: CellPos): void {
    if (!editable) return;
    if (pos.isNew && colMeta.get(pos.col)?.isGenerated) return; // not insertable
    let current: CellValue;
    if (pos.isNew) {
      const row = newRowOf(pos.row);
      current = row && isCellSet(row, pos.col) ? row.values[pos.col] : null;
    } else {
      current = result.rows[pos.row][colIndex(pos.col)];
    }
    setEditing(pos);
    setDraft(current === null ? "" : String(current));
  }

  function commitEdit(value: CellValue): void {
    if (!editing) return;
    if (editing.isNew) {
      setNewRows((rows) =>
        setNewRowCell(rows, editing.row, editing.col, value),
      );
    } else {
      const original = result.rows[editing.row][colIndex(editing.col)];
      setEdits((e) => setEdit(e, editing.row, editing.col, original, value));
    }
    setEditing(null);
  }

  function setNull(pos: CellPos): void {
    const meta = colMeta.get(pos.col);
    if (!meta?.nullable) return;
    if (pos.isNew) {
      setNewRows((rows) => setNewRowCell(rows, pos.row, pos.col, null));
    } else {
      const original = result.rows[pos.row][colIndex(pos.col)];
      setEdits((e) => setEdit(e, pos.row, pos.col, original, null));
    }
    setMenu(null);
  }

  function setDefault(pos: CellPos): void {
    setNewRows((rows) => unsetNewRowCell(rows, pos.row, pos.col));
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

  /** Select the inclusive row range [a, b], anchored at a. Used by drag-select. */
  function selectRange(a: number, b: number): void {
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
    const next = new Set<number>();
    for (let i = lo; i <= hi; i++) next.add(i);
    anchorRef.current = a;
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
    setNewRows([]);
    setCommitError(null);
    setSelected(new Set());
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
    const changes = buildChanges(result, edits, deleted, newRows);
    if (changes.length === 0) return;
    if (invalidRows.size > 0) {
      setCommitError(
        `${invalidRows.size} new row${invalidRows.size !== 1 ? "s are" : " is"} ` +
          `missing a required value.`,
      );
      return;
    }
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
  // Always points at the current-render commit() so the window listener is fresh.
  commitRef.current = commit;

  function onKeyDown(e: React.KeyboardEvent): void {
    if (editing) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Backspace" && focused) {
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

  const menuItems = (m: CellMenu): MenuItemDef[] => {
    const items: MenuItemDef[] = [];
    if (m.isNew) {
      if (m.col && colMeta.get(m.col)?.nullable) {
        items.push({
          label: "Set NULL",
          onClick: () => setNull({ row: m.row, col: m.col, isNew: true }),
        });
      }
      if (m.col && !colMeta.get(m.col)?.isGenerated) {
        items.push({
          label: "Set DEFAULT",
          onClick: () => setDefault({ row: m.row, col: m.col, isNew: true }),
        });
      }
      items.push({
        label: "Remove new row",
        danger: true,
        onClick: () => removeNewRow(m.row),
      });
      return items;
    }
    if (m.col && colMeta.get(m.col)?.nullable) {
      items.push({
        label: "Set NULL",
        onClick: () => setNull({ row: m.row, col: m.col }),
      });
    }
    items.push({
      label: deleted.has(m.row) ? "Undo delete" : "Delete row",
      danger: true,
      onClick: () => {
        toggleDelete(selected.size > 0 ? selected : [m.row]);
        setMenu(null);
      },
    });
    return items;
  };

  function renderEditInput(): JSX.Element {
    return (
      <input
        autoFocus
        className="w-full bg-bg text-text border border-accent rounded px-1 outline-none"
        defaultValue={draft}
        onBlur={(e) => commitEdit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitEdit((e.target as HTMLInputElement).value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(null);
          }
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 overflow-auto outline-none select-none"
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
                    {requiredNames.has(h.column.id) ? (
                      <span className="text-danger" title="Required on insert">
                        {" "}
                        *
                      </span>
                    ) : null}
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
                <tr
                  key={row.id}
                  className={`
                    ${isDel ? "opacity-60" : ""}
                    ${isSel ? "bg-accent/30" : "bg-panel"}`}
                  onMouseDown={() => {
                    pressRowRef.current = ri;
                    draggingRef.current = false;
                  }}
                  onMouseEnter={(e) => {
                    if (e.buttons === 1 && pressRowRef.current !== null) {
                      draggingRef.current = true;
                      selectRange(pressRowRef.current, ri);
                    }
                  }}
                  onClick={(e) => {
                    if (draggingRef.current) return;
                    selectRow(ri, e);
                  }}
                >
                  <td
                    className={`${cellCls} text-muted cursor-pointer select-none`}
                    onClick={(e) => {
                      if (draggingRef.current) return;
                      e.stopPropagation();
                      selectRow(ri, e);
                    }}
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
                      editing?.row === ri &&
                      editing?.col === colName &&
                      !editing?.isNew;
                    const isFocused =
                      focused?.row === ri &&
                      focused?.col === colName &&
                      !focused?.isNew;
                    return (
                      <td
                        key={cell.id}
                        className={`
                          ${cellCls} ${dirty ? "bg-accent/20" : ""} 
                          ${isFocused ? "ring-1 ring-accent ring-inset" : ""} 
                          ${isDel ? "line-through text-danger" : ""}`}
                        onClick={() => {
                          if (draggingRef.current) return;
                          if (editable) setFocused({ row: ri, col: colName });
                        }}
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
                          renderEditInput()
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

            {newRows.map((nr) => {
              const invalid = invalidRows.has(nr.tempId);
              return (
                <tr
                  key={`new-${nr.tempId}`}
                  className="bg-success/5 border-l-2 border-l-success"
                >
                  <td
                    className={`${cellCls} text-success select-none cursor-pointer`}
                    title="New row — right-click to remove"
                    onClick={() => removeNewRow(nr.tempId)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        row: nr.tempId,
                        col: "",
                        isNew: true,
                      });
                    }}
                  >
                    ＋
                  </td>
                  {result.columns.map((c) => {
                    const colName = c.name;
                    const set = isCellSet(nr, colName);
                    const value = set ? nr.values[colName] : null;
                    const generated = c.isGenerated;
                    const missing =
                      invalid &&
                      requiredNames.has(colName) &&
                      (!set || value === null);
                    const isEditing =
                      editing?.isNew &&
                      editing.row === nr.tempId &&
                      editing.col === colName;
                    const isFocused =
                      focused?.isNew &&
                      focused.row === nr.tempId &&
                      focused.col === colName;
                    return (
                      <td
                        key={colName}
                        className={`${cellCls} ${
                          isFocused ? "ring-1 ring-accent ring-inset" : ""
                        } ${missing ? "ring-1 ring-danger ring-inset" : ""} ${
                          generated ? "text-muted" : ""
                        }`}
                        onClick={() =>
                          !generated &&
                          setFocused({
                            row: nr.tempId,
                            col: colName,
                            isNew: true,
                          })
                        }
                        onDoubleClick={() =>
                          startEdit({
                            row: nr.tempId,
                            col: colName,
                            isNew: true,
                          })
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!generated)
                            setFocused({
                              row: nr.tempId,
                              col: colName,
                              isNew: true,
                            });
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            row: nr.tempId,
                            col: colName,
                            isNew: true,
                          });
                        }}
                      >
                        {isEditing ? (
                          renderEditInput()
                        ) : !set ? (
                          <span className="text-muted italic">DEFAULT</span>
                        ) : value === null ? (
                          <span className="text-null italic">NULL</span>
                        ) : (
                          value
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

      {editable && (
        <div className="flex items-center gap-3 px-3 py-2 border-t border-border bg-panel">
          <Button variant="ghost" className="py-1" onClick={addRow}>
            ＋ Add row
          </Button>
          {counts.total > 0 && (
            <span className="text-muted">
              {counts.total} pending: {counts.updates} update
              {counts.updates !== 1 && "s"}, {counts.inserts} insert
              {counts.inserts !== 1 && "s"}, {counts.deletes} delete
              {counts.deletes !== 1 && "s"}
            </span>
          )}
          {commitError && <span className="text-danger">{commitError}</span>}
          {counts.total > 0 && (
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                className="py-1"
                onClick={discard}
                disabled={committing}
              >
                Discard
              </Button>
              <Button
                className="py-1"
                onClick={commit}
                disabled={committing}
                title="Cmd/Ctrl+S"
              >
                {committing ? "Committing…" : "Commit"}
              </Button>
            </div>
          )}
        </div>
      )}

      {menu && <Menu x={menu.x} y={menu.y} items={menuItems(menu)} />}

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
    <Modal width={520} onClose={onCancel}>
      <h2 className="m-0 mb-3 text-base text-danger">
        ⚠️ Some rows can't be uniquely identified
      </h2>
      <p className="text-muted mb-3">
        {warned.length} statement{warned.length !== 1 && "s"} match on all
        column values and may affect more than one row. Commit anyway?
      </p>
      <Button
        variant="ghost"
        className="py-1 mb-2"
        onClick={() => setShowSql((s) => !s)}
      >
        {showSql ? "Hide SQL" : "View SQL"}
      </Button>
      {showSql && (
        <pre className="bg-bg border border-border rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">
          {warning.statements.map((s) => `${s.sql};`).join("\n")}
        </pre>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm} disabled={committing}>
          {committing ? "Committing…" : "Commit anyway"}
        </Button>
      </div>
    </Modal>
  );
}
