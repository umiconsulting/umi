import { RiArrowRightLine, RiCheckLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { ServiceTag } from './Kitchen'
import { customerNote, orderIdentity, orderTotal, type Scene } from './order'
import './incoming-order3.css'

const money = (value: number) => value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

/** One expanded incoming register. State and acceptance stay owned by Workspace. */
export function IncomingOrder3({ s, onAccept, onResume }: {
  s: Scene; onAccept: () => void; onResume: () => void;
}) {
  const fade = useScrollFade()
  const total = money(orderTotal(s))
  return <section className="u-incoming3 u-boardui">
    <header className="u-incoming3-heading">
      <span className="text-caption-1-regular text-text-secondary">Menú digital</span>
      <h1 className="text-title-3-semibold">Pedidos entrantes</h1>
    </header>
    <div className="u-incoming3-scroll-wrap">
      <div className="u-incoming3-scroll" onScroll={fade.onScroll}>
        {s.incoming ? <article className="u-incoming3-document" aria-label={`Pedido web ${s.menuOrderNumber || '018'}`}>
          <header className="u-incoming3-register">
            <div className="u-incoming3-identity">
              <span className="text-caption-1-regular text-text-secondary">Pedido web {s.menuOrderNumber || '018'}</span>
              <h2 className="text-headline-medium">{orderIdentity(s)}</h2>
            </div>
            <div className="u-incoming3-service">
              <ServiceTag service="takeaway"/>
              <span className="text-caption-1-regular text-text-secondary">Retiro · {s.pickupTime || '15:10'}</span>
            </div>
            <div className="u-incoming3-amount">
              <span className="text-caption-1-regular text-text-secondary">Pago al recoger</span>
              <strong className="text-body-medium">{total}</strong>
            </div>
            <span className="u-incoming3-status text-caption-1-medium">Por revisar</span>
          </header>
          <div className="u-incoming3-products" role="table" aria-label="Productos y opciones">
            <div className="u-incoming3-product-head text-caption-1-medium text-text-secondary" role="row">
              <span role="columnheader">Cant.</span><span role="columnheader">Producto y opciones</span><span role="columnheader">Importe</span>
            </div>
            {s.items.map(item => <div className="u-incoming3-product" role="row" key={item.id}>
              <span className="text-body-2-medium" role="cell">{item.qty}</span>
              <div className="u-incoming3-product-copy" role="cell">
                <strong className="text-body-medium">{item.name}</strong>
                {item.detail && <span className="text-body-2-regular text-text-secondary">{item.detail}</span>}
                {item.note && <span className="text-body-2-regular text-text-secondary">{item.note}</span>}
              </div>
              <span className="text-body-2-medium" role="cell">{money(item.price * item.qty)}</span>
            </div>)}
          </div>
          <footer className="u-incoming3-ending">
            <div className="u-incoming3-note">
              <span className="text-caption-1-medium text-text-secondary">Nota del cliente</span>
              <p className="text-body-2-regular">{s.customerNote ?? customerNote}</p>
            </div>
            <div className="u-incoming3-settlement">
              <div className="u-incoming3-total"><span className="text-body-2-medium">Total por cobrar</span><strong className="text-title-2-medium">{total}</strong></div>
              <Button className="min-h-12 w-full" trailingIcon={RiArrowRightLine} data-target="accept-order" onClick={onAccept}>Atender en cuenta {s.account}</Button>
            </div>
          </footer>
        </article> : <div className="u-incoming3-empty">
          <RiCheckLine size={24} aria-hidden="true"/>
          <div><h2 className="text-headline-medium">Todo al día</h2><p className="text-body-2-regular text-text-secondary">El pedido está en la cuenta {s.account}.</p></div>
          <Button variant="secondary" className="min-h-12" trailingIcon={RiArrowRightLine} onClick={onResume}>Ver cuenta</Button>
        </div>}
      </div>
      <ScrollFade progress={fade.progress} surfaceClassName="from-background-full"/>
    </div>
  </section>
}
