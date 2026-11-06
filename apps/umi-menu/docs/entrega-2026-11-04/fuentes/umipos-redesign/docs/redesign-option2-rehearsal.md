# Rediseño 2 · Rehearsal

Se extiende el Stageshow existente de UMI; se conservan su Stage, frames, script y targets. Referencia de composición: imágenes locales de Zavo indicadas en el brief; no se importaron assets externos.

Capturas: shots/option2/sale-*-*.png; login, incoming, tables, kitchen, cash, settings, payment, done, modifiers y account en Windows/iPhone. Dos temas y ambas orientaciones de tablet.

Film real: tour-windows.png (Comer aquí, claro, viewport1440) y tour-phone-dark.png (digital, oscuro, viewport390),28 frames a2s durante54.8s. Revisados apertura, personalización, cuenta, ambas estaciones, cobro y recibo. Los controles se conservan durante las transiciones observadas; el recibo permanece al final de once.

Resultado automático: ambos reportes inconclusos/exit2. Windows6276 muestras, gap máximo175.4ms; teléfono6398 muestras, gap máximo75.9ms. No gate aprobado. Hallazgos íntegros en tour-*-report.json: candidatos sobre cambios de screen, iconos heredados, kit overrides y escalado del frame de teléfono en el host. No se añadieron data-snap/data-crop para ocultarlos.

Comprobaciones funcionales independientes:29 tres-flujos,45 roles,49 paridad,54 operaciones,2 layout de pago,93 matriz y7 variante. Se prueba input real; el film conserva el guion authored existente.

No se comprobó en hardware físico, emuladores ni sistema de impresión real. La prueba no certifica ausencia de flashes de un frame en huecos de muestreo ni rendimiento de dispositivos físicos. El último ajuste de labels auxiliares a12px ocurrió después del film, sin alterar composición/targets.
