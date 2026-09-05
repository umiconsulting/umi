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
  libsecret-1-dev uidmap slirp4netns fuse-overlayfs
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Sign out after the Docker group change. Sign in before you run Docker.

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
