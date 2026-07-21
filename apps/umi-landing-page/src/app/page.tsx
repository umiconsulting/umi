'use client';

import Navbar from '@/components/layout/Navbar';
import Hero from '@/components/home/Hero';
import Logos from '@/components/home/Logos';
import Services from '@/components/home/Services';
import Stats from '@/components/home/Stats';
import DiagnosticQuiz from '@/components/diagnostic/DiagnosticQuiz';
import Process from '@/components/home/Process';
import Testimonials from '@/components/home/Testimonials';
import ContactSection from '@/components/home/ContactSection';
import Footer from '@/components/layout/Footer';
import { motion } from 'framer-motion';

export default function Home() {
  return (
    <main className="min-h-screen">
      <Navbar />

      <Hero />

      <Logos />

      <Services />

      <Stats />

      {/* Diagnóstico Rápido */}
      <section
        id="diagnostico"
        className="scroll-mt-28 py-32 px-6 sm:px-8 lg:px-10"
        data-screen-label="03 Diagnóstico"
      >
        <div className="container-wide mb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="section-eyebrow mb-6"
          >
            <span className="section-eyebrow-rule" />
            <span>Diagnóstico operativo</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            viewport={{ once: true }}
            className="section-title mb-5"
          >
            3 minutos.
            <br />
            <em>Qué producto activar primero.</em>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            viewport={{ once: true }}
            className="section-lede"
          >
            Sin pitch genérico: ubicamos si tu cuello de botella está en pedidos, cocina, lealtad,
            visibilidad gerencial u observabilidad.
          </motion.p>
        </div>

        <div className="container-wide">
          <DiagnosticQuiz />
        </div>
      </section>

      <Process />

      <Testimonials />

      <ContactSection />

      <Footer />
    </main>
  );
}
