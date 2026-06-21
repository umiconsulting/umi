'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

export function SettingsSubpageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="u-fade-up mb-6">
      <Link
        href={`/${slug}/admin/settings`}
        className="inline-flex items-center gap-1 text-sm mb-3"
        style={{ color: 'var(--color-ink-light)' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Configuración
      </Link>
      <h1 className="u-display" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
        {title}
      </h1>
      {subtitle && (
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-light)' }}>{subtitle}</p>
      )}
    </div>
  );
}

export function StatusMessage({ message, isSuccess }: { message: string; isSuccess: boolean }) {
  if (!message) return null;
  return (
    <p className={`text-center text-sm font-medium ${isSuccess ? 'text-green-700' : 'text-red-700'}`}>{message}</p>
  );
}
