import type { ReactNode } from 'react'
import { RiSmartphoneLine, RiTabletLine } from '@remixicon/react'
import { Phone, Window } from '../kit'
import { Button } from '@/components/base/buttons/button'
import { Select, SelectItem } from '@/components/base/select/select'

export const devices = {
  windows: { label: 'PC · Windows', kind: 'desktop', width: 1280, height: 780, edge: 0 },
  mac: { label: 'Mac · macOS', kind: 'desktop', width: 1280, height: 780, edge: 0 },
  iphone: { label: 'iPhone 17 Pro · iOS', kind: 'phone', width: 402, height: 874, edge: 13 },
  android: { label: 'Pixel 8 · Android', kind: 'phone', width: 412, height: 915, edge: 11 },
  ipad: { label: 'iPad Air 11″ · iPadOS', kind: 'tablet', width: 820, height: 1180, edge: 12 },
  galaxy: { label: 'Galaxy Tab A11 · Android', kind: 'tablet', width: 800, height: 1340, edge: 12 },
} as const
export type Device = keyof typeof devices
export type Orientation = 'portrait' | 'landscape'
export function deviceFormat(device: Device, orientation: Orientation) {
  const profile = devices[device]
  const rotated = profile.kind === 'tablet' && orientation === 'landscape'
  const width = rotated ? profile.height : profile.width
  const height = rotated ? profile.width : profile.height
  return { ...profile, width, height, outerWidth: width + profile.edge*2, outerHeight: height + profile.edge*2 + (profile.kind === 'desktop' ? 38 : 0) }
}

export function DevicePicker({ device, orientation, onDevice, onOrientation }: {
  device: Device; orientation: Orientation; onDevice: (device: Device) => void; onOrientation: (orientation: Orientation) => void;
}) {
  return <div className="study-device-picker">
    <Select aria-label="Dispositivo de vista previa" selectedKey={device} onSelectionChange={key=>onDevice(key as Device)} className="study-device-select">
      {Object.entries(devices).map(([id,profile])=><SelectItem key={id} id={id}>{profile.label}</SelectItem>)}
    </Select>
    {devices[device].kind==='tablet'&&<div className="study-orientation" role="group" aria-label="Orientación de tablet">
      <Button variant={orientation==='portrait'?'secondary':'ghost'} leadingIcon={RiSmartphoneLine} aria-pressed={orientation==='portrait'} onClick={()=>onOrientation('portrait')}>Vertical</Button>
      <Button variant={orientation==='landscape'?'secondary':'ghost'} leadingIcon={RiTabletLine} aria-pressed={orientation==='landscape'} onClick={()=>onOrientation('landscape')}>Horizontal</Button>
    </div>}
  </div>
}

export function DeviceFrame({ device, orientation, dark, children, title = 'UMI POS' }: { device: Device; orientation: Orientation; dark: boolean; children: ReactNode; title?: string }) {
  const format=deviceFormat(device,orientation)
  if(format.kind==='desktop')return <Window title={title} platform={device==='windows'?'windows':'mac'} className="u-device-window" style={{width:format.outerWidth,height:format.outerHeight}}>{children}</Window>
  const model=device==='iphone'?'iphone17pro':device==='android'?'pixel8':device==='ipad'?'ipad11':'galaxytaba11'
  return <Phone width={format.outerWidth} frame={device==='android'?'android':format.kind==='tablet'?'bezel':'pro'} model={model} orientation={orientation} dark={dark} time="14:52" wallpaper="var(--color-background-primary-default)">
    <div className="u-device-safe" data-device={device}><div className="u-device-content">{children}</div></div>
  </Phone>
}
