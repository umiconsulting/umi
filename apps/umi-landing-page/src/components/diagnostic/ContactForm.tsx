import { useState } from 'react';
import { motion } from 'framer-motion';
import ProgressBar from './ProgressBar';

interface ContactFormProps {
  onSubmit: (contactInfo: ContactInfo) => void;
  isLoading?: boolean;
  errorMessage?: string;
}

export interface ContactInfo {
  name: string;
  email: string;
  company: string;
  phone: string;
}

const ContactForm = ({ onSubmit, isLoading = false, errorMessage }: ContactFormProps) => {
  const [contactInfo, setContactInfo] = useState<ContactInfo>({
    name: '',
    email: '',
    company: '',
    phone: '',
  });

  const [validationErrors, setValidationErrors] = useState<Partial<ContactInfo>>({});

  const validateForm = (): boolean => {
    const errors: Partial<ContactInfo> = {};

    if (!contactInfo.name.trim()) {
      errors.name = 'El nombre es requerido';
    }

    if (!contactInfo.email.trim()) {
      errors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.email)) {
      errors.email = 'Formato de email inválido';
    }

    if (!contactInfo.company.trim()) {
      errors.company = 'La empresa es requerida';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (validateForm()) {
      onSubmit(contactInfo);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setContactInfo((prev) => ({ ...prev, [name]: value }));

    // Limpiar error de validación cuando el usuario empiece a escribir
    if (validationErrors[name as keyof ContactInfo]) {
      setValidationErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <motion.div
      key="contact"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      className="py-2"
    >
      <ProgressBar
        currentStep={5}
        totalSteps={5}
        messages={{
          5: 'Paso final - Datos de contacto',
        }}
      />

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-[clamp(26px,3vw,36px)] font-extrabold leading-[1.08] text-umi-blue-deep">
            Tu ruta inicial está lista
          </h3>
          <p className="mb-6 font-semibold text-[rgba(20,33,66,0.66)]">
            Completa tus datos para recibir:
          </p>

          <div className="space-y-4 mb-6">
            <div className="flex items-start">
              <div className="mr-3 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-umi-blue-dark text-sm font-extrabold text-white">
                1
              </div>
              <div>
                <h4 className="mb-1 font-extrabold text-umi-blue-deep">Lectura por producto</h4>
                <p className="text-sm font-semibold leading-[1.45] text-[rgba(20,33,66,0.62)]">
                  Dónde entra ConversaFlow, KDS, Cash, Dashboard o Logs
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="mr-3 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-umi-blue-dark text-sm font-extrabold text-white">
                2
              </div>
              <div>
                <h4 className="mb-1 font-extrabold text-umi-blue-deep">Orden de activación</h4>
                <p className="text-sm font-semibold leading-[1.45] text-[rgba(20,33,66,0.62)]">
                  Qué conviene resolver primero para no inflar alcance
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="mr-3 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-umi-blue-dark text-sm font-extrabold text-white">
                3
              </div>
              <div>
                <h4 className="mb-1 font-extrabold text-umi-blue-deep">Riesgos de operación</h4>
                <p className="text-sm font-semibold leading-[1.45] text-[rgba(20,33,66,0.62)]">
                  Qué puede romperse si se automatiza sin trazabilidad
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] bg-[#eef3ff] p-4">
            <p className="text-sm font-extrabold text-umi-blue-dark">
              Te enviaremos la ruta por email y podremos revisarla contigo.
            </p>
          </div>
        </div>

        <div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{errorMessage}</p>
              </div>
            )}

            <div>
              <label
                htmlFor="name"
                className="mb-1 block text-sm font-extrabold text-[rgba(20,33,66,0.7)]"
              >
                Nombre completo *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={contactInfo.name}
                onChange={handleChange}
                className={`w-full rounded-2xl border bg-[#fffdf8] px-4 py-3 font-semibold text-umi-blue-deep outline-none focus:border-umi-blue-dark ${
                  validationErrors.name ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Tu nombre completo"
                disabled={isLoading}
              />
              {validationErrors.name && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.name}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-extrabold text-[rgba(20,33,66,0.7)]"
              >
                Email profesional *
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={contactInfo.email}
                onChange={handleChange}
                className={`w-full rounded-2xl border bg-[#fffdf8] px-4 py-3 font-semibold text-umi-blue-deep outline-none focus:border-umi-blue-dark ${
                  validationErrors.email ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="tu@empresa.com"
                disabled={isLoading}
              />
              {validationErrors.email && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.email}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="company"
                className="mb-1 block text-sm font-extrabold text-[rgba(20,33,66,0.7)]"
              >
                Empresa *
              </label>
              <input
                type="text"
                id="company"
                name="company"
                value={contactInfo.company}
                onChange={handleChange}
                className={`w-full rounded-2xl border bg-[#fffdf8] px-4 py-3 font-semibold text-umi-blue-deep outline-none focus:border-umi-blue-dark ${
                  validationErrors.company ? 'border-red-300' : 'border-gray-300'
                }`}
                placeholder="Nombre de tu empresa"
                disabled={isLoading}
              />
              {validationErrors.company && (
                <p className="text-sm text-red-600 mt-1">{validationErrors.company}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="phone"
                className="mb-1 block text-sm font-extrabold text-[rgba(20,33,66,0.7)]"
              >
                Teléfono (opcional)
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={contactInfo.phone}
                onChange={handleChange}
                className="w-full rounded-2xl border border-gray-300 bg-[#fffdf8] px-4 py-3 font-semibold text-umi-blue-deep outline-none focus:border-umi-blue-dark"
                placeholder="+52 123 456 7890"
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full rounded-full px-4 py-3 font-extrabold text-white transition-colors ${
                isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-umi-blue-dark hover:bg-umi-light-blue'
              }`}
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Enviando ruta...
                </div>
              ) : (
                'Recibir mi ruta Umi'
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs font-semibold text-[rgba(20,33,66,0.48)]">
            Al enviar este formulario aceptas recibir comunicaciones de Umi. No compartiremos tu
            información con terceros.
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default ContactForm;
