import { useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { keymap, EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type { QueryResult } from "@shared/types";
import { Button } from "../atoms/Button";

interface Props {
  connectionId: string;
  /** Controlled editor text (lifted to the page so table clicks can prefill it). */
  value: string;
  onChange: (value: string) => void;
  /** Schema/table names for autocomplete, as { table: [columns] }. */
  schema?: Record<string, string[]>;
  onResult: (result: QueryResult) => void;
  onError: (message: string) => void;
}

export function SqlEditor({
  connectionId,
  value,
  onChange,
  schema,
  onResult,
  onError,
}: Props): JSX.Element {
  const [running, setRunning] = useState(false);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  // Keep the latest run handler reachable from the static CodeMirror keymap.
  const runRef = useRef<() => void>(() => {});

  /** Run the selection if there is one, otherwise the whole editor. */
  async function run(): Promise<void> {
    const view = cmRef.current?.view;
    let toRun = value;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (from !== to) toRun = view.state.sliceDoc(from, to);
    }
    toRun = toRun.trim();
    if (!toRun) return;

    setRunning(true);
    try {
      onResult(await window.api.runQuery(connectionId, toRun));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }
  runRef.current = run;

  const extensions = [
    sql({ dialect: PostgreSQL, schema, upperCaseKeywords: false }),
    // Highest precedence so Cmd/Ctrl+Enter always runs, beating default keymaps.
    Prec.highest(
      keymap.of([
        { key: "Mod-Enter", preventDefault: true, run: () => (runRef.current(), true) },
        { key: "Shift-Mod-Enter", preventDefault: true, run: () => (runRef.current(), true) },
      ]),
    ),
    EditorView.lineWrapping,
  ];

  return (
    <div className="border-b border-border">
      <CodeMirror
        ref={cmRef}
        value={value}
        onChange={onChange}
        theme="dark"
        extensions={extensions}
        basicSetup={{ foldGutter: false, lineNumbers: true }}
        height="140px"
        style={{ fontSize: 13 }}
      />
      <div className="flex items-center gap-2 px-2 py-1.5 bg-panel">
        <Button
          onClick={run}
          disabled={running}
          className="px-3 py-1"
          title="Run (Cmd/Ctrl+Enter) — runs the selection, or the whole editor"
        >
          {running ? "Running…" : "▶ Run"}
        </Button>
        <span className="text-muted text-xs">⌘↵ runs selection or all</span>
      </div>
    </div>
  );
}
