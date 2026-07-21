// src/app/api/cron/emailCron.ts - Para configurar tareas programadas
import * as cron from 'node-cron';

// Interfaces para tipado fuerte
interface CronJobConfig {
  schedule: string;
  timezone?: string;
  name: string;
  description: string;
}

interface EmailCronMetrics {
  jobsExecuted: number;
  lastExecution: Date | null;
  failedExecutions: number;
  totalEmailsSent: number;
}

export class EmailCronManager {
  private static instance: EmailCronManager;
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private metrics: EmailCronMetrics = {
    jobsExecuted: 0,
    lastExecution: null,
    failedExecutions: 0,
    totalEmailsSent: 0,
  };

  static getInstance(): EmailCronManager {
    if (!EmailCronManager.instance) {
      EmailCronManager.instance = new EmailCronManager();
    }
    return EmailCronManager.instance;
  }

  scheduleSequenceProcessing() {
    const config: CronJobConfig = {
      schedule: '0 9 * * *', // Diario a las 9:00 AM
      timezone: 'America/Mexico_City',
      name: 'daily_sequences',
      description: 'Procesamiento diario de secuencias de email',
    };

    const job = cron.schedule(
      config.schedule,
      async () => {
        console.log('⏰ Ejecutando procesamiento diario de secuencias...');

        try {
          const response = await fetch('/api/email-system', { method: 'GET' });
          const result = await response.json();

          this.updateMetrics(true, result.metrics?.emailsSent || 0);
          console.log('✅ Procesamiento completado:', result);
        } catch (error) {
          this.updateMetrics(false);
          console.error('❌ Error en cron job:', this.getErrorMessage(error));
        }
      },
      // Solo incluir timezone si está definido
      config.timezone ? { timezone: config.timezone } : {},
    );

    this.jobs.set(config.name, job);
    console.log(`📅 Cron job programado: ${config.description} - ${config.schedule}`);
  }

  scheduleWeeklyReport() {
    const config: CronJobConfig = {
      schedule: '0 10 * * 1', // Lunes a las 10:00 AM
      timezone: 'America/Mexico_City',
      name: 'weekly_report',
      description: 'Reporte semanal de métricas',
    };

    const job = cron.schedule(
      config.schedule,
      async () => {
        console.log('📊 Generando reporte semanal...');

        try {
          const response = await fetch('/api/email-system', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get_metrics' }),
          });

          const result = await response.json();
          console.log('📈 Métricas semanales:', result.metrics);

          this.updateMetrics(true);
          // Enviar reporte semanal detallado
          // implementar según necesidades
        } catch (error) {
          this.updateMetrics(false);
          console.error('❌ Error en reporte semanal:', this.getErrorMessage(error));
        }
      },
      // Solo incluir timezone si está definido
      config.timezone ? { timezone: config.timezone } : {},
    );

    this.jobs.set(config.name, job);
    console.log(`📅 Cron job programado: ${config.description} - ${config.schedule}`);
  }

  scheduleHealthCheck() {
    const config: CronJobConfig = {
      schedule: '*/30 * * * *', // Cada 30 minutos
      timezone: 'America/Mexico_City',
      name: 'health_check',
      description: 'Verificación de salud del sistema',
    };

    const job = cron.schedule(
      config.schedule,
      async () => {
        console.log('🔍 Ejecutando health check...');

        try {
          const response = await fetch('/api/email-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'connection' }),
          });

          const result = await response.json();

          if (result.success) {
            console.log('✅ Sistema de email funcionando correctamente');
          } else {
            console.warn('⚠️ Problema detectado en sistema de email');
          }

          this.updateMetrics(result.success);
        } catch (error) {
          this.updateMetrics(false);
          console.error('❌ Error en health check:', this.getErrorMessage(error));
        }
      },
      // Solo incluir timezone si está definido
      config.timezone ? { timezone: config.timezone } : {},
    );

    this.jobs.set(config.name, job);
    console.log(`📅 Cron job programado: ${config.description} - ${config.schedule}`);
  }

  startAllJobs() {
    this.scheduleSequenceProcessing();
    this.scheduleWeeklyReport();
    this.scheduleHealthCheck();
    console.log('🚀 Todos los cron jobs iniciados');
  }

  stopJob(jobName: string): boolean {
    const job = this.jobs.get(jobName);
    if (job) {
      job.stop();
      this.jobs.delete(jobName);
      console.log(`🛑 Cron job detenido: ${jobName}`);
      return true;
    }
    console.warn(`⚠️ Job no encontrado: ${jobName}`);
    return false;
  }

  stopAllJobs() {
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`🛑 Cron job detenido: ${name}`);
    }
    this.jobs.clear();
    console.log('🛑 Todos los cron jobs detenidos');
  }

  getActiveJobs(): string[] {
    return Array.from(this.jobs.keys());
  }

  getJobStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const [name, job] of this.jobs) {
      // Verificar si el job está activo
      status[name] = job.getStatus() !== null;
    }
    return status;
  }

  getMetrics(): EmailCronMetrics {
    return { ...this.metrics };
  }

  resetMetrics() {
    this.metrics = {
      jobsExecuted: 0,
      lastExecution: null,
      failedExecutions: 0,
      totalEmailsSent: 0,
    };
    console.log('📊 Métricas de cron jobs reiniciadas');
  }

  private updateMetrics(success: boolean, emailsSent: number = 0) {
    this.metrics.lastExecution = new Date();

    if (success) {
      this.metrics.jobsExecuted++;
      this.metrics.totalEmailsSent += emailsSent;
    } else {
      this.metrics.failedExecutions++;
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

// Función helper para inicializar el sistema de cron jobs
export function initializeCronJobs() {
  const cronManager = EmailCronManager.getInstance();
  cronManager.startAllJobs();
  return cronManager;
}

// Función helper para obtener el manager
export function getCronManager() {
  return EmailCronManager.getInstance();
}
