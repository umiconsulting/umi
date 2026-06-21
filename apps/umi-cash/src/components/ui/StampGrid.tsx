'use client';

import { getTenantAssets } from '@/lib/tenantAssets';
import { useTenant } from '@/context/TenantContext';

type Props = {
  stamps: number;
  total: number;
  cols?: number;
  size?: number;
  background?: string;
};

export function StampGrid({ stamps, total, cols = 4, size = 46, background }: Props) {
  const { slug } = useTenant();
  const assets = getTenantAssets(slug);
  const rows = Math.ceil(total / cols);

  return (
    <div
      style={{
        background,
        padding: background ? '14px 12px 16px' : 0,
        borderRadius: background ? 14 : 0,
      }}
    >
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
          if (!used) return <div key={i} style={{ width: size, height: size }} />;
          return (
            <img
              key={i}
              src={filled ? assets.stampFilled : assets.stampEmpty}
              alt={filled ? 'stamp' : 'empty'}
              style={{ width: size, height: size, objectFit: 'contain' }}
            />
          );
        })}
      </div>
    </div>
  );
}
