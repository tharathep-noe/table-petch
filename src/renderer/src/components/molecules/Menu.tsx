export interface MenuItemDef {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/** A positioned right-click context menu. Used for connections and cells. */
export function Menu({
  x,
  y,
  items,
}: {
  x: number;
  y: number;
  items: MenuItemDef[];
}): JSX.Element {
  return (
    <div
      className="fixed z-20 bg-panel border border-border rounded-md p-1 min-w-[150px] shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className={`px-2.5 py-1.5 rounded cursor-pointer hover:bg-border ${
            item.danger ? "text-danger" : ""
          }`}
          onClick={item.onClick}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
