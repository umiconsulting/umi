import Link from 'next/link';
import { getTenant } from '@/lib/tenant';
import { nextTier } from '@/lib/reward-tiers';
import { notFound } from 'next/navigation';

function QRCodeMock({ size = 56 }: { size?: number }) {
  const cells: [number, number][] = [
    [8,8],[9,8],[11,8],[8,9],[10,9],[12,9],[9,10],[11,10],[8,11],[12,11],[10,12],[12,12],
    [14,8],[16,8],[18,8],[15,9],[17,9],[14,10],[18,10],[16,11],[14,12],[17,12],
    [8,14],[10,14],[12,14],[9,15],[11,15],[8,16],[12,16],[10,17],[9,18],[11,18],
    [14,14],[16,15],[18,14],[15,16],[14,17],[17,17],[16,18],[18,19],[14,19],
    [20,14],[19,15],[20,16],[19,17],[20,18],
    [9,3],[11,3],[13,3],[10,4],[12,4],[9,5],[13,5],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" style={{ imageRendering: 'pixelated', display: 'block' }}>
      <rect width="21" height="21" fill="white" />
      <rect x="0" y="0" width="7" height="7" fill="#132642" />
      <rect x="1" y="1" width="5" height="5" fill="white" />
      <rect x="2" y="2" width="3" height="3" fill="#132642" />
      <rect x="14" y="0" width="7" height="7" fill="#132642" />
      <rect x="15" y="1" width="5" height="5" fill="white" />
      <rect x="16" y="2" width="3" height="3" fill="#132642" />
      <rect x="0" y="14" width="7" height="7" fill="#132642" />
      <rect x="1" y="15" width="5" height="5" fill="white" />
      <rect x="2" y="16" width="3" height="3" fill="#132642" />
      {[8,10,12].map((x) => <rect key={`ht${x}`} x={x} y="6" width="1" height="1" fill="#132642" />)}
      {[8,10,12].map((y) => <rect key={`vt${y}`} x="6" y={y} width="1" height="1" fill="#132642" />)}
      {cells.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="#132642" />
      ))}
    </svg>
  );
}

function UmiFishMark({ width = 18, stroke = '#E66025', eye = '#132642' }: { width?: number; stroke?: string; eye?: string }) {
  const height = Math.round((width * 68) / 100);
  return (
    <svg width={width} height={height} viewBox="0 0 116 78" fill="none" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M50 18 C47 8, 55 3, 66 7 C74 10, 79 16, 83 21 Z" fill={stroke} />
      <path d="M53 59 C50 68, 57 74, 67 70 C73 67, 77 62, 80 57 Z" fill={stroke} />
      <path
        d="M36 39 C28 27, 17 17, 10 20 C5 23, 8 33, 18 39 C8 46, 5 56, 10 59 C17 62, 28 51, 36 39 C45 24, 63 16, 80 19 C94 21, 105 30, 109 39 C105 49, 94 58, 79 60 C62 62, 45 54, 36 39 Z"
        stroke={stroke}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="91.5" cy="37.5" r="5" fill={eye} />
    </svg>
  );
}

function UmiWordmark({ height = 12, color = '#132642' }: { height?: number; color?: string }) {
  const width = Math.round((height * 136) / 62);
  return (
    <svg width={width} height={height} viewBox="0 0 136 62" fill="none" aria-label="umi" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M11 21 C10 34, 10 47, 17 53 C23 58, 34 57, 39 50 C40 53, 42 56, 46 56 C50 56, 52 52, 52 46 C52 38, 52 28, 51 21 C50 16, 42 16, 41 21 C40 28, 41 37, 37 42 C33 46, 26 46, 24 41 C22 36, 23 27, 22 21 C21 16, 12 16, 11 21 Z" fill={color} />
      <path d="M59 23 C58 32, 58 45, 59 52 C60 57, 68 57, 69 52 C70 46, 69 36, 72 32 C74 29, 78 30, 79 34 C80 39, 79 45, 81 49 C82 53, 89 53, 90 48 C91 42, 91 34, 94 31 C97 28, 101 30, 101 36 C102 42, 101 49, 103 53 C105 57, 113 56, 113 50 C113 41, 114 29, 109 22 C104 16, 95 17, 89 23 C85 18, 76 17, 70 22 C69 17, 60 17, 59 23 Z" fill={color} />
      <path d="M120 24 C119 33, 119 45, 120 52 C121 57, 130 57, 131 51 C132 43, 131 31, 130 24 C129 19, 121 19, 120 24 Z" fill={color} />
      <ellipse cx="125.5" cy="10.5" rx="6.8" ry="6.2" transform="rotate(-8 125.5 10.5)" fill={color} />
    </svg>
  );
}

