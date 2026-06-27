import type { ReactNode } from 'react';

/** Centered overlay dialog. Click outside (the backdrop) closes it. */
export function Modal({
  width = 440,
  onClose,
  children,
}: {
  width?: number;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-30"
      onMouseDown={onClose}
    >
      <div
        className="bg-panel border border-border rounded-[10px] p-5 max-h-[90vh] overflow-y-auto"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
