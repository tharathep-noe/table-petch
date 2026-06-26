import type { SelectHTMLAttributes } from "react";

/** Styled select primitive. */
export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select
      className={`bg-bg text-text border border-border rounded px-2 py-1 cursor-pointer ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}
