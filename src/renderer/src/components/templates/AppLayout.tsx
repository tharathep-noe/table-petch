import type { ReactNode } from 'react';

/** The shell: fixed sidebar on the left, flexible main area, and an optional
 *  right pane (the row detail pane, ADR 0009) that owns its own width. */
export function AppLayout({
  sidebar,
  children,
  rightPane,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  rightPane?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-screen">
      {sidebar}
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
      {rightPane}
    </div>
  );
}
