import { HTMLAttributes } from 'react';

export function Eyebrow({
  className = '',
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`u-eyebrow ${className}`} {...rest} />;
}
