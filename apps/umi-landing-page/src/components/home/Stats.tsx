"use client";

import { useEffect, useRef, useState } from "react";

function useCounter(target: number, duration: number, start: boolean): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!start) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return v;
}

export default function Stats() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setInView(true);
        });
      },
      { threshold: 0.25 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  const products = useCounter(5, 1000, inView);
  const schemas = useCounter(4, 1200, inView);
  const channels = useCounter(3, 1300, inView);
  const loop = useCounter(1, 900, inView);

  return (
    <section
      ref={ref}
      aria-label="Arquitectura Umi"
      className="py-20 px-6 sm:px-8 lg:px-10 bg-[#fff8ed] text-umi-blue-deep"
    >
      <div className="container-wide grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
        <div>
          <div className="inline-flex items-center gap-3 text-[12px] font-extrabold uppercase text-umi-blue-dark mb-5">
            <span className="h-2 w-2 rounded-full bg-umi-accent" />
            <span>La arquitectura en claro</span>
          </div>
          <h2 className="font-sans text-[clamp(30px,4vw,50px)] font-extrabold leading-[1.05] mb-4">
            Umi no es una landing de servicios.
            <br />
            <em className="font-serif not-italic text-umi-blue-dark">Es una suite viva.</em>
          </h2>
          <p className="text-[16px] leading-[1.7] text-[rgba(10,20,48,0.7)] max-w-[580px]">
            El diseño cuenta lo que el código ya dice: clientes delgados, contratos
            normalizados, verdad operacional en backend y productos especializados por rol.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { num: products, unit: "", lbl: "productos conectados" },
            { num: schemas, unit: "", lbl: "esquemas de dominio" },
            { num: channels, unit: "+", lbl: "canales de experiencia" },
            { num: loop, unit: "", lbl: "operación de punta a punta" },
          ].map((s, i) => (
            <div key={s.lbl} className="rounded-[24px] border border-[var(--stroke)] bg-[#fffdf8] p-6 sm:p-8 min-h-[150px] shadow-[0_18px_60px_rgba(34,57,121,0.06)]">
              <div className="font-sans text-[clamp(44px,6vw,74px)] font-extrabold leading-none text-umi-blue-dark mb-4">
                {s.num}
                {s.unit && <span className="text-[0.42em] ml-1">{s.unit}</span>}
              </div>
              <div className="text-[13px] leading-[1.5] text-[rgba(10,20,48,0.68)] pt-3.5 border-t border-[rgba(10,20,48,0.12)] max-w-[180px]">
                {s.lbl}
              </div>
              {i === 3 && (
                <div className="mt-4 h-1.5 w-full bg-[rgba(34,57,121,0.12)]">
                  <div className="h-full w-full bg-umi-accent" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
