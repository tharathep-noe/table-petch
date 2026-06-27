export interface MenuItemDef {
  label: string;
  /** Leading glyph/emoji, kept in a fixed-width slot so labels align. */
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  shortcut?: string;
  onClick?: () => void;
  /** When present, the row becomes a submenu that opens on hover. */
  children?: MenuItemDef[];
}

/** A horizontal divider between groups of items. */
export type MenuEntry = MenuItemDef | 'separator';

const panelCls =
  'bg-panel/95 backdrop-blur border border-border rounded-lg p-1 ' +
  'min-w-[180px] shadow-2xl shadow-black/40 text-sm';

function MenuRow({ item }: { item: MenuItemDef }): JSX.Element {
  const hasChildren = !!item.children?.length;
  return (
    <div className="relative group/mi">
      <div
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md select-none transition-colors ${
          item.disabled
            ? 'opacity-40 pointer-events-none'
            : 'cursor-pointer hover:bg-accent/20'
        } ${item.danger ? 'text-danger' : 'text-text'}`}
        onClick={item.disabled ? undefined : item.onClick}
      >
        <span className="w-4 shrink-0 text-center text-muted">
          {item.icon ?? ''}
        </span>
        <span className="flex-1 whitespace-nowrap">{item.label}</span>
        {item.shortcut && (
          <span className="ml-6 text-xs text-muted tracking-wide">
            {item.shortcut}
          </span>
        )}
        {hasChildren && <span className="ml-2 text-muted">›</span>}
      </div>

      {hasChildren && (
        <div
          className={`absolute left-full top-0 -ml-1 pl-1 hidden group-hover/mi:block ${panelCls}`}
        >
          {item.children!.map((c, i) => (
            <MenuRow key={`${c.label}-${i}`} item={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A positioned right-click context menu. Used for connections and cells. */
export function Menu({
  x,
  y,
  items,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
}): JSX.Element {
  return (
    <div className={`fixed z-20 ${panelCls}`} style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 h-px bg-border/70" />
        ) : (
          <MenuRow key={i} item={item} />
        ),
      )}
    </div>
  );
}
