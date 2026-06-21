import { ReactNode } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
};

export function KPICard({ label, value, sub }: Props) {
  return (
    <div className="u-surface" style={{ padding: 18 }}>
      <div className="u-eyebrow">{label}</div>
      <div className="u-stat-num" style={{ marginTop: 8 }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-2" style={{ color: 'var(--color-ink-light)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}
