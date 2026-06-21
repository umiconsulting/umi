import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { ArrowRight, ClipboardList } from "lucide-react";

interface WelcomeProps {
  onStart: () => void;
}

const Welcome = ({ onStart }: WelcomeProps) => (
  <motion.div
    key="welcome"
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -20 }}
    transition={{ duration: 0.3 }}
    className="py-2"
  >
    <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
      <div>
        <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-umi-blue-dark text-white shadow-[0_18px_42px_rgba(34,57,121,0.22)]">
          <ClipboardList size={24} strokeWidth={1.8} />
        </span>
        <h3 className="mb-4 text-[clamp(30px,4vw,48px)] font-extrabold leading-[1.03] text-umi-blue-deep">
          Diagnóstico de operación conectada
        </h3>
        <p className="mb-7 max-w-xl text-[17px] font-semibold leading-[1.6] text-[rgba(20,33,66,0.68)]">
          En menos de 3 minutos ubicamos qué producto Umi conviene activar primero
          según tu flujo de pedidos, cocina, clientes y visibilidad.
        </p>

        <Button
          onClick={onStart}
          variant="primary"
          className="px-8"
        >
          Comenzar diagnóstico
          <ArrowRight size={18} strokeWidth={1.8} />
        </Button>

        <p className="mt-4 text-sm font-semibold text-[rgba(20,33,66,0.5)]">
          La recomendación es orientativa; afinamos alcance contigo.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        {[
          ["01", "puerta de entrada para pedidos y atención"],
          ["05", "superficies de producto conectadas"],
          ["3 min", "para sugerir una ruta inicial"],
        ].map(([num, label]) => (
          <div key={num} className="rounded-[22px] border border-[var(--stroke)] bg-[#fbf7ef] p-5">
            <p className="mb-1 text-[36px] font-extrabold leading-none text-umi-blue-dark">
              {num}
            </p>
            <p className="text-sm font-semibold leading-[1.45] text-[rgba(20,33,66,0.62)]">
              {label}
            </p>
          </div>
        ))}
      </div>
    </div>
  </motion.div>
);

export default Welcome;
