import { Tab } from "../molecules/Tab";

export interface TabInfo {
  id: string;
  title: string;
}

interface Props {
  tabs: TabInfo[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
}: Props): JSX.Element {
  return (
    <div className="app-drag flex items-end gap-1 px-2 pt-8 bg-panel border-b border-border overflow-x-auto">
      {tabs.map((t) => (
        <Tab
          key={t.id}
          title={t.title}
          active={t.id === activeTabId}
          onSelect={() => onSelect(t.id)}
          onClose={() => onClose(t.id)}
        />
      ))}
      <button
        className="app-no-drag px-2 py-1 text-muted hover:text-text"
        onClick={onNew}
        title="New tab"
      >
        ＋
      </button>
    </div>
  );
}
