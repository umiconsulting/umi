// src/lib/cron/init.ts
import { EmailCronManager } from "@/app/api/cron/emailCron";

// 🚀 INICIALIZACIÓN AUTOMÁTICA
export const initializeCronJobs = () => {
  if (process.env.ENABLE_CRON_JOBS !== "false") {
    const cronManager = EmailCronManager.getInstance();
    cronManager.startAllJobs(); // CAMBIO: usar startAllJobs() en lugar de initializeAllJobs()

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log("🛑 Deteniendo cron jobs...");
      cronManager.stopAllJobs();
      process.exit(0);
    });

    console.log("✅ Cron jobs inicializados correctamente");
  } else {
    console.log("⏸️ Cron jobs deshabilitados");
  }
};

// Función para verificar el estado de los cron jobs
export const getCronJobsStatus = () => {
  if (process.env.ENABLE_CRON_JOBS !== "false") {
    const cronManager = EmailCronManager.getInstance();
    return {
      enabled: true,
      activeJobs: cronManager.getActiveJobs(),
      status: cronManager.getJobStatus(),
      metrics: cronManager.getMetrics(),
    };
  }
  return { enabled: false, jobs: [] };
};

// Función para detener manualmente los cron jobs
export const stopCronJobs = () => {
  const cronManager = EmailCronManager.getInstance();
  cronManager.stopAllJobs();
  console.log("🛑 Cron jobs detenidos manualmente");
};

// Función para reiniciar los cron jobs
export const restartCronJobs = () => {
  const cronManager = EmailCronManager.getInstance();
  cronManager.stopAllJobs();
  cronManager.startAllJobs(); // CAMBIO: usar startAllJobs()
  console.log("🔄 Cron jobs reiniciados");
};
