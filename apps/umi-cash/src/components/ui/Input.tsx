'use client';

import { InputHTMLAttributes, forwardRef } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = '', ...rest },
  ref
) {
  return <input ref={ref} className={`u-input ${className}`} {...rest} />;
});

export function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="u-eyebrow block mb-2">
      {children}
    </label>
  );
}
