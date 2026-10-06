# The Secret Service provider on Linux is GNOME Keyring

**2026-09-28.** Status: decided. This record answers a question that cost two sessions:
why a POS with a healthy backend stops on "No pudimos terminar la preparación".

## Decision

1. **The requirement is the freedesktop Secret Service API.** UmiPOS reads and writes its
   device credential through libsecret, and libsecret asks the session bus for
   `org.freedesktop.secrets`. The client stays provider-agnostic. No app code changes for
   a provider choice.
2. **GNOME Keyring is the supported provider on Linux.** It is the provider on GNOME
   distributions, and it answers D-Bus activation, so the service starts on demand.
3. **KWallet is tolerated, not supported.** It can serve a full KDE Plasma session. It
   does not work out of the box on a compositor-only session, because it ships no D-Bus
   activation for `org.freedesktop.secrets` and needs a login-time unlock path.
4. **Unlock policy.** A disposable workstation uses an empty-password login keyring, so
   no prompter ever appears. Shared or pilot hardware uses the login password with PAM
   unlock. An empty password protects the credential by file permissions alone; state
   that tradeoff when you choose it.
5. **Other platforms are unchanged.** Keychain on macOS and iOS, platform credential
   protection on Windows, platform keystore on Android.

## Why this needed writing down

The POS fails closed when the credential service is missing, and the symptom names the
wrong component. The release check catches the storage failure and reports
`apiUnavailable`. The till then shows an "API unavailable" style card while the API is
healthy, and **not one HTTP request reaches `:4001`**. Two sessions went into reading the
API log and the database before anyone read the app log, which held the answer on the
first line: `libsecret_error: Failed to unlock the keyring`.

The state that caused it was not exotic. KWallet was disabled on purpose, because its
prompter interrupts other applications:

```ini
[Wallet]
First Use=false
Enabled=false
```

That is a valid choice for a desktop, and it silently removes the only Secret Service
provider on the machine.

## Evidence, measured on the Arch / Hyprland workstation, 2026-09-28

| Claim                                | Command                                                                             | Result                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GNOME Keyring activates on demand    | `pacman -Fl gnome-keyring`                                                          | ships `usr/share/dbus-1/services/org.freedesktop.secrets.service` and `usr/lib/systemd/user/gnome-keyring-daemon.{service,socket}` |
| KWallet publishes no such file       | `rg -l org.freedesktop.secrets /usr/share/dbus-1/ /usr/lib/systemd/user/`           | no match                                                                                                                           |
| The KWallet daemon fails to activate | `busctl --user call org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet isEnabled` | `Could not activate remote peer 'org.kde.kwalletd6': unit failed`                                                                  |
| No login-time unlock exists for it   | `systemctl --user status plasma-kwallet-pam.service`                                | `masked`                                                                                                                           |
| The till never calls the API         | `rg -c '"message":"request"' <api log>`                                             | `1`, and that one is the health probe                                                                                              |
| Storage is the failure               | app log                                                                             | `libsecret_error: Failed to unlock the keyring`                                                                                    |

The app path is `BootstrapController.initialize`: configuration, contract, release check,
then `_secureStorage.healthCheck()`. `ApiReleaseCompatibilityGateway.check` catches every
transport error as `apiUnavailable`, and the device credential read happens inside
`_send` before the socket opens. A storage fault therefore surfaces as a backend fault.

## What this changes

- `docs/development/NEW_MACHINE_SETUP.md` installs and unlocks GNOME Keyring, and carries
  the Arch command beside the Debian one.
- `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` §1 carries the symptom, the check and
  the fix, so the next person reads the app log first.
- Provider choice stays a platform concern. It never becomes a compile-time flag or a
  code branch.

## How to verify

```sh
busctl --user list | grep org.freedesktop.secrets     # must name an owner
printf 'probe\n' | secret-tool store --label=umi-probe app umi-probe
secret-tool lookup app umi-probe                      # must print probe
```

Then start the till. It leaves the recovery card and reaches the PIN keypad.

## Open items

- The pilot image needs its own unlock decision, recorded where the pilot packaging
  lives. An empty-password keyring is not acceptable on a counter terminal.
- A future session can read the PoP!_OS workstation (`jc@pop-os`) to confirm the provider
  and wallet that ran there. That machine is currently offline. It does not block this
  decision; GNOME-based distributions use GNOME Keyring by default.
