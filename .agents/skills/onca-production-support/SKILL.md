---
name: onca-production-support
description: Ejecuta soporte live de ONCA desde la computadora autorizada, diagnostica fallos con evidencia, restaura Tailscale y ADB, verifica la flota y entrega hotfixes seguros a producción.
metadata:
  short-description: Soporte live de ONCA con acceso verificado
---

# Soporte de producción ONCA

Usa esta skill para cualquier incidente de ONCA en producción, para revisar la
flota de tablets o para entregar un hotfix durante una jornada operativa.

Instala esta carpeta en `.agents/skills/` o en
`${CODEX_HOME:-$HOME/.codex}/skills/`. Inicia el agente desde la carpeta del
repositorio.

## Resultado esperado

No termines al encontrar una teoría. Termina cuando:

1. confirmaste que trabajas en la computadora de soporte correcta;
2. verificaste Tailscale y ADB en todos los equipos `onca-*`;
3. identificaste la causa con evidencia del equipo, API, base de datos o código;
4. aplicaste una corrección pequeña y probada;
5. ejecutaste el flujo real que falló;
6. registraste el resultado y cualquier límite de la verificación.

La operación tiene prioridad. No declares un resultado verde si no observaste la
conducta correcta en el sistema real.

## Límites

- Trabaja sólo sobre los equipos y servicios de UMI/ONCA.
- No repitas un cobro externo confirmado. Consulta primero el intento de pago y
  la venta.
- No alteres ventas, pagos, recibos, efectivo o saldos sin autorización explícita.
- No pongas secretos, llaves privadas ni PIN en el repositorio o en la bitácora.
- No adivines ni evadas PIN de operador.
- No conviertas un fallo desconocido en un mensaje genérico. Conserva el código,
  el `correlationId` y la operación exacta.
- No esperes la compilación de iOS. No forma parte de este soporte.

## 1. Entra a la computadora correcta

Lee [references/ssh-and-access.md](references/ssh-and-access.md) antes de
conectar. Verifica la huella SSH y la identidad de la máquina. No confíes sólo en
la dirección IP.

La computadora correcta tiene:

- machine-id `97d302e7018b42eb80e9a56e78dab7b6`;
- Tailscale `100.109.51.39`;
- el servicio `onca-adb-register.service`;
- el workspace indicado por `git worktree list`.

Si ya ejecutas comandos dentro de esa máquina, continúa. Si no, abre una sesión
SSH con root. Ejecuta los comandos del repositorio, Flutter, Git y `codex` como
el usuario `juan`; no crees archivos de propiedad de root en su workspace.

Si la autenticación falla, pide al propietario que agregue la llave pública del
desarrollador con `scripts/authorize-onca-support-key.sh`. No abras autenticación
por contraseña para root.

## 2. Ejecuta el diagnóstico de flota

Desde la raíz del workspace:

```bash
python3 .agents/skills/onca-production-support/scripts/onca-support-doctor.py \
  --expected-build 333
```

Usa `--expected-build` con la build vigente. Para reconectar endpoints ya
registrados, repite con `--repair`. Usa `--json` para guardar evidencia.

Lee [references/fleet-runbook.md](references/fleet-runbook.md) cuando falle
cualquier equipo. Los cuatro equipos ONCA deben estar conectados antes de
diagnosticar un fallo multi-terminal.

En una iMin, confirma siempre:

- Tailscale como VPN siempre activa;
- `Settings > Battery > Transmission Mode` activo;
- KeepADB en versión esperada y con **Mantener siempre activo**;
- webhook `http://100.109.51.39:47123/keepadb`;
- depuración inalámbrica permitida para la red `UmiPOS`;
- KeepADB y Tailscale excluidos del ahorro de batería.

Después de un apagado o reinicio, iMin puede cerrar la depuración USB. Si
Tailscale está en línea pero ADB no, pide a una persona que abra KeepADB y revise
la configuración. No intentes forzar el puerto.

## 3. Verifica versiones antes del diagnóstico

La build mínima actual es UmiPOS `333`. Verifica el `versionCode`, que la app no
sea depurable y que la firma sea la llave de producción. Lee
[references/release-and-hotfix.md](references/release-and-hotfix.md) antes de
crear o instalar otra build.

No mezcles versiones mientras investigas. Una diferencia entre terminales puede
producir estados incompatibles.

## 4. Fija el fallo con evidencia

Pide o localiza el mensaje exacto, la hora local, el equipo, el operador y el
total. Conserva imágenes, video, `correlationId`, ID de cuenta, pago, venta o
comanda. No sustituyas el reporte por una suposición.

Después:

1. Lee [references/incident-triage.md](references/incident-triage.md).
2. Consulta la bitácora y los incidentes relacionados.
3. Localiza el contrato, cliente, API, repositorio y prueba.
4. Carga la skill `diagnosing-bugs` y construye una prueba roja que reproduzca
   el síntoma.
5. Compara el código con el comportamiento de producción.

Para incidentes actuales, consulta:

- [Bitácora](../../../docs/reports/ONCA_PRODUCTION_BUG_LOG.md)
- [Cobros, mesas, KDS y caja](../../../docs/reports/2026-10-26-onca-production-bug-005.md)
- [Arranque de UmiPOS](../../../docs/reports/2026-10-26-onca-production-bug-006.md)
- [Flota, firma y configuración](../../../docs/reports/2026-10-27-onca-production-bug-007.md)
- [KeepADB de ONCA](../../../docs/reports/2026-10-26-onca-keepadb-fleet.md)

## 5. Corrige sin crear daño futuro

Prefiere la corrección en el límite de negocio correcto. Mantén DRY y KISS.
Considera al menos estos efectos posteriores:

- otra tablet con caché, sesión o versión distintas;
- un pago externo ya aprobado;
- una cuenta abierta o una mesa ocupada;
- reproducción sin conexión o reconexión;
- una migración aplicada mientras la API antigua sigue activa;
- rollback de API, APK, esquema o configuración.

Si el cambio no es seguro, detén la mutación y explica el bloqueo con evidencia.
No inventes un parche para obtener una prueba verde.
Si el flujo real vuelve a fallar, regresa al diagnóstico. No apiles otro parche
sobre una hipótesis no confirmada.

## 6. Entrega producción

Lee [references/release-and-hotfix.md](references/release-and-hotfix.md).

Usa PR y CI para cambios de código. Los checks requeridos deben quedar verdes.
No esperes iOS. Si el incidente bloquea la operación y existe acceso verificado
al VPS, puedes aplicar una recuperación operativa aprobada; no edites código
dentro de un contenedor.

Después del despliegue:

- confirma `/health/release`;
- instala la misma build en toda la flota con `adb install -r`;
- confirma versión, firma y arranque;
- repite el flujo real;
- actualiza la bitácora y el APK canónico.

## Cierre

Entrega un resumen breve con:

- síntoma y causa;
- evidencia;
- corrección y commit;
- despliegue;
- equipos verificados;
- flujo real ejecutado;
- riesgos, rollback y pasos pendientes.

Si el flujo real no se ejecutó, dilo. No uses “verificado” para pruebas
unitarias, instalación o arranque solamente.
