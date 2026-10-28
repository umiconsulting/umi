# Triaje de incidentes ONCA

## Evidencia mínima

Registra la hora local, la tablet, el operador, el mensaje exacto y los números
visibles. Conserva captura o video.

Busca después:

- código de error;
- `correlationId`;
- ID de cuenta, carrito, línea, pago, venta, recibo o comanda;
- versión de UmiPOS;
- peticiones HTTP y respuesta;
- evento de caja, mesa o cocina;
- estado anterior y posterior.

No ejecutes una operación financiera para “ver si funciona”.

## Fallos conocidos

### Comanda pagada que reaparece

Causas combinadas:

- el cobro ejecutaba un append idempotente de cocina;
- ese append reabría el ticket aunque no insertaba una línea;
- la tablet conservaba una copia local vieja de un ticket sobre el que había
  actuado;
- la nube ya omitía el ticket, pero la copia local lo devolvía.

Correcciones: `2f5ea8e6`, `8a8ec541`.

### El ticket aparece sólo en algunas tablets

La copia local sólo se creaba cuando esa tablet había enviado un comando al
ticket. Por eso no había un patrón global.

### La mesa no se libera

El cobro cerraba la venta pero no la visita de mesa. Corrección: `445bedac`.

### La salida de efectivo muestra un error genérico

La tablet tenía una versión del turno diferente a la del servidor. Una consulta
ocultaba el conflicto y lanzaba un `Error`, convertido en `500 INTERNAL_ERROR`.
Corrección: `8a8ec541`.

### No se puede enviar a Cocina o Barra

El Cajero podía escribir el carrito pero no tenía `order.fire`. La migración 054
corrigió el rol. Una sesión anterior conserva permisos viejos hasta entrar de
nuevo.

### KDS no muestra comandas

Revisa en este orden:

1. la cuenta envió una comanda;
2. el operador tiene `order.fire`;
3. la sesión KDS tiene permisos `kitchen.*`;
4. el filtro de estación existe;
5. la lectura de la nube omitió el ticket;
6. la caché local conserva una copia vieja.

No cierres con “era red” sin evidencia.

### Pago de terminal aprobado sin venta

El caso de MXN 545 ocurrió así:

1. Chai entró a la cuenta sin el grupo obligatorio Leche;
2. el catálogo se editó después;
3. el checkout recalculó la línea histórica contra la opción nueva;
4. la terminal ya había cobrado;
5. cuatro `checkout` fallaron con `CHECKOUT_CART_CHANGED`;
6. el cliente ocultó el conflicto.

La corrección conserva los datos comerciales de la línea. No vuelvas a cobrar
un intento `succeeded` sin venta. Requiere conciliación autorizada.

### El mensaje dice “Reconecta para usar terminal manual”

No confirma una falla de red. El cliente llegó al camino sin conexión y sustituyó
el error real por `OFFLINE_ADVANCED_TENDER_BLOCKED`. Un pago externo definitivo
ya no debe entrar a ese camino.

### El cobro dividido pide folio de terminal

La referencia manual se aplicaba al terminal externo. Ya no se pide para ese
medio. La transferencia bancaria sí conserva una referencia.

### La mesa se pide antes de los productos

El flujo anterior abría la mesa al iniciar “Comer aquí”. La corrección inicia la
cuenta sin mesa y la pide al enviar o cobrar.

### UmiPOS no abre

Revisa `umi_pos.bootstrap`. Las causas ya vistas fueron:

- APK `profile` instalado como producción;
- `RELEASE_IDENTITY_INVALID`;
- contrato distinto;
- API no disponible sin prueba previa;
- almacenamiento seguro no disponible.

No reinstales datos antes de revisar el código del bootstrap.

## Verificación del flujo real

Después de corregir, prueba según el fallo:

- crear cuenta;
- agregar y modificar cantidades;
- enviar a cocina;
- observar la misma comanda en Barra y Cocina;
- completar y confirmar que desaparece;
- cobrar sin duplicar dinero;
- liberar la mesa;
- dividir cuenta;
- registrar salida de efectivo;
- confirmar que la sesión del operador sigue válida.

Una prueba de sólo arranque no cierra un incidente de cobro, mesa o KDS.
