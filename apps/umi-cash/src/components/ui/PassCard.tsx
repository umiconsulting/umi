'use client';

import { getTenantAssets } from '@/lib/tenantAssets';
import { useTenant } from '@/context/TenantContext';

type Props = {
  stamps?: number;
  total?: number;
  passStyle?: 'stamps' | 'balance';
  balance?: number;
  lang?: 'es' | 'en';
  cardNum?: string;
  rewardName?: string;
  qr?: React.ReactNode;
};

export function PassCard({
  stamps = 0,
  total = 8,
  passStyle = 'stamps',
  balance = 0,
  lang = 'es',
  cardNum,
  rewardName,
  qr,
}: Props) {
  const { slug, name } = useTenant();
  const assets = getTenantAssets(slug);
  const missing = Math.max(0, total - stamps);
  const cols = 4;
  const rows = Math.ceil(total / cols);

  const t =
    lang === 'es'
      ? { missing: 'VISITAS FALTANTES', rewardType: 'RECOMPENSA', visit: 'visitas' }
      : { missing: 'VISITS REMAINING', rewardType: 'REWARD TYPE', visit: 'visits' };

  return (
    <div
      style={{
        width: 300,
        borderRadius: 14,
        overflow: 'hidden',
        background: 'var(--color-brand)',
        color: '#fff',
        fontFamily: '-apple-system, "SF Pro", system-ui',
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
      }}
    >
      <div style={{ padding: '16px 18px 14px' }}>
        <img
          src={assets.walletLogo}
          alt={name}
          style={{
            height: 28,
            width: 'auto',
            display: 'block',
            objectFit: 'contain',
            objectPosition: 'left center',
          }}
        />
      </div>

      <div style={{ background: '#EFE0CC', padding: '14px 12px 16px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 8,
            justifyItems: 'center',
          }}
        >
          {Array.from({ length: rows * cols }).map((_, i) => {
            const used = i < total;
            const filled = i < stamps;
            if (!used) return <div key={i} style={{ width: 46, height: 46 }} />;
            return (
              <img
                key={i}
                src={filled ? assets.stampFilled : assets.stampEmpty}
                alt={filled ? 'stamp' : 'empty'}
                style={{ width: 46, height: 46, objectFit: 'contain' }}
              />
            );
          })}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: '14px 18px 10px',
        }}
      >
        <div>
          <div style={{ fontSize: 10, letterSpacing: 0.8, opacity: 0.88, fontWeight: 500 }}>
            {t.missing}
          </div>
          <div style={{ fontSize: 22, marginTop: 4, fontWeight: 400 }}>
            {passStyle === 'stamps' ? `${missing} ${t.visit}` : `$${balance}`}
          </div>
        </div>
        {rewardName && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: 0.8, opacity: 0.88, fontWeight: 500 }}>
              {t.rewardType}
            </div>
            <div style={{ fontSize: 22, marginTop: 4, fontWeight: 400 }}>{rewardName}</div>
          </div>
        )}
      </div>

      {qr && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 20px' }}>
          <div
            style={{
              background: '#fff',
              borderRadius: 4,
              padding: '12px 12px 6px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {qr}
            {cardNum && (
              <div
                style={{
                  marginTop: 6,
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: 11,
                  color: 'var(--color-ink)',
                  letterSpacing: '0.02em',
                }}
              >
                {cardNum}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
