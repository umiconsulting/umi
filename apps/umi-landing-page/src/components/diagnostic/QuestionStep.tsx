import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import ProgressBar from "./ProgressBar";

export interface Question {
  id: number;
  question: string;
  options: {
    text: string;
    value: string;
    description: string;
  }[];
}

interface QuestionStepProps {
  question: Question;
  currentQuestion: number;
  totalQuestions: number;
  selectedValue: string | null;
  onSelect: (value: string) => void;
  onPrevious: () => void;
}

const QuestionStep = ({
  question,
  currentQuestion,
  totalQuestions,
  selectedValue,
  onSelect,
  onPrevious,
}: QuestionStepProps) => (
  <motion.div
    key={`question-${question.id}`}
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: -20 }}
    transition={{ duration: 0.3 }}
    className="py-2"
  >
    <ProgressBar
      currentStep={currentQuestion}
      totalSteps={totalQuestions + 2} // +2 for welcome and result steps
      messages={{
        1: "Diagnóstico - Primera pregunta",
        2: "Diagnóstico - Casi a mitad de camino",
        3: "Diagnóstico - Última pregunta",
      }}
    />

    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <h3 className="max-w-2xl text-[clamp(24px,3vw,34px)] font-extrabold leading-[1.08] text-umi-blue-deep">
        {question.question}
      </h3>
      <span className="text-sm font-bold text-[rgba(20,33,66,0.48)]">
        Pregunta {currentQuestion} de {totalQuestions}
      </span>
    </div>

    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      {question.options.map((option) => (
        <button
          key={option.value}
          onClick={() => onSelect(option.value)}
          className={`rounded-[24px] border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(34,57,121,0.1)] ${
            selectedValue === option.value
              ? "border-umi-blue-dark bg-[#eef3ff]"
              : "border-[var(--stroke)] bg-[#fbf7ef] hover:border-umi-blue-dark/35"
          }`}
        >
          <h4 className="mb-2 text-lg font-extrabold text-umi-blue-deep">{option.text}</h4>
          <p className="text-sm font-semibold leading-[1.5] text-[rgba(20,33,66,0.62)]">{option.description}</p>
        </button>
      ))}
    </div>

    <div className="flex justify-between mt-4">
      {currentQuestion > 1 && (
        <button
          onClick={onPrevious}
          className="flex items-center gap-2 text-sm font-extrabold text-umi-blue-dark hover:text-umi-blue-deep"
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
          Anterior
        </button>
      )}
      <div></div> {/* Spacer */}
    </div>

    <div className="mt-6 border-t border-[var(--stroke)] pt-6 text-center text-sm font-bold text-[rgba(20,33,66,0.48)]">
      <p>
        {currentQuestion === totalQuestions
          ? "Última pregunta - ¡Ya casi terminas!"
          : `Pregunta ${currentQuestion} de ${totalQuestions} - ¡Sigue avanzando!`}
      </p>
    </div>
  </motion.div>
);

export default QuestionStep;
