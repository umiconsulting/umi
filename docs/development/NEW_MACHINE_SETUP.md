# New machine setup

Use this guide for a clean Linux workstation.

## Select the current work line

`build-v3` is the active integration and cutover branch. `main` remains the production line.

```sh
git fetch --all --prune
git switch --track origin/build-v3
git status --short --branch
```

Do not merge `main` into `build-v3` during setup. Use a reviewed reconciliation change.

Read these files before implementation:

- `AGENTS.md`
- `docs/migration/build-v3/GATED_CUTOVER_PLAN.md`
- `docs/migration/build-v3/backend-convergence-map.md`
- `docs/architecture-transition/CURRENT_PLATFORM_STATE.json`
- The owning app's `AGENTS.md` and `REPO_CONTEXT.md`, when present.

Treat `docs/migration/build-v2/` as historical input. Use `docs/migration/build-v3/` for pre-cutover database changes.

## Install the supported tools

Install these versions:

- Node.js 22
- pnpm 10.29.3 through Corepack
- Flutter 3.44.6 with Dart 3.12.2
- Java 17 or later for Android
- `uv` and `uvx` for Python MCP servers
- GitHub CLI for pull request history

Run these checks:

```sh
node --version
pnpm --version
flutter --version
java -version
uv --version
gh auth status
```

Install these Linux packages on Pop!_OS or Ubuntu:

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 postgresql-client redis-tools \
  clang cmake ninja-build pkg-config libgtk-3-dev libstdc++-12-dev \
  libsecret-1-dev libsecret-tools gnome-keyring uidmap slirp4netns fuse-overlayfs
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Sign out after the Docker group change. Sign in before you run Docker.

### Secure storage for UmiPOS

UmiPOS keeps its device credential in the platform credential service. On Linux that
service is the freedesktop Secret Service. GNOME Keyring is the supported provider; read
[the provider record](../architecture/2026-09-28-linux-secret-service-provider.md)
before you select a different one.

A GNOME desktop (Pop!_OS, Ubuntu desktop) already runs GNOME Keyring, and PAM unlocks it
at login. A minimal or compositor-only session does neither. Install it and unlock it:

```sh
sudo pacman -S --needed gnome-keyring libsecret        # Arch
sudo apt-get install -y gnome-keyring libsecret-tools  # Debian, Ubuntu, PoP!_OS

# Start the session service and unlock the login keyring. An empty line is an empty
# password, which stops every prompter.
eval "$(printf '\n' | gnome-keyring-daemon --unlock --components=secrets)"
```

An empty password protects the credential by file permissions only. Use the login
password with PAM unlock on shared or pilot hardware.

The package arms a user socket, so the daemon starts on demand at later logins. Verify
that once, after the next login: `scripts/local-secure-storage.sh` must print `OK`. Add
PAM unlock if a prompter appears instead.

Prove the provider answers before you start the till:

```sh
busctl --user list | grep org.freedesktop.secrets   # must name an owner
printf 'probe\n' | secret-tool store --label=umi-probe app umi-probe
secret-tool lookup app umi-probe                    # must print probe
```

`scripts/local-secure-storage.sh` runs the install, the unlock and the check. The default
is the check alone, so it is safe to run at any time:

```sh
scripts/local-secure-storage.sh            # check only, change nothing
scripts/local-secure-storage.sh --install  # install, start and unlock GNOME Keyring
```

The install path refuses to run while `ksecretd` is alive, because only one process may
own `org.freedesktop.secrets`.

Install the Android SDK and accept its licenses if Android work is in scope.

Install the package versions required by Flutter 3.44.6:

```sh
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
  "ndk;28.2.13676358" "cmake;3.22.1"
flutter doctor --android-licenses
```

Read each Android license before you accept it.

## Install repository dependencies

