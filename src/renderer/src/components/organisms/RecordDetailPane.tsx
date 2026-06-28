import { useEffect, useRef } from 'react';
import type { QueryResult } from '@shared/types';
import { cellValue, isDirty } from '../../lib/editState';
import type { TableEditing } from '../../lib/useTableEditing';

const MIN_WIDTH = 280;
const MAX_WIDTH = 760;

interface Props {
  result: QueryResult;
  /** Shared staged-edit + selection state; the pane is a second editing surface. */
  edit: TableEditing;
  width: number;
  onResize: (width: number) => void;
  onClose: () => void;
}

/** A textarea that grows to fit its content, so long/JSON values get room. */
function AutoGrowTextarea({
  value,
  onChange,
  dirty,
}: {
  value: string;
  onChange: (v: string) => void;
  dirty: boolean;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full resize-none rounded border px-2 py-1 font-mono text-sm leading-snug outline-none focus:border-accent ${
        dirty ? 'border-accent bg-accent/10' : 'border-border bg-bg'
      }`}
    />
  );
}

/** The row detail pane (ADR 0009): the active row's columns as a vertical list of
 *  always-on inputs. Edits flow into the same staged-change set as the grid and
 *  are committed by the grid's footer — the pane has no commit of its own. Shows
 *  existing rows only; composing a new row stays in the grid. */
export function RecordDetailPane({
  result,
  edit,
  width,
  onResize,
  onClose,
}: Props): JSX.Element {
  const { activeRowIndex, selected, edits, deleted, colMeta, requiredNames } =
    edit;

  // Drag the left edge to resize; width is measured from the window's right edge.
  const draggingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, window.innerWidth - e.clientX),
      );
      onResize(next);
    };
    const onUp = (): void => {
      draggingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onResize]);

  const hasRow =
    activeRowIndex !== null &&
    activeRowIndex >= 0 &&
    activeRowIndex < result.rows.length;
  const rowIndex = hasRow ? (activeRowIndex as number) : -1;
  const isDeleted = hasRow && deleted.has(rowIndex);

  return (
    <aside
      className="relative flex h-full flex-col border-l border-border bg-panel"
      style={{ width }}
    >
      <div
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-accent/40"
        onMouseDown={() => {
          draggingRef.current = true;
        }}
      />

      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Row detail</div>
          {hasRow && (
            <div className="truncate text-xs text-muted">
              Row {rowIndex + 1}
              {selected.size > 1 ? ` · ${selected.size} selected` : ''}
            </div>
          )}
        </div>
        <button
          className="rounded px-2 py-0.5 text-muted hover:bg-border/40"
          title="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </header>

      {!hasRow ? (
        <div className="p-4 text-sm text-muted">Select a row to inspect.</div>
      ) : (
        <div className="flex-1 overflow-auto">
          {isDeleted && (
            <div className="border-b border-border bg-danger/10 px-3 py-2 text-xs text-danger">
              Marked for deletion — undo the delete in the grid to edit.
            </div>
          )}
          <dl className="m-0 flex flex-col">
            {result.columns.map((c) => {
              const colIndex = result.columns.indexOf(c);
              const original = result.rows[rowIndex][colIndex];
              const val = cellValue(edits, rowIndex, c.name, original);
              const dirty = isDirty(edits, rowIndex, c.name);
              const meta = colMeta.get(c.name);
              const locked = isDeleted || !!meta?.isGenerated;
              const nullable = !!meta?.nullable;
              return (
                <div key={c.name} className="border-b border-border px-3 py-2">
                  <dt className="mb-1 flex items-center gap-1 text-xs">
                    {meta?.isPrimaryKey && <span title="Primary key">🔑</span>}
                    <span className="font-medium">{c.name}</span>
                    {requiredNames.has(c.name) && (
                      <span className="text-danger" title="Required on insert">
                        *
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-muted">
                      {meta?.dataType}
                    </span>
                  </dt>
                  <dd className="m-0">
                    {locked ? (
                      <div className="rounded border border-border bg-bg/50 px-2 py-1 font-mono text-sm text-muted">
                        {meta?.isGenerated ? (
                          'DEFAULT (generated)'
                        ) : val === null ? (
                          <span className="text-null italic">NULL</span>
                        ) : (
                          val
                        )}
                      </div>
                    ) : val === null ? (
                      <div className="flex items-center gap-2">
                        <span className="text-null italic">NULL</span>
                        <button
                          className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-border/40"
                          onClick={() => edit.setCellEdit(rowIndex, c.name, '')}
                        >
                          Set value
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <AutoGrowTextarea
                          value={val}
                          dirty={dirty}
                          onChange={(v) =>
                            edit.setCellEdit(rowIndex, c.name, v)
                          }
                        />
                        {nullable && (
                          <button
                            className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-border/40"
                            title="Set NULL"
                            onClick={() =>
                              edit.setNull({ row: rowIndex, col: c.name })
                            }
                          >
                            ∅
                          </button>
                        )}
                      </div>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}
    </aside>
  );
}
