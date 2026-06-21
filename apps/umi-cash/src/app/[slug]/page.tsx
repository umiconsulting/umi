import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { getActiveRewardConfig, rewardConfigDefaults } from '@/lib/prisma-helpers';
import { notFound } from 'next/navigation';

function QRCodeMock({ size = 96 }: { size?: number }) {
  const cells: [number, number][] = [
    [8,8],[9,8],[11,8],[8,9],[10,9],[12,9],[9,10],[11,10],[8,11],[12,11],[10,12],[12,12],
    [14,8],[16,8],[18,8],[15,9],[17,9],[14,10],[18,10],[16,11],[14,12],[17,12],
    [8,14],[10,14],[12,14],[9,15],[11,15],[8,16],[12,16],[10,17],[9,18],[11,18],
    [14,14],[16,15],[18,14],[15,16],[14,17],[17,17],[16,18],[18,19],[14,19],
    [20,14],[19,15],[20,16],[19,17],[20,18],
    [9,3],[11,3],[13,3],[10,4],[12,4],[9,5],[13,5],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" style={{ imageRendering: 'pixelated' }}>
      <rect width="21" height="21" fill="white" />
      <rect x="0" y="0" width="7" height="7" fill="#1f1410" />
      <rect x="1" y="1" width="5" height="5" fill="white" />
      <rect x="2" y="2" width="3" height="3" fill="#1f1410" />
      <rect x="14" y="0" width="7" height="7" fill="#1f1410" />
      <rect x="15" y="1" width="5" height="5" fill="white" />
      <rect x="16" y="2" width="3" height="3" fill="#1f1410" />
      <rect x="0" y="14" width="7" height="7" fill="#1f1410" />
      <rect x="1" y="15" width="5" height="5" fill="white" />
      <rect x="2" y="16" width="3" height="3" fill="#1f1410" />
      {[8,10,12].map((x) => <rect key={`ht${x}`} x={x} y="6" width="1" height="1" fill="#1f1410" />)}
      {[8,10,12].map((y) => <rect key={`vt${y}`} x="6" y={y} width="1" height="1" fill="#1f1410" />)}
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="#1f1410" />
      ))}
    </svg>
  );
}

// Spanish ordinal for common reward counts; falls back to "Nº" for others
const ordinalEs = (n: number): string => ({
  3: 'tercer', 5: 'quinto', 6: 'sexto', 7: 'séptimo',
  8: 'octavo', 10: 'décimo', 12: 'duodécimo',
}[n] || `${n}º`);

