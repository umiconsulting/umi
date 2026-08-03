# Índice de documentos UmiPOS / NEXO

> **CORREGIDO 2026-07-28.** El índice original — entregado por el equipo NEXO el 2026-07-22 y
> conservado abajo — decía que `UMI_NEXO_PLATFORM_CONSOLIDATION_STRATEGY.md` era «la
> arquitectura definitiva» y que «debe leerse primero». Ese documento está **supersedido**: propone
> la plataforma federada (Opción A) que rechazamos por escrito el 2026-07-14. Leerlo primero
> lleva a implementar la arquitectura equivocada. Este archivo lo reemplaza.

## Orden de lectura vigente

Leer en este orden. Los primeros cuatro son autoridad; el resto es evidencia.

| #   | Documento                                                                                                  | Qué es                                                          | Autoridad       |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------- |
| 1   | [`2026-07-28-umipos-branch-reconciliation.md`](2026-07-28-umipos-branch-reconciliation.md)                 | Estado actual: qué construyó la rama, qué falta, qué se decidió | **Vigente**     |
| 2   | [`2026-07-23-umipos-fusion-implementation-plan.md`](2026-07-23-umipos-fusion-implementation-plan.md)       | El plan de ejecución por gates (Gate 0–9)                       | **Vigente**     |
| 3   | [`2026-07-22-umipos-resolucion-arquitectura.md`](2026-07-22-umipos-resolucion-arquitectura.md)             | La resolución: UmiPOS es módulo de Umi, no plataforma peer      | **Vigente**     |
| 4   | [`2026-07-20-umipos-contract-seam.md`](2026-07-20-umipos-contract-seam.md)                                 | La frontera `@umi/contract` → artefacto → Dart                  | **Vigente**     |
| 5   | [`2026-07-14-umipos-analisis-integracion.md`](2026-07-14-umipos-analisis-integracion.md)                   | El análisis original de 3 arquitecturas; origen de Opción A/B/C | Fundacional     |
| 6   | [`2026-07-14-umipos-resumen-para-nexo.md`](2026-07-14-umipos-resumen-para-nexo.md)                         | El resumen que se entregó al equipo NEXO                        | Fundacional     |
| 7   | [`2026-07-23-nexo-formal-response.md`](2026-07-23-nexo-formal-response.md)                                 | Su respuesta a nuestras 34 preguntas                            | Evidencia       |
| 8   | [`2026-07-22-nexo-discovery-report.md`](2026-07-22-nexo-discovery-report.md)                               | Su auditoría read-only de ambos repos                           | Evidencia       |
| 9   | [`2026-07-22-nexo-platform-consolidation-strategy.md`](2026-07-22-nexo-platform-consolidation-strategy.md) | Su propuesta de plataforma federada                             | **Supersedido** |

## Regla

Si un documento propone segunda base de datos, sincronización, webhooks entre planos o
reconciliación entre UMI y NEXO, describe la Opción A y **no** es la arquitectura vigente.

---

## Índice original (2026-07-22, entregado por NEXO — histórico)

```
Documentos de Arquitectura

1. UMI_NEXO_PLATFORM_CONSOLIDATION_STRATEGY.md
   Documento principal.
   Describe la arquitectura definitiva.
   Define ownership.
   Reconstruye el roadmap.
   Debe leerse primero.

2. UMI_NEXO_DISCOVERY_REPORT.md
   Auditoría completa.
   Toda la evidencia.
   Debe usarse únicamente como respaldo de la estrategia.

3. PRODUCT_CERTIFICATION/
   Reportes técnicos de certificación.
```

Nota: `PRODUCT_CERTIFICATION/` nunca llegó a este repositorio. Los reportes de certificación de
NEXO viven en su repositorio y se citan desde
[`2026-07-23-nexo-formal-response.md`](2026-07-23-nexo-formal-response.md) §7.
