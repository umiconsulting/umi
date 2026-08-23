# Producto y negocio

[Índice](README.md) | [Alcance](ALCANCE_V1.md) | [Historias](HISTORIAS_DE_PUNTA_A_PUNTA.md)

## Propósito

UMI POS sirve a comercios con una o varias ubicaciones. El producto conecta venta, cocina, inventario, personal y administración.

El modelo es apto para restaurantes, cafeterías y comercios con catálogo operativo. No promete una función que v1 excluye.

## Ciclo del comercio

```mermaid
flowchart LR
  A[Crear comercio] --> B[Crear ubicaciones]
  B --> C[Asignar personal]
  C --> D[Inscribir dispositivos]
  D --> E[Configurar catálogo]
  E --> F[Establecer inventario]
  F --> G[Abrir turno]
  G --> H[Vender y preparar]
  H --> I[Revisar y conciliar]
  I --> J[Cerrar turno]
```

## Funciones principales

| Área        | Valor operativo                                             |
| ----------- | ----------------------------------------------------------- |
| Personal    | Define quién puede consultar, vender, aprobar o administrar |
| Catálogo    | Define qué se vende y cómo se configura                     |
| Inventario  | Registra movimientos y resume existencias                   |
| Ventas      | Conserva transacciones inmutables y pagos soportados        |
| Recibos     | Representa el hecho oficial y sus copias                    |
| Reembolsos  | Añade una compensación sin borrar la venta                  |
| Turnos      | Registra la custodia y conciliación de efectivo             |
| Clientes    | Asocia una venta con información permitida                  |
| Lealtad     | Aplica reglas y conserva hechos de puntos                   |
| Wallet      | Conserva autorizaciones, débitos, liberaciones y reembolsos |
| Gift cards  | Protege el secreto y registra valor almacenado              |
| KDS         | Coordina el trabajo de cocina sin autoridad financiera      |
| Diagnóstico | Ayuda a encontrar estado, causa y recuperación segura       |

## Flujo diario

Antes de abrir, el Manager verifica salud, ubicación, caja, dispositivos, catálogo e inventario. Después abre el turno necesario.

Durante el día, el Cashier vende. KDS presenta el trabajo de cocina. Dashboard ofrece supervisión y operaciones autorizadas.

Al cerrar, el equipo revisa turnos, ventas, reembolsos, inventario, recuperación y auditoría.

## Funciones opcionales

Wallet, gift cards, lealtad y KDS pueden depender de la política del comercio. Su uso requiere configuración y permisos correctos.

## Límites

- El pago manual registra una afirmación del operador sobre un terminal externo.
- El producto no afirma una autorización integrada del proveedor.
- Object storage permanece deshabilitado para RC2.
- Los costos avanzados de inventario no forman parte de v1.
- La evidencia física pertenece a Gate 13.
