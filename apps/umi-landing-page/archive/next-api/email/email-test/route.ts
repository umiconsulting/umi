// 🔄 ACTUALIZACIÓN DE: src/app/api/email/email-test/route.ts
// Mejorando el archivo existente con funcionalidad completa

import { NextRequest, NextResponse } from 'next/server';
import { getEmailService } from '@/lib/email/email-service';
import { getSequenceManager } from '@/lib/email/sequence-manager';
import { EmailTemplates } from '@/lib/email/templates';

// Interfaces para type safety
interface TestRequest {
  type: string;
  email?: string;
  templateName?: string;
}

// Mantener compatibilidad con función existente
export async function testEmailSystem(request: NextRequest) {
  try {
    const { email, type = 'connection' } = await request.json();
    return await handleTest(type, email);
  } catch (error) {
    console.error('❌ Error en test de email:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json(
      { error: 'Error ejecutando test', details: errorMessage },
      { status: 500 },
    );
  }
}

// Nueva función POST para manejar todos los tipos de test
export async function POST(request: NextRequest) {
  try {
    const { type, email, templateName }: TestRequest = await request.json();
    return await handleTest(type, email, templateName);
  } catch (error) {
    console.error('❌ Error en testing:', error);
    const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
    return NextResponse.json(
      { error: 'Error ejecutando test', details: errorMessage },
      { status: 500 },
    );
  }
}

// Función unificada para manejar tests
async function handleTest(type: string, email?: string, templateName?: string) {
  switch (type) {
    case 'connection':
      return await testConnection();

    case 'send_test':
      if (!email) {
        return NextResponse.json({ error: 'Email de destino requerido' }, { status: 400 });
      }
      return await testSendEmail(email);

    case 'template_test':
      if (!email) {
        return NextResponse.json({ error: 'Email de destino requerido' }, { status: 400 });
      }
      if (!templateName) {
        return NextResponse.json({ error: 'Nombre de template requerido' }, { status: 400 });
      }
      return await testTemplate(email, templateName);

    case 'sequence_test':
      if (!email) {
        return NextResponse.json({ error: 'Email de destino requerido' }, { status: 400 });
      }
      return await testSequence(email);

    case 'system_health':
      return await testSystemHealth();

    default:
      return NextResponse.json(
        {
          error: 'Tipo de test inválido',
          validTypes: [
            'connection',
            'send_test',
            'template_test',
            'sequence_test',
            'system_health',
          ],
        },
        { status: 400 },
      );
  }
}

// Funciones de testing
async function testConnection() {
  console.log('🔍 Testing conexión de email...');

  const emailService = getEmailService();
  const isConnected = await emailService.testConnection();

  return NextResponse.json({
    success: isConnected,
    test: 'connection',
    message: isConnected ? '✅ Conexión exitosa' : '❌ Error de conexión',
    timestamp: new Date().toISOString(),
  });
}

async function testSendEmail(testEmail: string) {
  console.log(`📧 Testing envío a: ${testEmail}`);

  const emailService = getEmailService();
  const success = await emailService.sendTestEmail(testEmail);

  return NextResponse.json({
    success,
    test: 'send_test',
    recipient: testEmail,
    message: success ? '✅ Email de prueba enviado' : '❌ Error enviando email',
    timestamp: new Date().toISOString(),
  });
}

async function testTemplate(testEmail: string, templateName: string) {
  const template = EmailTemplates[templateName as keyof typeof EmailTemplates];
  if (!template) {
    return NextResponse.json(
      {
        error: 'Template no encontrado',
        availableTemplates: Object.keys(EmailTemplates),
      },
      { status: 400 },
    );
  }

  console.log(`🎨 Testing template '${templateName}' para: ${testEmail}`);

  // Datos de prueba para el template
  const testData = {
    contactInfo: {
      name: 'Usuario de Prueba',
      email: testEmail,
      company: 'Empresa Test',
    },
    diagnosticData: {
      score: 5,
      level: 'Intermedio',
      primaryChallenge: 'Organización de datos',
      quickWins: [
        {
          action: 'Dashboard básico',
          description: 'Implementar KPIs principales',
        },
      ],
      estimatedROI: {
        timeToValue: 30,
        expectedReturn: 200,
      },
    },
  };

  const emailService = getEmailService();
  const html = template(testData);

  const success = await emailService.sendEmail({
    to: testEmail,
    subject: `🧪 Test Template: ${templateName}`,
    html,
    campaign: 'template_test',
    priority: 'normal',
  });

  return NextResponse.json({
    success,
    test: 'template_test',
    template: templateName,
    recipient: testEmail,
    message: success ? `✅ Template '${templateName}' enviado` : '❌ Error enviando template',
    timestamp: new Date().toISOString(),
  });
}

async function testSequence(testEmail: string) {
  console.log(`🔄 Testing secuencia para: ${testEmail}`);

  const sequenceManager = getSequenceManager();
  const success = await sequenceManager.testSequence(testEmail);

  return NextResponse.json({
    success,
    test: 'sequence_test',
    recipient: testEmail,
    message: success ? '✅ Secuencia de prueba ejecutada' : '❌ Error en secuencia',
    timestamp: new Date().toISOString(),
  });
}

async function testSystemHealth() {
  console.log('🏥 Testing salud del sistema...');

  const emailService = getEmailService();
  const sequenceManager = getSequenceManager();

  // Test conexión
  const connectionOk = await emailService.testConnection();

  // Métricas del sistema
  const emailMetrics = emailService.getMetrics();
  const sequenceMetrics = sequenceManager.getMetrics();

  // Variables de entorno
  const envVars = {
    EMAIL_USER: !!process.env.EMAIL_USER,
    EMAIL_PASSWORD: !!process.env.EMAIL_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
  };

  const allHealthy = connectionOk && envVars.EMAIL_USER && envVars.EMAIL_PASSWORD;

  return NextResponse.json({
    success: allHealthy,
    test: 'system_health',
    results: {
      connection: connectionOk,
      environment: envVars,
      emailMetrics,
      sequenceMetrics,
      lastCheck: new Date().toISOString(),
    },
    message: allHealthy ? '✅ Sistema saludable' : '⚠️ Problemas detectados',
    timestamp: new Date().toISOString(),
  });
}
