# ADR: CFDI / facturación (Fase 3 de Recibos) — contexto fiscal con puerto PAC

- Fecha: 2026-09-08
- Estado: Propuesto (bloqueado por dos decisiones externas: proveedor PAC y custodia del CSD;
  ver "Prerrequisitos").
- Relación: es la **Fase 3** del ADR
  [`2026-09-08-reportes-por-trabajo-no-por-documento-adr.md`](2026-09-08-reportes-por-trabajo-no-por-documento-adr.md).
  Las Fases 0–2 (IA de Reportes, detalle de venta, visibilidad del reembolso) ya están
  implementadas. Esta fase agrega la facturación mexicana, el diferenciador que **ningún
  competidor** (Toast, Square, Lightspeed, Clover, Shopify) cubre.

## Decisión

Construir la facturación como un **contexto acotado "Fiscal"** nuevo en `umi-api`, con un
**puerto de timbrado (`FiscalStampingPort`)** y adaptadores por PAC — no atado a un proveedor.
El ticket sigue siendo el documento de venta; el **CFDI es un documento aparte** ligado a la
venta, con su propia máquina de estados. El frontend solo lee estado y dispara acciones; nunca
timbra.

**No se escribe código de timbrado hasta resolver los dos prerrequisitos.** Este ADR fija la
arquitectura y un primer incremento **agnóstico del PAC** que sí es seguro construir antes.

## Base de la decisión

Investigación de esta sesión (sección México: ticket vs CFDI/factura) más una verificación del
repo: **hoy no existe nada de CFDI** (0 coincidencias de `cfdi/factura/timbr/PAC/CSD` en código
y esquema). Es un desarrollo desde cero, con requisitos legales y de dinero real.

## Contexto — por qué el ticket no basta

En México el **ticket** (recibo de venta, ya implementado) **no** es deducible. Para deducir, el
cliente necesita un **CFDI 4.0** (factura electrónica timbrada por el SAT). El dueño vive en la
brecha entre los dos: el JTBD #1 de la investigación es "convertir un ticket en factura, rápido,
incluso días después" (el momento _¿me facturas?_). Ningún competidor lo resuelve.

## Requisitos del CFDI 4.0 (lo que obliga la arquitectura)

- **Datos del receptor, exactos según el SAT:** RFC, Nombre/Razón Social, **Código Postal**
  fiscal, **Régimen Fiscal**, **Uso del CFDI**. Un CP equivocado es la causa #1 de rechazo del
  timbrado.
- **Timbrado por un PAC:** el CFDI se sella con el **CSD** (Certificado de Sello Digital) del
  emisor (el comercio) y lo **timbra un PAC** (Proveedor Autorizado de Certificación), que
  aplica el timbre fiscal del SAT y devuelve **UUID + XML sellado**.
- **Factura global:** las ventas a público en general que no pidieron factura se agregan en una
  **factura global** con RFC genérico `XAXX010101000` ("PÚBLICO EN GENERAL"). La **RMF 2026**
  bajó el plazo a **24 h** tras el cierre del periodo, y el total debe **reconciliar** con la
  suma de tickets no facturados.
- **CFDI nominativo después de la global:** si el cliente pide factura nominativa tras emitirse
  la global, el emisor **sigue obligado** a emitirla, ligada a la global. → el estado de CFDI
  debe rastrearse por ticket.
- **Complemento de Pago:** ventas PPD (a crédito) requieren complemento cuando entra el pago.
  El POS de Umi hoy cobra al momento (PUE), así que esto es de baja prioridad, pero el modelo
  debe dejarle lugar.

## Arquitectura

**Contexto acotado "Fiscal"** (módulo `fiscal` en `umi-api`), con seam hexagonal:

- **`FiscalStampingPort`** — interfaz de timbrado (timbrar, cancelar, consultar estado). El PAC
  concreto (Facturama / Finkok / SW sapien / Formas Digitales / …) es un **adaptador**
  intercambiable. Un **`FakeStampingAdapter`** permite pruebas sin PAC ni CSD.
- **Modelo de datos (nuevo, esquema `merchant`, RLS-scoped):**
  - `fiscal_emisor_profile` — datos fiscales del comercio (RFC, régimen, CP) y **referencia al
    CSD** (no el .key en claro; ver custodia).
  - `fiscal_receptor` — datos fiscales del cliente, reutilizables (RFC, nombre, CP, régimen, uso),
    ligados a la identidad de cliente que Umi ya resuelve.
  - `cfdi_document` — el CFDI: liga a `pos_committed_sale` / `receipt_snapshot`; `kind`
    (`nominative` | `global`); `status` (`draft → stamped → cancelled` / `error`); `uuid`,
    referencias a XML/PDF, timbre, id del PAC, folios.
  - `cfdi_global_batch` — el lote global: periodo, fecha límite (24 h), reconciliación al total
    de tickets no facturados.
- **Máquina de estados por ticket:** `not_invoiced` → (`pending_self_invoice` | `in_global` |
  `nominative_stamped`). La global consume los `not_invoiced` del periodo; un nominativo
  posterior sale de la global de forma ligada.
