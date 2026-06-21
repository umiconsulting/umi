'use client';

import { useParams } from 'next/navigation';

export default function GiftCardsPage() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <div className="u-fade-up mb-6">
        <div className="u-eyebrow mb-2">Próximamente</div>
        <h1 className="u-display" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
          Tarjetas de regalo
        </h1>
      </div>

      <div className="u-fade-up d1 u-surface p-6 text-center">
        <div className="u-eyebrow mb-2" style={{ color: 'var(--color-brand)' }}>En desarrollo</div>
        <p className="u-display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-ink)', margin: 0 }}>
          Función disponible muy pronto
        </p>
        <p className="text-sm mt-2" style={{ color: 'var(--color-ink-light)' }}>
          Te avisaremos en cuanto esté lista para vender y canjear tarjetas.
        </p>
      </div>
    </div>
  );
}
