import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import SocialProof from './SocialProof';

interface ResultPoint {
  title: string;
  description: string;
}

interface FullResultProps {
  title: string;
  description: string;
  recommendationPoints: ResultPoint[];
  contactInfo: {
    name: string;
    email: string;
  };
  onReset: () => void;
}

const FullResult = ({
  title,
  description,
  recommendationPoints,
  contactInfo,
  onReset,
}: FullResultProps) => (
  <motion.div
    key="result"
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -20 }}
    transition={{ duration: 0.4 }}
    className="py-2"
  >
    <div className="text-center mb-10">
      <span className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-umi-blue-dark text-white shadow-[0_18px_42px_rgba(34,57,121,0.22)]">
        <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
          <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-9.618 5.04m-.023 7.032A11.955 11.955 0 0112 21.056a11.955 11.955 0 019.618-5.04m-9.618-9.072a3.18 3.18 0 00-.023 0m.023 0a3.18 3.18 0 01-.023 0M12 7.757a3 3 0 00-2.12 5.122 3 3 0 002.12.879 3 3 0 002.12-.879 3 3 0 00-2.12-5.122z"
          />
        </svg>
      </span>
      <h3 className="mb-2 text-[clamp(28px,3.6vw,44px)] font-extrabold leading-[1.05] text-umi-blue-deep">
        {title}
      </h3>
      <p className="mx-auto max-w-2xl font-semibold leading-[1.6] text-[rgba(20,33,66,0.66)]">
        {description}
      </p>

      <div className="mt-4 inline-block rounded-full bg-[#eef3ff] px-4 py-2">
        <p className="text-sm font-bold text-[rgba(20,33,66,0.66)]">
          <span className="text-umi-blue-dark">Informe enviado a:</span> {contactInfo.email}
        </p>
      </div>
    </div>

    <div className="mb-8 rounded-[28px] border border-[var(--stroke)] bg-[#fbf7ef] p-6 sm:p-8">
      <div className="mb-6">
        <h4 className="mb-4 text-2xl font-extrabold text-umi-blue-deep">
          Plan de acción personalizado
        </h4>
        <p className="mb-6 font-semibold text-[rgba(20,33,66,0.66)]">
          Basándonos en tu diagnóstico, estas son acciones iniciales para conectar mejor la
          operación:
        </p>

        <div className="space-y-6">
          {recommendationPoints.map((point, idx) => (
            <div
              key={idx}
              className="rounded-[20px] border border-[var(--stroke)] bg-[#fffdf8] p-5"
            >
              <h5 className="mb-1 text-lg font-extrabold text-umi-blue-deep">{point.title}</h5>
              <p className="font-semibold leading-[1.55] text-[rgba(20,33,66,0.64)]">
                {point.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--stroke)] pt-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h5 className="mb-1 font-extrabold text-umi-blue-deep">
              ¿Necesitas revisar esta ruta con Umi?
            </h5>
            <p className="text-sm font-semibold text-[rgba(20,33,66,0.62)]">
              Cuéntanos tu operación y afinamos el primer alcance.
            </p>
          </div>
          <Button variant="primary" onClick={() => (window.location.href = '#contacto')}>
            Contactar
          </Button>
        </div>
      </div>
    </div>

    <div className="mb-6 rounded-[26px] bg-[#eef3ff] p-6">
      <h4 className="mb-4 font-extrabold text-umi-blue-deep">Lecturas sugeridas</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-[20px] border border-[var(--stroke)] bg-white/80 p-4">
          <h5 className="mb-2 font-extrabold text-umi-blue-deep">Mapa de operación</h5>
          <p className="mb-3 text-sm font-semibold text-[rgba(20,33,66,0.62)]">
            Primeros puntos para ordenar mensajes, pedidos y cocina.
          </p>
          <a
            href="#"
            className="text-umi-blue-dark text-sm font-medium flex items-center hover:text-umi-light-blue"
          >
            Revisar con Umi
            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24">
              <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </a>
        </div>
        <div className="rounded-[20px] border border-[var(--stroke)] bg-white/80 p-4">
          <h5 className="mb-2 font-extrabold text-umi-blue-deep">Checklist de trazabilidad</h5>
          <p className="mb-3 text-sm font-semibold text-[rgba(20,33,66,0.62)]">
            Preguntas para automatizar sin perder explicación.
          </p>
          <a
            href="#"
            className="text-umi-blue-dark text-sm font-medium flex items-center hover:text-umi-light-blue"
          >
            Solicitar
            <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24">
              <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      </div>
    </div>

    <div className="flex flex-col sm:flex-row gap-4 justify-center">
      <Button
        onClick={onReset}
        variant="secondary"
        className="flex items-center justify-center gap-2"
      >
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
          <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Reiniciar diagnóstico
      </Button>
      <Button variant="primary" onClick={() => (window.location.href = '#contacto')}>
        Hablar con Umi
      </Button>
    </div>

    <SocialProof />
  </motion.div>
);

export default FullResult;
