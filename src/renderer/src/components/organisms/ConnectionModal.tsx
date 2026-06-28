import { useState } from 'react';
import type { ConnectionConfig, ConnectionInput, Engine } from '@shared/types';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { Select } from '../atoms/Select';
import { Field } from '../molecules/Field';
import { Modal } from '../molecules/Modal';

interface Props {
  /** When editing, the existing config (password is never provided). */
  initial?: ConnectionConfig;
  onClose: () => void;
  onSaved: (saved: ConnectionConfig, didChangeConnTarget: boolean) => void;
}

const ENGINES: { value: Engine; label: string; port: string }[] = [
  { value: 'postgres', label: 'PostgreSQL', port: '5432' },
  { value: 'mysql', label: 'MySQL', port: '3306' },
  { value: 'mssql', label: 'SQL Server', port: '1433' },
  { value: 'oracle', label: 'Oracle', port: '1521' },
];

const defaultPort = (e: Engine): string =>
  ENGINES.find((x) => x.value === e)?.port ?? '5432';

// The form holds a superset of every engine's fields; only the relevant ones
// are rendered and read per engine. The persisted ConnectionConfig is a union.
interface FormState {
  engine: Engine;
  name: string;
  host: string;
  port: string;
  database: string; // pg / mysql / mssql
  user: string;
  password: string;
  ssl: boolean;
  instance: string; // mssql
  encrypt: boolean; // mssql
  oracleBy: 'service' | 'sid'; // oracle
  serviceName: string; // oracle
  sid: string; // oracle
}

const emptyForm: FormState = {
  engine: 'postgres',
  name: '',
  host: 'localhost',
  port: '5432',
  database: '',
  user: '',
  password: '',
  ssl: false,
  instance: '',
  encrypt: true,
  oracleBy: 'service',
  serviceName: '',
  sid: '',
};

function fromConfig(c: ConnectionConfig): FormState {
  const base: FormState = {
    ...emptyForm,
    engine: c.engine,
    name: c.name,
    host: c.host,
    port: String(c.port),
    user: c.user,
    password: '', // never sent to the renderer; blank means "keep existing"
    ssl: !!c.ssl,
  };
  if (c.engine === 'oracle') {
    return {
      ...base,
      oracleBy: c.sid ? 'sid' : 'service',
      serviceName: c.serviceName ?? '',
      sid: c.sid ?? '',
    };
  }
  if (c.engine === 'mssql') {
    return {
      ...base,
      database: c.database,
      instance: c.instance ?? '',
      encrypt: c.encrypt ?? true,
    };
  }
  return { ...base, database: c.database };
}

