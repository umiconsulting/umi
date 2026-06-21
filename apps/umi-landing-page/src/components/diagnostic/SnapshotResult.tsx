import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import ProgressBar from "./ProgressBar";
import { ArrowRight, Check, RotateCcw } from "lucide-react";

interface SnapshotResultProps {
  score: number;
  levelName: string;
  description: string;
  primaryOpportunity: string;
  opportunityPercentage: number;
  onContinue: () => void;
  onReset: () => void;
}

const SnapshotResult = ({
  score,
  levelName,
  description,
  primaryOpportunity,
  opportunityPercentage,
  onContinue,
  onReset,
}: SnapshotResultProps) => (
  <motion.div
    key="snapshot"
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -20 }}
    transition={{ duration: 0.3 }}
    className="py-2"
  >
    <ProgressBar
      currentStep={4}
      totalSteps={5}
      messages={{
        4: "Resultados preliminares - 80% completado",
      }}
    />

    <div className="mb-8 grid gap-7 lg:grid-cols-[0.78fr_1.22fr] lg:items-stretch">
      <div className="rounded-[28px] bg-umi-blue-dark p-6 text-white shadow-[0_24px_70px_rgba(34,57,121,0.22)]">
        <div className="mb-5 text-sm font-extrabold uppercase text-white/62">
          Puntuación operativa
        </div>
        <div className="flex items-end gap-2">
          <span className="text-[118px] font-extrabold leading-[0.78]">{score}</span>
          <span className="pb-2 text-2xl font-extrabold text-white/55">/10</span>
        </div>
        <div className="mt-6 rounded-2xl bg-white/10 p-4">
          <p className="text-sm font-bold text-white/64">Nivel de operación conectada</p>
          <p className="text-2xl font-extrabold">{levelName}</p>
        </div>
      </div>

      <div className="rounded-[28px] border border-[var(--stroke)] bg-[#fbf7ef] p-6">
        <h3 className="mb-3 text-[clamp(26px,3vw,38px)] font-extrabold leading-[1.06] text-umi-blue-deep">
          Tu diagnóstico preliminar está listo
        </h3>
        <p className="mb-6 text-[16px] font-semibold leading-[1.6] text-[rgba(20,33,66,0.68)]">
          {description}
        </p>
        <div className="rounded-[22px] bg-[#fffdf8] p-5">
          <h4 className="mb-2 text-sm font-extrabold uppercase text-umi-blue-dark">
            Oportunidad principal
          </h4>
          <p className="mb-4 text-[15px] font-semibold leading-[1.55] text-[rgba(20,33,66,0.68)]">
            {primaryOpportunity}
          </p>
          <div className="inline-flex rounded-full bg-[#fff2df] px-3 py-1.5 text-sm font-extrabold text-[#a86224]">
            Prioridad estimada {opportunityPercentage}/3
          </div>
        </div>
      </div>
    </div>

    <div className="mb-8 rounded-[26px] border border-umi-blue-dark/15 bg-[#eef3ff] p-6">
      <h4 className="mb-4 text-xl font-extrabold text-umi-blue-deep">
        Tu informe completo está listo
      </h4>
      <p className="mb-5 font-semibold text-[rgba(20,33,66,0.66)]">
        Recibe una ruta más completa con:
      </p>
      <ul className="mb-6 grid gap-3 md:grid-cols-3">
        {[
          "Lectura de tus fricciones por producto Umi",
          "Orden sugerido de activación",
          "Riesgos operativos a resolver primero",
        ].map((item) => (
          <li key={item} className="flex items-start gap-2 rounded-[18px] bg-white/72 p-4 text-sm font-bold text-umi-blue-deep">
            <Check size={17} className="mt-0.5 shrink-0 text-umi-blue-dark" strokeWidth={2} />
              <span>{item}</span>
          </li>
        ))}
      </ul>
      <Button onClick={onContinue} variant="primary" className="w-full">
        Obtener mi informe completo
        <ArrowRight size={18} strokeWidth={1.8} />
      </Button>
    </div>

    <div className="text-center">
      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 text-sm font-extrabold text-[rgba(20,33,66,0.52)] hover:text-umi-blue-dark"
      >
        <RotateCcw size={15} strokeWidth={1.8} />
        Reiniciar diagnóstico
      </button>
    </div>
  </motion.div>
);

export default SnapshotResult;
