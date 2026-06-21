import { ReactNode } from 'react';

type Props = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '48px 24px', color: 'var(--color-ink-light)' }}
    >
      {icon && <div style={{ marginBottom: 18, color: 'var(--color-brand)', opacity: 0.7 }}>{icon}</div>}
      <div
        className="u-display"
        style={{ fontSize: 22, color: 'var(--color-ink)', fontWeight: 600 }}
      >
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 14, marginTop: 8, maxWidth: 280 }}>{description}</div>
      )}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}
