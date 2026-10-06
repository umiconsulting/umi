'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const STEPS = [
  {
    n: '01',
    t: 'Conversación',
    d: 'El cliente escribe por WhatsApp. ConversaFlow entiende intención, contexto y negocio antes de convertir el mensaje en trabajo operativo.',
    dur: 'Entrada',
  },
  {
    n: '02',
    t: 'Normalización',
    d: 'La información se guarda como contrato usable: pedidos, clientes, eventos, jobs y outbox. Las apps no cargan payloads crudos.',
    dur: 'Backend',
  },
  {
    n: '03',
    t: 'Ejecución',
    d: 'KDS mueve el pedido en cocina; Cash asigna valor al cliente; el dashboard muestra lo que requiere decisión.',
    dur: 'Operación',
  },
  {
    n: '04',
    t: 'Notificación',
    d: 'Los cambios relevantes regresan al cliente por el canal correcto: aceptado, preparando, listo, completado o cancelado con razón.',
    dur: 'Salida',
  },
  {
    n: '05',
    t: 'Observabilidad',
    d: 'Logs y trazas dejan evidencia para corregir, explicar costos, revisar seguridad y mejorar el flujo con base en hechos.',
    dur: 'Confianza',
  },
];

const Process = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = 1 - (rect.bottom - vh * 0.4) / rect.height;
      const idx = Math.min(STEPS.length - 1, Math.max(0, Math.floor(progress * STEPS.length)));
      setActive(idx);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section
      id="proceso"
      className="py-28 px-6 sm:px-8 lg:px-10 bg-[#fffdf8]"
      data-screen-label="04 Sistema"
    >
      <div className="container-wide mb-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="section-eyebrow mb-6"
        >
          <span className="section-eyebrow-rule" />
          <span>Sistema operativo</span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="section-title mb-5"
        >
          Del mensaje del cliente
          <br />
          <em>a una operación visible.</em>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="section-lede"
        >
          La promesa no es automatizar por automatizar. Es mantener confianza, contexto y
          trazabilidad mientras el restaurante se mueve.
        </motion.p>
      </div>

      <div ref={ref} className="max-w-[980px] mx-auto relative px-6 sm:px-8">
        <div className="absolute left-8 top-5 bottom-5 w-px bg-[var(--stroke)]">
          <div
            className="w-full bg-umi-accent transition-[height] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]"
            style={{ height: `${((active + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {STEPS.map((s, i) => (
          <div
            key={s.n}
            className={`grid grid-cols-[86px_1fr] md:grid-cols-[160px_1fr] gap-5 md:gap-12 py-8 border-b border-[var(--stroke)] relative transition-opacity duration-500 ${
              i <= active ? 'opacity-100' : 'opacity-40'
            }`}
          >
            <div className="relative pl-7">
              <div className="text-[13px] text-umi-blue-dark font-extrabold relative">
                <span
                  className={`absolute -left-8 top-[3px] w-2.5 h-2.5 border transition-all duration-500 ${
                    i <= active
                      ? 'bg-umi-accent border-umi-accent'
                      : 'bg-[#fffdf8] border-[var(--stroke-strong)]'
                  }`}
                />
                {s.n}
              </div>
              <div className="text-[11px] mt-2.5 text-[var(--ink-faint)] uppercase font-extrabold">
                {s.dur}
              </div>
            </div>
            <div>
              <h3 className="font-sans text-[clamp(22px,2.4vw,28px)] font-extrabold m-0 mb-2.5 text-umi-blue-deep">
                {s.t}
              </h3>
              <p className="text-base leading-[1.6] text-[var(--ink-dim)] m-0 max-w-[620px]">
                {s.d}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default Process;
