/** A single tab chip with a close affordance. */
export function Tab({
  title,
  active,
  onSelect,
  onClose,
}: {
  title: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      className={`app-no-drag group flex items-center gap-2 px-3 py-1 rounded-t text-xs whitespace-nowrap cursor-pointer ${
        active ? "bg-bg text-text" : "bg-panel text-muted hover:bg-border"
      }`}
      onClick={onSelect}
    >
      <span>{title || "Untitled"}</span>
      <span
        className="opacity-50 group-hover:opacity-100 hover:text-danger"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        title="Close tab"
      >
        ×
      </span>
    </div>
  );
}
