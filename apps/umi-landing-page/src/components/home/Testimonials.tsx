'use client';

import { motion } from 'framer-motion';

const PRINCIPLES = [
  {
    title: 'Confianza antes que magia',
    text: 'El manual original habla de conexión, respeto y lluvia de ideas segura. En producto eso se traduce en trazas, contratos claros y decisiones explicables.',
  },
  {
    title: 'Apps delgadas, backend fuerte',
    text: 'KDS, Cash, Dashboard y Logs consumen superficies normalizadas. La verdad operativa vive donde se puede auditar y recomponer.',
  },
  {
    title: 'Diseño para trabajo real',
    text: 'Cocina necesita targets grandes; gerencia necesita señales escaneables; soporte necesita historia. Cada interfaz debe respetar su contexto.',
  },
];

const Testimonials = () => {
  return (
    <section
      id="testimonios"
      className="py-28 px-6 sm:px-8 lg:px-10 bg-umi-paper"
      data-screen-label="05 Visión"
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
          <span>Alma de marca</span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="section-title mb-5"
        >
          Umi cambió de forma.
          <br />
          <em>No cambió de brújula.</em>
        </motion.h2>
      </div>

      <div className="container-wide grid grid-cols-1 md:grid-cols-3 gap-5">
        {PRINCIPLES.map((item, i) => (
          <motion.article
            key={item.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: i * 0.1 }}
            className="rounded-[26px] border border-[var(--stroke)] bg-[#fffdf8] p-8 shadow-[0_18px_60px_rgba(34,57,121,0.06)] md:p-10 lg:p-12"
          >
            <div className="text-[12px] text-umi-accent font-extrabold mb-8">0{i + 1}</div>
            <h3 className="font-sans text-[25px] leading-[1.18] font-extrabold text-umi-blue-deep mb-4">
              {item.title}
            </h3>
            <p className="text-[15px] leading-[1.7] text-[var(--ink-dim)] m-0">{item.text}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
};

export default Testimonials;
