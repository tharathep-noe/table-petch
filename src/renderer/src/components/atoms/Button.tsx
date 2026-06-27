import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  'rounded cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white px-2.5 py-1.5',
  ghost:
    'bg-transparent text-text border border-border px-2.5 py-1.5 hover:bg-border',
};

/** The single button primitive used everywhere. */
export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: Props): JSX.Element {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest} />
  );
}
