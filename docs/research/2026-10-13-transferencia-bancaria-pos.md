# Transferencia bancaria en el cobro presencial

Fecha: 2026-10-13. Alcance: instrucciones de pago por SPEI para ONCA en el POS local.

## Herramienta y fuentes

Herramienta: `web.run` (el proveedor no publica una versión). Se usó para buscar y leer
documentación oficial. La guía [Research del repositorio](../../.agents/skills/research/SKILL.md)
y el [doctrina de herramientas](../agents/tool-and-research-doctrine.md) recomiendan fuentes
primarias. El costo de adopción fue cero. `curl` o el navegador oficial son alternativas si
una página bloquea la lectura. La implementación debe reutilizar el contrato y los
componentes actuales del POS; crear un proveedor de pagos propio sólo para presentar una
cuenta bancaria añade un componente que no confirma abonos.

## Hechos documentados

- [Banco de México](https://www.banxico.org.mx/servicios/mi-spei_-transferencias-ban.html):
  SPEI permite transferir a una CLABE de 18 dígitos o a una tarjeta receptora de 16 dígitos.
  La persona necesita conocer la institución de destino. El CEP constata el abono en la cuenta
  beneficiaria y depende de la confirmación del banco receptor.
- [Banco de México](https://www.banxico.org.mx/footer-es/preguntas-frecuentes-dudas-ba.html):
  el concepto ayuda a identificar el pago. La referencia numérica admite hasta siete dígitos.
  La CLABE tiene un dígito de control.
- [Adyen](https://docs.adyen.com/payment-methods/bank-transfer/api-only): la pantalla de
  transferencia presenta beneficiario, cuenta, importe y referencia. También explica cómo
  confirmar el pago. Adyen mantiene el pago abierto hasta que llegan los fondos y usa un
  webhook para confirmar el resultado.
- [PCI SSC, FAQ 1335](https://www.pcisecuritystandards.org/faqs/1335/): el número completo de
  tarjeta (PAN) entra en PCI DSS. Un número de cuenta bancaria que no contiene el PAN no es
  dato de tarjeta según esa norma.
- [Flutter](https://api.flutter.dev/flutter/material/AlertDialog/scrollable.html):
  `AlertDialog(scrollable: true)` permite que el título y el contenido sigan visibles en
  pantallas con poco espacio vertical.
- [Android](https://developer.android.com/reference/android/content/ClipDescription):
  `EXTRA_IS_SENSITIVE` oculta la vista previa de texto sensible al copiarlo. No protege el
  contenido del portapapeles.

## Decisión aplicada a ONCA local

**Inferencia para este POS:** al elegir «Transferencia bancaria», abrir un modal de
instrucciones. Mostrar el logo del comercio que ya existe en `merchant.logo_url`, o el nombre
ONCA si no hay imagen. Mostrar importe, banco, titular y CLABE o número de cuenta.
Mostrar «Concepto: ONCA Cuenta N». No se incluyó una opción para copiar datos.

**Inferencia para el registro:** abrir el modal, copiar un dato o recibir una captura del
cliente no confirma el abono. «Cerrar» deja la cuenta pendiente. Una acción aparte,
«Confirmar abono y cobrar» pide confirmación al operador de que vio el ingreso en el banco
o un CEP. El cobro registra operador, importe, cuenta y hora. La clave de rastreo no se
guarda en el hecho financiero actual; el POS no la solicita. El POS describe esto como
**confirmación manual**, no como verificación bancaria automática. ONCA no dispone aquí
de un webhook bancario.

**Inferencia de configuración:** pedir banco, titular y una CLABE de 18 dígitos o un número de
cuenta bancaria. La API valida longitud y formato de la CLABE. Todavía no valida su dígito de
control. Se omitió el PAN de la tarjeta por el alcance PCI indicado arriba. La referencia
numérica de SPEI tiene un límite de siete dígitos, por lo que el folio completo de una cuenta
pertenece en el concepto.
El logo del banco no es necesario para explicar a qué banco transferir; el logo del comercio
identifica al beneficiario sin añadir imágenes bancarias sin fuente ni licencia.

## Límites de esta investigación

- **NO VERIFICADO:** recepción automática de abonos. Esta solución no integra un banco.
- **NO VERIFICADO:** impresión física del nuevo pie y lectura de transferencia en la A11.
