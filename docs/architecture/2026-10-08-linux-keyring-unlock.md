# The login keyring unlocks at session start on this workstation

**2026-10-08.** Status: applied. This note covers one workstation. The provider
decision stays in `2026-09-28-linux-secret-service-provider.md`.

## Symptom

Chromium asked for the keyring password at every start, and it saved no
password. Every client that touched the Secret Service showed the same prompt.

## Cause

Three faults were present at the same time.

1. The `login` collection was locked. The daemon reported `Locked = true` in
   the middle of a session, so no client could read or write a secret.
2. PAM did not unlock the keyring. `/etc/pam.d/sddm` loads
   `pam_gnome_keyring.so`, but gnome-keyring starts by socket activation. The
   login password never reached the keyring.
3. Two providers competed. The machine runs `ksecretd` (KWallet) beside
   gnome-keyring, and `/etc/pam.d/sddm` started both.

`pam_gnome_keyring.so` and `pam_kwallet5.so` are both installed. A PAM line for
a missing module is not the cause here.

## Fix

- The `login` keyring has an empty password. The old file is kept at
  `~/.local/share/keyrings/login.keyring.2026-10-08.before-blank.bak`.
- `~/.local/bin/gnome-keyring-unlocked` starts the daemon with `--unlock`. An
  empty line on stdin gives the empty password, so no prompter appears.
- A systemd user drop-in
  (`~/.config/systemd/user/gnome-keyring-daemon.service.d/unlock.conf`) and a
  user D-Bus service file
  (`~/.local/share/dbus-1/services/org.freedesktop.secrets.service`) both call
  that script. Both activation paths were measured, and each one bypassed the
  other.
- The PAM lines for `pam_gnome_keyring.so` and `pam_kwallet5.so` are commented
  out in `/etc/pam.d/sddm` and `/etc/pam.d/sddm-autologin`. Backups carry the
  `2026-10-08` suffix.

## Tradeoff

An empty password protects the keyring by file permissions alone. That is
correct for a disposable workstation. It is wrong for a counter terminal. The
till uses a vault sealed to the TPM 2.0. Read
`apps/umi-pos/lib/core/storage/tpm_sealed_storage.dart` and §10 of
`docs/product/UMIPOS_DEVICE_ENROLLMENT_SPEC.md`.

## How to verify

```sh
busctl --user get-property org.freedesktop.secrets \
  /org/freedesktop/secrets/collection/login \
  org.freedesktop.Secret.Collection Locked      # must print b false
printf 'probe\n' | secret-tool store --label=umi-probe app umi-probe
secret-tool lookup app umi-probe                # must print probe
scripts/local-secure-storage.sh                 # must print OK
```

## Tools

Measured on EndeavourOS, Arch family: gnome-keyring 1:50.0-1, systemd 262,
dbus-broker, `systemd-creds` from systemd 262.
