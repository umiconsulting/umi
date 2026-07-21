'use client';

import {
  ArrowRight,
  Camera,
  ChefHat,
  Gift,
  MessageSquareText,
  MonitorDot,
  Radar,
} from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

const PRODUCTS = [
  {
    tag: '01',
    icon: MessageSquareText,
    kicker: 'ConversaFlow',
    title: 'Pedidos y atención por WhatsApp con memoria operativa.',
    desc: 'Convierte conversaciones en pedidos, eventos, jobs y mensajes salientes trazables. El backend conserva la verdad operativa y normaliza lo que cada app consume.',
    bullets: [
      'Ingesta y normalización',
      'Jobs y outbox',
      'Memoria contextual',
      'Wakeups para notificaciones',
    ],
    signal: 'Del chat al pedido sin copiar y pegar',
    visual: 'Foto: cliente haciendo pedido por WhatsApp',
  },
  {
    tag: '02',
    icon: ChefHat,
    kicker: 'Umi KDS',
    title: 'Pantalla de cocina para mover tickets con pocos taps.',
    desc: 'Una app nativa de iPad para estaciones de cocina. Lee proyecciones backend, no payloads crudos, y permite avanzar, cancelar o ajustar tickets.',
    bullets: [
      'Board iPad-first',
      'Eventos ordenados',
      'Cancelación parcial',
      'Estados para cliente',
    ],
    signal: 'Cocina ve solo lo que necesita',
    visual: 'Foto: estación de cocina con tickets',
  },
  {
    tag: '03',
    icon: Gift,
    kicker: 'Umi Cash',
    title: 'Lealtad, monedero y pases para que el cliente vuelva.',
    desc: 'Capa de wallet, recompensas, gift cards y pases digitales. Diseñada para pertenecer al restaurante, no a una plantilla genérica.',
    bullets: ['Wallet y saldo', 'Sellos y recompensas', 'Pases Apple/Google', 'Tenant y sesiones'],
    signal: 'Cada visita deja una razón para regresar',
    visual: 'Foto: cliente en caja o pickup',
  },
  {
    tag: '04',
    icon: MonitorDot,
    kicker: 'Umi Dashboard',
    title: 'Vista de dueño con pedidos, miembros, cocina e ingresos.',
    desc: 'El panel reúne señales vivas de Cash, KDS y ConversaFlow para que la gerencia entienda la operación sin abrir cinco herramientas.',
    bullets: ['Métricas en vivo', 'Centro de acción', 'Estaciones KDS', 'Actividad de wallet'],
    signal: 'La operación deja de estar escondida',
    visual: 'Foto: dueño revisando dashboard',
  },
  {
    tag: '05',
    icon: Radar,
    kicker: 'Umi Logs',
    title: 'Observabilidad para confiar en la automatización.',
    desc: 'Trazas, invocaciones, costos, errores, seguridad y pipeline de órdenes para auditar qué pasó y corregir rápido.',
    bullets: ['System pulse', 'Timeline de trazas', 'Costos de IA', 'Alertas operativas'],
    signal: 'Si algo falla, hay historia',
    visual: 'Foto: equipo revisando operación',
  },
];

const Services = () => {
  return (
    <section
      id="productos"
      className="py-28 px-6 sm:px-8 lg:px-10"
      data-screen-label="02 Productos"
    >
      <div className="container-wide mb-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="section-eyebrow mb-6"
        >
          <span className="section-eyebrow-rule" />
          <span>Productos</span>
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="section-title mb-5"
        >
          Cinco superficies.
          <br />
          <em>Una misma operación.</em>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="section-lede"
        >
          La landing anterior vendía análisis. La nueva explica el sistema: cada producto resuelve
          una parte distinta del ciclo restaurante-cliente-operación.
        </motion.p>
      </div>

      <div className="container-wide product-grid">
        {PRODUCTS.map((product, i) => {
          const Icon = product.icon;
          return (
            <motion.article
              key={product.tag}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.05 + i * 0.06 }}
              className="product-card"
            >
              <div className="photo-placeholder mb-6 aspect-[4/3] rounded-[22px]">
                <span className="placeholder-caption flex items-center gap-2">
                  <Camera size={13} strokeWidth={2} />
                  {product.visual}
                </span>
              </div>

              <div className="flex items-start justify-between gap-5 mb-8">
                <span className="text-[12px] text-umi-accent font-extrabold">{product.tag}</span>
                <span className="product-icon">
                  <Icon size={22} strokeWidth={1.7} />
                </span>
              </div>

              <div className="text-[12px] uppercase text-umi-blue-dark font-extrabold mb-3">
                {product.kicker}
              </div>
              <h3 className="font-sans text-[24px] font-extrabold leading-[1.12] text-umi-blue-deep mb-4">
                {product.title}
              </h3>
              <p className="text-[15px] leading-[1.65] text-[var(--ink-dim)] mb-7">
                {product.desc}
              </p>

              <ul className="list-none p-0 m-0 mb-6">
                {product.bullets.slice(0, 3).map((bullet) => (
                  <li
                    key={bullet}
                    className="flex items-center gap-3 text-sm leading-[1.45] text-[var(--ink-dim)] py-2"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-umi-accent shrink-0" />
                    {bullet}
                  </li>
                ))}
              </ul>

              <div className="mt-auto rounded-[20px] bg-[#f7f0e7] p-4">
                <div className="text-[11px] uppercase text-[var(--ink-faint)] mb-2 font-extrabold">
                  Señal de valor
                </div>
                <p className="text-sm leading-[1.55] text-umi-blue-deep font-bold">
                  {product.signal}
                </p>
              </div>
            </motion.article>
          );
        })}
      </div>

      <div className="container-wide mt-12">
        <Link
          href="#contacto"
          className="inline-flex items-center gap-2 text-[12px] uppercase font-extrabold text-umi-blue-dark hover:text-umi-blue-deep border-b border-umi-blue-dark pb-1 transition-all"
        >
          Hablar de implementación <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      </div>
    </section>
  );
};

export default Services;
