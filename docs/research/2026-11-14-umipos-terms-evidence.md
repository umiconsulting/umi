# Evidencia para términos de uso de UmiPOS

Fecha: 14 de noviembre de 2026. Alcance: investigación breve para `/terminos-umipos`; no es una auditoría legal ni se revisaron contratos o datos de producción.

## Instrumento y método

**Hecho documentado.** Se utilizó `ripgrep` 15.2.0 y lectura directa del repositorio, junto con la herramienta web administrada para documentación oficial y el PDF vigente de Diputados. La versión del servicio web no está expuesta. Son herramientas disponibles, automatizables y sin dependencia nueva para la aplicación; no se adoptó una biblioteca legal. `ripgrep` tiene licencia MIT/Unlicense; las páginas consultadas son fuentes de consulta, no código incorporado. Fuente del método: `.agents/skills/research/SKILL.md` y `docs/agents/tool-and-research-doctrine.md`.

**Hecho documentado.** Peldaños usados: documentación del proveedor Google, legislación primaria y código local. El primer resultado extenso excedió el límite de salida; consultas `find` y aperturas por línea recuperaron los artículos pertinentes. No fue necesario recurrir a guías secundarias.

## Fuentes y hechos

**Hecho documentado — Google Play.** La [declaración de trader](https://support.google.com/googleplay/android-developer/answer/17594752?hl=en), sección “Additional steps”, indica que solicita certificación de productos/servicios legales y enlace a términos por aplicación. La FAQ describe que mostrará el enlace si se proporcionó. No prescribe un texto de tarifas, reembolsos o garantías. Publicar términos específicos y accesibles responde al formulario sin atribuirle cláusulas inexistentes a Google.

**Hecho documentado — México.** [LFPC consolidada, última reforma 12-12-2025](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf): el artículo 2 delimita consumidor y contempla ciertos supuestos empresariales; no demuestra una exclusión general de restaurantes. El artículo 76 Bis exige información contractual, costos, medios de reclamación y protección de información en relaciones de consumo electrónicas. Sus fracciones VIII-IX regulan cobros recurrentes: información y consentimiento expreso, aviso de renovación automática con cinco días naturales y cancelación inmediata. El artículo 90 invalida, en contratos de adhesión, cambios unilaterales y exoneraciones civiles, entre otras cláusulas abusivas. El artículo 85 exige español legible. **Inferencia:** preservar derechos obligatorios, evitar renuncias generales y no confundir publicar una página con implementar consentimiento y cancelación operativos.

**Hecho documentado — identidad pública.** `apps/umi-landing-page/src/app/privacidad-umipos/page.tsx:33` identifica a **Juan Carlos Lopez Quinonez**, nombre comercial **Umi**, con domicilio **Blvd. José Limon Lote D, Parque Canacintra I, Humaya, 80020 Culiacán Rosales, Sinaloa, México**, y correo **hola@umiconsulting.co**. La misma página identifica UmiPOS y `co.umiconsulting.umi_pos`. Reutilizar estos datos evita inventar una sociedad mercantil.

**Hecho documentado — producto.** La política vigente y `docs/research/2026-11-12-umipos-privacy-policy-evidence.md` documentan operaciones de restaurante, cuentas/órdenes, catálogo, operadores, clientes, recompensas, saldo y tarjetas de regalo según módulos habilitados. Las fuentes primarias incluyen `apps/umi-pos/lib/features/customer_value/customer_value_repository.dart`, `apps/umi-pos/lib/core/storage/local_working_copy.dart`, `apps/umi-pos/lib/features/offline/offline_journal.dart` y `apps/umi-pos/lib/core/security/credential_vault.dart`. Hay datos locales y sincronización: no prometer disponibilidad permanente, respaldo infalible o funcionamiento íntegro sin conexión.

## Cláusulas recomendadas

Las siguientes son **inferencias de redacción**, proporcionadas al producto observado:

- Identificar aplicación, proveedor, contacto y fecha; distinguir al restaurante contratante de sus operadores autorizados. El acceso debe corresponder a una autorización del comercio.
- Describir uso de software para administrar la operación del restaurante y una autorización limitada de uso. Los módulos y servicios disponibles dependen de lo habilitado y acordado con el comercio; no anunciar capacidades futuras como incluidas.
- Pedir custodia de credenciales, asignación adecuada de permisos y aviso de accesos indebidos; prohibir fraude, acceso a información ajena e interferencia deliberada. No convertir todo incidente en responsabilidad exclusiva del cliente.
- Explicar que el comercio debe contar con legitimidad para introducir datos y operar programas de clientes; enlazar `/privacidad-umipos`. Los términos no sustituyen el aviso ni otorgan consentimiento de marketing por sí solos.
- Remitir precios, módulos, facturación y duración a la oferta o contrato aceptado antes de contratar. La descarga no debe interpretarse por sí sola como aceptación de cargos adicionales.
- Diferenciar el software de las condiciones de los proveedores de pagos, hardware y conectividad cuando efectivamente intervengan. No afirmar que Umi procesa o custodia fondos sin verificación.
- Explicar dependencias de red, dispositivos, permisos y sincronización. Ofrecer el correo existente para soporte, aclaraciones y solicitudes de cancelación, sin inventar SLA ni tiempo de respuesta.
- Describir suspensión proporcionada ante uso indebido o riesgos de seguridad, y contacto para resolverla. La terminación no debe prometer borrado inmediato de registros sujetos a conservación.
- Para cambios materiales, comunicar condiciones antes de aplicarlas y respetar lo contratado y derechos obligatorios. Evitar jurisdicción exclusiva impuesta, renuncia a PROFECO, “sin reembolsos en todos los casos” o exención total de responsabilidad.

## Límites y pendientes

**UNVERIFIED:** precios, impuestos aplicables, planes, prueba gratis, periodicidad, renovación, política de reembolsos, teléfono público autorizado, SLA, contrato comercial vigente y flujo operativo de cancelación. No completar esos espacios con cifras o promesas supuestas. El domicilio y correo ya publicados pueden usarse; un teléfono exige una fuente autorizada.

**Tradeoff respaldado:** una página específica aclara el uso y permite aportar un enlace a Play, pero un texto genérico no establece condiciones económicas verificadas ni sustituye las funciones de consentimiento/cancelación exigibles si se ofrecen suscripciones. Mantener el alcance comercial sujeto a acuerdos previos reales y conservar derechos aplicables.

**Inferencia de implementación:** página HTML pública con URL canónica `https://www.umiconsulting.co/terminos-umipos`, fecha visible, enlace desde el footer y enlace recíproco con privacidad. Reutilizar la estructura visual y exportación estática existentes; este trabajo de investigación no modifica código ni publica contenido.
