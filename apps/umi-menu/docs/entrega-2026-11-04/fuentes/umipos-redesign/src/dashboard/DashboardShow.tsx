import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RiPlayLine, RiPauseLine, RiRestartLine, RiArrowLeftLine, RiArrowRightLine } from '@remixicon/react'
import { Stage, type Act } from '../../kit'
import { useReducedMotion } from '../../kit/reduced-motion'
import { Button } from '@/components/base/buttons/button'
import { Select, SelectItem } from '@/components/base/select/select'
import { cx } from '@/utils/cx'
import { deviceFormat, type Device, type Orientation } from '../DevicePreview'
import Dashboard from './Dashboard'
import { dashboardTour, tourChapterLabel, type DashboardScene } from './tour-model'
import { runDashboardTour } from './tour-script'
import './tour.css'
import { PreviewChoices } from '../PreviewChoices'

type Props = { device: Device; orientation: Orientation; dark: boolean; platform: boolean; controls?:ReactNode }
export default function DashboardShow({device, orientation, dark, platform, controls}: Props) {
  const params = new URLSearchParams(location.search)
  const beats = useMemo(() => dashboardTour(platform), [platform])
  const requested = Math.max(0, beats.findIndex(beat => beat.chapter === params.get('chapter')))
  const [mode, setMode] = useState<'explore'|'tour'>(params.has('play') || params.has('chapter') ? 'tour' : 'explore')
  const [start, setStart] = useState(requested)
  const [take, setTake] = useState(0)
  const [paused, setPaused] = useState(!params.has('play'))
  const [scene, setScene] = useState<DashboardScene>(beats[requested].scene)
  const [initial, setInitial] = useState<DashboardScene>(beats[requested].scene)
  const latest = useRef(scene)
  const reduced = useReducedMotion()
  const format = deviceFormat(device, orientation)
  const phone = format.kind === 'phone', smallMenu = phone || format.kind === 'tablet' && orientation === 'portrait'
  const chapters = [...new Set(beats.map(beat => beat.chapter))]
  const index = Math.min(scene.index, beats.length - 1), beat = beats[index]
  const report = useCallback((value: DashboardScene) => { latest.current = value; setScene(value) }, [])
  const run = useCallback((a: Act<DashboardScene>) => runDashboardTour(a, {beats, start: Math.min(start, beats.length - 1), smallMenu, phone}), [beats, start, smallMenu, phone])
  const jump = (next: number, play = false) => {
    const bounded = Math.max(0, Math.min(beats.length - 1, next))
    setStart(bounded); setInitial(beats[bounded].scene); setScene(beats[bounded].scene); latest.current = beats[bounded].scene
    setMode('tour'); setPaused(!play); setTake(n => n + 1)
  }
  // Reframe at the same beat, without a second concurrent script or an old target.
  const configuration = `${device}-${orientation}-${platform}-${reduced}`
  const previousConfiguration = useRef(configuration)
  useEffect(() => {
    if (previousConfiguration.current === configuration) return
    previousConfiguration.current = configuration
    if (mode === 'explore') return
    const current = latest.current
    const next = beats.findIndex(b => b.scene.view === current.view && JSON.stringify(b.scene.detail) === JSON.stringify(current.detail) && b.scene.floorEditing === current.floorEditing && b.scene.authScreen === current.authScreen)
    const bounded = Math.max(0, next)
    const seed = next < 0 ? beats[bounded].scene : {...current, index:bounded, menu:false, sectionOpen:false}
    setStart(bounded); setInitial(seed); setScene(seed); latest.current = seed; setPaused(true); setTake(n => n + 1)
  }, [configuration, beats, mode])
  useEffect(() => { if (reduced) setPaused(true) }, [reduced])
  const playing = mode === 'tour' && !paused && !reduced && !scene.complete
  return <section className={cx('dashboard-show', 'text-body-regular')} data-tour-mode={mode} data-tour-step={index} data-tour-complete={scene.complete} data-tour-playing={playing}>
    <div className="preview-controls">
      <PreviewChoices label="Vista del dashboard" value={mode} options={[{value:'explore',label:'Explorar',ariaLabel:'Explorar pantalla'},{value:'tour',label:'Recorrido',ariaLabel:'Ver recorrido completo'}]} onChange={next=>next==='tour'?jump(0,true):(setPaused(true),setMode('explore'))}/>
      {controls}
    </div>
    <div className="dashboard-tour-controls">
      <div className="dashboard-tour-actions">
        {mode === 'tour' && <>
          <Button leadingIcon={playing ? RiPauseLine : scene.complete ? RiRestartLine : RiPlayLine} aria-label={playing ? 'Pausar recorrido' : scene.complete ? 'Repetir recorrido' : 'Continuar recorrido'} disabled={reduced} onClick={() => scene.complete ? jump(0, true) : setPaused(!paused)}>{playing ? 'Pausar' : scene.complete ? 'Repetir' : 'Continuar'}</Button>
        </>}
      </div>
      <Select className="dashboard-tour-chapters" aria-label="Capítulo del recorrido" selectedKey={beat.chapter} onSelectionChange={key => jump(beats.findIndex(b => b.chapter === key))}>
        {chapters.map((chapter, i) => <SelectItem id={chapter} key={chapter}>{String(i + 1).padStart(2, '0')} · {tourChapterLabel(chapter)}</SelectItem>)}
      </Select>
      {mode === 'tour' && <div className="dashboard-tour-steps">
        <Button variant="secondary" iconOnly leadingIcon={RiArrowLeftLine} aria-label="Paso anterior" disabled={index === 0} onClick={() => jump(index - 1)}/>
        <span className="text-body-2-medium">{index + 1} / {beats.length}</span>
        <Button variant="secondary" iconOnly leadingIcon={RiArrowRightLine} aria-label="Paso siguiente" disabled={index === beats.length - 1} onClick={() => jump(index + 1)}/>
      </div>}
    </div>
    {mode === 'tour' && <div className="dashboard-tour-caption" aria-live="polite" aria-atomic="true">
      <strong className="text-headline-medium">{scene.complete ? 'Recorrido completado' : beat.title}</strong>
      <p className="text-body-2-regular">{scene.complete ? 'Puedes repetirlo o explorar la pantalla actual.' : beat.note}{reduced ? ' Movimiento reducido: usa Anterior y Siguiente.' : ''}</p>
      <progress aria-label="Avance del recorrido" value={index + 1} max={beats.length}/>
    </div>}
    <div className="dashboard-tour-stage" style={{maxWidth:format.outerWidth}}>
      <Stage<DashboardScene> key={`${take}`} width={format.outerWidth} height={format.outerHeight}
        initial={initial} poster={scene} script={mode === 'tour' ? run : undefined}
        paused={paused} suspendOffscreen play="once" fidelity="realistic" theme={dark ? 'dark' : 'light'}
        cursor={mode === 'tour' ? {at:{x:-30,y:-30},style:phone?'touch':'arrow',ripple:!phone,idle:850} : undefined}>
        {s => <DashboardTourFrame {...{device, orientation, dark, platform}} scene={s} mode={mode} report={report}/>}
      </Stage>
    </div>
  </section>
}

function DashboardTourFrame({scene, mode, report, ...props}: Props & {scene:DashboardScene;mode:'tour'|'explore';report:(scene:DashboardScene)=>void}) {
  useEffect(() => { if (mode === 'tour') report(scene) }, [scene, mode, report])
  const blockDuringPlayback = (event: React.SyntheticEvent) => { if (mode === 'tour') { event.preventDefault(); event.stopPropagation() } }
  return <div className="dashboard-tour-surface" onPointerDownCapture={blockDuringPlayback} onClickCapture={blockDuringPlayback} onKeyDownCapture={event => { if (event.key !== 'Tab') blockDuringPlayback(event) }}>
    <Dashboard {...props} tour={mode === 'tour' ? scene : undefined}/>
  </div>
}
