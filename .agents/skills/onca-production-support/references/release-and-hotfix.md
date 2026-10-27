# Entrega de correcciones ONCA

## Regla principal

Protege primero la operación. Corrige la causa real en el límite de negocio.
No edites código dentro de un contenedor de producción.

Para cambios de código:

1. reproduce el fallo;
2. crea una prueba roja en el límite correcto;
3. implementa la corrección;
4. ejecuta pruebas y análisis;
5. publica un PR;
6. espera los checks de CI aplicables;
7. haz merge sólo cuando estén verdes;
8. confirma el despliegue de `main`;
9. prueba el flujo real.

No esperes iOS para un hotfix de POS, API o Dashboard.

## API de producción

Antes de usar SSH directo:

```bash
: "${ONCA_VPS_SSH_TARGET:?No VPS SSH target is configured}"
ssh -o BatchMode=yes "$ONCA_VPS_SSH_TARGET" 'hostname; docker ps --format "{{.Names}}"'
```

Usa el acceso directo para diagnóstico, logs, estado de Compose y rollback.
Los cambios duraderos pasan por el repositorio y CI.

El despliegue normal ocurre al integrar `main`:

- `.github/workflows/umi-api-deploy.yml`
- `.github/workflows/deploy-backend.yml`
- `/health/release`

Para rollback, identifica primero la versión y configuración anteriores. No
borres volúmenes ni ejecutes migraciones destructivas durante una caída.

## APK Android

Construye desde un árbol limpio:

```bash
UMIPOS_RELEASE_VERSION=1.0.0 \
UMIPOS_BUILD_NUMBER=<siguiente> \
UMIPOS_CONTRACT_VERSION=<contrato-api> \
scripts/build-umipos-android-release.sh
```

El script usa la llave en Secret Service. El certificado esperado es:

```text
14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051
```

Antes de instalar:

```bash
apksigner verify --verbose --print-certs <apk>
aapt2 dump badging <apk>
```

Comprueba primero que la flota completa está conectada:

```bash
python3 .agents/skills/onca-production-support/scripts/install-umipos-fleet.py \
  <apk> --check-only
```

Instala en los cuatro equipos:

```bash
python3 .agents/skills/onca-production-support/scripts/install-umipos-fleet.py \
  <apk>
```

Después:

```bash
adb -s <serial> shell dumpsys package co.umiconsulting.umi_pos.estacion |
  grep -E 'versionCode=|versionName=|debuggable|DEBUGGABLE'
```

Comprueba que la app abre. Si el incidente cambió un flujo, ejecuta también ese
flujo con una cuenta controlada y sin duplicar dinero.

## Base de datos

Prefiere una consulta de sólo lectura para probar la hipótesis. Toda escritura de
reparación debe:

- ser transaccional;
- verificar estado anterior;
- conservar IDs e historia;
- producir auditoría;
- tener rollback;
- contar con autorización explícita cuando afecte dinero.

## Registro

Actualiza la bitácora con:

- síntoma;
- causa comprobada;
- evidencia;
- commit e imágenes;
- migraciones;
- equipos y versiones;
- pruebas reales;
- rollback;
- pendientes.

Si la verificación real no ocurrió, usa “pendiente”. No uses “corregido en
producción” solo por tener CI verde.