export default async function TenantLandingPage({ params }: { params: { slug: string } }) {
  const tenant = await getTenant(params.slug);
  if (!tenant) notFound();

  const rewardConfig = await getActiveRewardConfig(tenant.id);
  const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);
  const cardNumberExample = `${tenant.cardPrefix}-1234567890`;
  const exampleVisits = 4;

  const safeHex = (c: string) => /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#333333';
  const primary = safeHex(tenant.primaryColor);
  const accent = safeHex(tenant.secondaryColor || tenant.primaryColor);

  const isCoffee = /caf[eé]/i.test(rewardName);
  const headlineLine1 = isCoffee ? `Tu ${ordinalEs(visitsRequired)} café` : rewardName;
  const headlineLine2 = isCoffee ? 'va por la casa.' : `cada ${visitsRequired} visitas.`;

  return (
    <main
      className="relative min-h-screen"
      style={{ background: 'var(--color-surface)', ['--tenant-primary' as string]: primary, ['--tenant-accent' as string]: accent }}
    >
      {/* Scrollable content */}
      <div className="px-6 pt-4 pb-[260px] max-w-lg mx-auto">
        {/* Wordmark header */}
        <div className="flex items-center justify-between pt-2 pb-1">
          <div
            className="uppercase"
            style={{
              fontFamily: '"Domus", serif',
              fontWeight: 400,
              fontSize: 15,
              letterSpacing: '0.04em',
              color: primary,
            }}
          >
            {tenant.name}
          </div>
          {tenant.city && (
            <div
              className="uppercase"
              style={{
                fontSize: 10,
                letterSpacing: '0.14em',
                fontWeight: 600,
                color: 'var(--color-ink-light)',
              }}
            >
              {tenant.city}
            </div>
          )}
        </div>

        {/* Hero: headline */}
        <div className="mt-7">
          <h1
            className="u-display"
            style={{
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: '-0.025em',
              lineHeight: 1.02,
              margin: 0,
              color: 'var(--color-ink)',
            }}
          >
            {headlineLine1}
            <br />
            {headlineLine2}
          </h1>
          <p
            style={{
              fontSize: 15,
              color: 'var(--color-ink)',
              opacity: 0.7,
              margin: '14px 0 0',
              lineHeight: 1.5,
              maxWidth: 340,
            }}
          >
            Suma una visita cada vez que vengas. Al llegar a {visitsRequired}, disfruta tu recompensa. Se guarda en tu Wallet — sin apps, sin contraseñas.
          </p>
        </div>

        {/* Pass preview — tilted 3D */}
        <div className="mt-8 flex justify-center" style={{ perspective: '800px' }}>
          <div
            style={{
              transform: 'rotateX(6deg) scale(0.94)',
              transformOrigin: 'center bottom',
              filter: 'drop-shadow(0 16px 22px rgba(31,20,16,0.14))',
            }}
          >
            <div className="w-[300px] rounded-[18px] overflow-hidden relative" style={{ backgroundColor: primary }}>
              <div className="px-4 pt-4 pb-2 flex items-start justify-between">
                {tenant.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tenant.logoUrl} alt={tenant.name} className="h-10 w-auto object-contain" />
                ) : (
                  <span className="text-white text-2xl font-black tracking-tight uppercase leading-none">{tenant.name}</span>
                )}
                {tenant.topupEnabled && (
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className="text-[10px] uppercase tracking-widest font-medium text-white/50">Saldo</p>
                    <p className="text-white text-xl font-bold leading-tight">$150.00</p>
                  </div>
                )}
              </div>

              {tenant.passStyle === 'stamps' ? (
                <div className="px-3 py-2" style={{ backgroundColor: tenant.secondaryColor || 'transparent' }}>
                  {(() => {
                    const cols = visitsRequired <= 5 ? visitsRequired : Math.ceil(visitsRequired / 2);
                    const rows: number[][] = [];
                    for (let i = 0; i < visitsRequired; i += cols) {
                      rows.push(Array.from({ length: Math.min(cols, visitsRequired - i) }, (_, j) => i + j));
                    }
                    return rows.map((row, ri) => (
                      <div key={ri} className="flex justify-center gap-1.5" style={{ marginTop: ri > 0 ? '6px' : undefined }}>
                        {row.map((i) => {
                          const isWelcome = i === 0 && params.slug === 'nectarcafe';
                          const src = isWelcome
                            ? `/logos/${params.slug}-stamp-welcome.png`
                            : `/logos/${params.slug}-stamp-${i < exampleVisits ? 'filled' : 'empty'}.png`;
                          return (
                            <div key={i} className="aspect-square flex items-center justify-center rounded-full overflow-hidden" style={{ width: `${100 / cols - 2}%` }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={src}
                                alt={isWelcome ? '15% off' : i < exampleVisits ? 'Sello' : 'Vacío'}
                                className="w-full h-full object-contain"
                              />
                            </div>
                          );
                        })}
                      </div>
                    ));
                  })()}
                </div>
              ) : tenant.stripImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tenant.stripImageUrl} alt="" className="w-full h-auto" />
              ) : (
                <div className="h-4" />
              )}

              <div className="px-4 pt-1 pb-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-white/50">Visitas faltantes</p>
                  <p className="text-white text-lg font-semibold mt-0.5">{visitsRequired - exampleVisits} visitas</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-white/50">Recompensa</p>
                  <p className="text-white text-lg font-semibold mt-0.5 truncate">{rewardName}</p>
                </div>
              </div>

              <div className="h-6" />

              <div className="bg-white mx-auto mb-5 rounded-xl p-3 flex flex-col items-center gap-1 w-fit">
                <QRCodeMock size={110} />
                <p className="text-[10px] font-mono text-gray-400 tracking-wider">{cardNumberExample}</p>
              </div>
            </div>
          </div>
        </div>

        {/* How it works — compact */}
        <div className="mt-12">
          <div
            className="u-eyebrow mb-4"
            style={{ color: 'var(--color-ink-light)' }}
          >
            Cómo funciona
          </div>
          <div className="flex flex-col gap-4">
            {[
              { n: '01', t: 'Regístrate una vez', s: 'Nombre, teléfono y cumpleaños. 30 segundos.' },
              { n: '02', t: 'Guárdala en tu Wallet', s: 'Apple Wallet o Google Wallet. Sin apps extra.' },
              { n: '03', t: 'Suma sellos', s: 'Muestra el QR al barista en cada visita.' },
              { n: '04', t: 'Gana recompensas', s: `A las ${visitsRequired} visitas: ${rewardName}.` },
            ].map((r) => (
              <div key={r.n} className="flex gap-4 items-start">
                <div
                  className="u-display"
                  style={{ width: 32, fontSize: 20, color: 'var(--color-brand)', fontWeight: 600 }}
                >
                  {r.n}
                </div>
                <div className="flex-1">
                  <div className="font-semibold" style={{ fontSize: 14, color: 'var(--color-ink)' }}>{r.t}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-light)', marginTop: 2 }}>{r.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fixed bottom CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 px-5 pb-7 pt-5"
        style={{ background: 'linear-gradient(180deg, transparent 0%, var(--color-surface) 28%)' }}
      >
        <div className="max-w-lg mx-auto">
          <Link
            href={`/${params.slug}/register`}
            className="u-btn u-btn-primary w-full"
            style={{ width: '100%', height: 54 }}
          >
            Crear mi tarjeta gratis →
          </Link>
          <div
            className="flex items-center justify-center gap-2 mt-3"
            style={{ fontSize: 11, color: 'var(--color-ink-light)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span>Gratis · Sin descargas · Nunca compartimos tu número.</span>
          </div>
          <div
            className="flex items-center justify-center gap-3 mt-2 border-t pt-2"
            style={{ fontSize: 10, color: 'var(--color-ink-light)', borderColor: 'var(--color-surface-dark)' }}
          >
            <Link href={`/${params.slug}/admin-login`} className="underline hover:opacity-80">Acceso personal</Link>
            <span>·</span>
            <Link href={`/${params.slug}/aviso-privacidad`} className="underline hover:opacity-80">Privacidad</Link>
            <span>·</span>
            <Link href={`/${params.slug}/terminos`} className="underline hover:opacity-80">Términos</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
