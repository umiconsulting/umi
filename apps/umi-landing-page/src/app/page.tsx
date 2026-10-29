import Image from 'next/image';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/layout/Footer';
import ContactSection from '@/components/home/ContactSection';
import ShaderBackground from '@/components/background/ShaderBackground';
import PosShowcase from '@/components/home/PosShowcase';

const work = [
  {
    number: '01',
    title: 'Toma el pedido y cobra.',
    text: 'UmiPOS reúne la carta, las cuentas y el cobro en el punto de venta que usa tu equipo.',
    product: 'POS',
  },
  {
    number: '02',
    title: 'Haz visible la cocina.',
    text: 'Las comandas llegan a la estación correcta. Cocina y barra ven qué sigue y qué ya está listo.',
    product: 'KDS',
  },
  {
    number: '03',
    title: 'Conoce a quien regresa.',
    text: 'Cash lleva pases, sellos y valor del cliente con la identidad de cada restaurante.',
    product: 'Wallet',
  },
  {
    number: '04',
    title: 'Ve el día completo.',
    text: 'El dueño consulta ventas, turnos, cocina y clientes desde una sola vista.',
    product: 'Dashboard',
  },
  {
    number: '05',
    title: 'Sigue la conversación.',
    text: 'El Agente IA conecta mensajes de WhatsApp con el trabajo que ocurre dentro del restaurante.',
    product: 'Agente IA',
  },
];

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <section className="hero" id="inicio" aria-labelledby="hero-title">
          <Image
            src="/editorial/sea-hero.jpg"
            alt="Pez naranja que sale del agua sobre un mar azul oscuro"
            fill
            priority
            sizes="100vw"
            className="hero-image"
          />
          <ShaderBackground />
          <div className="hero-scrim" aria-hidden="true" />
          <div className="hero-grid site-width">
            <div className="hero-spacer" aria-hidden="true" />
            <div className="hero-copy">
              <p className="eyebrow eyebrow-light">
                <span className="eyebrow-line" /> Umi para restaurantes
              </p>
              <h1 id="hero-title">
                Pedidos, cocina, cobro y clientes. <span>Una sola operación.</span>
              </h1>
              <p className="hero-description">
                Tu equipo sabe qué sigue. Tú sabes qué pasó. Umi conecta el trabajo diario de tu
                restaurante en un sistema claro.
              </p>
              <div className="hero-actions">
                <a className="button button-light" href="#demo">
                  Solicitar demo <ArrowUpRight size={18} aria-hidden="true" />
                </a>
                <a className="text-link text-link-light" href="#clientes">
                  Conoce a nuestros clientes <ArrowDown size={17} aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
          <div className="hero-index site-width" aria-hidden="true">
            <span>01 / Una operación clara</span>
            <span>Umi · México</span>
          </div>
        </section>

        <PosShowcase />

        <section className="proof-intro" id="clientes" aria-label="Clientes Umi">
          <div className="site-width proof-intro-grid">
            <p className="eyebrow">En restaurantes reales</p>
            <div className="proof-intro-names">
              <span>
                ONCA <small>Integración completa</small>
              </span>
              <span>
                Kalala Café <small>Umi Cash</small>
              </span>
              <span>
                El Gran Ribera <small>Umi Cash</small>
              </span>
            </div>
          </div>
        </section>

        <section className="onca-section section-space" aria-labelledby="onca-title">
          <div className="site-width">
            <div className="section-heading onca-heading">
              <div>
                <p className="eyebrow">
                  <span className="eyebrow-line" /> En operación / ONCA
                </p>
                <h2 id="onca-title">
                  Un restaurante.
                  <br />
                  <span>Todo en movimiento.</span>
                </h2>
              </div>
              <p>
                ONCA usa Umi como una integración completa. El pedido pasa del punto de venta a
                cocina y cobro, mientras el dueño conserva una vista de la operación.
              </p>
            </div>
            <div className="onca-media-grid">
              <figure className="media-panel media-panel-main">
                <div className="media-frame">
                  <Image
                    src="/editorial/onca-pos-latest.png"
                    alt="Carta y comanda de ONCA en UmiPOS"
                    width={1920}
                    height={985}
                    sizes="(max-width: 800px) 100vw, 65vw"
                  />
                </div>
                <figcaption>
                  <span>01 / Pedido</span>
                  <strong>La carta y la cuenta, en el mismo lugar.</strong>
                </figcaption>
              </figure>
              <div className="onca-media-side">
                <figure className="media-panel">
                  <div className="media-frame media-frame-kitchen">
                    <Image
                      src="/editorial/onca-kitchen-latest.png"
                      alt="Comanda de cocina en preparación en Umi"
                      width={1920}
                      height={985}
                      sizes="(max-width: 800px) 100vw, 32vw"
                    />
                  </div>
                  <figcaption>
                    <span>02 / Cocina</span>
                    <strong>Una comanda visible para el equipo.</strong>
                  </figcaption>
                </figure>
                <figure className="media-panel">
                  <div className="media-frame media-frame-checkout">
                    <Image
                      src="/editorial/onca-checkout-latest.png"
                      alt="Cobro en UmiPOS para ONCA"
                      width={1920}
                      height={985}
                      sizes="(max-width: 800px) 100vw, 32vw"
                    />
                  </div>
                  <figcaption>
                    <span>03 / Cobro</span>
                    <strong>El cierre del pedido sigue el flujo.</strong>
                  </figcaption>
                </figure>
              </div>
            </div>
            <p className="image-note">Vistas del producto Umi en el entorno de ONCA.</p>
          </div>
        </section>

        <section className="work-section section-space" id="sistema" aria-labelledby="work-title">
          <div className="site-width">
            <div className="section-heading work-heading">
              <div>
                <p className="eyebrow">
                  <span className="eyebrow-line" /> Cómo funciona
                </p>
                <h2 id="work-title">
                  Cada parte del día
                  <br />
                  <span>tiene su lugar.</span>
                </h2>
              </div>
              <p>
                Puedes empezar por lo que tu restaurante necesita hoy. Las piezas comparten el
                contexto cuando tu operación crece.
              </p>
            </div>
            <div className="work-list">
              {work.map((item) => (
                <article className="work-row" key={item.number}>
                  <span className="work-number">{item.number}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <span className="work-product">{item.product}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="cash-section section-space" id="cash" aria-labelledby="cash-title">
          <div className="site-width">
            <div className="section-heading cash-heading">
              <div>
                <p className="eyebrow">
                  <span className="eyebrow-line" /> Umi Cash en otras marcas
                </p>
                <h2 id="cash-title">
                  La relación con el cliente
                  <br />
                  <span>lleva tu nombre.</span>
                </h2>
              </div>
              <p>
                Cash toma la forma de cada restaurante. Kalala Café y El Gran Ribera usan esta parte
                de Umi para su experiencia de lealtad.
              </p>
            </div>
            <div className="cash-grid">
              <article className="cash-client cash-client-kalala">
                <div className="cash-client-top">
                  <span>01 / Cash</span>
                  <span>Kalala Café</span>
                </div>
                <div className="cash-photo cash-photo-tall">
                  <Image
                    src="/editorial/kalala-wallet.jpg"
                    alt="Un cliente muestra el pase de Kalala Café desde su teléfono dentro del café"
                    width={928}
                    height={1152}
                    sizes="(max-width: 760px) 100vw, 40vw"
                    priority={false}
                  />
                </div>
                <div className="cash-client-bottom">
                  <h3>Lealtad con identidad propia.</h3>
                  <p>Una experiencia de Cash con el lenguaje visual de Kalala Café.</p>
                </div>
              </article>
              <article className="cash-client cash-client-ribera">
                <div className="cash-client-top">
                  <span>02 / Cash</span>
                  <span>El Gran Ribera</span>
                </div>
                <div className="cash-photo cash-photo-tall">
                  <Image
                    src="/editorial/ribera-wallet.jpg"
                    alt="Un cliente muestra el pase de El Gran Ribera desde su teléfono frente al mostrador"
                    width={1200}
                    height={1490}
                    sizes="(max-width: 760px) 100vw, 40vw"
                  />
                </div>
                <div className="cash-client-bottom">
                  <h3>Un pase que se siente suyo.</h3>
                  <p>Cash conserva la marca de El Gran Ribera en la experiencia del cliente.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="closing-statement" aria-label="Propuesta Umi">
          <div className="site-width">
            <span>Una operación que puedes seguir.</span>
            <p>Desde el primer pedido hasta la siguiente visita.</p>
          </div>
        </section>
        <ContactSection />
      </main>
      <Footer />
    </>
  );
}
