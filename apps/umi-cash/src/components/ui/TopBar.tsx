import { ReactNode } from 'react';

type Props = {
  title?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function TopBar({ title, leading, trailing }: Props) {
  return (
    <div className="u-topbar">
      <div className="flex items-center gap-2">{leading}</div>
      {title && <div className="u-topbar-title">{title}</div>}
      <div className="flex items-center gap-2">{trailing}</div>
    </div>
  );
}

export function IconButton({
  onClick,
  'aria-label': ariaLabel,
  children,
}: {
  onClick?: () => void;
  'aria-label'?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className="u-icon-btn">
      {children}
    </button>
  );
}
