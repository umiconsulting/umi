# Certificación de resiliencia, seguridad e integridad financiera de UmiPOS

## Veredicto

**COMPLETE WITH OBSERVATIONS** — 13 de agosto de 2026.

La certificación usó PostgreSQL 16, Redis 7.4, API, worker y Dashboard reales.
Usó los simuladores canónicos de hardware y del límite KDS.

## Entorno

- Rama: `architectureUMIposIntegration`.
- Commit certificado: `0fd02768dae7a80bcb44939068c66c0232ee1b30`.
- Esquema: `build-v3-48`.
- Entorno: `pilot` desechable.
- RLS: 133 tablas con RLS y FORCE RLS.
- Rol API: sin superuser y sin BYPASSRLS.

## Fallas de servicios

| Escenario                  | Estado | Evidencia                                               |
| -------------------------- | ------ | ------------------------------------------------------- |
| Reinicio de API            | PASS   | Recuperación en 2,052 ms; una venta persistida          |
| Reinicio de worker         | PASS   | Archivo de readiness restaurado; backlog estable        |
| Interrupción de PostgreSQL | PASS   | Readiness no disponible; mutación cerrada; recuperación |
| Interrupción de Redis      | PASS   | PostgreSQL estable; recuperación en 866 ms              |
| Pérdida de respuesta       | PASS   | Consulta del comando devolvió la venta original         |
| Flapping de red KDS        | PASS   | Cinco snapshots iguales; cero duplicados                |
| Reinicio del cliente       | PASS   | Nueva sesión; estado financiero sin duplicados          |

## Seguridad y autoridad

Los 113 casos enfocados cubrieron sesiones, revocación, dispositivos, autoridad administrativa, rate limit, hardware, KDS, offline y checkout.

La matriz administrativa de 24 casos cubrió revocación, alcance, permisos y aprobación.
Los límites devolvieron HTTP 429 durante una ráfaga real.
La secuencia final respetó el límite configurado.

La certificación de RLS confirmó 133 tablas con FORCE RLS.
El rol `umi_api_login` reportó `rolsuper=false` y `rolbypassrls=false`.
El worker conserva el modelo documentado de BYPASSRLS para maquinaria limitada.

La búsqueda de secretos encontró cero coincidencias en `merchant.audit_event`.
Los 46 casos de límites validaron dinero, cantidades, inventario, reembolsos y valor almacenado.

## Concurrencia e idempotencia

- Las 26 carreras de valor de cliente produjeron 52 resultados terminales.
- Las 14 pruebas KDS con PostgreSQL real pasaron.
- Wallet, gift card y reembolso no produjeron doble gasto.
- La repetición de una respuesta perdida devolvió el resultado original.
- Los comandos con fingerprint distinto conservaron el conflicto canónico.

## Secuencia financiera

La secuencia determinista confirmó 100 ventas nuevas.
Incluyó efectivo, terminal manual, wallet, gift card y pago mixto.

| Hecho            |                    Valor |
| ---------------- | -----------------------: |
| Ventas finales   |                      103 |
| Tenders finales  |                      105 |
| Ventas brutas    | 400,100 unidades menores |
| Efectivo         | 312,100 unidades menores |
| Terminal manual  |  76,000 unidades menores |
| Wallet           |   6,000 unidades menores |
| Gift card        |   6,000 unidades menores |
| Deriva monetaria |                        0 |

La latencia media de la venta fue 133 ms.
La latencia máxima fue 178 ms.
No apareció una regresión grave.

## Conciliaciones

| Área            | Estado | Resultado                                 |
| --------------- | ------ | ----------------------------------------- |
| Finanzas        | PASS   | 400,100 bruto; cero deriva                |
| Inventario      | PASS   | 16 artículos; cero deriva de proyección   |
| Wallet          | PASS   | Ledger y proyección: 44,000               |
| Gift card       | PASS   | Ledger y proyección: 19,000               |
| Lealtad         | PASS   | Neto: 865 puntos                          |
| Recovery Center | PASS   | 423 comandos; cero sin resolver           |
| Auditoría       | PASS   | 317 eventos; eventos requeridos presentes |

## Backup y restore

El backup real creó un dump personalizado y su checksum SHA-256.
El restore aislado terminó en 7 segundos.

La base original y la base restaurada coincidieron:

```text
ventas|tenders|inventario|importe|auditoría
103|105|230|400100|317
```

## Defectos

No quedó un defecto P0 o P1 del producto.
El runner recibió HTTP 429 durante la primera ráfaga.
Se corrigió el ritmo del runner para respetar el control de abuso.

## Evidencia

El archivo local `artifacts/certification/gate-7b.json` contiene las referencias seguras.
El archivo no contiene secretos.

## Observaciones

- El simulador no certifica hardware físico.
- El runner Linux no certifica Xcode ni iPad.
- DNS, TLS público y almacenamiento externo requieren infraestructura productiva.
- Los pagos externos y la UX final quedan fuera de este Gate.

Gate 8A queda autorizado con observaciones. PR #72 debe permanecer abierto y sin merge.
