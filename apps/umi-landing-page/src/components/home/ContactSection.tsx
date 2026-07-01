"use client";

import { useState, ChangeEvent, FormEvent } from "react";
import { motion } from "framer-motion";
import { apiUrl } from "../../lib/api";

type FormStatus = "idle" | "sending" | "success" | "error";

interface FormState {
  status: FormStatus;
  message: string;
}

const Arrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 12l5 5L20 6" />
  </svg>
);

const NEEDS = [
  { value: "conversaflow", label: "Pedidos WhatsApp" },
  { value: "kds", label: "Cocina / KDS" },
  { value: "cash", label: "Lealtad / Wallet" },
  { value: "suite", label: "Suite completa" },
];

const CONTACT_EMAIL = "hola@umiconsulting.co";

const ContactSection = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    need: "suite",
    message: "",
  });

  const [formState, setFormState] = useState<FormState>({
    status: "idle",
    message: "",
  });
  const [submittedName, setSubmittedName] = useState("");

  const [privacy, setPrivacy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (formState.status === "error") setFormState({ status: "idle", message: "" });
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched({ name: true, email: true, company: true, message: true, privacy: true });

    if (!formData.name.trim() || !formData.email.trim()) {
      setFormState({ status: "error", message: "Por favor completa los campos requeridos." });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setFormState({ status: "error", message: "Por favor ingresa un email válido." });
      return;
    }
    if (!formData.message.trim() || formData.message.trim().length < 10) {
      setFormState({ status: "error", message: "Cuéntanos un poco más (10+ caracteres)." });
      return;
    }
    if (!privacy) {
      setFormState({ status: "error", message: "Debes aceptar el aviso de privacidad." });
      return;
    }

    setFormState({ status: "sending", message: "" });

    try {
      const response = await fetch(apiUrl("/api/contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await response.json();

      if (response.ok) {
        setSubmittedName(formData.name);
        setFormState({
          status: "success",
          message:
            "Gracias. Recibimos tu mensaje y te respondemos en menos de 48 horas hábiles.",
        });
        setFormData({ name: "", email: "", company: "", need: "suite", message: "" });
        setPrivacy(false);
        if (typeof window !== "undefined" && "gtag" in window) {
          const gtag = (window as { gtag: (...args: unknown[]) => void }).gtag;
          gtag("event", "form_submit", { event_category: "Contact", event_label: formData.need });
        }
      } else {
        setFormState({
          status: "error",
          message: result.error || "Hubo un error al enviar tu consulta. Inténtalo de nuevo.",
        });
      }
    } catch (err) {
      console.error("Error:", err);
      setFormState({
        status: "error",
        message: "Error de conexión. Verifica tu internet e inténtalo de nuevo.",
      });
    }
  };

  return (
    <section
      id="contacto"
      className="relative py-32 px-6 sm:px-8 lg:px-10 bg-umi-paper text-umi-blue-deep"
      data-screen-label="06 Contacto"
    >
      <div className="container-wide grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start">
        {/* LEFT */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="pt-3.5 border-t border-[rgba(10,20,48,0.25)]"
        >
          <div className="inline-flex items-center gap-3 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-umi-blue-dark mt-3.5 mb-6">
            <span className="h-px w-7 bg-umi-blue-dark" />
            <span>Contacto</span>
          </div>

          <h2 className="font-serif text-[clamp(32px,4.2vw,54px)] font-light leading-[1.08] tracking-[-0.022em] text-umi-blue-deep m-0 mb-5">
            ¿Listo para conectar tu operación
            <br />
            con <em className="not-italic italic text-umi-blue-dark font-light">productos Umi</em>?
          </h2>

          <p className="font-serif text-[17px] leading-[1.6] text-[rgba(10,20,48,0.72)] m-0 mb-8 max-w-[480px] font-light">
            Cuéntanos dónde se rompe hoy el flujo: mensajes, cocina, clientes frecuentes,
            visibilidad del dueño u observabilidad.
          </p>

          <ul className="list-none p-0 m-0 mb-10">
            {[
              "Revisión inicial por producto y prioridad operativa",
              "Ruta sugerida sin inflar alcance",
              "Confidencialidad garantizada si compartes datos sensibles",
            ].map((t, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 py-2.5 text-[15px] text-[rgba(10,20,48,0.72)] border-b border-[rgba(10,20,48,0.12)] ${
                  i === 0 ? "border-t border-[rgba(10,20,48,0.12)]" : ""
                }`}
              >
                <span className="text-umi-accent flex-shrink-0">
                  <Check />
                </span>
                {t}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-5 pt-7 border-t border-[rgba(10,20,48,0.25)]">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgba(10,20,48,0.5)] mb-1.5">
                Correo directo
              </div>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-serif text-lg text-umi-blue-deep tracking-[-0.01em] hover:text-umi-blue-dark"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgba(10,20,48,0.5)] mb-1.5">
                WhatsApp
              </div>
              <div className="font-serif text-lg text-umi-blue-deep tracking-[-0.01em]">
                +52 667 730 1913
              </div>
            </div>
          </div>
        </motion.div>

        {/* RIGHT — Form */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="bg-white border border-[rgba(10,20,48,0.25)] p-7 sm:p-11"
        >
          {formState.status === "success" ? (
            <div className="text-center py-12 px-4">
              <div className="w-14 h-14 bg-umi-blue-dark text-white flex items-center justify-center mx-auto mb-6">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12l5 5L20 6" />
                </svg>
              </div>
              <div className="font-serif text-[28px] font-normal text-umi-blue-dark mb-3.5 tracking-[-0.015em]">
                Gracias, {submittedName.split(" ")[0] || ""}.
              </div>
              <p className="text-[15px] leading-[1.6] text-[rgba(10,20,48,0.72)] mb-7">
                {formState.message}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFormState({ status: "idle", message: "" });
                  setTouched({});
                }}
                className="font-mono text-[12px] tracking-[0.14em] uppercase text-umi-blue-dark border-b border-umi-blue-dark pb-1 hover:opacity-70"
              >
                Enviar otro mensaje
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="flex justify-between items-center mb-8 pb-5 border-b border-[rgba(10,20,48,0.12)]">
                <div className="font-serif text-2xl font-normal text-umi-blue-dark tracking-[-0.015em]">
                  Contáctanos
                </div>
                <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-[rgba(10,20,48,0.5)]">
                  Respuesta en 48h
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(10,20,48,0.72)]">
                    Nombre
                  </span>
                  <input
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Tu nombre"
                    className={`font-sans text-[15px] px-3.5 py-3 border bg-white text-umi-blue-deep transition-all rounded-none focus:outline-none focus:border-umi-blue-dark focus:shadow-[inset_0_-2px_0_var(--color-umi-accent)] ${
                      touched.name && !formData.name.trim()
                        ? "border-[#B33]"
                        : "border-[rgba(10,20,48,0.25)]"
                    }`}
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(10,20,48,0.72)]">
                    Empresa
                  </span>
                  <input
                    name="company"
                    value={formData.company}
                    onChange={handleChange}
                    placeholder="Nombre de tu organización"
                    className="font-sans text-[15px] px-3.5 py-3 border border-[rgba(10,20,48,0.25)] bg-white text-umi-blue-deep transition-all rounded-none focus:outline-none focus:border-umi-blue-dark focus:shadow-[inset_0_-2px_0_var(--color-umi-accent)]"
                  />
                </label>
              </div>

              <div className="mb-5">
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(10,20,48,0.72)]">
                    Email
                  </span>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="tu@empresa.com"
                    className={`font-sans text-[15px] px-3.5 py-3 border bg-white text-umi-blue-deep transition-all rounded-none focus:outline-none focus:border-umi-blue-dark focus:shadow-[inset_0_-2px_0_var(--color-umi-accent)] ${
                      touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
                        ? "border-[#B33]"
                        : "border-[rgba(10,20,48,0.25)]"
                    }`}
                  />
                </label>
              </div>

              <div className="mb-5">
                <div className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(10,20,48,0.72)]">
                  ¿Qué producto te interesa?
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {NEEDS.map((n) => (
                      <button
                        type="button"
                        key={n.value}
                        onClick={() => setFormData((p) => ({ ...p, need: n.value }))}
                        className={`px-4 py-2 text-[13px] font-medium border transition-all ${
                          formData.need === n.value
                            ? "bg-umi-blue-dark text-white border-umi-blue-dark"
                            : "bg-white text-[rgba(10,20,48,0.72)] border-[rgba(10,20,48,0.25)] hover:border-umi-blue-dark hover:text-umi-blue-dark"
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mb-5">
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(10,20,48,0.72)]">
                    Cuéntanos el contexto
                  </span>
                  <textarea
                    name="message"
                    rows={4}
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Ej. Los pedidos llegan por WhatsApp y cocina los recaptura; queremos KDS y recompensas sin perder control..."
                    className={`font-sans text-[15px] px-3.5 py-3 border bg-white text-umi-blue-deep transition-all rounded-none resize-y focus:outline-none focus:border-umi-blue-dark focus:shadow-[inset_0_-2px_0_var(--color-umi-accent)] ${
                      touched.message && formData.message.trim().length < 10
                        ? "border-[#B33]"
                        : "border-[rgba(10,20,48,0.25)]"
                    }`}
                  />
                </label>
              </div>

              <label className="flex items-start gap-2.5 my-3 mb-6 text-[13px] text-[rgba(10,20,48,0.72)] leading-[1.5] cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacy}
                  onChange={(e) => setPrivacy(e.target.checked)}
                  className="mt-1 accent-umi-blue-dark"
                />
                <span className={touched.privacy && !privacy ? "text-[#B33]" : ""}>
                  Acepto el tratamiento de datos conforme al aviso de privacidad.
                </span>
              </label>

              {formState.status === "error" && (
                <div className="mb-4 px-3.5 py-3 border border-[#B33] bg-[#FFF5F5] text-[#B33] text-[13px]">
                  {formState.message}
                </div>
              )}

              <button
                type="submit"
                disabled={formState.status === "sending"}
                className="w-full btn btn-primary btn-lg justify-center disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {formState.status === "sending" ? "Enviando…" : (
                  <>
                    Enviar mensaje <Arrow />
                  </>
                )}
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
};

export default ContactSection;