const ordinalEs = (n: number): string => ({
  3: 'tercer', 5: 'quinto', 6: 'sexto', 7: 'séptimo',
  8: 'octavo', 10: 'décimo', 12: 'duodécimo',
}[n] || `${n}º`);

export default async function TenantLandingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenant(slug);
  if (!tenant) notFound();

  const profile = tenant.rewardProfile;
  const { visitsRequired, rewardName } = profile;
  const headlineVisits = profile.baseTier?.visitsRequired ?? visitsRequired;
  const headlineReward = profile.baseTier?.rewardName ?? rewardName;
  const bonusFrom = profile.baseTier?.visitsRequired ?? null;
  const cardNumberExample = `${tenant.cardPrefix}-408219`;
  const exampleVisits = 5;
  const exampleNext = nextTier(profile, exampleVisits);

  const safeHex = (c: string) => (/^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#333333');
  const primary = safeHex(tenant.primaryColor);
  const accent = safeHex(tenant.secondaryColor || tenant.primaryColor);

  const isCoffee = /caf[eé]/i.test(headlineReward);
  const headlineLine1 = isCoffee ? `Tu ${ordinalEs(headlineVisits)} café` : headlineReward;
  const headlineLine2 = isCoffee ? 'va por la casa.' : `cada ${headlineVisits} visitas.`;

  return (
    <main
      className="umi-naive-customer relative min-h-screen"
      style={{
        ['--tenant-primary' as string]: primary,
        ['--tenant-accent' as string]: accent,
      }}
    >
      <div className="px-6 pt-5 pb-[230px] max-w-md mx-auto">
        {/* Wordmark header */}
        <div className="flex items-center justify-between pt-1 pb-1">
          <div
            className="uppercase u-display"
            style={{
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.06em',
              color: primary,
            }}
          >
            {tenant.name}
          </div>
          {tenant.city && (
            <div
              className="uppercase u-mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                fontWeight: 600,
                color: '#586A84',
              }}
            >
              {tenant.city}
            </div>
          )}
        </div>

        {/* Hero headline with Naive tilted pill highlight */}
        <div className="mt-4">
          <h1
            className="u-display"
            style={{
              fontSize: 35,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.06,
              margin: 0,
              color: '#132642',
            }}
          >
            {headlineLine1}
            <br />
            <span className="naive-cust-pill-highlight mt-1">{headlineLine2}</span>
          </h1>
          <p
            style={{
              fontSize: 13.5,
              color: '#586A84',
              margin: '11px 0 0',
              lineHeight: 1.5,
            }}
          >
            Suma una visita cada vez que vengas. Se guarda en tu Apple o Google Wallet — sin apps, sin contraseñas.
          </p>
        </div>

        {/* Authentic Wallet Pass Preview */}
        <div className="mt-6 flex justify-center relative pt-3">
          <span className="naive-rubber-stamp">SIN APPS ★</span>
          <div className="naive-wallet-pass">
            <div className="px-4 pt-4 pb-2.5 flex items-center justify-between gap-2">
              {tenant.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tenant.logoUrl} alt={tenant.name} className="h-7 w-auto max-w-[160px] object-contain" />
              ) : (
                <span className="text-white text-lg font-extrabold tracking-tight u-display">
                  {tenant.name}
                </span>
              )}
              {tenant.topupEnabled && (
                <div className="text-right flex-shrink-0">
                  <p className="text-[9px] uppercase tracking-widest u-mono text-white/70">Saldo</p>
                  <p className="text-white text-base font-bold leading-tight u-display">$150.00</p>
                </div>
              )}
            </div>

            {tenant.passStyle === 'stamps' ? (
              <div
                className="px-3.5 py-2.5"
                style={{ backgroundColor: tenant.secondaryColor || '#EFE3CE' }}
              >
                {(() => {
                  const cols = visitsRequired <= 5 ? visitsRequired : Math.ceil(visitsRequired / 2);
                  const rows: number[][] = [];
                  for (let i = 0; i < visitsRequired; i += cols) {
                    rows.push(
                      Array.from({ length: Math.min(cols, visitsRequired - i) }, (_, j) => i + j),
                    );
                  }
                  return rows.map((row, ri) => (
                    <div
                      key={ri}
                      className="flex justify-center gap-1.5"
                      style={{ marginTop: ri > 0 ? '6px' : undefined }}
                    >
                      {row.map((i) => {
                        const isWelcome = i === 0 && slug === 'nectarcafe';
                        const filled = i < exampleVisits;
                        const src = isWelcome
                          ? `/logos/${slug}-stamp-welcome.png`
                          : `/logos/${slug}-stamp-${filled ? 'filled' : 'empty'}.png`;
                        const isBonus = bonusFrom != null && i >= bonusFrom;
                        return (
                          <div
                            key={i}
                            className="aspect-square flex items-center justify-center rounded-full overflow-hidden"
                            style={{
                              width: `${100 / cols - 2}%`,
                              transform:
                                filled || isWelcome
                                  ? i % 2 === 0
                                    ? 'rotate(-5deg)'
                                    : 'rotate(5deg)'
                                  : undefined,
                              ...(isBonus
                                ? {
                                    boxShadow: 'inset 0 0 0 3px #78AAD2',
                                    filter: 'hue-rotate(170deg) saturate(1.3)',
                                  }
                                : {}),
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt={isWelcome ? '15% off' : filled ? 'Sello' : 'Vacío'}
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

            <div className="px-4 py-2.5 flex justify-between gap-3">
              <div>
                <p className="text-[9px] uppercase tracking-widest u-mono text-white/70">
                  Te faltan
                </p>
                <p className="text-white text-sm font-bold mt-0.5">
                  {exampleNext.remaining} visitas
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-widest u-mono text-white/70">
                  Recompensa
                </p>
                <p className="text-white text-sm font-bold mt-0.5 truncate">
                  {exampleNext.rewardName}
                </p>
              </div>
            </div>

            <div style={{ borderTop: '1.75px dashed rgba(255, 253, 248, 0.4)' }} />

            <div
              className="px-4 py-3 flex items-center justify-between gap-3"
              style={{ background: 'rgba(0, 0, 0, 0.14)' }}
            >
              <div>
                <div className="text-[9px] uppercase tracking-widest u-mono text-white/70">
                  Muestra al barista
                </div>
                <div className="text-xs font-semibold u-mono mt-1 tracking-wider">
                  {cardNumberExample}
                </div>
              </div>
              <div
                className="bg-white p-1.5 rounded-[10px] inline-flex"
                style={{ border: '1.5px solid #132642' }}
              >
                <QRCodeMock size={50} />
              </div>
            </div>
          </div>
        </div>

        {/* How it works — Naive carded steps in merchant color */}
        <div className="mt-7">
          <div className="u-mono text-[10px] font-semibold uppercase tracking-widest text-[#586A84] mb-2.5">
            Cómo funciona
          </div>
          <div className="flex flex-col gap-2">
            {[
              { n: '1', t: 'Regístrate en un momento', s: 'Nombre, teléfono y cumpleaños.' },
              {
                n: '2',
                t: 'Guárdala en tu Wallet',
                s: 'Apple Wallet o Google Wallet, sin descargas.',
              },
              {
                n: '3',
                t: 'Junta tus sellos y disfruta',
                s: `${headlineReward}${profile.baseTier ? ` · o ${rewardName}` : ''}.`,
              },
            ].map((r) => (
              <div key={r.n} className="naive-step-row">
                <span className="naive-step-num">{r.n}</span>
                <div>
                  <div className="font-bold text-[12.5px] text-[#132642] leading-tight">{r.t}</div>
                  <div className="text-[11px] text-[#586A84] mt-0.5">{r.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fixed bottom CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 px-5 pb-5 pt-4"
        style={{ background: 'linear-gradient(180deg, transparent 0%, #F8F3E9 26%)' }}
      >
        <div className="max-w-md mx-auto">
          <Link href={`/${slug}/register`} className="naive-cust-cta">
            <span>Crear mi tarjeta gratis</span>
            <span>→</span>
          </Link>
          <div className="flex items-center justify-center gap-1.5 mt-2.5 text-[11px] text-[#586A84]">
            <span>Tarjeta impulsada por</span>
            <UmiFishMark width={17} stroke="#E66025" eye="#132642" />
            <UmiWordmark height={12} color="#132642" />
          </div>
          <div
            className="flex items-center justify-center gap-3 mt-1.5 pt-1.5 border-t text-[10px] text-[#586A84]"
            style={{ borderColor: 'rgba(19, 38, 66, 0.1)' }}
          >
            <Link href={`/${slug}/admin`} className="underline hover:opacity-80">
              Acceso personal
            </Link>
            <span>·</span>
            <Link href={`/${slug}/aviso-privacidad`} className="underline hover:opacity-80">
              Privacidad
            </Link>
            <span>·</span>
            <Link href={`/${slug}/terminos`} className="underline hover:opacity-80">
              Términos
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
