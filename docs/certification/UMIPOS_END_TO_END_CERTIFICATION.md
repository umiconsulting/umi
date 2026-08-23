# Certificación operativa integral de UmiPOS

## Veredicto

**COMPLETE WITH OBSERVATIONS** — 13 de agosto de 2026.

La ejecución usó PostgreSQL, Redis, API, worker, Dashboard y UmiPOS Linux reales. Usó el simulador canónico de hardware.

## Entorno

- Rama: `architectureUMIposIntegration`.
- Base inicial: `e41c18a315d0a7f29b2aaac9a3dca133e3cbb7a3`.
- Esquema: `build-v3-48`.
- Entorno: `pilot` desechable.
- RLS y FORCE RLS: activos.

## Resultado de los bloqueadores finales

| Escenario                  | Estado | Evidencia                                            |
| -------------------------- | ------ | ---------------------------------------------------- |
| Pago con wallet            | PASS   | Débito 4,500; saldo 30,500 → 26,000                  |
| Pago con gift card         | PASS   | Débito 4,500; saldo 5,500 → 1,000; referencia oculta |
| Pago mixto                 | PASS   | Wallet 1,500 + efectivo 3,000 = 4,500                |
| Venta offline nativa       | PASS   | Diario cifrado con almacenamiento seguro de Linux    |
| Replay offline             | PASS   | Venta oficial; reintento `duplicate`                 |
| Reembolso completo         | PASS   | Compensación 4,500; reintento sin duplicado          |
| Cierre de turno            | PASS   | Esperado 107,500; contado 107,500; variación 0       |
| Revisión EOD del Dashboard | PASS   | 11 vistas con sesión autenticada                     |
| Conciliación financiera    | PASS   | Bruto 116,700; reembolsos 9,000; neto 107,700        |
| Conciliación de inventario | PASS   | 16 artículos; deriva de proyección 0                 |
| Conciliación de valor      | PASS   | Wallet 29,000; gift card 1,000; lealtad 325          |
| Recovery Center            | PASS   | 322 comandos; 0 sin resolver                         |
| Continuidad de auditoría   | PASS   | 258 eventos; 0 secretos detectados                   |

## Hechos persistidos finales

- Ventas: 24.
- Recibos: 24.
- Excepciones: 2.
- Tenders: 27.
- Hechos de inventario: 45.
- Hechos de lealtad: 16.
- Hechos de wallet: 33.
- Hechos de gift card: 19.
- Órdenes de cocina: 25.
- Comandos de hardware: 5.
- Comandos de replay: 2.

El archivo local `artifacts/certification/gate-7a.json` contiene las referencias seguras.

## Defectos corregidos

1. La consulta de moneda usaba una columna ausente del carrito.
2. Las funciones SQL de valor almacenado recibían parámetros sin tipo.
3. El fingerprint de valor almacenado incluía sus propios tenders.
4. El worker de expiración usaba el pool API y exigía un contexto de dispositivo.
5. El registro de conflictos offline usaba un parámetro SQL con dos tipos.
6. El replay usaba la misma identidad para la vista previa y el commit.
7. El rol API no tenía los permisos mínimos de las tablas de replay.
8. La consulta inmutable de replay solicitaba un bloqueo que requería permiso de actualización.

## Observaciones

- El simulador no certifica hardware físico.
- El runner Linux no certifica Xcode ni iPad.
- DNS, TLS público, almacenamiento externo, pagos externos, infraestructura productiva y UX final quedan fuera de este Gate.

Gate 7B queda autorizado con observaciones. PR #72 debe permanecer abierto y sin merge.
