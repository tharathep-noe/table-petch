import type { ReactNode } from 'react';

/** A labelled form row: a caption above its control. */
export function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className={`flex flex-col gap-1 mb-2.5 ${className}`}>
      <span className="text-muted text-xs">{label}</span>
      {children}
    </label>
  );
}
