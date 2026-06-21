import { HTMLAttributes } from 'react';

type ScreenProps = HTMLAttributes<HTMLDivElement>;

export function Screen({ className = '', ...rest }: ScreenProps) {
  return <div className={`u-screen ${className}`} {...rest} />;
}

export function ScreenScroll({ className = '', ...rest }: ScreenProps) {
  return <div className={`u-screen-scroll ${className}`} {...rest} />;
}

export function ScreenFixedBottom({ className = '', ...rest }: ScreenProps) {
  return <div className={`u-screen-fixed-bottom ${className}`} {...rest} />;
}
