# Lint y validación antes de publicar un PR

## Síntoma

El job `lint` de GitHub falló después del commit funcional de Gate 3D. El paso ESLint pasó. El paso de formato falló.

La ejecución fallida fue `30849619737`. Prettier encontró seis archivos sin el formato canónico:

- `apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts`
- `apps/umi-api/src/modules/pos-exception/pos-exception.service.spec.ts`
- `apps/umi-api/src/modules/pos-exception/pos-exception.service.ts`
- `apps/umi-api/src/modules/pos-exception/refund-calculator.spec.ts`
- `docs/product/UMIPOS_PRODUCT_ROADMAP.md`
- `packages/contract/src/catalog.ts`

El commit `6db49009857cc770d7b26ce1d2901b56ff6a5004` aplicó Prettier. La ejecución siguiente, `30849804056`, pasó.

## Job afectado

| Campo         | Valor                                                      |
| ------------- | ---------------------------------------------------------- |
| Workflow      | `.github/workflows/lint.yml`                               |
| Workflow name | `lint`                                                     |
| Job           | `lint`                                                     |
| Runner        | `ubuntu-latest`                                            |
| Node          | `22`                                                       |
| pnpm          | `10.29.3`, activado por Corepack                           |
| Directorio    | Raíz del workspace                                         |
| Instalación   | `pnpm install --frozen-lockfile`                           |
| Paso ESLint   | `pnpm lint`                                                |
| Warning gate  | `pnpm check:lint-warnings`                                 |
| Paso Prettier | `pnpm format:check`                                        |
| Cache         | Turbo local del runner; no decide el resultado de Prettier |

El workflow no usa un filtro `paths`. Este comportamiento evita que un check obligatorio quede pendiente.

## Causa raíz demostrada

La causa fue una diferencia de procedimiento entre la validación local y CI.

La validación de Gate 3D ejecutó lint enfocado, typecheck y `git diff --check`. No ejecutó el comando raíz exacto `pnpm format:check` antes del primer push.

`git diff --check` solo detecta errores de espacios y marcadores de conflicto. No aplica las reglas de Prettier. ESLint tampoco da formato a Markdown, JSON ni todos los archivos TypeScript.

La evidencia descarta estas causas:

- ESLint real: `pnpm lint` terminó con código cero.
- Versión de Node: local y CI usan Node 22.
- Versión de pnpm: local y CI usan 10.29.3.
- Lockfile: `pnpm install --frozen-lockfile` pasó.
- Cache: Prettier revisó archivos de trabajo de forma directa.
- Generated drift: el contrato generado fue determinista.
- Line endings: Prettier identificó estilo en seis archivos concretos.

## Corrección

El script raíz `pnpm check:pr` es ahora la validación canónica antes de publicar.

Ejecuta esta secuencia:

1. `pnpm --filter @umi/contract generate:check`
2. `pnpm lint`
3. `pnpm check:lint-warnings`
4. `pnpm format:check`
5. `node scripts/check-pr.mjs`
6. `node scripts/check-umipos-use-cases.mjs`

El comando ejecuta los mismos comandos de lint y formato que usa CI. También comprueba drift, JSON, checksum del contrato, documentación y whitespace.

`scripts/check-pr.mjs` revisa tres superficies de Git:

- cambios unstaged;
- cambios staged;
- rango desde el merge base del PR hasta `HEAD`.

El valor predeterminado es `origin/main`. Use `PR_BASE_REF` cuando el PR tenga otra base. PR #72 usa:

```sh
PR_BASE_REF=origin/build-v3 pnpm check:pr
```

El rango actual contiene dos saltos de línea Markdown deliberados. `config/git-whitespace-baseline.json` registra solo esas dos líneas. El gate rechaza cualquier hallazgo nuevo.

La skill `.agents/skills/pr-gates/SKILL.md` llama este comando en el gate mecánico. Los tests y builds afectados siguen separados.

## Comandos antes de commit

Use Node 22 y pnpm 10.29.3.

```sh
corepack enable
corepack prepare pnpm@10.29.3 --activate
pnpm install --frozen-lockfile
pnpm format
pnpm check:pr
git status --short
```

`pnpm format` modifica archivos. Revise el diff antes del commit.

## Comandos antes de push

No ejecute un formateador después del commit sin revisar el resultado.

```sh
pnpm check:pr
git status --short
```

El segundo `pnpm check:pr` debe terminar sin cambios. Publique solo después de esa comprobación.

## ESLint y Prettier

ESLint detecta problemas en JavaScript, TypeScript y archivos configurados. El Dashboard tiene 49 warnings de Fast Refresh en una línea base explícita.

`config/lint-warning-baseline.json` limita cada warning del Dashboard por archivo y regla. El gate permite una reducción. Rechaza una categoría nueva o un aumento.

UMI API y Landing usan `--max-warnings 0`. Cualquier warning nuevo en esos workspaces falla dentro de `pnpm lint`.

Prettier valida el formato de TypeScript, JavaScript, Markdown, JSON y otros archivos admitidos. Un archivo puede pasar ESLint y fallar Prettier.

Use estos comandos para separar el diagnóstico:

```sh
pnpm lint
pnpm check:lint-warnings
pnpm format:check
```

Use `pnpm format` para corregir formato. Revise todos los cambios antes del commit.

## Generated drift

El generador contractual puede producir JSON, TypeScript y Dart. Nunca edite esos artefactos de forma manual.

```sh
pnpm --filter @umi/contract generate:check
```

Si el check falla:

1. Edite solo `packages/contract/src`.
2. Ejecute `pnpm --filter @umi/contract generate`.
3. Ejecute `pnpm format`.
4. Ejecute `pnpm check:pr` dos veces.
5. Confirme que la segunda ejecución no cambia archivos.

## Troubleshooting

### Prettier muestra archivos

1. Ejecute `pnpm prettier --write <ruta>` para un conjunto limitado.
2. Revise el diff.
3. Ejecute `pnpm format:check`.

### ESLint falla

1. Lea el primer error real.
2. Corrija el código o la configuración responsable.
3. No rebaje el error a warning.
4. Ejecute `pnpm lint` otra vez.

### El contrato tiene drift

1. Confirme que la fuente está en `packages/contract`.
2. Regenere los artefactos.
3. Aplique Prettier después del generador.
4. Verifique el checksum y el diff.

### CI y local difieren

1. Confirme `node --version`.
2. Confirme `pnpm --version`.
3. Use `pnpm install --frozen-lockfile`.
4. Ejecute los comandos exactos de `.github/workflows/lint.yml`.
5. Compare el commit local con el SHA de la ejecución.

### El routing ledger cambia

Revise el diff antes del commit. El comando `check:pr` no debe crear cambios de routing. Una herramienta de publicación debe registrar solo datos requeridos por su workflow.

## Qué no hacer

- No agregue `continue-on-error`.
- No use `|| true`.
- No omita hooks con `--no-verify`.
- No agregue exclusiones amplias.
- No desactive reglas globales para ocultar un error.
- No aumente la línea base sin una revisión y una justificación.
- No ignore artefactos generados que el repositorio versiona.
- No ejecute un comando local aproximado. Ejecute `pnpm check:pr`.

## Versiones requeridas

- Node: versión mayor 22. La validación local usada aquí fue `v22.23.2`.
- pnpm: `10.29.3`.
- Prettier: `3.9.4`, fijado por el lockfile.
- Turbo: `2.10.2`, fijado por el lockfile.

El campo `packageManager` de `package.json` fija pnpm. El workflow activa la misma versión con Corepack.
