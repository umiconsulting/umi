# SSH y acceso al host de soporte

## Destino

| Campo | Valor |
| --- | --- |
| Host | `juan-PC` |
| Tailscale IPv4 | `100.109.51.39` |
| Tailscale DNS | `juan-pc.tailbd8b9a.ts.net` |
| Puerto SSH | `22` |
| Machine ID | `97d302e7018b42eb80e9a56e78dab7b6` |
| Huella ED25519 | `SHA256:JNZVk8Jse74VgShkRlHZhdWUmZ+M+Ha6iSaXlB07KaE` |

El usuario remoto es `root`. `sshd` acepta root sólo con llave pública.

El 27 de octubre de 2026 se autorizó la llave pública del propietario. Una
conexión real por `root@100.109.51.39` respondió desde `juan-PC`. La llave de
cada nuevo desarrollador necesita su propia autorización.

## Verifica antes de conectar

En la computadora del desarrollador:

```bash
tailscale ping 100.109.51.39
ssh-keyscan -T 8 -t ed25519 100.109.51.39 2>/dev/null | ssh-keygen -lf -
```

La huella debe coincidir con la tabla. No continues si cambió.

Conecta:

```bash
ssh root@100.109.51.39
cat /etc/machine-id
hostname
tailscale ip -4
```

El machine-id debe coincidir. Si no coincide, estás en otra máquina.

## Autoriza una llave nueva

El desarrollador envía su llave **pública**, por ejemplo
`~/.ssh/id_ed25519.pub`. El propietario del host ejecuta:

```bash
sudo .agents/skills/onca-production-support/scripts/authorize-onca-support-key.sh \
  /ruta/authorized-developer-key.pub --dry-run
```

Sin `--dry-run`, el script agrega una sola llave a
`/root/.ssh/authorized_keys`. La llave sólo se acepta desde direcciones
`100.64.0.0/10` o `fd7a:115c:a1e0::/48` de Tailscale.

No habilites `PermitRootLogin yes` ni autenticación de root por contraseña.

## Trabaja como juan

La sesión SSH entra como root. Git, Flutter, Codex y los archivos del workspace
pertenecen a `juan`.

```bash
su - juan
cd /home/juan/umi-onca-bugfix-20261024
```

Para ejecutar un comando sin abrir shell:

```bash
runuser -u juan -- env HOME=/home/juan \
  XDG_RUNTIME_DIR=/run/user/1000 \
  PATH=/home/juan/.local/bin:/usr/local/bin:/usr/bin \
  bash -lc 'cd /home/juan/umi-onca-bugfix-20261024 && <command>'
```

No ejecutes `git`, `flutter`, `pnpm` ni `codex` como root dentro del workspace.

## Inicia otro agente

Desde una sesión root, un agente puede abrir Codex como `juan`:

```bash
ssh -t root@100.109.51.39 \
  "su - juan -c 'cd /home/juan/umi-onca-bugfix-20261024 && codex'"
```

Usa un solo agente para cambios concurrentes. Comparte evidencia y worktrees
separados cuando necesites paralelismo.

## Verifica el host

```bash
systemctl --user is-enabled onca-adb-register.service
systemctl --user is-active onca-adb-register.service
curl -fsS http://100.109.51.39:47123/health
tailscale status
adb devices -l
```

El servicio de usuario necesita `linger` para iniciar sin una sesión gráfica.

## Acceso al VPS

No supongas que este host puede entrar al VPS. Comprueba primero el alias o la
variable de entorno disponible:

```bash
printf '%s\n' "${ONCA_VPS_SSH_TARGET:-unset}"
ssh -G "$ONCA_VPS_SSH_TARGET" 2>/dev/null | sed -n '1,20p'
```

No copies la llave privada del VPS ni imprimas secretos. Si no hay acceso
directo comprobado, usa el flujo de PR y despliegue por CI.
