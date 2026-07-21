'use client';

import {
  ArrowRight,
  Camera,
  ChefHat,
  Gift,
  MessageSquareText,
  MonitorDot,
  Radar,
  Utensils,
} from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';

const PRODUCTS = [
  {
    name: 'ConversaFlow',
    note: 'Pedidos WhatsApp',
    icon: MessageSquareText,
    tone: 'text-[#8FD2C0]',
  },
  { name: 'KDS', note: 'Cocina en vivo', icon: ChefHat, tone: 'text-[#F1C66B]' },
  { name: 'Cash', note: 'Lealtad y wallet', icon: Gift, tone: 'text-[#F08D74]' },
  { name: 'Dashboard', note: 'Dueños y gerencia', icon: MonitorDot, tone: 'text-[#BFD1F2]' },
  { name: 'Logs', note: 'Observabilidad', icon: Radar, tone: 'text-[#D7C7FF]' },
];

const Hero = () => {
  return (
    <section
      id="hero"
      className="min-h-[86svh] pt-24 pb-14 px-6 sm:px-8 lg:px-10 flex items-center max-w-[1320px] mx-auto"
      data-screen-label="01 Hero"
    >
      <div className="w-full grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] gap-12 lg:gap-16 items-center">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="section-eyebrow mb-7"
          >
            <span className="section-eyebrow-rule" />
            <span>Operaciones conectadas para restaurantes</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="font-sans text-[clamp(64px,9vw,122px)] font-extrabold leading-[0.88] text-umi-blue-deep m-0 mb-7 max-w-[760px]"
          >
            Umi
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="font-sans text-[clamp(24px,2.4vw,34px)] leading-[1.12] font-extrabold text-umi-blue-deep max-w-[720px] mb-5"
          >
            Pedidos, cocina, lealtad y datos en un flujo que el restaurante sí puede seguir.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="text-[16px] sm:text-[17px] leading-[1.62] text-[rgba(20,33,66,0.72)] max-w-[600px] mb-8 font-semibold"
          >
            Una suite para restaurantes que convierte conversaciones de WhatsApp en trabajo visible:
            tickets, estados, recompensas, tableros y trazas.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.65 }}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4"
          >
            <Link href="#productos" className="btn btn-primary btn-lg justify-center">
              Ver productos <ArrowRight size={16} strokeWidth={1.8} />
            </Link>
            <Link href="#diagnostico" className="btn btn-link btn-lg justify-center">
              Encontrar mi ruta <ArrowRight size={16} strokeWidth={1.8} />
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35 }}
          className="relative"
          aria-label="Vista conceptual del sistema operativo Umi con espacio para fotografía"
        >
          <div className="photo-placeholder hero-photo min-h-[520px] sm:min-h-[620px]">
            <span className="placeholder-caption flex items-center gap-2">
              <Camera size={14} strokeWidth={2} />
              Foto hero: cocina o mostrador
            </span>
            <div className="absolute inset-x-6 bottom-6 grid gap-3 sm:grid-cols-[1fr_0.72fr]">
              <div className="product-cockpit">
                <div className="cockpit-header">
                  <div>
                    <span className="cockpit-kicker">Pedido en vivo</span>
                    <strong>2 bowls + bebida</strong>
                  </div>
                  <span className="live-pill">KDS</span>
                </div>
                <div className="pipeline">
                  {['Recibido', 'Cocina', 'Listo'].map((item, index) => (
                    <span key={item} className={index < 2 ? 'active' : ''}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div className="hidden sm:flex rounded-[24px] border border-white/50 bg-white/82 p-4 shadow-[0_18px_50px_rgba(34,57,121,0.14)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff2df] text-[#a86224]">
                    <Utensils size={20} strokeWidth={1.8} />
                  </span>
                  <div>
                    <strong className="block text-[15px] text-umi-blue-deep">+120 puntos</strong>
                    <span className="text-[12px] font-semibold text-[rgba(20,33,66,0.58)]">
                      Cliente listo para volver
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="product-dock mt-4">
            {PRODUCTS.map(({ name, note, icon: Icon, tone }) => (
              <div key={name} className="dock-item">
                <Icon size={18} className={tone} strokeWidth={1.8} />
                <div>
                  <strong>{name}</strong>
                  <span>{note}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Hero;
