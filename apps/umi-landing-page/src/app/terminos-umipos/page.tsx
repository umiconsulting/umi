import type { Metadata } from 'next';
import Link from 'next/link';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';

export const metadata: Metadata = {
  title: 'Términos de uso de UmiPOS — Umi',
  description:
    'Condiciones de acceso, operación, contratación y soporte de UmiPOS para restaurantes.',
  alternates: { canonical: 'https://www.umiconsulting.co/terminos-umipos' },
  robots: { index: false, follow: false },
};

export default function UmiPosTermsOfService() {
  return (
    <>
      <Navbar />
      <main className="privacy-page">
        <div className="site-width privacy-layout">
          <div className="privacy-intro">
            <p className="eyebrow">
              <span className="eyebrow-line" /> Umi / UmiPOS
            </p>
            <h1>Términos de uso de UmiPOS</h1>
            <p className="privacy-status">
              Condiciones para usar UmiPOS en la operación de tu restaurante.
            </p>
            <p>Última actualización y entrada en vigor: 21 de noviembre de 2026.</p>
          </div>
          <div className="privacy-content">
            <section>
              <h2>1. Quién presta el servicio</h2>
              <p>
                Umi presta el servicio de UmiPOS. Para consultas, soporte o reclamaciones, escribe a{' '}
                <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a>.
              </p>
            </section>
            <section>
              <h2>2. Alcance y aceptación</h2>
              <p>
                Estos términos se aplican a UmiPOS, la aplicación de punto de venta de Umi para
                restaurantes, y a los servicios de Umi que permiten su funcionamiento. Al usar el
                servicio, aceptas estas condiciones en lo que corresponda a tu función. Si actúas
                por un negocio, debes tener autorización para representarlo o para operar su cuenta.
              </p>
              <p>
                Si existe un contrato específico con tu negocio, ese contrato determina las
                condiciones comerciales y los compromisos adicionales acordados. Estos términos
                complementan ese contrato y respetan los derechos que la ley te reconoce.
              </p>
            </section>
            <section>
              <h2>3. Acceso y seguridad</h2>
              <p>
                El acceso requiere una cuenta de negocio habilitada, una terminal vinculada y los
                permisos que correspondan al operador. El administrador del negocio autoriza a su
                personal y debe retirar el acceso de quien deje de necesitarlo.
              </p>
              <p>
                Protege los códigos de vinculación, los PIN, las contraseñas y las terminales.
                Utiliza únicamente las cuentas y funciones que tengas autorizadas. Si detectas un
                acceso indebido, comunícalo al administrador de tu negocio y a Umi cuanto antes.
              </p>
            </section>
            <section>
              <h2>4. Uso permitido</h2>
              <p>
                Umi te concede permiso de uso limitado, no exclusivo, para operar UmiPOS durante la
                prestación del servicio y conforme al plan contratado. Umi y sus respectivos
                titulares conservan los derechos sobre el software, las marcas y los demás
                materiales del servicio. Tu negocio conserva los derechos sobre sus propios datos y
                contenidos.
              </p>
              <p>
                Debes usar el servicio de forma lícita. Queda prohibido acceder a datos de otros
                negocios sin permiso, eludir controles de seguridad, introducir código malicioso,
                realizar operaciones fraudulentas o revender accesos sin autorización.
              </p>
            </section>
            <section>
              <h2>5. Operación del restaurante</h2>
              <p>
                UmiPOS permite gestionar pedidos, ventas, cobros, caja y otras funciones habilitadas
                para tu negocio. Las funciones disponibles dependen del plan, los permisos, la
                configuración y los dispositivos compatibles.
              </p>
              <p>
                Tu negocio debe revisar sus precios, productos, impuestos, descuentos, movimientos
                de caja y operaciones antes de confirmarlos. También debe cumplir sus obligaciones
                fiscales, laborales y frente a sus clientes. Un ticket de venta no debe tratarse
                como comprobante fiscal salvo que se emita mediante un servicio fiscal habilitado
                para ello. Esto no limita las obligaciones de Umi sobre su propio servicio.
              </p>
            </section>
            <section>
              <h2>6. Contratación, precios y pagos</h2>
              <p>
                Descargar la aplicación no activa por sí solo un plan de pago. Los precios, la
                moneda, los impuestos, las funciones, el periodo de servicio y las condiciones de
                renovación deben constar en la oferta o el contrato que aceptes antes del cobro. Los
                servicios o equipos de terceros pueden tener cargos y condiciones propios.
              </p>
              <p>
                Las cancelaciones y los reembolsos se atenderán conforme a las condiciones
                comunicadas al contratar y a los derechos que establezca la ley. Esta página no
                autoriza cargos adicionales ni modifica por sí sola un precio acordado.
              </p>
            </section>
            <section>
              <h2>7. Pagos e integraciones de terceros</h2>
              <p>
                Algunas funciones pueden requerir servicios externos, como terminales de pago,
                impresoras o notificaciones. Tu negocio debe contar con las autorizaciones y los
                contratos que esos proveedores requieran. El procesamiento, la liquidación y las
                comisiones de los pagos dependen del proveedor que corresponda.
              </p>
              <p>
                Umi presta la integración que tenga habilitada y atiende las incidencias de su
                servicio. Los proveedores externos responden por sus propios servicios conforme a
                sus condiciones y a la ley aplicable.
              </p>
            </section>
            <section>
              <h2>8. Conectividad, mantenimiento y soporte</h2>
              <p>
                El servicio requiere dispositivos compatibles y, para distintas funciones, conexión
                a Internet o a la red local. Algunas acciones pueden quedar pendientes de
                sincronización. Comprueba el estado de una operación antes de repetirla para evitar
                registros duplicados.
              </p>
              <p>
                Umi puede realizar mantenimiento y actualizaciones para corregir fallos o proteger
                el servicio. Procurará comunicar las interrupciones programadas que afecten a tu
                negocio. Los horarios de soporte y cualquier compromiso de disponibilidad o de
                respuesta serán los acordados en tu contrato. Puedes reportar incidencias a nuestro
                correo de contacto.
              </p>
            </section>
            <section>
              <h2>9. Privacidad y datos del negocio</h2>
              <p>
                La <Link href="/privacidad-umipos">Política de privacidad de UmiPOS</Link> explica
                qué datos se utilizan, para qué se utilizan y cómo solicitar su acceso, corrección o
                eliminación. Tu negocio debe contar con las facultades necesarias para incorporar
                datos de su personal y sus clientes, y debe informarles sobre su propio tratamiento.
              </p>
              <p>
                Para solicitar la recuperación, entrega o eliminación de información, escribe a
                nuestro correo de contacto. Verificaremos tu identidad y tu autorización sobre el
                negocio. Te informaremos de las opciones disponibles y de los registros que deban
                conservarse por una obligación legal. Cerrar sesión o desinstalar la aplicación no
                elimina por sí solo la cuenta ni los registros del negocio.
              </p>
            </section>
            <section>
              <h2>10. Suspensión y terminación</h2>
              <p>
                Puedes solicitar la cancelación del servicio por nuestro correo de contacto, con
                autorización suficiente para representar al negocio. Se aplicarán las condiciones de
                terminación y renovación que hayas aceptado y los derechos previstos por la ley.
              </p>
              <p>
                Umi puede restringir el acceso ante un uso ilícito, un riesgo de seguridad, un
                requerimiento legal o un incumplimiento relevante del contrato, incluido un impago.
                La medida debe ser proporcional a su causa. Cuando sea posible, comunicará el motivo
                y dará oportunidad de corregirlo. Una urgencia de seguridad o una obligación legal
                puede requerir una actuación inmediata.
              </p>
              <p>
                La terminación no elimina las obligaciones pendientes que sean válidas ni supone la
                eliminación inmediata de todos los datos. Puedes solicitar información sobre sus
                opciones de entrega y conservación antes de cerrar el servicio.
              </p>
            </section>
            <section>
              <h2>11. Responsabilidad y derechos</h2>
              <p>
                Cada parte responde por las obligaciones que le correspondan conforme a la ley y al
                contrato aplicable. UmiPOS es una herramienta de apoyo a la operación; tu negocio
                debe revisar sus registros y mantener procedimientos para atender interrupciones.
                Umi atiende las incidencias de su servicio según sus obligaciones legales y
                contractuales.
              </p>
              <p>
                Estos términos no excluyen garantías ni responsabilidades que la ley prohíba
                excluir. Tampoco implican renunciar a derechos de consumo, reembolsos o vías de
                reclamación que te correspondan.
              </p>
            </section>
            <section>
              <h2>12. Cambios a estos términos</h2>
              <p>
                Umi publicará las nuevas versiones en esta URL e indicará su fecha de entrada en
                vigor. Comunicará los cambios sustanciales por los medios de contacto disponibles
                para el negocio, con anticipación cuando corresponda. Si un cambio requiere tu
                consentimiento, lo solicitará antes de aplicarlo. La publicación no sustituye por sí
                sola los acuerdos específicos vigentes ni afecta derechos ya adquiridos.
              </p>
            </section>
            <section>
              <h2>13. Consultas y solución de controversias</h2>
              <p>
                Para resolver una consulta o reclamación, escribe a{' '}
                <a href="mailto:hola@umiconsulting.co">hola@umiconsulting.co</a> e identifica el
                negocio y la operación relacionada. Evita enviar contraseñas, PIN o datos completos
                de tarjetas. Estos términos se interpretan conforme a las leyes aplicables en
                México, sin desplazar las normas obligatorias de protección que te correspondan en
                tu lugar de residencia. Puedes acudir a las autoridades y los tribunales
                competentes, incluida la autoridad de protección al consumidor cuando corresponda.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
