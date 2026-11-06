import { useCallback, useEffect, useRef, useState } from 'react'
import { RiExternalLinkLine } from '@remixicon/react'
import { Stage } from '../kit'
import { ButtonLink } from '@/components/base/buttons/button'
import { DeviceFrame, DevicePicker, deviceFormat, type Device, type Orientation } from './DevicePreview'
import './digital-menu.css'
import { PreviewChoices } from './PreviewChoices'
import DigitalMenuShow from './DigitalMenuShow'

const menuUrl = '/menu-digital/menu.html'
const emptyScene = {}
type MenuWindow = Window & { __umiMenuPreview?: { capture: () => unknown; restore: (state: unknown) => void } }

export default function DigitalMenu({ device, orientation, onDevice, onOrientation }: {
  device: Device
  orientation: Orientation
  onDevice: (device: Device) => void
  onOrientation: (orientation: Orientation) => void
}) {
  const [view, setView] = useState(new URLSearchParams(location.search).get('menuView') === 'tour' ? 'tour' : 'menu')
  const menuFrame = useRef<HTMLIFrameElement|null>(null)
  const snapshot = useRef<unknown>(null)
  const [menuReady, setMenuReady] = useState(false)
  const bindMenuFrame = useCallback((node:HTMLIFrameElement|null) => { menuFrame.current=node; if(node)setMenuReady(false) }, [])
  const format = deviceFormat(device, orientation)

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === menuFrame.current?.contentWindow && event.data?.type === 'umi-menu:preview-state') snapshot.current = event.data.state
    }
    addEventListener('message', receive)
    return () => removeEventListener('message', receive)
  }, [])
  const saveMenu = () => {
    const menu = menuFrame.current?.contentWindow as MenuWindow | null
    snapshot.current = menu?.__umiMenuPreview?.capture() ?? snapshot.current
  }

  const choose = (next: 'menu' | 'tour') => {
    if (next === view) return
    setView(next)
    const url = new URL(location.href)
    url.searchParams.set('app', 'menu')
    url.searchParams.set('menuView', next)
    history.replaceState(null, '', url)
  }

  return <section className="digital-menu-section" aria-label="Menú digital">
    <div className="digital-menu-toolbar">
      <PreviewChoices label="Vista del menú digital" value={view as 'menu'|'tour'} options={[{value:'menu',label:'Explorar',ariaLabel:'Explorar menú'},{value:'tour',label:'Recorrido',ariaLabel:'Recorrido por pasos'}]} onChange={choose}/>
      {view === 'menu' && <ButtonLink variant="ghost" href={menuUrl} target="_blank" rel="noreferrer" trailingIcon={RiExternalLinkLine}>Abrir pantalla completa</ButtonLink>}
    </div>
    <div hidden={view !== 'menu'}>
      <div className="digital-menu-toolbar">
        <DevicePicker device={device} orientation={orientation} onDevice={next => { saveMenu(); onDevice(next) }} onOrientation={next => { saveMenu(); onOrientation(next) }}/>
        <p className="text-body-2-regular text-text-secondary">Elige productos, revisa el carrito y prueba un pedido</p>
      </div>
      <div className="digital-menu-preview" style={{maxWidth: format.outerWidth}}>
        <Stage width={format.outerWidth} height={format.outerHeight} initial={emptyScene} poster={emptyScene} fidelity="realistic" className="umi-study">
          {() => <DeviceFrame device={device} orientation={orientation} dark={false} title="Umi · Menú digital">
            <iframe ref={bindMenuFrame} className="digital-menu-frame" title="Menú digital interactivo" src={menuUrl} style={{visibility:menuReady?'visible':'hidden'}} onLoad={() => { (menuFrame.current?.contentWindow as MenuWindow | null)?.__umiMenuPreview?.restore(snapshot.current); setMenuReady(true) }}/>
          </DeviceFrame>}
        </Stage>
      </div>
    </div>
    {view === 'tour' && <DigitalMenuShow {...{device,orientation,onDevice,onOrientation}}/>}
    <p className="mt-4 text-body-2-regular text-text-secondary">Datos de ejemplo. Los pedidos y los avisos son simulados.</p>
  </section>
}
