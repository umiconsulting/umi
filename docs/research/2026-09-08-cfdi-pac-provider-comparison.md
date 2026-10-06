# Comparación de PAC / API de facturación para Umi (CFDI 4.0)

- Fecha: 2026-09-08. Precios en MXN.
- Alimenta el ADR
  [`docs/architecture/2026-09-08-cfdi-facturacion-fase-3-adr.md`](../architecture/2026-09-08-cfdi-facturacion-fase-3-adr.md).
- Cada dato lleva su URL. Lo que ninguna fuente primaria confirmó está en "Lo que no pudimos
  verificar" — no se adivina.

Contexto que cruza todo: el plazo de la **factura global** cambió con la **RMF 2026** (Regla
2.7.1.21, DOF 28-dic-2025). El emisor ahora tiene **24 h** tras el cierre de operaciones, no 72.
Es una regla del SAT que obliga a todo emisor, así que **Umi debe forzar la ventana de 24 h por
su cuenta** — ningún PAC lo hace por ti.
([Carbajal Contadores](https://carbajalcontadores.com/2026/08/02/factura-global-publico-general-2026-plazo-24-horas-resico-guia-completa-sat/),
[Gosocket RMF 2026](https://gosocket.net/centro-de-recursos/sat-publica-la-rmf-2026-y-sus-anexos-4-5-6-8-15-y-25/)).

## 1. Matriz de comparación

| Proveedor                            | Tipo                                            | API / SDK                                                                           | Sandbox                                                       | Multiemisor (una cuenta → muchos RFC)                                                                  | Custodia del CSD                                                                                          | $ / timbre                                                                            | Factura global                                         | API autofactura                                                     |
| ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| **Facturapi**                        | Capa sobre un PAC **no revelado**               | **REST/JSON**. SDK oficial **Node/TS**, .NET, Java, PHP                             | Gratis, llaves de prueba `sk_test_*`                          | **El mejor** — API "Organizations", **sin costo ni tope por organización**                             | El comercio sube el CSD; **Facturapi guarda las llaves**. Sin claim de HSM                                | **$0.60** + **$299/mes** base (multi-RFC incluido). Los timbres **no expiran**        | Sí (objeto `global`, `S01`)                            | **Sí** — portal QR con marca (factura.space); **$599/organización** |
| **Facturama**                        | Capa sobre **3 PAC** sin nombre (de FreshBooks) | REST, Basic Auth. SDK Node/JS oficial pero **poco mantenido**; sin TS oficial       | Gratis (`dev.facturama.mx`); CSD de prueba del SAT            | **Sí** — "API Multiemisor" por RFC. **Sin objeto de subcuenta**; esos CFDI **no aparecen en su panel** | El comercio sube el CSD; **Facturama guarda las llaves**. Sin HSM                                         | Módulo API **$1,650/año con 100 folios**, luego **$0.50 / $0.45 / $0.40** por volumen | Sí (`XAXX010101000`, `S01`)                            | **Sin portal llave en mano**; lo construyes tú                      |
| **SW sapien** (Luna Soft)            | **PAC directo** (aut. 16543, 2013)              | **REST** (Bearer) + SOAP heredado. SDK **Node** oficial + .NET/PHP/Java/Python/Ruby | Gratis (`services.test.sw.com.mx`); 5 timbres prod gratis     | **Sí** — modelo distribuidor + "API Usuarios V2" (subcuenta por RFC)                                   | El comercio sube el CSD; **SW lo guarda** ("sitio seguro"). Sin claim de HSM                              | Tienda pública solo vía Odoo (lo demás por cotización); mínimo **$250/año**           | Sí (su blog cita el plazo de 24 h)                     | **Sí** — portal + API "Web tickets" + QR                            |
| **Finkok**                           | **PAC directo** (aut. 10852, 2013)              | **SOAP primero** (núcleo); REST solo para PDF. **Sin SDK oficial** (comunidad)      | Gratis (`demo-facturacion.finkok.com`); CSD de prueba del SAT | **Sí** — una cuenta, muchos RFC; WS "Registro de Clientes" + socios/créditos                           | **Flexible** — tú firmas el XML (**las llaves se quedan contigo**) o subes el CSD (`sign_stamp`). Sin HSM | Pospago: **$150 mín (0–500)**, **$0.30** de 501+ (+IVA). Sin mínimo de volumen        | Soportada (XML genérico)                               | Sí — WS "Crear ticket"                                              |
| **Formas Digitales**                 | **PAC directo** (RFC FCG840618N51)              | **Solo SOAP**. Solo librería **Java** oficial; sin REST/Node/TS                     | Gratis; credenciales demo `pruebasWS/pruebasWS`               | **Sí** — "WS Admin Digital", usuarios `distribuidor`/`cliente`                                         | En la API de timbrado **el integrador firma localmente**; los flujos alojados guardan el CSD. Sin HSM     | **No pública**                                                                        | Genérica; sin página específica ni mención de RMF 2026 | Sí — WS AutoFactura                                                 |
| **Prodigia (PADE)** _(secundario)_   | **PAC directo**                                 | **REST + SOAP**. Sin SDK Node/TS oficial                                            | Gratis (`pruebas.pade.mx`)                                    | **Sí** — API "Distribuidores 2.0" (`registrarAsociado` por RFC)                                        | **Flexible** — `CERT_DEFAULT` guardado o base64 por request. Sin HSM                                      | **No pública**; timbres **sin expiración**                                            | Soportada; Autofactura arma la global diaria           | Sí — portal + API                                                   |
| **Solución Factible** _(secundario)_ | **PAC directo** (2011)                          | **Solo SOAP**. Sin SDK Node/TS oficial                                              | Gratis; credenciales demo públicas                            | **Sí** — "emisores ilimitados", **cobro por timbre, no por cliente**                                   | En el WS de timbrado **el comercio sella** (envía el XML). Custodia alojada no documentada                | **No pública**                                                                        | Vía Autofactura; `XAXX` + RMF 2026 no confirmados      | Sí — portal con marca                                               |

## 2. Detalle por proveedor

### Facturapi — el más orientado a desarrollador

- **Tipo:** capa sobre un PAC autorizado, **no es PAC**; no nombra al PAC de fondo.
  ([intro](https://docs.facturapi.io/en/docs/intro/), [qué es un PAC](https://www.facturapi.io/en/blog/what-is-a-pac))
- **API/SDK:** REST/JSON puro, sin SOAP. SDK oficial Node (TS primero), .NET, Java, PHP.
  Aviso: las restricciones de API-key entran el **16-jun-2026**.
  ([API](https://docs.facturapi.io/en/api/), [facturapi-node](https://github.com/FacturAPI/facturapi-node),
  [quickstart](https://docs.facturapi.io/en/docs/quickstart/))
- **Multiemisor (lo decisivo):** el modelo "Organizations" es justo el de Umi. Una cuenta
  (`sk_user_*`) crea organizaciones emisoras ilimitadas por API o panel, cada una con sus llaves,
  RFC, series y CSD. **Sin costo ni tope por organización.**
  ([Organizations](https://docs.facturapi.io/en/docs/guides/organizations/),
  [precios (ES)](https://help.facturapi.io/es/articles/9247074-informacion-general-sobre-precios))
- **Custodia del CSD:** el comercio sube .cer/.key + contraseña a la organización;
  Facturapi guarda las llaves. Sin claim de HSM.
  ([subir CSD](https://docs.facturapi.io/en/stripe-app/organizacion-emisora/certificado-csd/))
- **Precios** (página consultada 2026-09-08): $299/mes base (multi-RFC incluido), **$0.60/timbre**,
  E-Receipt $0.40, **timbres sin expiración**. Autofactura y descarga masiva se cobran **por
  organización** ($599 y $999). ([precios](https://www.facturapi.io/pricing))
- **Global / REP / cancelaciones:** todo soportado — `global` con `S01`; REP `type:'P'`;
  cancelación CFDI 4.0 con motivos y `AcuseXmlBase64` + webhook.
  ([pago](https://docs.facturapi.io/en/docs/guides/invoices/pago/),
  [cancelaciones](https://docs.facturapi.io/docs/guides/invoices/cancelaciones/))
- **Autofactura:** micrositio QR con marca; el E-Receipt devuelve `self_invoice_url`.
  ([autofactura](https://docs.facturapi.io/en/docs/guides/self-invoice/),
  [e-receipts](https://www.facturapi.io/e-receipts))
- **Fricción de alta:** la **más baja**. Una cuenta de Umi cubre a todos; cada comercio es una
  Organization con su RFC + CSD. Sin contrato-PAC por comercio.
- **Confiabilidad:** [status público](https://facturapi.statuspage.io/); clientes citados: Fever,
  Lyft, Femsa, Cuenca. Sin SLA numérico publicado.

### Facturama

- Capa sobre **3 PAC** sin nombre; de FreshBooks desde 2020. Dos productos: **API Web** (un RFC,
  visible en panel) y **API Multiemisor** (muchos RFC, CFDI **solo consultables por API**).
  ([API](https://facturama.mx/api-facturacion-electronica),
  [multiemisor](https://apisandbox.facturama.mx/guias/cfdi40/multiemisor))
- Multiemisor es un **almacén plano de CSD por RFC**, sin objeto de inquilino; Umi carga toda la
  información de reportes. Precios (páginas sin fecha): API **$1,650/año con 100 folios**, extra
  **$0.50/$0.45/$0.40**. ([planes](https://facturama.mx/planes-facturacion),
  [costos](https://apisandbox.facturama.mx/costos))
- Global, REP y cancelación con acuse: soportados. Sin portal de autofactura llave en mano en
  CFDI 4.0. **Bandera:** Trustpilot 3.2/5 (2 reseñas); un reporte de folios pagados no
  entregados; sin status público. ([Trustpilot](https://es.trustpilot.com/review/facturama.mx))

### SW sapien (Luna Soft)

- **PAC directo**, aut. 16543 desde 2013. REST (Bearer) + SOAP; SDK **Node** oficial + varios.
  ([SAT SW](https://www.gob.mx/sat/acciones-y-programas/sw-smarterweb),
  [APIs](https://developers.sw.com.mx/article-categories/apis/),
  [github.com/lunasoft](https://github.com/lunasoft))
- Multiemisor por subcuentas (`Crear Usuario` con `taxId` y saldo).
  ([API Usuarios V2](https://developers.sw.com.mx/knowledge-base/api-usuarios-v2/))
- El comercio sube el CSD (`/certificates/save`); SW lo guarda. Precio público solo en Odoo (con
  IVA excluido y "no a la venta"); lo real es por cotización, mínimo $250/año.
  ([T&C](https://sw.com.mx/hubfs/), [tienda](https://tienda.sw.com.mx/shop))
- Global, REP (Pagos 2.0) y cancelación con acuse: soportados; su blog cita las 24 h. Portal de
  autofacturación + API "Web tickets" con QR. Afirma 99.95% de disponibilidad.
  ([cancelación](https://developers.sw.com.mx/knowledge-base/cancelacion-cfdi/),
  [web tickets](https://developers.sw.com.mx/knowledge-base/portal-de-web-tickets/))

### Finkok

- **PAC directo**, aut. 10852 desde 2013. **SOAP primero**; REST solo PDF; **sin SDK oficial**
  (usar `phpcfdi/finkok` de la comunidad o envolver los WSDL).
  ([SAT Finkok](https://www.gob.mx/sat/acciones-y-programas/finkok),
  [phpcfdi/finkok](https://github.com/phpcfdi/finkok))
- Multiemisor: una credencial para muchos RFC + modelo de socio con créditos por cliente.
- **Custodia flexible (diferenciador):** con `stamp`/`quickstamp` envías el XML ya sellado y
  **Finkok nunca ve la llave privada**; solo `sign_stamp` pide subir el CSD.
  ([certificados](https://wiki.finkok.com/home/certificados))
- Precio pospago: **$150 mín (0–500), $0.30/timbre desde 501 (+IVA)**, sin mínimo de volumen.
  ([FAQ](https://support.finkok.com/support/solutions/articles/31000156766-preguntas-de-uso-frecuente-faq-))
- **Banderas:** el wiki sirvió certificados TLS inválidos durante la investigación; sin status
  público; documentación en español y centrada en SOAP.

### Formas Digitales (Forsedi)

- **PAC directo** (RFC FCG840618N51). **Solo SOAP**, solo librería **Java**; sin REST/Node/TS.
  Multiemisor por "WS Admin Digital". En la API de timbrado **el integrador firma localmente**.
  Precio no público. Es el mayor esfuerzo de integración para un stack TypeScript.
  ([developers](https://forsedi.facturacfdi.mx/developers/),
  [métodos timbrado](https://forsedi.facturacfdi.mx/developers/metodos-timbrado))

### Prodigia (PADE) — secundario

- **PAC directo**, REST + SOAP, API "Distribuidores 2.0" (multiemisor por RFC), custodia flexible,
  cancelación con acuse, Autofactura. Precio no público; **timbres sin expiración**; ~99.9% de
  disponibilidad. Sin SDK Node/TS oficial.
  ([docs](https://docs.prodigia.com.mx/), [distribuidores](https://docs.prodigia.com.mx/api-distribuidores.html))

### Solución Factible — secundario

- **PAC directo** (2011), **solo SOAP**, credenciales demo públicas. Mensaje muy pro-SaaS:
  "emisores ilimitados", **"pago por timbre, no por cliente"**. El comercio sella en el WS de
  timbrado. Precio no público; sin SDK Node/TS oficial.
  ([API desarrolladores](https://solucionfactible.com/contenido/productos/timbrado/apiDesarrolladores))

## 3. Recomendación para el caso multiinquilino de Umi

**Primario: Facturapi.** Es la única opción que encaja en todos los ejes de un SaaS
multiinquilino a la vez:

- **El mejor encaje multiemisor.** "Organizations" es un objeto por inquilino, manejado por API,
  **sin costo ni tope**. Umi tiene **una** cuenta; cada café es una Organization con sus llaves,
  RFC, series y CSD. El "multiemisor" de Facturama es una lista plana de RFC sin objeto de
  inquilino y con CFDI invisibles en su panel; los PAC directos lo hacen por APIs de
  distribuidor/subcuenta, reales pero más toscas y por cotización.
- **La experiencia de desarrollo casa con el stack de Umi:** REST/JSON + SDK **TypeScript**
  oficial, sandbox autoservicio, portal QR de autofactura, y global / REP / cancelación con
  acuse nativos. Los PAC solo-SOAP (Finkok, Formas Digitales, Solución Factible) obligan a un
  adaptador SOAP hecho a mano, sin SDK oficial.
- **La fricción de alta es la más baja:** sin contrato-PAC por comercio.

**Secundario / respaldo tras la misma abstracción: un PAC directo — SW sapien primero, Finkok
cerca.** Como Umi construye la abstracción de PAC de todos modos, cablear un PAC directo de
respaldo quita dos riesgos de Facturapi: (a) **dependencia de un solo PAC no revelado**, y
(b) depender del uptime de un solo proveedor.

- **SW sapien** es el "PAC directo que aún se siente moderno": REST + Bearer, SDK Node oficial,
  multiemisor por subcuenta, portal de autofactura. Es el salto más corto desde un adaptador con
  forma de Facturapi.
- **Finkok** es la opción si la **custodia del CSD** es lo decisivo: precio pospago barato y la
  posibilidad de que las llaves privadas del comercio se queden en la bóveda de Umi — a costa de
  SOAP y sin SDK oficial.

**Nota sobre la custodia del CSD (decidir a propósito).** Hay dos modelos y es un dilema real de
seguridad para un SaaS multiinquilino:

- **El PAC guarda las llaves** (Facturapi, Facturama, SW, y los flujos alojados de los PAC
  directos): el comercio sube .cer/.key + contraseña y el PAC firma del lado servidor. Menor
  esfuerzo. Pero Umi confía al PAC **las llaves privadas de cada comercio**, y **ningún proveedor
  publicó un claim de HSM o cifrado en reposo** — hay que confirmarlo con el área de seguridad de
  cada uno antes de lanzar.
- **El integrador guarda las llaves** (Finkok `stamp`/`quickstamp`, Prodigia por request, Formas
  Digitales / Solución Factible): Umi firma el XML y el PAC nunca ve la llave. Menor radio de
  daño, pero Umi asume su propia custodia (HSM/KMS) para muchos inquilinos.
- **Recomendación:** arrancar con el modelo "el PAC guarda las llaves" de Facturapi para llegar
  rápido, pero **diseñar la abstracción para permitir una ruta "Umi firma, el PAC solo timbra"**
  (Finkok y SW aceptan enviar un XML presellado). Así se mantiene la opción de mover la custodia
  a casa sin rearquitectura.

**En resumen:** construir primero contra **Facturapi** por velocidad y el mejor modelo
multiinquilino; mantener la abstracción lo bastante delgada para agregar **SW sapien** (o
**Finkok**) como respaldo de PAC directo, por redundancia y control de la custodia de llaves.

## 4. Lo que no pudimos verificar

- El **PAC de fondo de Facturapi** — nunca se nombra.
- **HSM / cifrado de llaves en reposo** — **ningún** proveedor publicó un claim técnico de
  custodia segura. Preguntar directo.
- **Precios de Formas Digitales, Prodigia, Solución Factible** — no públicos. Los números
  públicos de SW son específicos de Odoo y sin IVA — no el precio real para Umi.
- **Precio SaaS/socio de Facturapi y SW** — "a cotizar".
- **Expiración de timbres:** confirmado **sin expiración** en Facturapi y Prodigia; **30 días**
  para folios de prueba de Facturama, pero la expiración de folios comprados no se indica.
- **RMF 2026 (24 h) en la documentación de los proveedores** — la regla está confirmada por
  fuentes del SAT/fiscales, pero **ningún proveedor la cita en sus docs**. Umi debe forzar la
  ventana.
- **Calidad de mantenimiento de los SDK Node** de Facturama y SW (parecen poco mantenidos); sin
  tipos TS oficiales confirmados.
- **Solución Factible / Formas Digitales:** varios detalles de custodia, REST y acuse — sin
  confirmar.
- **SLA de uptime publicados / reseñas independientes (G2/Capterra)** — no se hallaron para
  ningún proveedor.
- La **lista maestra de PAC autorizados del SAT** se renderiza del lado cliente y no se pudo
  extraer directo; el estatus de PAC directo de SW, Finkok y Formas Digitales se confirmó por sus
  páginas individuales en gob.mx/SAT y registros de terceros.
