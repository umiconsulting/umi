'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  fullWidth?: boolean;
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'u-btn u-btn-primary',
  secondary: 'u-btn u-btn-secondary',
  ghost: 'u-btn u-btn-ghost',
  danger: 'u-btn u-btn-danger',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', fullWidth, className = '', style, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={`${VARIANT_CLASS[variant]} ${className}`}
      style={{ width: fullWidth ? '100%' : undefined, ...style }}
      {...rest}
    />
  );
});
