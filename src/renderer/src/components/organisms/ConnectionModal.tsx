import { useState } from "react";
import type { ConnectionConfig, ConnectionInput } from "@shared/types";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Field } from "../molecules/Field";
import { Modal } from "../molecules/Modal";

interface Props {
  /** When editing, the existing config (password is never provided). */
  initial?: ConnectionConfig;
  onClose: () => void;
  onSaved: (saved: ConnectionConfig, didChangeConnTarget: boolean) => void;
}

interface FormState {
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

const emptyForm: FormState = {
  name: "",
  host: "localhost",
  port: "5432",
  database: "",
  user: "",
  password: "",
  ssl: false,
};

function fromConfig(c: ConnectionConfig): FormState {
  return {
    name: c.name,
    host: c.host,
    port: String(c.port),
    database: c.database,
    user: c.user,
    password: "", // never sent to the renderer; blank means "keep existing"
    ssl: !!c.ssl,
  };
}

/** Parse a postgres:// URL into form fields. Returns null if it can't. */
function parseConnectionUrl(raw: string): Partial<FormState> | null {
  try {
    const u = new URL(raw.trim());
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    return {
      host: u.hostname || "localhost",
      port: u.port || "5432",
      user: decodeURIComponent(u.username) || "",
      password: decodeURIComponent(u.password) || "",
      database: u.pathname.replace(/^\//, "") || "",
      ssl: u.searchParams.get("sslmode") === "require",
    };
  } catch {
    return null;
  }
}

export function ConnectionModal({
  initial,
  onClose,
  onSaved,
}: Props): JSX.Element {
  const [form, setForm] = useState<FormState>(
    initial ? fromConfig(initial) : emptyForm,
  );
  const [urlText, setUrlText] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testState, setTestState] = useState<
    "idle" | "testing" | "ok" | "fail"
  >("idle");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setForm((f) => ({ ...f, [k]: v }));
    setTestState("idle");
  };

  const valid = form.host.trim() && form.database.trim() && form.user.trim();

  function applyUrl(): void {
    const parsed = parseConnectionUrl(urlText);
    if (!parsed) {
      setUrlError("Not a valid postgres:// URL");
      return;
    }
    setUrlError(null);
    setForm((f) => ({ ...f, ...parsed }));
    setTestState("idle");
  }

  function toInput(): ConnectionInput {
    return {
      id: initial?.id,
      name: form.name.trim() || `${form.user}@${form.host}`,
      host: form.host.trim(),
      port: Number(form.port) || 5432,
      database: form.database.trim(),
      user: form.user.trim(),
      ssl: form.ssl,
      // Blank on edit means "keep existing"; omit so the backend won't overwrite.
      ...(form.password
        ? { password: form.password }
        : isEdit
          ? {}
          : { password: "" }),
    };
  }

  async function test(): Promise<void> {
    setTestState("testing");
    setTestMsg(null);
    const res = await window.api.testConnection(toInput());
    setTestState(res.ok ? "ok" : "fail");
    setTestMsg(res.ok ? "Connection succeeded" : (res.error ?? "Connection failed"));
  }

  async function save(): Promise<void> {
    if (!valid) return;
    setSaving(true);
    try {
      const saved = await window.api.saveConnection(toInput());
      const changedTarget =
        !initial ||
        initial.host !== saved.host ||
        initial.port !== saved.port ||
        initial.database !== saved.database ||
        initial.user !== saved.user ||
        !!form.password;
      onSaved(saved, changedTarget);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal width={440} onClose={onClose}>
      <h2 className="m-0 mb-3.5 text-base">
        {isEdit ? "Edit connection" : "New connection"}
      </h2>

      <Field label="Paste connection URL">
        <div className="flex gap-1.5">
          <Input
            placeholder="postgresql://user:pass@host:5432/db"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
          />
          <Button variant="ghost" onClick={applyUrl} disabled={!urlText.trim()}>
            Fill
          </Button>
        </div>
        {urlError && <small className="text-danger">{urlError}</small>}
      </Field>

      <hr className="border-none border-t border-border my-3.5" />

      <Field label="Name">
        <Input
          placeholder={
            form.user && form.host ? `${form.user}@${form.host}` : "My database"
          }
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      <div className="flex gap-2.5">
        <Field label="Host" className="flex-[3]">
          <Input value={form.host} onChange={(e) => set("host", e.target.value)} />
        </Field>
        <Field label="Port" className="flex-1">
          <Input value={form.port} onChange={(e) => set("port", e.target.value)} />
        </Field>
      </div>

      <Field label="Database">
        <Input
          value={form.database}
          onChange={(e) => set("database", e.target.value)}
        />
      </Field>

      <div className="flex gap-2.5">
        <Field label="User" className="flex-1">
          <Input value={form.user} onChange={(e) => set("user", e.target.value)} />
        </Field>
        <Field label="Password" className="flex-1">
          <Input
            type="password"
            placeholder={isEdit ? "•••• (unchanged)" : ""}
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 mt-1 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.ssl}
          onChange={(e) => set("ssl", e.target.checked)}
        />
        <span>Use SSL</span>
      </label>

      {testMsg && (
        <div className={`my-1.5 ${testState === "ok" ? "text-success" : "text-danger"}`}>
          {testState === "ok" ? "✓ " : "✗ "}
          {testMsg}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="ghost"
          onClick={test}
          disabled={!valid || testState === "testing"}
        >
          {testState === "testing" ? "Testing…" : "Test"}
        </Button>
        <Button onClick={save} disabled={!valid || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
