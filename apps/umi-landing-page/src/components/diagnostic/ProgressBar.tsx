import { motion } from "framer-motion";

interface ProgressBarProps {
  currentStep: number;
  totalSteps: number;
  messages?: { [key: number]: string };
}

const ProgressBar = ({
  currentStep,
  totalSteps,
  messages,
}: ProgressBarProps) => {
  const progressPercentage = (currentStep / totalSteps) * 100;

  return (
    <div className="mb-7">
      <div className="mb-2 flex justify-between text-sm font-bold text-[rgba(20,33,66,0.58)]">
        <span>
          {messages && messages[currentStep]
            ? messages[currentStep]
            : `Paso ${currentStep} de ${totalSteps}`}
        </span>
        <span>{Math.round(progressPercentage)}% completado</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#efe5d8]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progressPercentage}%` }}
          transition={{ duration: 0.5 }}
          className="h-2.5 rounded-full bg-umi-accent"
        ></motion.div>
      </div>
    </div>
  );
};

export default ProgressBar;
