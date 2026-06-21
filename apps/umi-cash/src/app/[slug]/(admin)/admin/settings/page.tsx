'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { loadSettings, type TenantSettings } from './_shared';

type Section = {
  href: string;
  label: string;
  subtitle: (s: TenantSettings) => string;
};

const SECTIONS = (slug: string): Section[] => [
  {
    href: `/${slug}/admin/settings/business`,
    label: 'Información del negocio',
    subtitle: (s) => [s.name, s.city].filter(Boolean).join(' · ') || 'Sin configurar',
  },
  {
    href: `/${slug}/admin/settings/promotion`,
    label: 'Promoción especial',
    subtitle: (s) => s.promoMessage || 'Sin promoción activa',
  },
  {
    href: `/${slug}/admin/settings/appearance`,
    label: 'Apariencia',
    subtitle: (s) => s.primaryColor,
  },
  {
    href: `/${slug}/admin/settings/birthday`,
    label: 'Cumpleaños',
    subtitle: (s) => s.birthdayRewardEnabled ? `Activo · ${s.birthdayRewardName}` : 'Desactivado',
  },
  {
    href: `/${slug}/admin/settings/messages`,
    label: 'Mensajes automáticos',
    subtitle: (s) => {
      const overrides = Object.keys(s.lifecycleCopy || {}).length;
      return overrides > 0 ? `${overrides} mensaje${overrides !== 1 ? 's' : ''} personalizado${overrides !== 1 ? 's' : ''}` : 'Usando textos por defecto';
    },
  },
  {
    href: `/${slug}/admin/settings/options`,
    label: 'Opciones',
    subtitle: (s) => `Prefijo ${s.cardPrefix} · Registro ${s.selfRegistration ? 'abierto' : 'cerrado'}`,
  },
];

function Chevron() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-ink-light)' }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function SettingsIndexPage() {
  const { slug } = useParams<{ slug: string }>();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings(slug).then((s) => { setSettings(s); setLoading(false); });
  }, [slug]);

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <div className="u-fade-up mb-6">
        <div className="u-eyebrow mb-2">Preferencias</div>
        <h1 className="u-display" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
          Configuración
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-light)' }}>
          Elige una categoría para editar
        </p>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="u-surface p-4 animate-pulse h-16" />
          ))}
        </div>
      ) : settings ? (
        <div className="space-y-2">
          {SECTIONS(slug).map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="u-surface flex items-center justify-between gap-3 px-4 py-3.5 hover:opacity-80 transition-opacity"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>{section.label}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-ink-light)' }}>
                  {section.subtitle(settings)}
                </p>
              </div>
              <Chevron />
            </Link>
          ))}
        </div>
      ) : (
        <div className="u-surface p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--color-ink-light)' }}>No se pudo cargar la configuración.</p>
        </div>
      )}
    </div>
  );
}
