# UmiPOS

The till. Read the root `AGENTS.md` first; this file covers only what is specific to this app.

## What it is

- A **native Flutter application**. The native build is the runtime of record — the web build is a
  development convenience and is never evidence about the product
  (`docs/architecture/2026-09-16-pos-is-a-native-app.md`).
- A **client**. It holds client credentials only; every read and write goes through `umi-api`. Data
  questions are usually answered in the API or the database, not here.

## Setup

Linux desktop build needs a C++ toolchain, GTK and xdotool:

```sh
sudo pacman -S --needed clang cmake ninja pkgconf gtk3 xdotool   # Arch/EndeavourOS
```

Flutter, where the launcher looks for it (`FLUTTER_BIN` overrides the default
`$HOME/.local/opt/flutter/bin/flutter`). `pubspec.yaml` requires Dart ≥ 3.12 and Flutter ≥ 3.44;
`docs/development/RUNNING_UMIPOS.md` names the version the repo documents.

Dependencies, from the repo root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @umi/contract build       # the app imports @umi/contract/dist
cd apps/umi-pos && flutter pub get
```

Start what it talks to before the app:

| Piece     | Address                 | Command                                            |
| --------- | ----------------------- | -------------------------------------------------- |
| API       | `http://127.0.0.1:4001` | `cd apps/umi-api && pnpm dev`                      |
| Dashboard | `http://127.0.0.1:4000` | `pnpm --filter @umi/dashboard dev`                 |
| Postgres  | `127.0.0.1:4003`        | `docker compose -f deploy/local/compose.yml up -d` |
| Redis     | `127.0.0.1:4004`        | same compose file                                  |

The compose stack needs two seed files it does not ship — `deploy/local/seed/roles.sql` and
`deploy/local/seed/<db>.dump`. Supply them, or start the two services yourself. The database must
already carry the PostgreSQL schema, and the API connects as `api_login` (RLS-enforced) and
`worker_login` (BYPASSRLS); its boot guard refuses a superuser pool. See `db/`
and `apps/umi-api/.env.example`.

## Run

```sh
cd apps/umi-pos && flutter run -d linux \
  --dart-define=UMIPOS_API_BASE_URL=http://127.0.0.1:4001
```

`docs/development/RUNNING_UMIPOS.md` documents the full `--dart-define` set.

## Observe & Drive

`test_driver/driver_main.dart` enables the **Flutter Driver extension** over the Dart VM service:

```sh
cd apps/umi-pos && flutter run -d linux -t test_driver/driver_main.dart --print-dtd
```

## Conventions

- Verify windows with `hyprctl` on Wayland, not `xdotool`.
- Drive through the Driver extension, not the pointer.
- Do not wrap a long-running dev server in `timeout`; it dies mid-session and reads as a crash.
