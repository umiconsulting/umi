'use client';

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import Welcome from './Welcome';
import QuestionStep, { Question } from './QuestionStep';
import SnapshotResult from './SnapshotResult';
import ContactForm, { ContactInfo } from './ContactForm';
import FullResult from './FullResult';
import { apiUrl } from '../../lib/api';

// Define los tipos de datos necesarios
const questions: Question[] = [
  {
    id: 1,
    question: '¿Dónde se concentra hoy el mayor cuello de botella?',
    options: [
      {
        text: 'Pedidos',
        value: 'pedidos',
        description: 'WhatsApp, llamadas o mensajes se recapturan manualmente',
      },
      {
        text: 'Cocina',
        value: 'cocina',
        description: 'Los tickets se pierden, duplican o avanzan sin visibilidad',
      },
      {
        text: 'Clientes',
        value: 'clientes',
        description: 'No hay lealtad, wallet o recompensas consistentes',
      },
    ],
  },
  {
    id: 2,
    question: '¿Qué tan visible es la operación para dueños o gerencia?',
    options: [
      {
        text: 'A ciegas',
        value: 'inicial',
        description: 'Se pregunta por chat o se espera al cierre',
      },
      {
        text: 'Parcial',
        value: 'datos_basicos',
        description: 'Hay reportes, pero no reflejan cocina, pedidos y wallet juntos',
      },
      {
        text: 'En vivo',
        value: 'avanzado',
        description: 'Ya existen tableros y quieres integrarlos mejor',
      },
    ],
  },
  {
    id: 3,
    question: '¿Qué necesitas para confiar en la automatización?',
    options: [
      {
        text: 'Orden',
        value: 'recopilacion',
        description: 'Separar mensajes, pedidos, clientes y eventos',
      },
      {
        text: 'Trazabilidad',
        value: 'organizacion',
        description: 'Saber qué pasó cuando algo falla o se cancela',
      },
      {
        text: 'Escala',
        value: 'interpretacion',
        description: 'Operar más volumen sin meter más pasos manuales',
      },
    ],
  },
];

// Tipos de pasos del quiz
type QuizStage = 'welcome' | 'questions' | 'snapshot' | 'contact' | 'result';

// Estados del procesamiento de diagnóstico
type DiagnosticStatus = 'idle' | 'sending' | 'success' | 'error';

interface DiagnosticState {
  status: DiagnosticStatus;
  message: string;
}

