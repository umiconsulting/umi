# Guía de prueba de UmiPOS por rol

## Objetivo

Usa esta guía para probar las funciones actuales de UmiPOS Web.

El entorno local usa datos desechables. No ejecutes el seed en una base compartida.

## Preparación

Inicia la API de UMI y UmiPOS Web.

Ejecuta el seed desde la raíz del workspace:

```sh
UMI_POS_DEV_SEED_CONFIRM=disposable bash scripts/umi-pos-demo-seed.sh
```

El seed usa estos valores:

- Tenant: `UmiPOS Local`.
- Sucursal: `Sucursal Local`.
- Moneda: `MXN`.
- Categorías: Café, Té y bebidas, Alimentos y Postres.
- Productos: 12.
- Productos con variantes: Latte y Sándwich de pavo.
- Productos con modificadores: Latte y Sándwich de pavo.
- Estados especiales: disponibilidad futura y fuera de surtido.

Registra el dispositivo antes de usar un PIN.

El registro del dispositivo y el PIN del operador son controles diferentes.

## PIN por rol

| Rol           | PIN    | Funciones actuales                                                |
| ------------- | ------ | ----------------------------------------------------------------- |
| Propietario   | `1111` | Catálogo, carrito, checkout, auditoría y revisión de recuperación |
| Administrador | `2222` | Catálogo, carrito, checkout, auditoría y revisión de recuperación |
| Gerente       | `3333` | Catálogo, carrito, checkout, auditoría y revisión de recuperación |
| Cajero        | `2468` | Catálogo, carrito y checkout                                      |
| Consulta      | `5555` | Catálogo de solo lectura                                          |

Los permisos vienen de la API. Flutter no concede permisos.

UmiPOS Web no muestra una administración de personal. Usa el Dashboard para esa función.

El seed no crea un PIN de `super_admin`. Ese rol pertenece a la plataforma UMI.

El seed no crea un PIN de cocina. La operación de cocina pertenece a UmiKDS.

## Cambio de operador

1. Selecciona el candado en la barra superior.
2. Espera la pantalla del PIN.
3. Ingresa el PIN del siguiente rol.
4. Confirma que el catálogo se carga.

El bloqueo termina la sesión local del operador. El dispositivo permanece registrado.

## Prueba común del catálogo

Ejecuta esta prueba con todos los roles:

1. Selecciona `Café`.
2. Busca `Latte`.
3. Busca el SKU `CAF-LAT`.
4. Busca el código `750100000002`.
5. Abre el detalle del Latte.
6. Revisa la descripción, el precio y el impuesto.
7. Revisa las variantes Chico, Mediano y Grande.
8. Revisa los grupos Tipo de leche y Jarabes.
9. Confirma que Rollo de canela muestra disponibilidad futura.
10. Confirma que Bebida de temporada muestra fuera de surtido.

La búsqueda consulta la API. La aplicación no descarga todo el catálogo para buscar.

## Prueba del rol Consulta

Usa el PIN `5555`.

Prueba estas funciones:

1. Abre las categorías.
2. Busca por nombre.
3. Busca por SKU.
4. Busca por código de barras.
5. Abre un detalle de producto.
6. Revisa variantes, modificadores y disponibilidad.

Este rol no tiene `cart.write`.

El panel del carrito debe indicar que el carrito no está disponible.

## Prueba del rol Cajero

Usa el PIN `2468`.

Prueba este recorrido:

1. Abre el Latte.
2. Selecciona la variante Mediano.
3. Selecciona una opción de Tipo de leche.
4. Selecciona un jarabe opcional.
5. Escribe una nota sin formato.
6. Cambia la cantidad.
7. Agrega el producto al carrito.
8. Aumenta y reduce la cantidad desde el carrito.
9. Revisa el subtotal, el impuesto y el total.
10. Elimina una línea.
11. Agrega el producto de nuevo.
12. Abre el checkout.
13. Selecciona efectivo.
14. Confirma la venta en línea.
15. Revisa el recibo confirmado por la API.

El servidor calcula el precio, el impuesto y el total.

## Prueba del rol Gerente

Usa el PIN `3333`.

Ejecuta toda la prueba del Cajero.

El Gerente también tiene estos permisos:

- `audit.read`.
- `offline.recovery.review`.
- `offline.replay`.

UmiPOS Web no guarda ventas financieras sin conexión.

Usa una aplicación nativa compatible para probar el diario cifrado.

## Prueba del rol Administrador

Usa el PIN `2222`.

Ejecuta toda la prueba del Gerente.

El Dashboard administra estas funciones:

- Registro y aprobación de dispositivos.
- Personal.
- Roles.
- Permisos.
- Sucursales.

UmiPOS mantiene solo la experiencia operativa.

## Prueba del rol Propietario

Usa el PIN `1111`.

Ejecuta toda la prueba del Administrador.

La aplicación Web actual no tiene una pantalla exclusiva para el Propietario.

El Dashboard mantiene las funciones de propiedad y configuración.

## Funciones que todavía no existen

UmiPOS no implementa estas funciones:

- Corte y conciliación de caja.
- Reembolsos.
- Ajustes permanentes de inventario.
- Gestión de clientes.
- Lealtad.
- Flujo de KDS.
- Pagos con un proveedor real.
- Ventas financieras sin conexión en Web.

Un PIN de Gerente no crea una función que todavía no existe.

## Errores esperados

Un código de registro incorrecto muestra un error debajo del campo.

El campo también muestra un borde rojo.

Un PIN incorrecto muestra un error debajo del campo.

Un rol sin permiso recibe un estado seguro. La API bloquea la operación.

## Datos de búsqueda

| Producto             | SKU       | Código         |
| -------------------- | --------- | -------------- |
| Americano            | `CAF-AME` | `750100000001` |
| Latte                | `CAF-LAT` | `750100000002` |
| Cappuccino           | `CAF-CAP` | `750100000003` |
| Cold brew            | `CAF-CBR` | `750100000004` |
| Matcha latte         | `BEB-MAT` | `750100000005` |
| Chai latte           | `BEB-CHA` | `750100000006` |
| Croissant            | `ALI-CRO` | `750100000007` |
| Sándwich de pavo     | `ALI-SAN` | `750100000008` |
| Cheesecake           | `POS-CHE` | `750100000009` |
| Galleta de chocolate | `POS-GAL` | `750100000010` |

## Repetición del seed

El seed es idempotente para los usuarios, los roles y el catálogo de demostración.

El seed restablece los PIN y los intentos fallidos.

El seed no elimina ventas, recibos ni comandos pendientes.
