import { HTMLAttributes } from 'react';

type Variant = 'accent' | 'brand' | 'quiet';

type Props = HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

const CLASS: Record<Variant, string> = {
  accent: 'u-badge u-badge-accent',
  brand: 'u-badge u-badge-brand',
  quiet: 'u-badge u-badge-quiet',
};

export function Badge({ variant = 'accent', className = '', ...rest }: Props) {
  return <span className={`${CLASS[variant]} ${className}`} {...rest} />;
}
