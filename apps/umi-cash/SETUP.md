# Umi Cash — Plataforma de Lealtad

Sistema de lealtad multi-tenant para cafeterías. Cada negocio tiene su propia URL, marca y configuración.

## Stack

- **Next.js 14** (App Router) — frontend + backend
- **Prisma + SQLite** — base de datos (cambia a PostgreSQL en producción)
- **Tailwind CSS** — colores dinámicos por tenant via CSS variables
- **Apple Wallet** (`passkit-generator`) — pases PKPass
- **Google Wallet** (API REST) — pases de lealtad

---

## Instalación

### Requisitos previos

1. **Node.js 18+** — descarga en https://nodejs.org

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar variables de entorno
cp .env.example .env.local
# Edita .env.local con tus valores

# 3. Crear base de datos y sembrar tenants
npm run db:push
npm run db:seed

# 4. Iniciar en desarrollo
npm run dev
```

Abre http://localhost:3000

---

## Estructura de URLs

```
/                          → UMI Cash platform landing
/umi/login                 → Login del master admin (UMI Consultoría)
/umi/admin                 → Dashboard maestro — todos los tenants

/{slug}                    → Landing pública del negocio
/{slug}/register           → Registro de clientes
/{slug}/card               → Tarjeta digital del cliente
/{slug}/admin-login        → Login del staff/admin del negocio
/{slug}/admin              → Panel de administración del negocio
/{slug}/admin/scan         → Escanear QR
/{slug}/admin/topup        → Recargar saldo
/{slug}/admin/customers    → Lista de clientes
/{slug}/admin/rewards      → Configurar recompensas (solo ADMIN)
/{slug}/admin/settings     → Configurar negocio (solo ADMIN)
```

### Tenants incluidos

| Negocio | Slug | URL |
|---------|------|-----|
| El Gran Ribera | `elgranribera` | `/elgranribera` |
| Kalala Café | `kalalacafe` | `/kalalacafe` |

---

## Credenciales iniciales (desarrollo)

### UMI Master Admin
| URL | Contraseña |
|-----|-----------|
| /umi/admin | Ver `UMI_ADMIN_PASSWORD` en `.env.local` |

### El Gran Ribera
| Rol | Email | Contraseña |
|-----|-------|-----------|
| Admin | admin@elgranribera.mx | ElGranRibera2024! |
| Staff | barista@elgranribera.mx | Barista2024! |
| Cliente demo | +5215512345678 | (sin contraseña) |

### Kalala Café
| Rol | Email | Contraseña |
|-----|-------|-----------|
| Admin | admin@kalalacafe.mx | KalalaCafe2024! |
| Staff | barista@kalalacafe.mx | Barista2024! |
| Cliente demo | +5216871234567 | (sin contraseña) |

> **Cambia estas contraseñas antes de producción.**
> Edita `.env.local` y vuelve a correr `npm run db:seed`.

---

## Flujo de uso

### Para el cliente:
1. Se registra en `/{slug}/register` con su teléfono o correo
2. Accede a `/{slug}/card` para ver su tarjeta
3. Muestra el código QR al barista en cada visita
4. Agrega la tarjeta a Apple Wallet o Google Wallet (opcional)

### Para el barista:
1. Inicia sesión en `/{slug}/admin-login`
2. Va a **Escanear** → activa la cámara → escanea el QR del cliente
3. Elige "Registrar Visita" o "Canjear Recompensa"
4. Para recargar saldo: va a **Recargar** → ingresa número de tarjeta + monto

### Para el dueño (admin):
1. Accede con el usuario admin en `/{slug}/admin-login`
2. **Recompensas** → cambia nombre y cantidad de visitas
3. **Configuración** → edita nombre del negocio, ciudad, color, logo y registro abierto

### Para UMI Consultoría:
1. Entra en `/umi/login` con la contraseña maestra
2. Ve todos los tenants, usuarios, tarjetas y recompensas activas
3. Accede directamente al admin de cada negocio

---

## Agregar un nuevo tenant

1. Agrega una entrada en `prisma/seed.ts` dentro de `main()`:
```ts
await seedTenant({
  slug: 'nuevonegocio',
  name: 'Nuevo Negocio',
  city: 'Ciudad, Estado',
  cardPrefix: 'NNE',
  primaryColor: '#RRGGBB',
  secondaryColor: '#RRGGBB',
  locations: [{ name: 'Sucursal', address: 'Dirección' }],
  rewardConfig: { visitsRequired: 10, rewardName: 'Premio', rewardDescription: '...' },
  admin: { email: 'admin@negocio.mx', password: 'Password123!' },
  staff: { email: 'staff@negocio.mx', name: 'Staff', password: 'Password123!' },
  demoCustomer: { name: 'Cliente Demo', phone: '+52155XXXXXXXX' },
});
```
2. Ejecuta `npm run db:seed`
3. Accede en `/{slug}`

---

## Programa de lealtad

- Cada visita registrada incrementa el contador del ciclo actual
- Al completar N visitas (configurable por tenant), se gana 1 recompensa
- El contador se resetea a 0 y empieza un nuevo ciclo
- Las recompensas pendientes se acumulan
- El barista canjea desde el panel de escaneo o el perfil del cliente

---

## Apple Wallet (configuración avanzada)

Ver instrucciones en `passes/apple/certificates/README.md`.

Requiere:
- Apple Developer account ($99/año)
- Pass Type ID certificate (un único ID compartido por todos los tenants)
- Imágenes del pase (icon, logo, strip)

Sin configuración, el botón "Apple Wallet" devuelve error 503 — el resto del sistema funciona perfectamente.

---

## Google Wallet (configuración avanzada)

Requiere:
- Google Cloud project
- Google Wallet API habilitada
- Service account con rol "Google Wallet Object Issuer"
- Solicitar acceso de issuer en https://pay.google.com/business/console

Editar `.env.local` con las credenciales del service account.

---

## Variables de entorno

```bash
cp .env.example .env.local
```

En producción, genera secretos seguros:
```bash
openssl rand -base64 32  # JWT_ACCESS_SECRET
openssl rand -base64 32  # JWT_REFRESH_SECRET
openssl rand -base64 32  # APP_QR_SECRET
openssl rand -base64 32  # UMI_ADMIN_PASSWORD
```

---

## Despliegue (producción)

### VPS / servidor propio (recomendado)

```bash
npm run build
npm start
```

Con PM2:
```bash
npm install -g pm2
pm2 start npm --name "umi-cash" -- start
```

### Cambio de base de datos para producción

SQLite no funciona bien en entornos serverless. Cambia en `prisma/schema.prisma`:
```
provider = "postgresql"
```

Y actualiza `DATABASE_URL` con una URL de PostgreSQL (Railway, Neon, Supabase, etc.).

---

## API Reference

Todos los endpoints están bajo `/{slug}/`:

| Endpoint | Método | Auth | Descripción |
|----------|--------|------|-------------|
| `/api/{slug}/auth/login` | POST | — | Login cliente/staff/admin |
| `/api/{slug}/auth/logout` | POST | Cookie | Cerrar sesión |
| `/api/{slug}/auth/refresh` | POST | Cookie | Renovar token |
| `/api/{slug}/customers` | POST | — | Registrar nuevo cliente |
| `/api/{slug}/card` | GET | Bearer | Estado de la tarjeta |
| `/api/{slug}/card/qr` | GET | Bearer | Generar código QR |
| `/api/{slug}/passes/apple` | GET | Bearer | Descargar pase Apple Wallet |
| `/api/{slug}/passes/google` | GET | Bearer | URL para Google Wallet |
| `/api/{slug}/admin/scan` | POST | Bearer STAFF | Escanear QR |
| `/api/{slug}/admin/topup` | POST | Bearer STAFF | Recargar saldo |
| `/api/{slug}/admin/customers` | GET | Bearer STAFF | Lista de clientes |
| `/api/{slug}/admin/reward-config` | GET/PUT | Bearer ADMIN | Configuración de recompensas |
| `/api/{slug}/admin/settings` | GET/PATCH | Bearer ADMIN | Configuración del negocio |

---

## Seguridad del QR

- El QR contiene un JWT firmado con TTL de **5 minutos**
- Se invalida después de cada escaneo exitoso (token rotativo)
- Los pases de Apple/Google Wallet usan el número de tarjeta estático — válido para staff de confianza
- No es posible reutilizar capturas de pantalla del QR

---

## Desarrollo

```bash
npm run dev          # servidor en http://localhost:3000
npm run db:studio    # Prisma Studio — visualizar/editar base de datos
npm run build        # compilar para producción
npm run db:seed      # volver a sembrar la base de datos
```
