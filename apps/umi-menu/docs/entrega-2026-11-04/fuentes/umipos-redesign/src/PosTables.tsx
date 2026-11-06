import { useLayoutEffect, useState } from 'react'
import { RiArrowRightLine, RiAddLine, RiCloseLine, RiMap2Line, RiListCheck, RiGroupLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { Row } from '../kit'
import { FloorPlan, sampleTables } from './FloorPlan'
import { TableIdentity } from './TableIdentity'
import { accountList, balanceDue, roomOf, tableStatusLabel, tableIsFree, resumeAccount, seatTable, moveTable, mergeTables, splitTables, changeTableState, orderIdentity, type Scene } from './order'

const money = (value: number) => '$' + value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function PosTables({ s, set, fit, design = '1' }: { design?: '1'|'2'|'3'; s: Scene; set: (patch: Partial<Scene>) => void; fit: boolean }) {
  const [table, setTable] = useState(s.tableNumber ?? 3)
  const [map, setMap] = useState(true)
  const [mode, setMode] = useState<'view' | 'seat' | 'move' | 'merge' | 'split' | 'clear'>('view')
  const [selected, setSelected] = useState<number[]>([])
  const [guests, setGuests] = useState('2')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const fade = useScrollFade()
  const listFade = useScrollFade()
  useLayoutEffect(() => { listFade.reset() }, [design, map, listFade.reset])
  const room = roomOf(s), current = room[table]
  const accounts = accountList(s).filter(account => !account.paid)
  const account = accounts.find(account => account.tableNumber === table)
  const free = tableIsFree(current)
  const group = current.group ? Object.values(room).filter(t => t.group === current.group) : []
  const run = (operation: () => Scene, success = '') => { try { set(operation()); setError(''); setNotice(success); setMode('view') } catch (e) { setError((e as Error).message) } }
  const choose = (number: number) => {
    setError('')
    if (mode === 'move') { run(() => moveTable(s, table, number), 'Mesa trasladada. Se conserva el tiempo de atención y la cuenta.'); if (tableIsFree(room[number]) && current.guests <= room[number].seats) setTable(number); return }
    if (mode === 'merge') {
      if (!tableIsFree(room[number])) { setError('Selecciona mesas libres para unir el grupo.'); return }
      setSelected(values => values.includes(number) ? values.filter(n => n !== number) : [...values, number]); return
    }
    setTable(number); setMode('view'); setNotice(''); setGuests(String(room[number].guests || 2)); fade.reset()
  }
  const layout = sampleTables.map(item => ({ ...item, state: room[item.number].state === 'awaiting_payment' ? 'pay' as const : room[item.number].state === 'dirty' ? 'dirty' as const : tableIsFree(room[item.number]) ? 'free' as const : 'busy' as const }))
  const accountRows = <div className="u-account-list u-pos-account-list u-boardui" onScroll={design === '2' ? listFade.onScroll : undefined}>{accounts.map(a => <Button variant="secondary" key={a.account} onClick={() => { if (mode !== 'view' && a.tableNumber) choose(a.tableNumber); else run(() => resumeAccount(s, a.account)) }}><Row lead={a.tableNumber ? <TableIdentity number={a.tableNumber}/> : undefined} title={'Cuenta ' + a.account} subtitle={a.tableNumber ? tableStatusLabel[room[a.tableNumber].state] : orderIdentity(a)} meta={money(balanceDue(a))}/></Button>)}{Object.values(room).filter(tableIsFree).map(t => <Button variant="secondary" key={t.number} onClick={() => choose(t.number)}><Row lead={<TableIdentity number={t.number}/>} title={tableStatusLabel[t.state]} subtitle={`${t.seats} lugares`}/></Button>)}</div>
  const tableHeading=<><span className="u-overline">Mesa seleccionada</span><div className="u-page-title"><TableIdentity number={table}/></div><span className="u-pill">{tableStatusLabel[current.state]}</span></>
  return <div className="u-tables-composition">
    <section className="u-floor-main">
      <div className="u-page-heading"><div><span className="u-overline">Servicio en salón</span><div className="u-page-title">Cuentas y mesas</div></div><div className="u-toggle u-boardui"><Button variant="ghost" iconOnly leadingIcon={RiMap2Line} aria-label="Vista de mapa" data-active={map} onClick={() => setMap(true)}/><Button variant="ghost" iconOnly leadingIcon={RiListCheck} aria-label="Vista de lista" data-active={!map} onClick={() => setMap(false)}/></div></div>
      <div className="u-floor-toolbar"><span>Salón principal</span><span className="u-muted">6 mesas · {accounts.length} cuentas abiertas</span></div>
      {(mode === 'move' || mode === 'merge') && <div className="u-table-gesture u-boardui text-body-2-regular"><span>{mode === 'move' ? `Elige la mesa destino para ${current.guests} personas.` : `Selecciona las mesas libres del grupo: ${selected.map(n => String(n).padStart(2, '0')).join(', ') || 'ninguna'}`}</span><Button variant="ghost" iconOnly leadingIcon={RiCloseLine} aria-label="Cancelar selección de mesas" onClick={() => setMode('view')}/></div>}
      {map ? <FloorPlan fit={fit} selected={table} onSelect={choose} layout={layout}/> : design === '2' ? <div className="u-pos-account-list-wrap u-boardui">{accountRows}<ScrollFade progress={listFade.progress} surfaceClassName="from-background-full"/></div> : accountRows}
      <div className="u-floor-legend"><span data-state="free">Disponible</span><span data-state="busy">En servicio</span><span data-state="pay">Por cobrar</span><span data-state="dirty">Por limpiar</span></div>
      <span className="u-pos-muted text-caption-1-regular">Unir mesas agrupa personas. Cada cuenta conserva su folio.</span>
    </section>
    <div className="u-table-panel"><aside className="u-table-detail u-operational-table u-boardui" onScroll={fade.onScroll}>
      {design==='1'?tableHeading:<header className="u-table-document-head">{tableHeading}</header>}
      <div className="u-table-facts"><Row title={free ? `${current.seats} lugares` : `${current.guests} personas${group.length ? ` · ${group.length} mesas` : ''}`}/><Row title={current.seatedAt === undefined ? 'Sin personas en mesa' : current.seatedAt === 0 ? 'Sentados ahora' : 'Abierta hace 8 min'}/></div>
      {notice && <p role="status" className="u-pos-feedback text-body-2-regular">{notice}</p>}{error && <p role="alert" className="u-pos-error text-body-2-regular">{error}</p>}
      {mode === 'view' && <>
        {account && <><div className="u-detail-label">Cuenta {account.account}</div><div className="u-table-line-list">{account.items.filter(i => !i.voidReason).map(item => <Row key={item.id} title={`${item.qty} × ${item.name}`} subtitle={item.detail} meta={money(item.qty * item.price)}/>)}</div><div className="u-table-balance"><span>Saldo pendiente</span><strong>{money(balanceDue(account))}</strong></div><Button className="u-primary u-wide" trailingIcon={RiArrowRightLine} onClick={() => run(() => resumeAccount(s, account.account))}>Continuar cuenta</Button></>}
        {!account && (current.state === 'dirty' ? <Button className="u-primary u-wide" onClick={() => run(() => changeTableState(s, table, 'open'), 'Mesa limpia y disponible.')}>Marcar mesa limpia</Button> : <Button className="u-primary u-wide" leadingIcon={RiAddLine} onClick={() => { setGuests(String(current.guests || 2)); setMode('seat') }}>{free ? 'Sentar y abrir cuenta' : 'Abrir cuenta'}</Button>)}
        <div className="u-table-operations">
          {current.state === 'dirty' && account && <Button variant="secondary" onClick={() => run(() => changeTableState(s, table, 'open'), 'Mesa limpia y disponible.')}>Marcar mesa limpia</Button>}
          {!free && <>
            <Button variant="secondary" onClick={() => { setMap(true); setMode('move') }}>Mover a otra mesa</Button>
            {group.length > 1 && <Button variant="secondary" onClick={() => setMode('split')}>Separar mesas del grupo</Button>}
            <div className="u-pos-inline">{(['ordered', 'served', 'awaiting_payment'] as const).map(state => <Button variant="secondary" size="small" key={state} aria-pressed={current.state === state} onClick={() => run(() => changeTableState(s, table, state), `Estado actualizado: ${tableStatusLabel[state]}.`)}>{tableStatusLabel[state]}</Button>)}</div>
            <Button variant="ghost" onClick={() => setMode('clear')}>El grupo se retiró</Button>
          </>}
          {free && <Button variant="secondary" leadingIcon={RiGroupLine} onClick={() => { setSelected([table]); setMap(true); setGuests('2'); setMode('merge') }}>Unir mesas libres</Button>}
        </div>
      </>}
      {(mode === 'seat' || mode === 'merge') && <div className="u-table-form">
        <p className="text-body-2-regular">{mode === 'seat' ? `Capacidad: ${group.length ? group.reduce((sum, t) => sum + t.seats, 0) : current.seats} personas.` : `Mesas ${selected.join(', ')} · Capacidad ${selected.reduce((sum, n) => sum + room[n].seats, 0)} personas.`}</p>
        <Input label="Número de personas" inputMode="numeric" value={guests} onChange={value => { if (/^\d{0,2}$/.test(value)) setGuests(value) }}/>
        <Button className="u-primary u-wide" disabled={mode === 'merge' && selected.length < 2} onClick={() => run(() => mode === 'seat' ? seatTable(s, table, Number(guests)) : mergeTables(s, selected, Number(guests)), mode === 'merge' ? 'Mesas unidas. Abre la cuenta en la mesa correspondiente.' : '')}>{mode === 'seat' ? 'Abrir cuenta' : 'Unir y sentar grupo'}</Button>
        <Button variant="ghost" onClick={() => setMode('view')}>Volver</Button>
      </div>}
      {(mode === 'clear' || mode === 'split') && <div className="u-table-form">
        <p className="text-body-regular">{mode === 'clear' ? `¿Ya se fue el grupo de la mesa ${String(table).padStart(2, '0')}? ${group.length > 1 ? 'Todas las mesas del grupo quedarán por limpiar.' : 'La mesa quedará por limpiar.'} La cuenta conserva su saldo.` : 'Las personas se repartirán según la capacidad. Las mesas sin personas quedarán por limpiar. La cuenta se conserva en su mesa.'}</p>
        <Button className="u-primary u-wide" onClick={() => run(() => mode === 'clear' ? changeTableState(s, table, 'dirty') : splitTables(s, table), mode === 'clear' ? 'Mesa pendiente de limpieza.' : 'Mesas separadas; personas y cuentas conservadas.')}>Confirmar {mode === 'clear' ? 'retiro del grupo' : 'separación'}</Button>
        <Button variant="ghost" onClick={() => setMode('view')}>Volver</Button>
      </div>}
    </aside><ScrollFade progress={fade.progress}/></div>
  </div>
}
