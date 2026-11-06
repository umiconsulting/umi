import { modules } from './data'

export type TourDetail = { row?: number; action?: string; tab?: string; step?: 'edit' | 'review' }
export type DashboardScene = {
  view: string
  menu: boolean
  navExpanded: string | null
  sectionOpen: boolean
  detail: TourDetail | null
  authScreen: 'login' | 'mfa'
  email: string
  password: string
  code: string
  floorEditing: boolean
  index: number
  complete: boolean
}
export type TourBeat = {
  id: string; chapter: string; title: string; note: string
  scene: DashboardScene
  gesture?: 'credentials' | 'verify' | 'row' | 'edit' | 'review' | 'customer-tab' | 'floor-edit'
}

export const sceneForTour = (view = 'login'): DashboardScene => ({
  view, menu: false, navExpanded: null, sectionOpen: false, detail: null, authScreen: 'login',
  email: '', password: '', code: '', floorEditing: false, index: 0, complete: false,
})

export function dashboardTour(platform: boolean): TourBeat[] {
  const beats: TourBeat[] = []
  const add = (chapter: string, view: string, title: string, note: string, patch: Partial<DashboardScene> = {}, gesture?: TourBeat['gesture']) => {
    beats.push({ id: `${chapter}-${beats.length}`, chapter, title, note, gesture,
      scene: { ...sceneForTour(view), ...patch, index: beats.length } })
  }
  add('access', 'login', 'Acceso al dashboard', 'Correo y contraseña de la propietaria. El acceso del POS usa un PIN distinto.')
  add('access', 'login', 'Verificación de la cuenta', 'Segundo factor: código de seis dígitos.',
    { authScreen: 'mfa', email: 'sofia@example.com', password: 'UmiDemo2026' }, 'credentials')
  for (const mod of modules.filter(m => platform || !m.platform)) {
    for (const view of mod.views) {
      add(mod.id, view.id, view.label, view.description, {}, view.id === 'overview' ? 'verify' : undefined)
      if (view.id === 'orders') add(mod.id, view.id, 'Pedido 043 · Lucía', 'Menú digital, productos, importe y estado del pedido.', { detail: { row: 0 } }, 'row')
      if (view.id === 'receipts') add(mod.id, view.id, 'Detalle del recibo', 'Conceptos y total de la venta. La copia se solicita a una impresora registrada.', { detail: { row: 0 } }, 'row')
      if (view.id === 'shifts') add(mod.id, view.id, 'Turno de Ana', 'Fondo, ventas en efectivo y retiro. El conteo y los movimientos se hacen desde el POS.', { detail: { row: 0 } }, 'row')
      if (view.id === 'customers') {
        add(mod.id, view.id, 'Lucía Hernández', 'Historial del cliente, visitas y saldo.', { detail: { row: 0 } }, 'row')
        add(mod.id, view.id, 'Lealtad de Lucía', 'Sellos acumulados, próxima recompensa y monedero.', { detail: { row: 0, tab: 'Lealtad' } }, 'customer-tab')
        add(mod.id, view.id, 'Conversación del cliente', 'Historial de WhatsApp junto a sus pedidos y preferencias.', { detail: { row: 0, tab: 'WhatsApp' } }, 'customer-tab')
      }
      if (view.id === 'products') {
        add(mod.id, view.id, 'Latte · Opciones y disponibilidad', 'Presentaciones, tipo de leche y disponibilidad por sucursal.', { detail: { row: 0 } }, 'row')
        add(mod.id, view.id, 'Editar producto', 'Nombre, categoría, precio y disponibilidad del producto.', { detail: { row: 0, action: 'Editar producto' } }, 'edit')
        add(mod.id, view.id, 'Revisar el producto', 'La revisión reúne los valores antes de confirmar un cambio.', { detail: { row: 0, action: 'Editar producto', step: 'review' } }, 'review')
      }
      if (view.id === 'items' || view.id === 'recipes') add(mod.id, view.id, view.id === 'items' ? 'Existencias y movimientos' : 'Ingredientes de la receta', view.id === 'items' ? 'Entradas, consumo, ajustes y merma del artículo.' : 'Cantidades e ingredientes que intervienen en la preparación.', { detail: { row: 0 } }, 'row')
      if (view.id === 'floor') add(mod.id, view.id, 'Editar el plano', 'Áreas, mesas y elementos del salón. Tamaño, posición, rotación y capacidad conservan su lugar.', { floorEditing: true }, 'floor-edit')
      if (view.id === 'requests') add(mod.id, view.id, 'Solicitud de un dispositivo', 'Revisar el equipo y su estación antes de aprobar o denegar el acceso.', { detail: { row: 0 } }, 'row')
      if (view.id === 'team') add(mod.id, view.id, 'Acceso de Ana', 'Rol, acceso al POS y asignación de PIN por persona.', { detail: { row: 1 } }, 'row')
      if (view.id === 'recovery') add(mod.id, view.id, 'Operación por revisar', 'Consultar el resultado antes de reintentar una operación.', { detail: { row: 0 } }, 'row')
    }
  }
  return beats
}

export const tourChapterLabel = (id: string) => id === 'access' ? 'Acceso' : modules.find(m => m.id === id)?.label || id
