import type { Metadata } from 'next';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Política de privacidad de UmiPOS — Umi',
  description: 'Datos, usos, proveedores y solicitudes de privacidad de UmiPOS.',
  alternates: { canonical: 'https://www.umiconsulting.co/privacidad-umipos' },
  robots: { index: false, follow: false },
};

export default function UmiPosPrivacyPolicy() {
  return (
    <>
      <Navbar />
      <main className="privacy-page">
        <div className="site-width privacy-layout">
          <div className="privacy-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> Umi / UmiPOS
            </p>
            <h1>Política de privacidad de UmiPOS</h1>
            <p className="privacy-status">
              Consulta qué datos utiliza UmiPOS, para qué los utiliza y cómo ejercer tus derechos de
              privacidad.
            </p>
            <p>Última actualización: 12 de noviembre de 2026.</p>
          </div>
          <div className="privacy-content">
            <section>
              <h2>Responsable</h2>
              <p>
                Juan Carlos Lopez Quinonez, quien opera bajo el nombre comercial Umi, es responsable
                del tratamiento de datos para prestar este servicio. Su domicilio de contacto es
                Blvd. José Limon Lote D, Parque Canacintra I, Humaya, 80020 Culiacán Rosales,
                Sinaloa, México.
              </p>
              <p>
                El correo para consultas y solicitudes de privacidad es{' '}
                <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a>.
              </p>
            </section>
            <section>
              <h2>Alcance y contacto</h2>
              <p>
                Esta política describe el tratamiento de datos en UmiPOS, la aplicación de Umi para
                la operación de restaurantes. Su identificador de Android es
                co.umiconsulting.umi_pos. Para consultas de privacidad, escribe a{' '}
                <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a>.
              </p>
            </section>
            <section>
              <h2>Operadores y restaurantes</h2>
              <p>
                UmiPOS utiliza identificadores de cuenta, comercio, sucursal, dispositivo y sesión
                de operador para controlar el acceso. También trata los datos de identificación y
                contacto que se proporcionan para administrar la cuenta y atender solicitudes de
                soporte. El acceso utiliza las credenciales, los códigos y los tokens de sesión
                necesarios para autenticar al operador y al dispositivo.
              </p>
              <p>
                El restaurante decide qué datos de sus clientes registra y para qué los utiliza. Umi
                trata esos datos para prestar el servicio al restaurante. Si eres cliente de un
                restaurante, puedes dirigir tu solicitud al restaurante o escribirnos para
                identificar el comercio correspondiente.
              </p>
            </section>
            <section>
              <h2>Datos de clientes y operaciones</h2>
              <p>
                Según las funciones que utilice el restaurante, se registran nombres de clientes,
                correo o teléfono opcionales, preferencias de idioma y consentimientos. También se
                registran pedidos, productos, mesas, ventas, importes, métodos de pago, turnos de
                caja y movimientos de inventario. Las funciones de lealtad y saldo incluyen
                historial de compras, recompensas, saldo y tarjetas de regalo.
              </p>
              <p>
                El registro del método de pago describe la operación del restaurante. Los servicios
                de pago externos, cuando se utilizan, tratan los datos conforme a sus propias
                condiciones y políticas.
              </p>
            </section>
            <section>
              <h2>Datos del dispositivo</h2>
              <p>
                Para vincular una terminal y mantener su conexión, UmiPOS utiliza un identificador
                de instalación, la plataforma, el tipo de dispositivo y claves de vinculación. La
                configuración de equipos locales puede incluir direcciones de red y puertos de
                impresoras u otros equipos compatibles. Las conexiones a nuestros servicios pueden
                generar registros técnicos y de seguridad, incluida la dirección IP.
              </p>
            </section>
            <section>
              <h2>Finalidades</h2>
              <p>
                Tratamos los datos para autenticar operadores, aplicar permisos y vincular
                dispositivos. También los usamos para gestionar pedidos, cocina, cobros, caja,
                inventario, clientes y programas de lealtad. Conservamos información operativa local
                para recuperar acciones y sincronizarlas cuando regresa la conexión. El soporte
                utiliza la información necesaria para investigar errores y atender solicitudes.
              </p>
              <p>
                La ficha del cliente distingue el consentimiento para recibos, lealtad y marketing.
                Crear una ficha de cliente no activa por sí mismo el consentimiento de marketing.
              </p>
            </section>
            <section>
              <h2>Notificaciones y proveedores</h2>
              <p>
                UmiPOS utiliza Firebase Cloud Messaging, un servicio de Google, para entregar
                notificaciones de cocina. Google recibe identificadores de instalación y tokens de
                notificación. Los mensajes pueden incluir el folio de una cuenta, la mesa, el nombre
                de un producto e identificadores de pedidos y eventos. Puedes consultar{' '}
                <a href="https://firebase.google.com/support/privacy">
                  la información de privacidad de Firebase
                </a>
                .
              </p>
              <p>
                Los proveedores de alojamiento, bases de datos, comunicaciones y soporte pueden
                tratar información para prestar estos servicios. El personal autorizado del
                restaurante accede a los datos según los permisos de su cuenta. Algunas operaciones
                de proveedores pueden realizarse fuera de México. También puede comunicarse
                información cuando una obligación legal o un requerimiento válido de autoridad lo
                exija.
              </p>
            </section>
            <section>
              <h2>Almacenamiento y protección</h2>
              <p>
                Las credenciales se guardan mediante el almacenamiento seguro del sistema operativo.
                La aplicación también mantiene una base de datos local con información necesaria
                para operar y recuperar acciones pendientes. Las conexiones con la API de producción
                utilizan HTTPS. Los accesos a los servicios se controlan mediante sesiones y
                permisos.
              </p>
              <p>
                Protege el acceso físico a la terminal y sus credenciales. Cerrar sesión no equivale
                a eliminar todos los registros del restaurante ni sus copias de respaldo.
              </p>
            </section>
            <section>
              <h2>Conservación y eliminación</h2>
              <p>
                El criterio de conservación es el tiempo necesario para prestar el servicio y
                cumplir las obligaciones legales o contractuales aplicables. Una solicitud de
                eliminación debe considerar los registros que deban conservarse por obligaciones
                fiscales, seguridad o resolución de controversias. Las credenciales, los datos de
                operación y las copias de respaldo tienen ciclos de conservación distintos.
              </p>
              <p>
                Para solicitar la eliminación de datos o de una cuenta, escribe a nuestro correo de
                privacidad. Indica la cuenta o el restaurante relacionado y los datos que deseas
                eliminar. Podemos solicitar información proporcional para verificar tu identidad y
                tu facultad para hacer la solicitud. Te informaremos del alcance de la solicitud y
                de las excepciones que correspondan.
              </p>
            </section>
            <section>
              <h2>Tus derechos y opciones</h2>
              <p>
                Puedes solicitar acceso, rectificación, cancelación u oposición al tratamiento de
                tus datos, limitar su uso o revocar tu consentimiento. Escribe a{' '}
                <a href="mailto:hola@umiconsulting.co?subject=Privacidad%20UmiPOS">
                  hola@umiconsulting.co
                </a>{' '}
                con el asunto «Privacidad UmiPOS». Incluye un medio de respuesta y una descripción
                de tu solicitud. Puedes desactivar las notificaciones desde los ajustes de Android;
                esto afecta los avisos de cocina en segundo plano.
              </p>
            </section>
            <section>
              <h2>Cambios a esta política</h2>
              <p>
                Las actualizaciones de esta política se publicarán en esta página, con su fecha de
                actualización. Si un cambio requiere un consentimiento adicional, se solicitará por
                el medio que corresponda.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
