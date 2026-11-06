import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChefHat, Clock3, Coffee, Inbox, ShoppingBag, Utensils } from 'lucide-react'
import { Button } from '@/components/base/buttons/button'
import { Row, Roll } from '../kit'
import { TableIdentity } from './TableIdentity'
import { accountId, accountList, customerNote, orderIdentity, roleName, roundState, snapshot, stationItems, stationPatch, type Scene, type Service, type Station, type StationState, type OrderRound } from './order'

export function ServiceTag({ service }: { service: Service }) {
  return <span className="u-service-tag" data-service={service}>
    {service === 'here' ? <Utensils size={16} strokeWidth={1.8} /> : <ShoppingBag size={16} strokeWidth={1.8} />}
    {service === 'here' ? 'Comer aquí' : 'Para llevar'}
  </span>
}
export const stationLabel: Record<StationState, string> = { sent: 'Por recibir', received: 'Recibida', preparing: 'En preparación', ready: 'Listo' }

function StationCard({ s, station, round, set, primary }: { s: Scene; station: Station; round: OrderRound; set: (p: Partial<Scene>) => void; primary: boolean }) {
  const StationIcon = station === 'bar' ? Coffee : ChefHat
  const state = round.stations[station]
  const items = stationItems(s, station, round.number)
  const readyCount = items.filter(i => s.readyItems.includes(i.id)).length
  const allReady = items.length > 0 && readyCount === items.length
  const toggleItem = (id: string) => set({ readyItems: s.readyItems.includes(id) ? s.readyItems.filter(i => i !== id) : [...s.readyItems, id] })
  const action = state === 'sent' ? { label: 'Recibir comanda', target: 'kitchen-receive', next: 'received' } : state === 'received' ? { label: 'Comenzar preparación', target: 'kitchen-start', next: 'preparing' } : { label: 'Marcar estación lista', target: 'kitchen-ready', next: 'ready' }
  return <article className={primary ? 'u-kitchen-card u-active-order' : 'u-kitchen-card u-reference-order'} data-state={state} data-account={s.account} data-round={round.number}>
    <header className="u-kds-card-head"><span><StationIcon size={16}/>{roleName[station]}</span><span><Clock3 size={14}/>{state === 'sent' ? 'Ahora' : '02:10'}</span></header>
    <div className="u-kds-identity"><span className="u-overline">Comanda {accountId(s)}{round.number > 1 ? ` · Ronda ${round.number}` : ''}</span><span className="u-kds-origin">{s.hideMenuOrigin?'':s.source === 'menu' ? `Menú digital · ${s.menuOrderNumber||'018'}` : s.tableNumber ? 'Salón' : 'Mostrador'}</span></div>
    <h2>{s.source === 'counter' && s.service === 'here' && s.tableNumber ? <TableIdentity number={s.tableNumber}/> : orderIdentity(s)}</h2><div className="u-kds-service"><ServiceTag service={s.service}/>{s.source === 'menu' && <span>Retiro {s.pickupTime||'15:10'}</span>}</div>
    <div className="u-kds-state" data-state={state}><i/><Roll>{stationLabel[state]}</Roll><span>{state === 'preparing' ? `${readyCount}/${items.length}` : ''}</span></div>
    <div className="u-kds-products">{items.map(item => <div className="u-kds-product" key={item.id} data-ready={s.readyItems.includes(item.id)}>
      <Row className="u-kds-row" pad={0} lead={<span className="u-qty">{item.qty}</span>} title={item.name} subtitle={[item.course && item.course > 1 ? `Tiempo ${item.course}` : '', item.detail, item.note].filter(Boolean).join(' · ')}>
        <span className="u-ready-slot" data-visible={state === 'preparing' || state === 'ready'}><Button variant="secondary" className="u-ready-item" data-target={primary ? `ready-${item.id}` : undefined} disabled={state !== 'preparing'} aria-label={`Marcar ${item.name} ${s.readyItems.includes(item.id) ? 'pendiente' : 'listo'}`} aria-pressed={s.readyItems.includes(item.id)} onClick={() => toggleItem(item.id)}><Check size={18}/></Button></span>
      </Row>
    </div>)}</div>
    {s.source === 'menu' && station === 'bar' && <div className="u-kds-note"><b>Nota del cliente</b><span>{s.customerNote??customerNote}</span></div>}
    <div className="u-kds-action">{state !== 'ready' ? <Button className="u-primary u-wide" data-target={primary ? action.target : undefined} disabled={state === 'preparing' && !allReady} onClick={() => set(stationPatch(s, station, action.next as StationState, round.number))}><Roll>{action.label}</Roll><ArrowRight size={18}/></Button> : <div className="u-station-finished"><Check size={18}/>Preparación completada</div>}</div>
  </article>
}

