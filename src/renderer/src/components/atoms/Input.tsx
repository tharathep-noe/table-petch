import type { InputHTMLAttributes } from 'react';

/** Styled text input primitive. */
export function Input({
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      className={`w-full bg-bg text-text border border-border rounded px-2 py-1.5 outline-none focus:border-accent ${className}`}
      {...rest}
    />
  );
}
