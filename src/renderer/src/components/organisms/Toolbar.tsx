import { Button } from '../atoms/Button';

interface Props {
  connected: boolean;
  showSql: boolean;
  onToggleSql: () => void;
  filterShown: boolean;
  onToggleFilter: () => void;
  /** Whether a browsed result is on screen, so the row detail toggle can enable. */
  hasResult: boolean;
  recordPaneShown: boolean;
  onToggleRecordPane: () => void;
  error: string | null;
}

export function Toolbar({
  connected,
  showSql,
  onToggleSql,
  filterShown,
  onToggleFilter,
  hasResult,
  recordPaneShown,
  onToggleRecordPane,
  error,
}: Props): JSX.Element {
  return (
    <div className="app-drag flex gap-2 items-center p-2 border-b border-border">
      <Button
        variant="ghost"
        className="app-no-drag px-2 py-0.5 text-xs"
        onClick={onToggleSql}
        disabled={!connected}
        title="Toggle SQL editor"
      >
        {showSql ? 'Close Sql Editor' : 'Open Sql Editor'}
      </Button>
      <Button
        variant="ghost"
        className={`app-no-drag px-2 py-0.5 text-xs ${filterShown ? 'border-accent text-text' : ''}`}
        onClick={onToggleFilter}
        disabled={!connected}
        title="Toggle filter"
      >
        Filter
      </Button>
      <Button
        variant="ghost"
        className={`app-no-drag px-2 py-0.5 text-xs ${recordPaneShown ? 'border-accent text-text' : ''}`}
        onClick={onToggleRecordPane}
        disabled={!hasResult}
        title="Toggle row detail pane"
      >
        Row detail
      </Button>
      <span className="text-muted">
        {connected ? 'Connected' : 'Pick a connection'}
      </span>
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}
