import type { ReactNode } from 'react';

/** The two-pane shell: fixed sidebar on the left, flexible main area. */
export function AppLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="flex h-screen">
      {sidebar}
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
