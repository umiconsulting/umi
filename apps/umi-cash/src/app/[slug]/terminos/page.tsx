import Link from 'next/link';
import BackButton from '@/components/ui/BackButton';
import { getTenant } from '@/lib/tenant';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const tenant = await getTenant(params.slug);
  if (!tenant) return {};
  return { title: `Términos y Condiciones — ${tenant.name}` };
}

export default async function TerminosPage({ params }: { params: { slug: string } }) {
  const tenant = await getTenant(params.slug);
  if (!tenant) notFound();
  const name = tenant.name;

  return (
    <main className="min-h-screen" style={{ background: 'var(--color-surface)' }}>
      <div className="max-w-2xl mx-auto px-6 pt-4 pb-8">
        <div className="flex items-center justify-between pt-2 pb-1">
          <div
            className="uppercase"
            style={{ fontFamily: '"Domus", serif', fontWeight: 400, fontSize: 15, letterSpacing: '0.04em', color: 'var(--color-brand-dark)' }}
          >
            {name}
          </div>
        </div>
        <div className="u-fade-up" style={{ marginTop: 28 }}>
          <div className="u-eyebrow mb-2">Legal</div>
          <h1 className="u-display" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.05, color: 'var(--color-ink)', margin: 0 }}>
            Términos y Condiciones
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-ink-light)', margin: '10px 0 0' }}>
            Programa de Lealtad y Tarjeta de Saldo
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 pb-10 space-y-6">
        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">1. Descripción del Programa</h2>
          <p className="text-sm leading-relaxed">
            El Programa de Lealtad de <strong className="font-semibold">{name}</strong> es
            un programa de beneficios destinado a clientes frecuentes. Al registrarse, el cliente
            obtiene una tarjeta digital con dos funciones: (1) acumulación de visitas para ganar
            recompensas de temporada, y (2) saldo prepago para pagar en el establecimiento.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">2. Acumulación de Visitas</h2>
          <ul className="text-sm space-y-2 leading-relaxed">
            <li>• Cada visita se registra mediante el escaneo del código QR de la tarjeta digital por parte del personal autorizado del establecimiento.</li>
            <li>• El número de visitas requeridas para obtener una recompensa es configurable por el establecimiento y será comunicado en la aplicación.</li>
            <li>• El progreso de visitas <strong className="font-semibold">no caduca</strong>; una vez registrada una visita, no puede ser retirada salvo en caso de error debidamente documentado.</li>
            <li>• Solo se acredita una visita por día por cliente.</li>
          </ul>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">3. Recompensas de Temporada</h2>
          <ul className="text-sm space-y-2 leading-relaxed">
            <li>• Al completar el ciclo de visitas requerido, el cliente gana una recompensa de temporada (bebida, alimento u otro beneficio determinado por el establecimiento).</li>
            <li>• Las recompensas ganadas quedan registradas como <em>recompensas pendientes</em> y pueden ser canjeadas en cualquier visita posterior.</li>
            <li>• <strong className="font-semibold">Las recompensas pendientes no caducan</strong>, siempre que la cuenta permanezca activa.</li>
            <li>• El establecimiento puede cambiar la recompensa de temporada; los cambios aplican únicamente a ciclos futuros, no a recompensas ya ganadas.</li>
            <li>• Las recompensas son personales, intransferibles y no tienen valor de cambio por dinero en efectivo.</li>
          </ul>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">4. Saldo Prepago</h2>
          <ul className="text-sm space-y-2 leading-relaxed">
            <li>• El saldo prepago solo puede ser cargado <strong className="font-semibold">físicamente en el establecimiento</strong> mediante pago en efectivo u otros métodos aceptados.</li>
            <li>• <strong className="font-semibold">El saldo prepago monetario no vence, no caduca ni se pierde</strong> por el simple transcurso del tiempo. Esto es acorde a la Ley Federal de Protección al Consumidor (LFPC), artículos 85 y 86 Bis, que prohíben las cláusulas que impliquen el decomiso injustificado de un valor monetario prepagado.</li>
            <li>• El saldo es personal e intransferible.</li>
            <li>• En caso de cierre definitivo del establecimiento, el saldo no redimido se considerará un adeudo del establecimiento hacia el cliente, exigible conforme a la LFPC.</li>
            <li>• <strong className="font-semibold">El saldo no puede canjearse por dinero en efectivo</strong>, conforme a la política del establecimiento.</li>
            <li>• Las recargas de saldo superiores a MXN $16,010 en una sola transacción pueden requerir la presentación de identificación oficial conforme a la Ley Anti-Lavado (LFPIORPI).</li>
          </ul>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">5. Seguridad del Código QR</h2>
          <p className="text-sm leading-relaxed">
            El código QR de su tarjeta es único, temporal (válido por 5 minutos) y se renueva
            automáticamente. Tras cada escaneo, el código anterior queda inválido para prevenir
            uso fraudulento por capturas de pantalla. Guarde su sesión de forma segura; el
            establecimiento no se hace responsable por el uso no autorizado derivado de compartir
            el código QR con terceros.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">6. Cancelación de Cuenta</h2>
          <p className="text-sm leading-relaxed">
            El cliente puede solicitar la cancelación de su cuenta en cualquier momento enviando un
            correo a{' '}
            <a href="mailto:hola@umiconsulting.co" className="underline" style={{ color: 'var(--color-brand)' }}>
              hola@umiconsulting.co
            </a>
            . La cancelación implica la pérdida del historial de visitas y recompensas pendientes.
            El saldo monetario no redimido a la fecha de cancelación deberá ser utilizado previamente
            o se considerará donado al establecimiento, salvo acuerdo por escrito en contrario.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">7. Modificaciones al Programa</h2>
          <p className="text-sm leading-relaxed">
            {name} se reserva el derecho de modificar los términos del programa con un aviso
            previo de al menos 15 días naturales, publicado en la aplicación o comunicado al correo
            registrado. Los cambios no afectarán recompensas o saldo ya acumulados.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold">8. Ley Aplicable</h2>
          <p className="text-sm leading-relaxed">
            Estos términos se rigen por las leyes de los Estados Unidos Mexicanos,
            en particular la Ley Federal de Protección al Consumidor (LFPC) y la
            Ley Federal de Protección de Datos Personales en Posesión de los
            Particulares (LFPDPPP). Cualquier controversia se resolverá en primera instancia
            mediante conciliación ante PROFECO.
          </p>
          <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>Última actualización: marzo 2026</p>
        </section>

        <div className="text-center pt-2 space-y-3">
          <Link href={`/${params.slug}/aviso-privacidad`} className="underline text-sm block" style={{ color: 'var(--color-ink-light)' }}>
            Ver Aviso de Privacidad
          </Link>
          <BackButton label="← Volver" />
        </div>
      </div>
    </main>
  );
}
