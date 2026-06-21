import BackButton from '@/components/ui/BackButton';
import { getTenant } from '@/lib/tenant';
import { notFound } from 'next/navigation';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const tenant = await getTenant(params.slug);
  if (!tenant) return {};
  return { title: `Aviso de Privacidad — ${tenant.name}` };
}

export default async function AvisoPrivacidadPage({ params }: { params: { slug: string } }) {
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
            Aviso de Privacidad
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-ink-light)', margin: '10px 0 0' }}>
            Ley Federal de Protección de Datos Personales
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 pb-10 space-y-6">
        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>1. Identidad del Responsable</h2>
          <p className="text-sm leading-relaxed">
            <strong className="font-semibold">{name}</strong> (en adelante &ldquo;el Responsable&rdquo;),
            es responsable del tratamiento de sus datos personales
            conforme a lo establecido en la{' '}
            <em>Ley Federal de Protección de Datos Personales en Posesión de los Particulares</em>{' '}
            (LFPDPPP) y su Reglamento.
          </p>
          <p className="text-sm">
            Contacto de privacidad:{' '}
            <a href="mailto:hola@umiconsulting.co" className="underline" style={{ color: 'var(--color-brand)' }}>
              hola@umiconsulting.co
            </a>
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>2. Datos Personales que Recabamos</h2>
          <p className="text-sm leading-relaxed">
            Para operar el programa de lealtad recabamos únicamente:
          </p>
          <ul className="text-sm space-y-1 ml-4 list-disc">
            <li>Nombre completo</li>
            <li>Número de teléfono celular (opcional)</li>
            <li>Correo electrónico (opcional)</li>
            <li>Historial de visitas y transacciones de saldo dentro del programa</li>
          </ul>
          <p className="text-sm leading-relaxed">
            <strong className="font-semibold">No recabamos datos sensibles</strong> (datos biométricos,
            de salud, origen racial, preferencias políticas o religiosas).
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>3. Finalidades del Tratamiento</h2>
          <p className="text-sm">Sus datos se usan únicamente para:</p>
          <ul className="text-sm space-y-1.5 ml-4 list-disc">
            <li><strong className="font-semibold">Primarias (necesarias):</strong> crear y administrar su cuenta, registrar visitas, gestionar su saldo de prepago, y emitir recompensas del programa de lealtad.</li>
            <li><strong className="font-semibold">Secundarias (opcionales):</strong> enviarle comunicaciones sobre promociones o cambios en el programa, si usted no se opone.</li>
          </ul>
          <p className="text-sm">
            Puede oponerse al tratamiento para finalidades secundarias en cualquier momento a través del correo de privacidad indicado.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>4. Transferencia de Datos</h2>
          <p className="text-sm leading-relaxed">
            Sus datos <strong className="font-semibold">no se comparten</strong> con terceros para
            fines comerciales o publicitarios. Los datos se alojan en servidores seguros utilizados
            exclusivamente para la operación del programa. En caso de que en el futuro se realice
            alguna transferencia necesaria para la operación del servicio, será debidamente informado
            y se actualizará este aviso.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>5. Derechos ARCO</h2>
          <p className="text-sm leading-relaxed">
            Conforme al artículo 22 de la LFPDPPP, usted tiene derecho a:
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { letter: 'A', name: 'Acceso', desc: 'Saber qué datos tenemos sobre usted' },
              { letter: 'R', name: 'Rectificación', desc: 'Corregir datos inexactos o incompletos' },
              { letter: 'C', name: 'Cancelación', desc: 'Solicitar la eliminación de sus datos' },
              { letter: 'O', name: 'Oposición', desc: 'Oponerse al tratamiento de sus datos' },
            ].map(({ letter, name: arcoName, desc }) => (
              <div key={letter} className="rounded-xl p-3" style={{ background: 'var(--color-surface-dark)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-6 h-6 text-white rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: 'var(--color-brand)' }}
                  >
                    {letter}
                  </span>
                  <span className="font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>{arcoName}</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">
            Para ejercer sus derechos ARCO, envíe su solicitud a{' '}
            <a href="mailto:hola@umiconsulting.co" className="underline" style={{ color: 'var(--color-brand)' }}>
              hola@umiconsulting.co
            </a>
            . Responderemos dentro de los 20 días hábiles siguientes a la recepción de su solicitud.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>6. Revocación del Consentimiento</h2>
          <p className="text-sm leading-relaxed">
            Puede revocar su consentimiento para el tratamiento de sus datos en cualquier momento,
            enviando un correo a{' '}
            <a href="mailto:hola@umiconsulting.co" className="underline" style={{ color: 'var(--color-brand)' }}>
              hola@umiconsulting.co
            </a>
            . Tenga en cuenta que la revocación puede implicar la cancelación de su cuenta y la
            pérdida del historial de visitas y saldo no redimido.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>7. Seguridad de los Datos</h2>
          <p className="text-sm leading-relaxed">
            Implementamos medidas técnicas y organizativas para proteger sus datos contra acceso no
            autorizado, pérdida o alteración. El acceso a los datos está restringido al personal
            autorizado del establecimiento. Los códigos QR son temporales y se invalidan tras cada
            escaneo para prevenir uso fraudulento.
          </p>
        </section>

        <section className="card-surface space-y-3">
          <h2 className="u-display text-lg font-semibold" style={{ color: 'var(--color-ink)' }}>8. Cambios a este Aviso</h2>
          <p className="text-sm leading-relaxed">
            Cualquier modificación a este Aviso de Privacidad será notificada a través de la
            aplicación o al correo registrado. La versión vigente siempre estará disponible en
            esta página.
          </p>
          <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>Última actualización: marzo 2026</p>
        </section>

        <div className="text-center pt-2">
          <BackButton label="← Volver" />
        </div>
      </div>
    </main>
  );
}