Run the root install:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @umi/contract generate
```

Install the separate Cash application:

```sh
cd apps/umi-cash
npm ci
cd ../..
```

Install UmiPOS packages:

```sh
cd apps/umi-pos
flutter pub get
flutter gen-l10n
cd ../..
```

## Configure local environments

Create ignored local files from these templates:

- `apps/umi-api/.env.example` to `apps/umi-api/.env`
- `apps/umi-dashboard/.env.example` to `apps/umi-dashboard/.env.local`
- `apps/umi-cash/.env.example` to `apps/umi-cash/.env.local`
- `apps/umi-landing-page/.env.example` to `apps/umi-landing-page/.env.local`

Use local-only values for local databases and token keys. Store shared secrets in the approved secret manager.

Do not copy production secrets into Git. Do not reuse the local example keys in a shared environment.

The Dashboard contract value is `2.13.0`. The generated contract hash is:

`f4ca66cde5633f4deb0f9676263f42f48a6ef56e5a992eda4dd4d83b9b905e63`

## Build the local database

One command builds the database the API, the till and the gates all read. It is a
**dry run by default**: run it once to see what it would drop, then again with
`--yes` to do it.

```sh
pnpm db:reset              # prints the plan, changes nothing
pnpm db:reset -- --yes     # drops, rebuilds, seeds, regenerates the contract
```

It reads the database from `DATABASE_URL_APP` in `apps/umi-api/.env`, applies
`docs/migration/build-v3/00_run.sh`, seeds the demo merchant and catalogue, seeds
the local operator roles and PINs, grants the platform administrator, and
regenerates the contract. It **refuses** while an API is listening on 4001 or
4014, because rebuilding a schema under a running server leaves a session that
half-works; pass `--force` when you mean it.

Use `--database NAME` to rebuild a scratch database instead of the one in
`.env` — that is how the reset itself is tested without touching a shared
database:

```sh
pnpm db:reset -- --database umi_probe --yes
```

### The platform administrator

The Dashboard needs one account with a platform role. That role lets the account
see every cafe and switch between them. Without it the merchant picker shows one
cafe, and no error explains why.

`db:reset` grants the role to `hola@umiconsulting.co` and sets the local password.
Use `--admin-email` to name another account, and `--no-admin` to skip this step.

A database that another path built can lack the grant. Grant the role again with:

```sh
scripts/umi-local-platform-admin.sh
scripts/umi-local-platform-admin.sh --email someone@example.com
scripts/umi-local-platform-admin.sh --create --password secret
```

The script is idempotent. It stops with a clear message when the address matches
no account. That silence is the trap: `seed_rbac.sql` grants nothing and raises
nothing for an address it cannot match.

The seeds in `scripts/` are assertions as much as inserts: they fail loudly when
the data they expect is not there. If a reset stops inside one of them, read the
message — it is usually a pinned number or a column that moved, not a broken
script. Fix the seed in the same change that moved the thing it pins.

## Configure external access

Authenticate GitHub with `gh auth login` and the configured SSH host alias.

Azure Boards is the active issue tracker. Complete the Azure DevOps MCP interactive login.

Set `DEEPSEEK_API_KEY` only when the DeepSeek MCP server is required.

Set `GEMINI_API_KEY` only when the image MCP server is required.

Plane is retired as a tracker. Configure `PLANE_API_KEY` only for an approved data export.

Restart the coding agent after an MCP configuration or credential change.

## Run the local gates

Run these gates before implementation:

```sh
pnpm run build
pnpm run test
pnpm run lint
pnpm run format:check
PR_BASE_REF=origin/build-v3 pnpm check:pr
```

Run dependency audits. Review every critical or high advisory before a release.

```sh
pnpm audit --audit-level high
(cd apps/umi-cash && npm audit --audit-level=high)
```

Run the Cash gates:

```sh
cd apps/umi-cash
npm test
npm run build
```

Run the UmiPOS gates:

```sh
cd apps/umi-pos
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build web --debug \
  --dart-define=UMI_ENVIRONMENT=development \
  --dart-define=UMI_API_BASE_URL=https://api.example.test
```

Database and deployment gates require Docker, PostgreSQL, Redis, and the correct environment values.

See `docs/development/RUNNING_UMIPOS.md` for device, database, and pilot procedures.
