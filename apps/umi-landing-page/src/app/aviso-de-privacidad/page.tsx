import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Borrador del aviso de privacidad — Umi',
  robots: { index: false, follow: false },
};

export default function PrivacyNotice() {
  return (
    <>
      <Navbar />
      <main className="privacy-page">
        <div className="site-width privacy-layout">
          <div className="privacy-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> Umi / Privacidad
            </p>
            <h1>Aviso de privacidad</h1>
            <p className="privacy-status">
              Borrador para revisión. Falta confirmar la identidad y el domicilio de la persona
              responsable antes de publicarlo.
            </p>
          </div>
          <div className="privacy-content">
            <section>
              <h2>Responsable</h2>
              <p>
                <strong>Pendiente:</strong> razón social o nombre legal y domicilio de la persona
                responsable del tratamiento. Umi recibirá las consultas en{' '}
                <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a>.
              </p>
            </section>
            <section>
              <h2>Datos que recibimos</h2>
              <p>
                El formulario de demo solicita tu nombre, el nombre de tu restaurante y tu correo.
                Puedes agregar tu número de WhatsApp y un mensaje. No solicitamos datos sensibles.
              </p>
            </section>
            <section>
              <h2>Para qué usamos los datos</h2>
              <p>
                Usamos estos datos para responder tu solicitud, conocer las necesidades de tu
                restaurante y preparar una demostración de Umi. También enviamos un correo de
                confirmación. No usamos este formulario para suscribirte a publicidad.
              </p>
            </section>
            <section>
              <h2>Cómo limitar el uso y ejercer tus derechos</h2>
              <p>
                Puedes escribir a <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a>{' '}
                para solicitar acceso, rectificación, cancelación u oposición al tratamiento de tus
                datos. Usa ese correo para limitar el uso de tus datos o revocar tu consentimiento.
                Incluye tu nombre, un medio de respuesta y una descripción de tu solicitud.
              </p>
            </section>
            <section>
              <h2>Transferencias, conservación y cambios</h2>
              <p>
                <strong>Pendiente:</strong> confirmar los proveedores de alojamiento y correo, las
                transferencias aplicables y el plazo de conservación. Cualquier cambio a este aviso
                se publicará en esta misma dirección.
              </p>
            </section>
            <p className="privacy-source">
              Este borrador sigue los elementos del artículo 15 de la{' '}
              <a
                href="https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                Ley Federal de Protección de Datos Personales en Posesión de los Particulares
              </a>
              . Requiere revisión antes de uso público.
            </p>
            <Link className="text-link" href="/#demo">
              Volver a la solicitud de demo
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
