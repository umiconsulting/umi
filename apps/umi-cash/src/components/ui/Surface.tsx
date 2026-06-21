import { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLDivElement>;

export function Surface({ className = '', ...rest }: Props) {
  return <div className={`u-surface ${className}`} {...rest} />;
}
