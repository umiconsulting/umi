import { useNavigate, useParams } from 'react-router-dom';
import { Trans, useLingui } from '@lingui/react/macro';
import { I, UmiFish } from '@/icons.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { useMerchantData, useMembersData } from '@/data.jsx';
import { formatNumber } from '@/lib/format.js';

export default function SoftLockPreview({ productKey: propKey, moduleName }) {
  const { t } = useLingui();
  const params = useParams();
  const navigate = useNavigate();
  const merchant = useMerchant();
  const { data: merchantData } = useMerchantData();
  const { data: membersData } = useMembersData({ page: 1 });

  const key = propKey || params.productKey || 'pos';
  const cafeName = merchant?.selectedMerchant?.name || merchantData?.name || t`tu cafetería`;
  const totalMembers = membersData?.total || 0;

  const catalog = {
    pos: {
      badge: t`Punto de venta · Umi POS`,
      title: t`Cobro en barra conectado a tus sellos`,
      highlight: t`sin doble escaneo`,
      lead:
        totalMembers > 0
          ? t`Conecta tu caja con los ${formatNumber(totalMembers)} miembros que ya tienes en Umi Cash. Al cerrar una cuenta en el POS, los sellos y el saldo del monedero se aplican en un solo toque.`
          : t`Conecta tu caja con tu programa de lealtad Umi Cash. Al cerrar una cuenta en el POS, los sellos y el saldo del monedero se aplican en un solo toque.`,
      features: [
        {
          icon: 'Monitor',
          title: t`Caja rápida y turnos`,
          desc: t`Cobro en efectivo, tarjeta y monedero Umi con corte de caja por turno.`,
        },
        {
          icon: 'Layout',
          title: t`Plano de mesas y salón`,
          desc: t`Mapa visual de mesas, cuentas abiertas y tiempos de servicio en vivo.`,
        },
        {
          icon: 'Receipt',
          title: t`Pantalla de cocina (KDS)`,
          desc: t`Comandas digitales por estación sin papel perdido en barra.`,
        },
      ],
    },
    inventory: {
      badge: t`Inventario y costos · Umi Stock`,
      title: t`Recetas, insumos y margen real`,
      highlight: t`por cada taza`,
      lead: t`Calcula cuánto te cuesta realmente cada bebida y cada recompensa canjeada en ${cafeName}, con descuento automático de leche, café e insumos por receta.`,
      features: [
        {
          icon: 'PackagePlus',
          title: t`Recetas y costo por bebida`,
          desc: t`Conoce tu margen exacto por producto y el costo real de tus premios de lealtad.`,
        },
        {
          icon: 'Package',
          title: t`Conteos y alertas de stock`,
          desc: t`Avisos antes de quedarte sin grano, leche o vasos en hora pico.`,
        },
        {
          icon: 'ClipboardList',
          title: t`Compras y facturas`,
          desc: t`Captura entradas de proveedor y actualiza costos promedio al instante.`,
        },
      ],
    },
    conversaflow: {
      badge: t`Atención inteligente · WhatsApp IA`,
      title: t`Tu cafetería responde en WhatsApp`,
      highlight: t`las 24 horas`,
      lead: t`Atiende dudas de menú, horarios, sucursales y pedidos por WhatsApp reconociendo automáticamente a tus clientes frecuentes de Umi Cash.`,
      features: [
        {
          icon: 'WhatsApp',
          title: t`Asistente con la voz de tu café`,
          desc: t`Responde preguntas de menú, leches vegetales y ubicación al instante.`,
        },
        {
          icon: 'Users2',
          title: t`Reconoce a tus miembros`,
          desc: t`Identifica quién escribe por su teléfono y muestra sus sellos y saldo.`,
        },
        {
          icon: 'Clock',
          title: t`Horarios y pausa de pedidos`,
          desc: t`Sincroniza tu disponibilidad real sin dejar mensajes sin contestar.`,
        },
      ],
    },
  };

  const normalizedKey =
    key === 'inventory'
      ? 'inventory'
      : key === 'conversaflow' || key === 'triage' || key === 'hours'
        ? 'conversaflow'
        : 'pos';
  const info = catalog[normalizedKey];
  const displayProduct = moduleName || info.badge;

  const rawPhone =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_UMI_SALES_WHATSAPP) ||
    '5215500000000';
  const cleanPhone = String(rawPhone).replace(/\D/g, '');
  const waText = t`Hola equipo Umi, soy de ${cafeName} y me gustaría activar ${displayProduct} conectado a nuestro Umi Cash.`;
  const waHref = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`;

  return (
    <div className="naive-softlock-stage" data-soft-lock-preview={normalizedKey}>
      <div className="naive-softlock-card">
        <div className="naive-softlock-head">
          <span className="naive-eyebrow-pill">
            <I.Sparkles size={13} aria-hidden="true" />
            <span>{displayProduct}</span>
          </span>
          <h1 className="naive-display-h1">
            <span>{info.title} </span>
            <span className="naive-pill-highlight">{info.highlight}</span>
            <UmiFish width={30} />
          </h1>
          <p className="naive-softlock-lead">{info.lead}</p>
        </div>

        <div className="naive-softlock-grid">
          {info.features.map((feat) => {
            const Ic = I[feat.icon] || I.Sparkles;
            return (
              <div className="naive-softlock-feat" key={feat.title}>
                <div className="naive-softlock-ico">
                  <Ic size={20} />
                </div>
                <div className="naive-softlock-feat-title">{feat.title}</div>
                <div className="naive-softlock-feat-desc">{feat.desc}</div>
              </div>
            );
          })}
        </div>

        <div className="naive-softlock-bridge">
          <div className="naive-softlock-bridge-text">
            <strong>
              <Trans>Todo dentro de este mismo panel</Trans>
            </strong>
            <span>
              <Trans>
                Sin migrar cuentas ni cambiar de dirección web: al activarlo se desbloquea en tu
                menú lateral junto a Umi Cash.
              </Trans>
            </span>
          </div>
          <div className="naive-softlock-actions">
            <button
              type="button"
              className="naive-btn naive-btn-secondary"
              onClick={() => navigate('/loyalty-value/home')}
            >
              <Trans>Volver a mi panel</Trans>
            </button>
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="naive-btn naive-btn-primary"
            >
              <I.WhatsApp size={16} />
              <span>
                <Trans>Activar con Umi por WhatsApp</Trans>
              </span>
              <I.ArrowRight size={15} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
