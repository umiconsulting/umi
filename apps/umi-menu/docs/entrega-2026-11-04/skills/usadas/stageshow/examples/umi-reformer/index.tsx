import { useEffect, useState } from 'react'
import { Bar, Collapse, Count, Phone, Roll, Stage, States, Text, Window, useReducedMotion, type Act } from '../../kit'
import './style.css'

// Umi Studios · Reformer Pilates. A member books the last evening class on
// the web and the pass on her phone updates by itself: balance 63 → 62 and
// the next class appears. She browses the wallet: buys nothing, checks her
// history, comes back to the pass and opens the QR at the studio. The loop
// resets with a cause: she cancels on the web, the toast confirms, the pass
// rolls back.
//
// The web page is the hero (top-left, off the bottom); the phone straddles
// the window's right rail, over filler bars, never over the row being acted
// on. Real strings: Reformer Pilates, the row's time, Karla Lopez, the
// availability, Apartar/Cancelar, the balance, the next class, the toast.

type Tab = 'pase' | 'comprar' | 'historial'
type S = { booked: boolean; toast: boolean; qr: boolean; tab: Tab; plan: boolean }

const START: S = { booked: false, toast: false, qr: false, tab: 'pase', plan: false }
const POSTER: S = { booked: true, toast: false, qr: false, tab: 'pase', plan: false }
const TITLES: Record<Tab, string> = { pase: 'Mi pase', comprar: 'Comprar', historial: 'Historial' }

const script = async (a: Act<S>) => {
  try {
    await a.wait(1100)
    a.mark('book')
    await a.click('apartar')
    a.set({ booked: true })
    await a.wait(1000)
    a.mark('payoff')
    await a.wait(1600)
    a.mark('comprar')
    await a.click('tab-comprar')
    a.set({ tab: 'comprar' })
    await a.wait(700)
    await a.click('plan-10')
    a.set({ plan: true })
    await a.wait(1800)
    a.mark('historial')
    await a.click('tab-historial')
    a.set({ tab: 'historial' })
    await a.wait(2000)
    a.mark('pase')
    await a.click('tab-pase')
    a.set({ tab: 'pase' })
    await a.wait(1200)
    a.mark('studio')
    await a.click('qr')
    a.set({ qr: true })
    await a.wait(2600)
    a.mark('cancel')
    await a.click('cancelar')
    a.set({ booked: false, toast: true, qr: false, plan: false })
    await a.wait(1800)
    a.set({ toast: false })
    await a.wait(500)
    window.dispatchEvent(new CustomEvent('umi-reformer-loop'))
  } catch (error) {
    window.dispatchEvent(new CustomEvent('umi-reformer-error', { detail: error instanceof Error ? error.message : String(error) }))
    throw error
  }
}

const DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

