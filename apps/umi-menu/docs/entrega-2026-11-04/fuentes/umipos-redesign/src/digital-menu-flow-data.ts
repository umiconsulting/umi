export type Mode = 'pickup' | 'table' | 'scheduled'
export type CancelCase = 'pending' | 'accepted' | 'preparing'
export const modes: { id: Mode; label: string }[] = [
  { id: 'pickup', label: 'Para recoger' }, { id: 'table', label: 'En mesa' }, { id: 'scheduled', label: 'Programado' },
]
export const chapters = [
  { id: 'config', title: 'Configuración', actor: 'Dashboard', note: 'El negocio publica su menú y habilita los pedidos para esta sucursal.' },
  { id: 'menu', title: 'Elegir productos', actor: 'Cliente', note: 'El cliente elige sus productos y revisa las opciones antes de enviar.' },
  { id: 'send', title: 'Enviar el pedido', actor: 'Cliente → POS', note: 'El cliente revisa sus datos y el total. El pago será en el negocio.' },
  { id: 'accept', title: 'Recibir en POS', actor: 'Personal', note: 'El personal revisa el pedido según la modalidad.' },
  { id: 'kitchen', title: 'Preparar', actor: 'Barra + cocina', note: 'Cada estación recibe sus productos. El pedido está listo cuando terminan ambas.' },
  { id: 'notify', title: 'Avisar al cliente', actor: 'Seguimiento', note: 'El cliente consulta su enlace privado y recibe el aviso por correo.' },
  { id: 'pay', title: 'Cobrar y entregar', actor: 'UmiPOS', note: 'El personal cobra y registra la entrega sobre el mismo pedido.' },
  { id: 'cancel', title: 'Cancelar', actor: 'Cliente + personal', note: 'El estado determina si el cliente puede cancelar directamente.' },
] as const
export type Chapter = typeof chapters[number]['id']
export function readMode(value: string | null): Mode { return value === 'table' || value === 'scheduled' ? value : 'pickup' }
export function readChapter(value: string | null): Chapter { return chapters.some(c => c.id === value) ? value as Chapter : 'config' }
export function explanation(chapter: Chapter, mode: Mode, cancel: CancelCase): string {
  if (chapter === 'send') return mode === 'table' ? 'El QR identifica la mesa 12. El pedido pasa a preparación y avisa al personal. No pide datos de contacto.' : 'Nombre, teléfono y correo, sin código SMS. “Recibido” indica que el negocio todavía debe aceptar el pedido.'
  if (chapter === 'accept') return mode === 'table' ? 'La mesa no espera aceptación. El personal recibe el aviso de un pedido que ya pasó a preparación.' : mode === 'scheduled' ? 'Aceptar reserva la recogida de las 17:30. El pedido todavía no aparece en cocina ni en barra.' : 'Al aceptar, el mismo pedido pasa a cocina y barra. Hasta ese momento permanece pendiente.'
  if (chapter === 'kitchen') return mode === 'scheduled' ? 'A las 17:10 se libera el pedido aceptado. Barra termina primero; “Listo” aparece cuando también termina cocina. Horarios de ejemplo.' : 'Barra termina el latte. El pedido sigue en preparación hasta que cocina termina el French toast.'
  if (chapter === 'notify') return mode === 'table' ? 'El personal lleva el pedido a la mesa. El cliente consulta el seguimiento sin proporcionar correo.' : 'El correo identifica al negocio y enlaza al pedido. El seguimiento web funciona aunque el correo falle.'
  if (chapter === 'cancel') {
    if (mode === 'table' || cancel === 'preparing' || (mode === 'pickup' && cancel === 'accepted')) return 'El cliente solicita la cancelación. El pedido sigue activo hasta que el personal autoriza y el cambio llega a las estaciones.'
    if (mode === 'scheduled' && cancel === 'accepted') return 'Son las 16:50. Puede cancelar antes del límite de las 17:00 y antes de liberar a preparación. Horarios de ejemplo.'
    return 'Mientras espera aceptación, el cliente puede cancelar directamente. El pedido no pasa a cocina ni a barra.'
  }
  return chapters.find(c => c.id === chapter)!.note
}