/** Parse a connection URL (postgres/mysql/sqlserver/oracle) into form fields. */
function parseConnectionUrl(raw: string): Partial<FormState> | null {
  try {
    const u = new URL(raw.trim());
    const proto = u.protocol.replace(/:$/, '');
    const engine: Engine | null = /^postgres(ql)?$/.test(proto)
      ? 'postgres'
      : proto === 'mysql'
        ? 'mysql'
        : /^(sqlserver|mssql)$/.test(proto)
          ? 'mssql'
          : proto === 'oracle'
            ? 'oracle'
            : null;
    if (!engine) return null;
    const path = u.pathname.replace(/^\//, '');
    const out: Partial<FormState> = {
      engine,
      host: u.hostname || 'localhost',
      port: u.port || defaultPort(engine),
      user: decodeURIComponent(u.username) || '',
      password: decodeURIComponent(u.password) || '',
      ssl:
        u.searchParams.get('sslmode') === 'require' ||
        u.searchParams.get('ssl') === 'true',
    };
    if (engine === 'oracle') {
      out.oracleBy = 'service';
      out.serviceName = path;
    } else {
      out.database = path;
    }
    return out;
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
  const [urlText, setUrlText] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testState, setTestState] = useState<
    'idle' | 'testing' | 'ok' | 'fail'
  >('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEdit = !!initial;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]): void => {
    setForm((f) => ({ ...f, [k]: v }));
    setTestState('idle');
  };

  // Switching engine (new connections only) resets the port to the new default
  // when the current port is still a default — so a typed custom port survives.
  function setEngine(engine: Engine): void {
    setForm((f) => {
      const wasDefault = ENGINES.some((e) => e.port === f.port);
      return { ...f, engine, port: wasDefault ? defaultPort(engine) : f.port };
    });
    setTestState('idle');
  }

  const isOracle = form.engine === 'oracle';
  const valid =
    form.host.trim() &&
    form.user.trim() &&
    (isOracle
      ? form.oracleBy === 'service'
        ? form.serviceName.trim()
        : form.sid.trim()
      : form.database.trim());

  function applyUrl(): void {
    const parsed = parseConnectionUrl(urlText);
    if (!parsed) {
      setUrlError('Unrecognized connection URL');
      return;
    }
    setUrlError(null);
    setForm((f) => ({ ...f, ...parsed }));
    setTestState('idle');
  }

  function toInput(): ConnectionInput {
    const creds = form.password
      ? { password: form.password }
      : isEdit
        ? {}
        : { password: '' };
    const base = {
      id: initial?.id,
      name: form.name.trim() || `${form.user}@${form.host}`,
      host: form.host.trim(),
      port: Number(form.port) || Number(defaultPort(form.engine)),
      user: form.user.trim(),
      ssl: form.ssl,
      ...creds,
    };
    switch (form.engine) {
      case 'oracle':
        return {
          ...base,
          engine: 'oracle',
          ...(form.oracleBy === 'sid'
            ? { sid: form.sid.trim() }
            : { serviceName: form.serviceName.trim() }),
        };
      case 'mssql':
        return {
          ...base,
          engine: 'mssql',
          database: form.database.trim(),
          instance: form.instance.trim() || undefined,
          encrypt: form.encrypt,
        };
      case 'mysql':
        return { ...base, engine: 'mysql', database: form.database.trim() };
      default:
        return { ...base, engine: 'postgres', database: form.database.trim() };
    }
  }

  async function test(): Promise<void> {
    setTestState('testing');
    setTestMsg(null);
    const res = await window.api.testConnection(toInput());
    setTestState(res.ok ? 'ok' : 'fail');
    setTestMsg(
      res.ok ? 'Connection succeeded' : (res.error ?? 'Connection failed'),
    );
  }

  async function save(): Promise<void> {
    if (!valid) return;
    setSaving(true);
    try {
      const saved = await window.api.saveConnection(toInput());
      // Any change that alters what we'd connect to should drop the open session.
      const changedTarget =
        !initial || !!form.password || hasTargetChanged(saved);
      onSaved(saved, changedTarget);
    } finally {
      setSaving(false);
    }
  }

  function hasTargetChanged(saved: ConnectionConfig): boolean {
    if (!initial) return true;
    if (initial.host !== saved.host || initial.port !== saved.port) return true;
    if (initial.user !== saved.user) return true;
    if (initial.engine !== saved.engine) return true;
    if (initial.engine === 'oracle' && saved.engine === 'oracle') {
      return (
        initial.serviceName !== saved.serviceName || initial.sid !== saved.sid
      );
    }
    if (initial.engine !== 'oracle' && saved.engine !== 'oracle') {
      return initial.database !== saved.database;
    }
    return false;
  }

  const urlPlaceholder: Record<Engine, string> = {
    postgres: 'postgresql://user:pass@host:5432/db',
    mysql: 'mysql://user:pass@host:3306/db',
    mssql: 'sqlserver://user:pass@host:1433/db',
    oracle: 'oracle://user:pass@host:1521/service',
  };

  return (
    <Modal width={440} onClose={onClose}>
      <h2 className="m-0 mb-3.5 text-base">
        {isEdit ? 'Edit connection' : 'New connection'}
      </h2>

      <Field label="Paste connection URL">
        <div className="flex gap-1.5">
          <Input
            placeholder={urlPlaceholder[form.engine]}
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

      <div className="flex gap-2.5">
        <Field label="Engine" className="flex-1">
          <Select
            className="w-full"
            value={form.engine}
            disabled={isEdit}
            title={isEdit ? 'Engine is fixed once a connection is created' : ''}
            onChange={(e) => setEngine(e.target.value as Engine)}
          >
            {ENGINES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" className="flex-[2]">
          <Input
            placeholder={
              form.user && form.host
                ? `${form.user}@${form.host}`
                : 'My database'
            }
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>
      </div>

      <div className="flex gap-2.5">
        <Field label="Host" className="flex-[3]">
          <Input
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
          />
        </Field>
        <Field label="Port" className="flex-1">
          <Input
            value={form.port}
            onChange={(e) => set('port', e.target.value)}
          />
        </Field>
      </div>

      {isOracle ? (
        <div className="flex gap-2.5 items-end">
          <Field label="Connect by" className="flex-1">
            <Select
              className="w-full"
              value={form.oracleBy}
              onChange={(e) =>
                set('oracleBy', e.target.value as 'service' | 'sid')
              }
            >
              <option value="service">Service name</option>
              <option value="sid">SID</option>
            </Select>
          </Field>
          {form.oracleBy === 'service' ? (
            <Field label="Service name" className="flex-[2]">
              <Input
                value={form.serviceName}
                onChange={(e) => set('serviceName', e.target.value)}
              />
            </Field>
          ) : (
            <Field label="SID" className="flex-[2]">
              <Input
                value={form.sid}
                onChange={(e) => set('sid', e.target.value)}
              />
            </Field>
          )}
        </div>
      ) : (
        <Field label="Database">
          <Input
            value={form.database}
            onChange={(e) => set('database', e.target.value)}
          />
        </Field>
      )}

      {form.engine === 'mssql' && (
        <Field label="Instance (optional)">
          <Input
            placeholder="SQLEXPRESS"
            value={form.instance}
            onChange={(e) => set('instance', e.target.value)}
          />
        </Field>
      )}

      <div className="flex gap-2.5">
        <Field label="User" className="flex-1">
          <Input
            value={form.user}
            onChange={(e) => set('user', e.target.value)}
          />
        </Field>
        <Field label="Password" className="flex-1">
          <Input
            type="password"
            placeholder={isEdit ? '•••• (unchanged)' : ''}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 mt-1 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.ssl}
          onChange={(e) => set('ssl', e.target.checked)}
        />
        <span>Use SSL</span>
      </label>

      {form.engine === 'mssql' && (
        <label className="flex items-center gap-2 -mt-1 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.encrypt}
            onChange={(e) => set('encrypt', e.target.checked)}
          />
          <span>Encrypt connection (TLS)</span>
        </label>
      )}

      {testMsg && (
        <div
          className={`my-1.5 ${testState === 'ok' ? 'text-success' : 'text-danger'}`}
        >
          {testState === 'ok' ? '✓ ' : '✗ '}
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
          disabled={!valid || testState === 'testing'}
        >
          {testState === 'testing' ? 'Testing…' : 'Test'}
        </Button>
        <Button onClick={save} disabled={!valid || saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  );
}
