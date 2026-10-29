'use client';

import { FormEvent, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import { apiUrl } from '@/lib/api';

type Status = 'idle' | 'sending' | 'success' | 'error';

export default function ContactSection() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!privacyAccepted) {
      setStatus('error');
      setError('Lee y acepta el aviso de privacidad para enviar tu solicitud.');
      return;
    }
    setStatus('sending');
    try {
      const response = await fetch(apiUrl('/api/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          company,
          email,
          phone,
          message,
          privacyAccepted,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.error || 'No pudimos enviar tu solicitud. Inténtalo de nuevo.');
      setStatus('success');
    } catch (cause) {
      setStatus('error');
      setError(
        cause instanceof Error
          ? cause.message
          : 'No pudimos enviar tu solicitud. Inténtalo de nuevo.',
      );
    }
  }

  return (
    <section className="contact-section section-space" id="demo" aria-labelledby="demo-title">
      <div className="site-width contact-grid">
        <div className="contact-copy">
          <p className="eyebrow">
            <span className="eyebrow-line" /> Tu siguiente paso
          </p>
          <h2 id="demo-title">
            Ve Umi en el contexto
            <br />
            <span>de tu restaurante.</span>
          </h2>
          <p>
            Cuéntanos qué tipo de operación tienes. Te mostraremos las partes de Umi que sirven para
            tu equipo y tus clientes.
          </p>
          <div className="contact-direct">
            <span>También puedes escribirnos</span>
            <a href="mailto:hola@umiconsulting.co">
              hola@umiconsulting.co <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="contact-card">
          {status === 'success' ? (
            <div className="form-success" role="status">
              <span className="success-mark">
                <Check size={24} aria-hidden="true" />
              </span>
              <h3>Recibimos tu solicitud.</h3>
              <p>
                Gracias por contarnos sobre {company.trim() || 'tu restaurante'}. Te contactaremos
                por correo para preparar una demo útil.
              </p>
              <button
                type="button"
                onClick={() => {
                  setStatus('idle');
                  setName('');
                  setCompany('');
                  setEmail('');
                  setPhone('');
                  setMessage('');
                  setPrivacyAccepted(false);
                }}
              >
                Enviar otra solicitud
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="form-heading">
                <span>Solicitar demo</span>
                <span>01 / 01</span>
              </div>
              <div className="form-grid">
                <label>
                  Tu nombre{' '}
                  <input
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                    maxLength={100}
                    placeholder="Nombre y apellido"
                  />
                </label>
                <label>
                  Restaurante{' '}
                  <input
                    name="company"
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                    autoComplete="organization"
                    required
                    maxLength={120}
                    placeholder="Nombre del negocio"
                  />
                </label>
                <label>
                  Correo de contacto{' '}
                  <input
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="tu@restaurante.com"
                  />
                </label>
                <label>
                  WhatsApp <span className="optional">opcional</span>
                  <input
                    name="phone"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    autoComplete="tel"
                    maxLength={24}
                    placeholder="+52 000 000 0000"
                  />
                </label>
                <label className="form-full">
                  ¿Qué te gustaría resolver? <span className="optional">opcional</span>
                  <textarea
                    name="message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="Pedidos, cocina, clientes, visibilidad del negocio…"
                  />
                </label>
              </div>
              <label className="privacy-check">
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(event) => setPrivacyAccepted(event.target.checked)}
                  required
                />
                <span>
                  Leí y acepto el{' '}
                  <a href="/aviso-de-privacidad" target="_blank" rel="noopener noreferrer">
                    aviso de privacidad
                  </a>
                  .
                </span>
              </label>
              {status === 'error' && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button button-dark form-submit"
                type="submit"
                disabled={status === 'sending'}
              >
                {status === 'sending' ? 'Enviando…' : 'Solicitar demo'}{' '}
                <ArrowUpRight size={18} aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
