'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const screens = [
  {
    src: '/editorial/pos-pedido-v3.png',
    label: 'Pedido',
    caption: 'La carta, la cuenta y el cobro en la misma pantalla.',
    alt: 'Terminal UmiPOS en estudio con la pantalla de la carta de un restaurante',
  },
  {
    src: '/editorial/pos-cobro-v3.png',
    label: 'Cobro',
    caption: 'El cierre del pedido sin salir del flujo.',
    alt: 'Terminal UmiPOS en estudio con la pantalla de cobro',
  },
];

export default function PosShowcase() {
  const [index, setIndex] = useState(0);
  const go = (step: number) =>
    setIndex((current) => (current + step + screens.length) % screens.length);

  return (
    <section className="pos-showcase section-space" id="producto" aria-labelledby="pos-title">
      <div className="site-width">
        <div className="section-heading pos-heading">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-line" /> El sistema
            </p>
            <h2 id="pos-title">
              Una terminal.
              <br />
              <span>Toda la operación.</span>
            </h2>
          </div>
          <p>
            El mismo equipo para tomar la orden y cerrar la cuenta. Cambia de pantalla para ver cada
            parte del día.
          </p>
        </div>

        <div className="pos-stage">
          {screens.map((screen, i) => (
            <Image
              key={screen.src}
              src={screen.src}
              alt={screen.alt}
              width={1800}
              height={1179}
              sizes="(max-width: 900px) 100vw, 1080px"
              priority={i === 0}
              className={i === index ? 'pos-frame is-active' : 'pos-frame'}
            />
          ))}
        </div>

        <div className="pos-controls">
          <button
            type="button"
            className="pos-arrow"
            onClick={() => go(-1)}
            aria-label="Pantalla anterior"
          >
            <ArrowLeft size={18} strokeWidth={1.6} />
          </button>
          <div className="pos-tabs" role="tablist" aria-label="Pantallas del sistema">
            {screens.map((screen, i) => (
              <button
                key={screen.label}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={i === index ? 'pos-tab is-active' : 'pos-tab'}
                onClick={() => setIndex(i)}
              >
                {String(i + 1).padStart(2, '0')} {screen.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pos-arrow"
            onClick={() => go(1)}
            aria-label="Pantalla siguiente"
          >
            <ArrowRight size={18} strokeWidth={1.6} />
          </button>
        </div>

        <p className="pos-caption" aria-live="polite">
          {screens[index]?.caption ?? ''}
        </p>
      </div>
    </section>
  );
}
