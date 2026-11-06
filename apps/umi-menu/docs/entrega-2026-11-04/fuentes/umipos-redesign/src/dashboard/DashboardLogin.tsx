import { useEffect, useState } from 'react'
import { RiEyeLine, RiEyeOffLine, RiArrowLeftLine, RiCheckLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Select, SelectItem } from '@/components/base/select/select'
import './login.css'
import type { DashboardScene } from './tour-model'

const copy={
 es:{access:'Iniciar sesión',description:'Accede a la administración de tu negocio.',email:'Correo',password:'Contraseña',enter:'Entrar',remember:'Recordar mi correo',forgot:'Olvidé mi contraseña',back:'Volver al acceso',recover:'Restablecer contraseña',recoverDescription:'Ingresa el correo asociado a tu cuenta.',send:'Enviar enlace',sent:'Revisa tu correo',sentDescription:'Solicitud de ejemplo. No se envió un correo real.',sampleLink:'Abrir enlace de ejemplo',newPassword:'Nueva contraseña',confirm:'Confirmar contraseña',save:'Guardar contraseña',done:'Contraseña actualizada en la demo',verify:'Verifica que eres tú',code:'Código de seis dígitos',verifyButton:'Verificar',emailCode:'Ingresa el código que recibiste por correo.',totpCode:'Ingresa el código de tu aplicación de autenticación.',invalid:'Correo o contraseña incorrectos.',invalidCode:'Código incorrecto. Inténtalo de nuevo.',short:'Usa al menos ocho caracteres.',mismatch:'Las contraseñas no coinciden.',show:'Mostrar contraseña',hide:'Ocultar contraseña'},
 en:{access:'Sign in',description:'Access your business dashboard.',email:'Email',password:'Password',enter:'Sign in',remember:'Remember my email',forgot:'Forgot password',back:'Back to sign in',recover:'Reset password',recoverDescription:'Enter the email linked to your account.',send:'Send link',sent:'Check your email',sentDescription:'Example request. No real email was sent.',sampleLink:'Open example link',newPassword:'New password',confirm:'Confirm password',save:'Save password',done:'Password updated in the demo',verify:'Verify your identity',code:'Six-digit code',verifyButton:'Verify',emailCode:'Enter the code sent to your email.',totpCode:'Enter the code from your authenticator app.',invalid:'Incorrect email or password.',invalidCode:'Incorrect code. Try again.',short:'Use at least eight characters.',mismatch:'The passwords do not match.',show:'Show password',hide:'Hide password'},
}
export default function DashboardLogin({reset,onEnter,tour}:{reset:boolean;onEnter:()=>void;tour?:DashboardScene}){
 const params=new URLSearchParams(location.search)
 const [localScreen,setScreen]=useState(reset?'reset':'login'),[locale,setLocale]=useState<'es'|'en'>('es')
 const [localEmail,setEmail]=useState(()=>{try{return localStorage.getItem('umi.redesign.demo.email')||''}catch{return ''}})
 const [localPassword,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[localCode,setCode]=useState('')
 const [remember,setRemember]=useState(()=>{try{return !!localStorage.getItem('umi.redesign.demo.email')}catch{return false}}),[reveal,setReveal]=useState(false),[error,setError]=useState('')
 const [demoPassword,setDemoPassword]=useState('UmiDemo2026')
 const screen=tour?.authScreen??localScreen,email=tour?.email??localEmail,password=tour?.password??localPassword,code=tour?.code??localCode
 useEffect(()=>{if(tour){setScreen(tour.authScreen);setEmail(tour.email);setPassword(tour.password);setCode(tour.code)}},[tour])
 const c=copy[locale]
 const go=(next:string)=>{setScreen(next);setError('');setPassword('');setConfirmation('');setCode('');setReveal(false)}
 const submit=()=>{
  setError('')
  if(screen==='login'){
   if(email.trim().toLowerCase()!=='sofia@example.com'||password!==demoPassword){setError(c.invalid);return}
   try{if(remember)localStorage.setItem('umi.redesign.demo.email',email);else localStorage.removeItem('umi.redesign.demo.email')}catch{}
   if(params.get('auth')==='mfa'){go('mfa');return}
   setPassword('');onEnter()
  }else if(screen==='forgot')go('sent')
  else if(screen==='mfa'){if(code==='135790')onEnter();else{setError(c.invalidCode);setCode('')}}
  else if(screen==='reset'){
   if(password.length<8){setError(c.short);return}
   if(password!==confirmation){setError(c.mismatch);return}
   setDemoPassword(password);go('done')
  }
 }
 const title=screen==='login'?(locale==='es'?'Hola de nuevo':'Welcome back'):screen==='forgot'||screen==='reset'?c.recover:screen==='sent'?c.sent:screen==='mfa'?c.verify:c.done
 const description=screen==='login'?(locale==='es'?'Inicia sesión para entrar a tu panel.':'Sign in to your dashboard.'):screen==='forgot'?c.recoverDescription:screen==='sent'?c.sentDescription:screen==='mfa'?params.get('method')==='totp'?c.totpCode:c.emailCode:''
 return <section className="d-auth" data-target="d-auth-scroll" data-auth-screen={screen}>
  <aside className="d-auth-image"><img src="/dashboard-login-bg.jpg" alt=""/><div className="d-auth-brand"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 15 C7 10.5,10 10.5,12 14.5 S18 18,20 13.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M4 10.5 C7 6,10 6,12 10 S18 13.5,20 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity=".6"/></svg><span className="d-logo">umi</span></div></aside>
  <div className="d-auth-story"><h2>{locale==='es'?<>Tu operación,<br/>en tiempo real.</>:<>Your operation,<br/>in real time.</>}</h2><p>{locale==='es'?'Supervisa la operación de tu negocio al momento, desde un solo panel.':'Monitor your business operations as they happen, from one dashboard.'}</p></div>
  <div className="d-auth-pane"><div className="d-auth-locale"><Select aria-label="Idioma del acceso" selectedKey={locale} onSelectionChange={key=>setLocale(key as 'es'|'en')}><SelectItem id="es">Español</SelectItem><SelectItem id="en">English</SelectItem></Select></div>
   <form className="d-auth-form" onSubmit={e=>{e.preventDefault();submit()}}>
    <header><h1>{title}</h1>{description&&<p>{description}</p>}</header>
    {['login','forgot'].includes(screen)&&<Input className="d-auth-credential" data-target="d-auth-email" data-cursor="ibeam" label={c.email} type="email" autoComplete="email" placeholder="nombre@negocio.com" isRequired value={email} onChange={setEmail}/>}
    {['login','reset'].includes(screen)&&<><div className="d-auth-password"><Input className="d-auth-credential" data-target="d-auth-password" data-cursor="ibeam" label={screen==='reset'?c.newPassword:c.password} type={reveal?'text':'password'} autoComplete={screen==='reset'?'new-password':'current-password'} placeholder={locale==='es'?'Escribe tu contraseña':'Enter your password'} isRequired value={password} onChange={setPassword}/><Button variant="ghost" iconOnly leadingIcon={reveal?RiEyeOffLine:RiEyeLine} aria-label={reveal?c.hide:c.show} onClick={()=>setReveal(!reveal)}/></div>{screen==='reset'&&<Input className="d-auth-credential" label={c.confirm} type={reveal?'text':'password'} autoComplete="new-password" isRequired value={confirmation} onChange={setConfirmation}/>}</>}
    {screen==='mfa'&&<Input className="d-auth-credential" data-target="d-auth-code" data-cursor="ibeam" label={c.code} inputMode="numeric" maxLength={6} autoComplete="one-time-code" isRequired value={code} onChange={value=>setCode(value.replace(/\D/g,''))}/>}
    {screen==='login'&&<div className="d-auth-options"><Checkbox isSelected={remember} onChange={setRemember}>{c.remember}</Checkbox><Button variant="ghost" onClick={()=>go('forgot')}>{c.forgot}</Button></div>}
    {error&&<p className="d-error" role="alert">{error}</p>}
    {!['sent','done'].includes(screen)&&<Button data-target="d-auth-submit" type="submit" disabled={screen==='mfa'&&code.length!==6}>{screen==='login'?c.enter:screen==='forgot'?c.send:screen==='mfa'?c.verifyButton:c.save}</Button>}
    {screen==='sent'&&<Button variant="secondary" onClick={()=>go('reset')}>{c.sampleLink}</Button>}
    {screen==='done'&&<RiCheckLine size={28} className="d-auth-done"/>}
    {screen!=='login'&&<Button variant="ghost" leadingIcon={RiArrowLeftLine} onClick={()=>go('login')}>{c.back}</Button>}
   </form>
  </div>
 </section>
}