- **Trabajos:** generador de **factura global** por cierre de día comercial (≤ 24 h), con
  reintentos y backoff ante fallas del PAC; los estados de error son visibles, no silenciosos.
- **Flujos:** (1) nominativo en caja; (2) **QR de autofacturación** en el ticket — el cliente
  escanea, captura sus datos fiscales una vez y recibe el CFDI por correo/**WhatsApp** (Umi ya
  tiene identidad de WhatsApp); (3) nominativo posterior a la global.

**Frontend (delgado, sobre el detalle de venta de la Fase 1):** una **insignia de estado CFDI**
por ticket, una entrada **"Convertir en factura"** y el **QR**. Todo condicionado a que el
backend exista — sin botones muertos.

## Prerrequisitos y decisiones (bloqueantes)

1. **Proveedor PAC.** Contrato, cobertura, calidad del API REST, **sandbox** de pruebas, costo
   por timbre. Decisión de procura del negocio. El puerto nos deja diferirla y no quedar atados.
2. **Custodia del CSD (quién guarda el sello del comercio).** Es una decisión legal y de
   seguridad, y define el esquema:
   - **A — Umi integra un PAC; el CSD de cada comercio vive en el PAC.** Umi timbra por cuenta
     del comercio; Umi no guarda llaves privadas en claro. _(Recomendado: menor carga de
     seguridad y responsabilidad.)_
   - **B — Umi custodia los CSD** (.cer/.key + contraseña) y los usa contra el PAC. Máximo
     control, máxima responsabilidad (HSM/cifrado, cumplimiento).
   - **C — Embeber un SaaS de facturación de punta a punta** (el proveedor hace todo, Umi
     enlaza). Menos control e integración, arranque más rápido.
3. **Validación legal/contable:** mapeo de régimen, catálogos SAT del producto
   (`c_ClaveProdServ`), unidad (`c_ClaveUnidad`), manejo de IVA por ítem, y el flujo de la
   global. Requiere revisión de un contador.

## Alcance por sub-fases

- **Fase 3a — cimientos agnósticos del PAC (seguro de construir ya).** Migración del modelo de
  datos fiscal + `FiscalStampingPort` + `FakeStampingAdapter` + lectura del **estado CFDI en el
  detalle de venta**. No timbra nada real. Sin PAC ni CSD.
- **Fase 3b — timbrado real (bloqueada por prerrequisitos 1 y 2).** Adaptador del PAC elegido,
  captura del receptor, nominativo en caja, cancelación.
- **Fase 3c — autoservicio y global.** QR de autofacturación + entrega por WhatsApp, generador
  de factura global (24 h) con reconciliación, y complemento de pago si se necesita.

## Consecuencias

Positivas:

- Cierra el JTBD #1 del dueño mexicano y el mayor diferenciador frente a la competencia.
- El puerto/adaptador evita el amarre a un PAC y hace el timbrado probable con un fake.
- El CFDI como documento aparte respeta que el ticket ya está bien y no lo contamina.

Costos y riesgos:

- Es una **integración de cumplimiento**, no una pantalla: dinero real, obligaciones fiscales,
  responsabilidad por los CSD. Un error de timbrado es un problema legal, no solo un bug.
- Depende de decisiones externas (PAC, CSD, contador) antes de escribir el timbrado.
- La migración del esquema fiscal toca RLS, backfill y pruebas de literal-string; debe diseñarse
  con cuidado (por eso 3a va detrás de este ADR aceptado).

## Alternativas consideradas

1. **Integrar un PAC tras un puerto** (elegida): control del producto, sin amarre, probable.
2. **Embeber un SaaS de facturación de punta a punta** (opción C): arranque más rápido, menos
   control e integración con la identidad de cliente y el ticket de Umi. Válida si el negocio
   prefiere velocidad sobre control.
3. **Volverse PAC** — descartada: carga regulatoria enorme, fuera de alcance.
4. **Atarse a un solo PAC sin puerto** — descartada: amarre y difícil de probar.

## Referencias

- ADR de la reorganización: `docs/architecture/2026-09-08-reportes-por-trabajo-no-por-documento-adr.md`.
- Investigación de esta sesión: sección México ticket vs CFDI/factura (CFDI 4.0; factura global
  con RFC `XAXX010101000`; plazo 24 h por RMF 2026; QR de autofacturación; patrón de las
  herramientas mexicanas PoloTab/Alegra).
- Verificación del repo: 0 coincidencias de `cfdi/factura/timbr/PAC/CSD` — desarrollo desde cero.
- Comparación de proveedores PAC (esta sesión):
  `docs/research/2026-09-08-cfdi-pac-provider-comparison.md`. Recomendación: **Facturapi**
  primario (mejor modelo multiemisor: "Organizations" por inquilino, sin costo ni tope; REST +
  SDK TypeScript; QR de autofactura nativo), con **SW sapien** o **Finkok** como respaldo de PAC
  directo tras la misma abstracción. La custodia del CSD se decide a propósito (empezar con "el
  PAC guarda las llaves", dejando abierta la ruta "Umi firma, el PAC solo timbra").
- Base para el frontend: el detalle de venta de la Fase 1 (`recibos.jsx`) y el endpoint
  `operations/sales/:saleId/receipt`, donde colgará el estado CFDI.
