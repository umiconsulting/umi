import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Aviso de privacidad — Umi',
  description: 'Aviso de privacidad para las solicitudes de contacto y demostración de Umi.',
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
              Consulta cómo tratamos los datos que compartes al solicitar información o una
              demostración de Umi.
            </p>
            <p>Última actualización: 21 de noviembre de 2026.</p>
          </div>
          <div className="privacy-content">
            <section>
              <h2>Responsable</h2>
              <p>
                Umi es responsable del tratamiento de los datos personales que compartes mediante
                este sitio. Para consultas y solicitudes de privacidad, escribe a{' '}
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
                Los proveedores de alojamiento y correo pueden tratar estos datos únicamente para
                operar el sitio y atender tu solicitud. Conservamos la información durante el tiempo
                necesario para dar seguimiento a tu consulta y cumplir las obligaciones legales
                aplicables. Cualquier cambio a este aviso se publicará en esta misma dirección.
              </p>
            </section>
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
