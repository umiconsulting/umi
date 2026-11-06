import { RiArrowRightLine, RiDeleteBack2Line, RiCheckLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { cx } from '@/utils/cx'
import { demoPin, roleName, staffName, type Scene } from './order'

export function Login({s,set,shiftStatus,design='1'}:{s:Scene;set:(patch:Partial<Scene>)=>void;shiftStatus:string;design?:'1'|'2'|'3'}) {
  const edit=(pin:string)=>set({pin:pin.replace(/\D/g,'').slice(0,4),pinError:false})
  const submit=()=>{
    if(s.pin.length!==4)return
    if(s.pin!==demoPin[s.role]){set({pin:'',pinError:true});return}
    set({screen:s.role==='cashier'?s.resumeScreen:'kitchen',pin:'',pinError:false})
  }
  const chooseRole=(role:Scene['role'])=>set({role,pin:'',pinError:false,resumeScreen:role==='cashier'?(s.source==='menu'&&s.incoming?'incoming':'sale'):'kitchen'})
  const businessSummary=<div className="u-login-business" aria-label="Resumen del negocio"><div className="u-login-shift"><b>{shiftStatus==='closed'?'Turno cerrado':shiftStatus==='suspended'?'Turno suspendido':'Turno en curso'}</b><span>{shiftStatus==='closed'?'Abre un turno en Caja':'Desde las 08:00'}</span></div><dl><div><dt>Mesas libres</dt><dd>3 <span>de 6</span></dd></div><div><dt>Pedidos por revisar</dt><dd>{s.incoming?'1':'0'} <span>del menú digital</span></dd></div></dl></div>
  const userSelect=<Select label="Usuario" selectedKey={s.role} triggerClassName="min-h-12" onSelectionChange={key=>chooseRole(String(key) as Scene['role'])}>
          {(['cashier','bar','kitchen'] as const).map(role=><SelectItem key={role} id={role} textValue={`${staffName[role]} · ${roleName[role]}`}>{staffName[role]} · {roleName[role]}</SelectItem>)}
        </Select>
  const pinForm=<form className="u-login-form" onSubmit={e=>{e.preventDefault();submit()}}>
        <Input label="PIN" name="pin" type="password" inputMode="numeric" inputDir="ltr" autoComplete="off" maxLength={4} value={s.pin} isInvalid={s.pinError} onChange={edit} placeholder="" inputClassName="text-center text-title-1-medium tracking-widest" fieldClassName="h-14"/>
        <div className="u-pin-message">{s.pinError?<span role="alert">PIN incorrecto. Inténtalo de nuevo.</span>:<span>Ingresa los 4 dígitos de tu PIN.</span>}</div>
        <div className="u-pin-keypad">{['1','2','3','4','5','6','7','8','9','clear','0','delete'].map(key=><Button key={key} variant="secondary" type="button" data-target={`pin-${key}`} aria-label={key==='clear'?'Borrar PIN':key==='delete'?'Borrar último dígito':key} leadingIcon={key==='delete'?RiDeleteBack2Line:undefined} iconOnly={key==='delete'} className={cx('h-14 w-full rounded-lg shadow-none',key==='clear'?'text-caption-1-medium':'text-title-2-medium')} onClick={()=>edit(key==='clear'?'':key==='delete'?s.pin.slice(0,-1):s.pin+key)}>{key==='delete'?undefined:key==='clear'?'Borrar':key}</Button>)}</div>
        <Button type="submit" className="h-12 w-full justify-between shadow-none" trailingIcon={RiArrowRightLine} data-target="login-submit" disabled={s.pin.length!==4}>Ingresar</Button>
      </form>
  const identity=<header className="u-login-header"><span className="u-login-logo">umi</span><span>ONCA <span>{design==='3'?'Centro':'· Centro'}</span></span></header>
  const footer=<footer className="u-login-footer">ONCA Centro <span>{roleName[s.role]}</span></footer>
  if(design!=='1')return <section className="u-login u-boardui">
    {identity}
    <div className="u-login-content">
      <div className="u-login-access">
        <div className="u-login-intro"><span className="u-overline">Acceso al punto de venta</span><h1>Iniciar sesión</h1><p>Selecciona tu usuario e ingresa tu PIN.</p></div>
        {design==='2'?<div className="u-login-operators" role="group" aria-label="Usuario">{(['cashier','bar','kitchen'] as const).map(role=><Button key={role} variant="secondary" aria-label={`${staffName[role]} · ${roleName[role]}`} aria-pressed={s.role===role} onClick={()=>chooseRole(role)} className="u-login-operator shadow-none"><span className="u-login-operator-copy"><b className="text-body-medium">{staffName[role]}</b><span className="text-caption-1-regular">{roleName[role]}</span></span>{s.role===role&&<RiCheckLine size={16} aria-hidden="true"/>}</Button>)}</div>:userSelect}
        {pinForm}
      </div>
      {businessSummary}
    </div>
    {footer}
  </section>
  return <section className="u-login u-boardui">
    {identity}
    <div className="u-login-content">
      <div className="u-login-intro"><span className="u-overline">Acceso al punto de venta</span><h1>Iniciar sesión</h1><p>Selecciona tu usuario e ingresa tu PIN.</p>
        {businessSummary}
        {userSelect}
      </div>
      {pinForm}
    </div>{footer}
  </section>
}