const DiagnosticQuiz = () => {
  // Estados para manejar el quiz
  const [stage, setStage] = useState<QuizStage>('welcome');
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null);
  const [startTime, setStartTime] = useState<number>(Date.now());
  const [diagnosticState, setDiagnosticState] = useState<DiagnosticState>({
    status: 'idle',
    message: '',
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Marcar el inicio cuando el usuario entra a las preguntas. La condición anterior
  // (`startTime === Date.now()`) solo era cierta si el efecto corría en el mismo
  // milisegundo que el render inicial, así que nunca se cumplía: `startTime` se
  // quedaba en la hora de montaje y `completionTime` incluía el tiempo que el
  // usuario pasó en la pantalla de bienvenida.
  useEffect(() => {
    if (stage === 'questions') {
      setStartTime(Date.now());
    }
  }, [stage]);

  useEffect(() => {
    if (stage === 'welcome') return;
    const t = window.setTimeout(() => {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [stage, currentQuestion]);

  // Manejar selección de opción en las preguntas
  const handleOptionSelect = (value: string) => {
    // Guardar la respuesta
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion]: value,
    }));

    // Si hay más preguntas, avanzar a la siguiente
    if (currentQuestion < questions.length) {
      setTimeout(() => {
        setCurrentQuestion(currentQuestion + 1);
      }, 300);
    } else {
      // Si es la última pregunta, mostrar carga y avanzar al resultado parcial
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setStage('snapshot');
      }, 1500);
    }
  };

  // Manejar retroceso a pregunta anterior
  const handlePrevious = () => {
    if (currentQuestion > 1) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  // Función para enviar diagnóstico completo por email
  const sendDiagnosticEmail = async (contactData: ContactInfo) => {
    const completionTime = Math.round((Date.now() - startTime) / 1000); // en segundos

    const diagnosticData = {
      email: contactData.email,
      name: contactData.name,
      company: contactData.company,
      responses: {
        analytics_stage: answers[1] || '',
        decision_basis: answers[2] || '',
        data_challenge: answers[3] || '',
        completion_time_seconds: completionTime,
      },
    };

    try {
      const response = await fetch(apiUrl('/api/diagnostic'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(diagnosticData),
      });

      const result = await response.json();

      if (response.ok) {
        setDiagnosticState({
          status: 'success',
          message: 'Diagnóstico enviado exitosamente. Revisa tu email.',
        });

        // Tracking para analytics si está disponible
        if (typeof window !== 'undefined' && 'gtag' in window) {
          const gtag = (window as { gtag: (...args: unknown[]) => void }).gtag;
          gtag('event', 'diagnostic_completed', {
            event_category: 'Diagnostic',
            event_label: getLevelName(),
            value: getScore(),
          });
        }

        return true;
      } else {
        setDiagnosticState({
          status: 'error',
          message: result.error || 'Error al enviar diagnóstico. Inténtalo de nuevo.',
        });
        return false;
      }
    } catch (error) {
      console.error('Error al enviar diagnóstico:', error);
      setDiagnosticState({
        status: 'error',
        message: 'Error de conexión. Verifica tu internet e inténtalo de nuevo.',
      });
      return false;
    }
  };

  // Manejar envío del formulario de contacto
  const handleContactSubmit = async (contactData: ContactInfo) => {
    setDiagnosticState({
      status: 'sending',
      message: 'Enviando diagnóstico...',
    });

    // Guardar contactInfo en estado
    setContactInfo(contactData);

    // Enviar diagnóstico por email
    const success = await sendDiagnosticEmail(contactData);

    if (success) {
      // Cambiar a pantalla de resultado final
      setTimeout(() => {
        setStage('result');
      }, 2000);
    }
  };

  // Resetear el quiz
  const resetQuiz = () => {
    setStage('welcome');
    setCurrentQuestion(1);
    setAnswers({});
    setLoading(false);
    setContactInfo(null);
    // `startTime` no se toca aquí: el efecto de arriba lo fija cuando el usuario
    // vuelve a entrar a las preguntas. Un solo escritor para un solo dato.
    setDiagnosticState({ status: 'idle', message: '' });
  };

  // Funciones para calcular resultados
  const getScore = (): number => {
    const values = Object.values(answers);
    let score = 0;

    values.forEach((value) => {
      switch (value) {
        case 'inicial':
        case 'intuicion':
        case 'recopilacion':
        case 'pedidos':
          score += 2;
          break;
        case 'intermedio':
        case 'datos_basicos':
        case 'organizacion':
        case 'cocina':
          score += 5;
          break;
        case 'avanzado':
        case 'analisis':
        case 'interpretacion':
        case 'clientes':
          score += 8;
          break;
      }
    });

    return Math.round((score / (values.length * 8)) * 10);
  };

  const getLevelName = (): string => {
    const score = getScore();
    if (score <= 3) return 'Inicial';
    if (score <= 6) return 'Intermedio';
    return 'Avanzado';
  };

  const getSnapshotDescription = (): string => {
    const level = getLevelName();
    switch (level) {
      case 'Inicial':
        return 'Tu operación necesita primero una base clara: capturar pedidos, clientes y estados sin depender de recaptura manual.';
      case 'Intermedio':
        return 'Ya existe una base operativa, pero conviene conectar productos para que cocina, cliente y gerencia vean la misma historia.';
      case 'Avanzado':
        return 'Tu operación puede beneficiarse de observabilidad, automatización y medición fina para crecer sin perder control.';
      default:
        return 'Evaluación completada.';
    }
  };

  const getPrimaryOpportunity = (): string => {
    const level = getLevelName();
    switch (level) {
      case 'Inicial':
        return 'Activar ConversaFlow como puerta de entrada y definir el contrato mínimo de pedido, cliente y estado.';
      case 'Intermedio':
        return 'Conectar KDS, Cash y Dashboard para eliminar huecos entre cocina, recompensas y decisión gerencial.';
      case 'Avanzado':
        return 'Fortalecer Logs, trazas y alertas para auditar automatizaciones y detectar puntos de mejora.';
      default:
        return 'Evaluación completada.';
    }
  };

  const getOpportunityPercentage = (): number => {
    const level = getLevelName();
    switch (level) {
      case 'Inicial':
        return 3;
      case 'Intermedio':
        return 2;
      case 'Avanzado':
        return 1;
      default:
        return 0;
    }
  };

  const getRecommendations = (): Array<{
    title: string;
    description: string;
  }> => {
    const level = getLevelName();
    switch (level) {
      case 'Inicial':
        return [
          {
            title: 'Base ConversaFlow',
            description: 'Convertir conversaciones y pedidos en registros operativos claros.',
          },
          {
            title: 'Primer tablero',
            description: 'Mostrar pedidos, clientes y estados sin esperar al cierre.',
          },
          {
            title: 'Contrato de operación',
            description: 'Definir qué datos consume cocina, wallet y gerencia.',
          },
        ];
      case 'Intermedio':
        return [
          {
            title: 'KDS conectado',
            description: 'Pasar tickets a cocina con estados claros y acciones rápidas.',
          },
          {
            title: 'Cash y recurrencia',
            description: 'Dar valor al cliente después de la compra con wallet y recompensas.',
          },
          {
            title: 'Dashboard de dueño',
            description: 'Unificar pedidos, miembros, estaciones e ingresos en una vista viva.',
          },
        ];
      case 'Avanzado':
        return [
          {
            title: 'Observabilidad',
            description: 'Auditar trazas, costos, errores y seguridad de la operación.',
          },
          {
            title: 'Automatización controlada',
            description: 'Aumentar volumen sin perder explicación ni capacidad de intervención.',
          },
          {
            title: 'Ciclos de mejora',
            description: 'Usar evidencia operacional para priorizar cambios de producto.',
          },
        ];
      default:
        return [];
    }
  };

  // Obtener la pregunta actual de forma segura
  const getCurrentQuestion = (): Question | null => {
    const questionIndex = currentQuestion - 1;
    if (questionIndex >= 0 && questionIndex < questions.length) {
      return questions[questionIndex] ?? null;
    }
    return null;
  };

  const currentQuestionData: Question | null = getCurrentQuestion();

  return (
    <div
      ref={containerRef}
      className="mx-auto max-w-5xl scroll-mt-32 overflow-hidden rounded-[30px] border border-[var(--stroke)] bg-[#fffdf8] text-umi-blue-deep shadow-[0_28px_90px_rgba(34,57,121,0.12)]"
    >
      <div className="border-b border-[var(--stroke)] bg-[#f7f0e7] px-5 py-4 sm:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5 text-[12px] font-extrabold uppercase text-umi-blue-dark">
            <span className="h-2 w-2 rounded-full bg-umi-accent" />
            Diagnóstico operativo
          </div>
          <div className="text-sm font-bold text-[rgba(20,33,66,0.58)]">
            3 preguntas · ruta inicial
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-8 lg:p-10">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-umi-blue-dark mb-4"></div>
            <p className="text-[rgba(10,20,48,0.72)]">Analizando tus respuestas...</p>
          </div>
        )}

        {!loading && (
          <div>
            {/* Mostrar estado del diagnóstico si está en proceso */}
            {diagnosticState.status !== 'idle' && (
              <div className="mb-6 p-4 rounded-lg border bg-white">
                <div className="flex items-center">
                  {diagnosticState.status === 'success' ? (
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                      <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ) : diagnosticState.status === 'error' ? (
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                      <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
                      <path
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  )}
                  <span className="text-sm font-medium">{diagnosticState.message}</span>
                </div>
              </div>
            )}

            <AnimatePresence mode="wait">
              {stage === 'welcome' && <Welcome onStart={() => setStage('questions')} />}

              {stage === 'questions' && currentQuestionData && (
                <QuestionStep
                  question={currentQuestionData}
                  currentQuestion={currentQuestion}
                  totalQuestions={questions.length}
                  selectedValue={answers[currentQuestion] || null}
                  onSelect={handleOptionSelect}
                  onPrevious={handlePrevious}
                />
              )}

              {stage === 'snapshot' && (
                <SnapshotResult
                  score={getScore()}
                  levelName={getLevelName()}
                  description={getSnapshotDescription()}
                  primaryOpportunity={getPrimaryOpportunity()}
                  opportunityPercentage={getOpportunityPercentage()}
                  onContinue={() => setStage('contact')}
                  onReset={resetQuiz}
                />
              )}

              {stage === 'contact' && (
                <ContactForm
                  onSubmit={handleContactSubmit}
                  isLoading={diagnosticState.status === 'sending'}
                  {...(diagnosticState.status === 'error' && diagnosticState.message
                    ? { errorMessage: diagnosticState.message }
                    : {})}
                />
              )}

              {stage === 'result' && contactInfo && (
                <FullResult
                  title={`Tu estrategia personalizada: Nivel ${getLevelName()}`}
                  description={getSnapshotDescription()}
                  recommendationPoints={getRecommendations()}
                  contactInfo={{
                    name: contactInfo.name,
                    email: contactInfo.email,
                  }}
                  onReset={resetQuiz}
                />
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default DiagnosticQuiz;