export function Kitchen({ s, set, design = '1' }: { design?: '1'|'2'|'3'; s: Scene; set: (p: Partial<Scene>) => void }) {
  const [showReady, setShowReady] = useState(true)
  const station: Station = s.role === 'bar' ? 'bar' : 'kitchen'
  const StationIcon = station === 'bar' ? Coffee : ChefHat
  const accounts = accountList(s).sort((a, b) => a.account === s.account ? -1 : b.account === s.account ? 1 : a.account.localeCompare(b.account))
  const cards = accounts.flatMap(account => {
    const current = roundState({ ...s, ...account })
    return current.rounds!.filter(round => !round.delivered && stationItems(current, station, round.number).length > 0).map((round, index) => ({ current, round, primary: account.account === s.account && index === 0 }))
  })
  const readyCount = cards.filter(card => card.round.stations[station] === 'ready').length
  const hideReady = design === '2' && !showReady
  const visibleCards = hideReady ? cards.filter(card => card.round.stations[station] !== 'ready') : cards
  const root = useRef<HTMLElement>(null)
  const activeState = cards.find(card=>card.primary)?.round.stations[station]
  useLayoutEffect(()=>{if(design==='2')root.current?.querySelector('.u-active-order')?.scrollIntoView({block:'nearest',inline:'nearest'})},[design,activeState])
  const renderCard = ({ current, round, primary }: typeof cards[number]) => <StationCard key={`${current.account}-${round.number}`} s={current} station={station} round={round} primary={primary} set={patch => current.account === s.account ? set({ ...patch, items: current.items, rounds: patch.rounds ?? current.rounds }) : set({ savedAccounts: { ...s.savedAccounts, [current.account]: snapshot({ ...current, ...patch }) } })}/>
  return <section ref={root} className="u-kitchen u-boardui">
    <div className="u-page-heading"><div><span className="u-overline">Preparación de pedidos</span><div className="u-page-title">{roleName[station]}</div></div><span className="u-kds-live"><i/>En vivo</span></div>
    <div className="u-kds-toolbar"><span className="u-kds-scope"><StationIcon size={17}/><b>Comandas de {roleName[station].toLowerCase()}</b></span>{design === '2' ? <div className="u-kds-view-options"><span className="text-caption-1-regular">Por orden de llegada <Clock3 size={14}/></span><Button variant="secondary" className="h-11 min-h-11 text-body-2-medium" aria-expanded={showReady} onClick={() => setShowReady(value => !value)}>{showReady ? 'Ocultar listas' : 'Mostrar listas'} · {readyCount}</Button></div> : <span>Por orden de llegada <Clock3 size={14}/></span>}</div>
    {!visibleCards.length ? <div className="u-station-empty"><Inbox size={38}/><h2>{hideReady && readyCount > 0 ? 'Sin comandas por preparar' : 'Sin comandas pendientes'}</h2></div> : <div className="u-kitchen-grid" data-ready-visible={design === '2' ? showReady : undefined}>{design === '2' ? ['arrival','preparing',...(showReady ? ['ready'] : [])].map(lane => <section className="u-prep-lane" data-lane={lane} key={lane}><header><h2 className="text-body-medium">{lane==='arrival'?'Recepción':lane==='preparing'?'En preparación':'Lista'}</h2><span className="text-caption-1-medium">{cards.filter(card=>lane==='arrival'?['sent','received'].includes(card.round.stations[station]):card.round.stations[station]===lane).length}</span></header><div>{cards.filter(card=>lane==='arrival'?['sent','received'].includes(card.round.stations[station]):card.round.stations[station]===lane).map(renderCard)}</div></section>) : cards.map(renderCard)}</div>}
  </section>
}