function LiveStatus() {
  const reduced = useReducedMotion()
  const [loops, setLoops] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [vis, setVis] = useState(typeof document !== 'undefined' ? document.visibilityState : 'visible')
  useEffect(() => {
    const onLoop = () => setLoops((n) => n + 1)
    const onError = (e: Event) => setError((e as CustomEvent<string>).detail)
    const onVis = () => setVis(document.visibilityState)
    window.addEventListener('umi-reformer-loop', onLoop)
    window.addEventListener('umi-reformer-error', onError)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('umi-reformer-loop', onLoop)
      window.removeEventListener('umi-reformer-error', onError)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  if (error) {
    return <p className="rp-hint rp-hint--err">Error del loop: {error}. Recarga la página.</p>
  }
  if (reduced) {
    return (
      <p className="rp-hint">
        Tu navegador tiene “Reducir movimiento” activo: el demo se muestra fijo.
        Desactívalo para ver el flujo.
      </p>
    )
  }
  if (loops === 0) {
    return (
      <p className="rp-hint">
        El loop aún no arranca · pestaña: {vis}. Si no cambia en unos segundos,
        recarga con Cmd+Shift+R.
      </p>
    )
  }
  return (
    <p className="rp-hint" aria-live="polite">Loop {loops} ✓ · pestaña: {vis}</p>
  )
}

function SessionRow({ time, coach, avail, booked, target, isFocal }: {
  time: string; coach: string; avail: number; booked: boolean; target: string; isFocal: boolean
}) {
  return (
    <div className="rp-row" data-focal={isFocal || undefined}>
      <div className="rp-row__time">
        <span className="rp-row__h">{time}</span>
        <span className="rp-row__m">50 min</span>
      </div>
      <div className="rp-row__info">
        <span className="rp-row__t">Reformer Pilates</span>
        <span className="rp-row__c">{coach} · <Roll>{booked ? '1 de 6' : `${avail} de 6`}</Roll></span>
      </div>
      <button
        className="rp-row__btn"
        data-target={target}
        data-cursor="pointer"
        data-booked={booked || undefined}
      >
        <States
          value={booked ? 'booked' : 'open'}
          align="center"
          states={{
            open: <span className="rp-row__lbl">Apartar</span>,
            booked: <span className="rp-row__lbl">Cancelar</span>
          }}
        />
      </button>
    </div>
  )
}

function QuietRow({ time }: { time: string }) {
  return (
    <div className="rp-row">
      <div className="rp-row__time">
        <span className="rp-row__h">{time}</span>
        <span className="rp-row__m">50 min</span>
      </div>
      <div className="rp-row__info">
        <span className="rp-row__t">Reformer Pilates</span>
        <Bar w={64} h={4} tone={1} />
      </div>
      <Bar w={46} h={22} r={7} tone={2} />
    </div>
  )
}

function PlanRow({ label, price, selected }: { label: string; price: string; selected: boolean }) {
  return (
    <button
      className="rp-plan"
      data-target={label === '10 clases' ? 'plan-10' : undefined}
      data-cursor="pointer"
      data-selected={selected || undefined}
    >
      <span className="rp-plan__l">{label}</span>
      <span className="rp-plan__p">{price}</span>
      <States
        value={selected ? 'done' : 'open'}
        align="center"
        states={{
          open: <span className="rp-plan__tag">Elegir</span>,
          done: <span className="rp-plan__tag rp-plan__tag--on">Seleccionado</span>
        }}
      />
    </button>
  )
}

function HistRow({ when, coach }: { when: string; coach: string }) {
  return (
    <div className="rp-hist__row">
      <span className="rp-hist__when">{when}</span>
      <span className="rp-hist__who">{coach}</span>
      <span className="rp-hist__cost">−1 clase</span>
    </div>
  )
}

export default function UmiReformer() {
  const [run, setRun] = useState(0)
  return (
    <>
      <Stage
        key={run}
        width={640}
        height={400}
        play="loop"
        initial={START}
        poster={POSTER}
        compact={{ below: 600, width: 358, height: 400 }}
        className="rp"
        cursor={{ at: { wide: { x: 60, y: 118 }, compact: { x: 36, y: 112 } } }}
      >
        {(s: S, _rect, layout) => (
          <>
          <Window url="reformerpilates.umistudio.app" urlShape="pill" className="rp-window">
            <div className="rp-web">
              <div className="rp-web__head">
                <Text className="rp-word">Reformer Pilates</Text>
                <span className="rp-web__chip">63 clases</span>
              </div>

              <div className="rp-week">
                {DAYS.map((d, i) => (
                  <span key={d} className="rp-day" data-active={i === 3 || undefined}>{d}</span>
                ))}
              </div>

              <div className="rp-list">
                <QuietRow time="8:00 AM" />
                <SessionRow time="5:00 PM" coach="Karla Lopez" avail={2} booked={s.booked} target={s.booked ? 'cancelar' : 'apartar'} isFocal />
                <QuietRow time="6:00 PM" />
                <QuietRow time="7:00 PM" />
              </div>
            </div>

            <div className="rp-rail">
              {[76, 64, 40, 70, 58, 66, 60, 46, 72, 52, 68, 44, 62, 56, 48, 66].map((w, i) => (
                <Bar key={i} w={w} h={5} tone={i % 3 === 0 ? 3 : 1} />
              ))}
            </div>

            <div className="rp-toast" data-show={s.toast || undefined}>
              Clase devuelta
            </div>
          </Window>

          <Phone width={layout === 'wide' ? 240 : 200} frame="pro" status={layout === 'wide'} className="rp-phone">
            <div className="rp-app">
              <div className="rp-app__head">
                <span className="rp-word rp-app__title"><Roll>{TITLES[s.tab]}</Roll></span>
                <Bar w={34} h={6} tone={2} />
              </div>

              {s.tab === 'pase' && (
                <div className="rp-pass" data-target="qr" data-cursor="pointer" data-open={s.qr || undefined}>
                  <div className="rp-pass__in">
                    <div className="rp-pass__nivel">PLATINO</div>
                    <div className="rp-pass__lbl">PRÓXIMA CLASE</div>
                    <div className="rp-pass__nextval">Jue · 5:00 PM</div>
                    <div className="rp-pass__frow">
                      <div>
                        <div className="rp-pass__lbl">CLASE</div>
                        <div className="rp-pass__val">Reformer · Karla Lopez</div>
                      </div>
                      <div>
                        <div className="rp-pass__lbl">TE QUEDAN</div>
                        <div className="rp-pass__val"><Count className="rp-pass__quedan" value={s.booked ? 62 : 63} duration={800} /> <span className="rp-pass__unit">clases</span></div>
                      </div>
                    </div>
                    <div className="rp-pass__frow">
                      <div>
                        <div className="rp-pass__lbl">CONTIGO</div>
                        <div className="rp-pass__val rp-pass__val--grey">63 clases</div>
                      </div>
                      <div>
                        <div className="rp-pass__lbl">SIGUIENTE</div>
                        <div className="rp-pass__val rp-pass__val--grey">Black · 37 clases</div>
                      </div>
                    </div>
                    <div className="rp-pass__nextwrap">
                      <Collapse open={s.booked} reveal="drop">
                        <span className="rp-pass__nextline">Próxima · Jue 5 · 5:00 PM</span>
                      </Collapse>
                    </div>
                  </div>
                  <div className="rp-pass__qr" />
                  <div className="rp-pass__open">
                    <div className="rp-pass__openqr" />
                    <div className="rp-pass__openinfo">
                      <span className="rp-pass__openlbl">En el estudio</span>
                      <span className="rp-pass__openhint">Muéstralo al entrar</span>
                    </div>
                  </div>
                </div>
              )}

              {s.tab === 'comprar' && (
                <div className="rp-plans">
                  <PlanRow label="1 clase" price="$180" selected={false} />
                  <PlanRow label="10 clases" price="$1,650" selected={s.plan} />
                  <PlanRow label="30 clases" price="$4,500" selected={false} />
                </div>
              )}

              {s.tab === 'historial' && (
                <div className="rp-hist">
                  <HistRow when="Jue 5 · 5:00 PM" coach="Karla Lopez" />
                  <HistRow when="Mié 4 · 6:00 PM" coach="Lucio" />
                  <HistRow when="Lun 2 · 7:00 PM" coach="Lucio" />
                </div>
              )}

              <div className="rp-tabs">
                <button className="rp-tab" data-active={s.tab === 'pase' || undefined} data-target="tab-pase" data-cursor="pointer">Pase</button>
                <button className="rp-tab" data-active={s.tab === 'comprar' || undefined} data-target="tab-comprar" data-cursor="pointer">Comprar</button>
                <button className="rp-tab" data-active={s.tab === 'historial' || undefined} data-target="tab-historial" data-cursor="pointer">Historial</button>
              </div>
            </div>
          </Phone>
          </>
        )}
      </Stage>
      <LiveStatus />
      <button className="rp-restart" onClick={() => setRun((n) => n + 1)}>Reiniciar demo</button>
    </>
  )
}
