'use client';

const SIGNALS = [
  'WhatsApp -> pedidos estructurados',
  'Cocina -> estados visibles',
  'Wallet -> visitas recurrentes',
  'Dashboard -> decisiones de dueño',
  'Logs -> confianza operativa',
];

export default function Logos() {
  return (
    <section
      aria-label="Sistema Umi"
      className="py-10 px-6 sm:px-8 lg:px-10 bg-[#fffdf8] text-umi-blue-deep"
    >
      <div className="container-wide">
        <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-10">
          <div className="flex items-center gap-2.5 text-[12px] uppercase text-umi-blue-dark font-extrabold shrink-0">
            <span className="inline-block w-2 h-2 rounded-full bg-umi-accent" />
            <span>Una sola operación</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 flex-1">
            {SIGNALS.map((signal) => (
              <span
                key={signal}
                className="rounded-full border border-[var(--stroke)] bg-[#fbf7ef] px-4 py-3 text-center text-[13px] font-bold leading-[1.35] text-[var(--ink-dim)]"
              >
                {signal}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
