# Installing UmiPOS on an Android till

Status: `VERIFIED ON REAL HARDWARE` — iMin D3-504 (RK3566, Android 11), 2026-10-05.
Scope: the Android client only. The Linux desktop build stays the reference target
(`docs/architecture/2026-09-16-pos-is-a-native-app.md`); Android is the same app.

This is what it takes to put UmiPOS on the café tablet or the counter terminal, and the traps
that cost time the first time. Everything here was exercised against the local API and a
physical D3-504.

## 1. What the machine needs

| Piece          | Version used                                                      | Notes                                                            |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| JDK            | 17 (`jdk17-openjdk`)                                              | AGP 9.0.1 with Gradle 9.1.0. Gradle 9 needs 17 or newer.         |
| Android SDK    | cmdline-tools + platform 36 + build-tools 36.0.0 + platform-tools | Flutter 3.47 defaults to `compileSdk 36`.                        |
| Flutter        | 3.47.5                                                            | `flutter config --android-sdk <path>` so the toolchain is found. |
| `android-udev` | latest                                                            | Only needed for USB debugging.                                   |

```sh
sudo pacman -S --needed jdk17-openjdk android-udev
# cmdline-tools, then accept the licences and install the platform
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0"
flutter config --android-sdk "$HOME/Android/Sdk"
flutter doctor -v          # the Android toolchain row must be a check
```

One wrinkle: `scrcpy` depends on the distribution `android-tools`, so a second `adb` exists
next to the SDK one. `flutter doctor` warns about it. Give the SDK copy priority in `PATH`
rather than removing the package — removing it would break `scrcpy`.

## 2. The build command

```sh
cd apps/umi-pos
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export ANDROID_HOME="$HOME/Android/Sdk"

flutter build apk --debug --target-platform android-arm64 \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL=http://192.168.1.9:4001 \
  --dart-define=UMIPOS_DEVICE_KEY=keystore \
  --dart-define=UMIPOS_CONTRACT_VERSION=2.23.0 \
  --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true
```

Arm64-only release build: 21.8 MB. The icon font is tree-shaken from 1.6 MB to 21 KB.

Every define matters:

| Define                           | Why it is not optional                                                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UMIPOS_API_BASE_URL`            | Without it `AppConfig.validate()` fails and the till never starts.                                                                                                                                                                              |
| `UMIPOS_DEVICE_KEY=keystore`     | Selects the Android Keystore key. The default is the software Ed25519 key, and a shipped build would silently not use the hardware boundary.                                                                                                    |
| `UMIPOS_CONTRACT_VERSION`        | **Omitting it makes the app stop on the recovery card even when the API is healthy.** `ApiReleaseCompatibilityGateway` compares this against the server's `contractVersion`; the client value must be present and parse as `major.minor.patch`. |
| `UMIPOS_RELEASE_VERSION`         | Compared against the server's `minimumPosVersion`.                                                                                                                                                                                              |
| `UMIPOS_DEVELOPMENT_DIAGNOSTICS` | Turns on the one-line bootstrap log (§7) and the diagnostics surfaces.                                                                                                                                                                          |

## 3. Two things the Android build must declare

Both were missing and both are fixed in the tree. Re-check them if a release build ever
reports `apiUnavailable` while the API is demonstrably healthy.

**`INTERNET` in the main manifest.** `android/app/src/main/AndroidManifest.xml` had no
`android.permission.INTERNET`; only the debug and profile manifests declared it. A release
APK therefore had no network at all. UmiPOS is a client — every read and write goes through
`umi-api` — so the permission belongs in `main`.

Proof on the artifact, not on the source:

```sh
aapt2 dump permissions build/app/outputs/flutter-apk/app-release.apk
```

**Cleartext for development only.** With `targetSdk 36` Android blocks plain HTTP, and the
device log says so: `NetworkSecurityConfig: No Network Security Config specified, using
platform default`. Debug and profile manifests set `android:usesCleartextTraffic="true"`;
`main` deliberately does not, because a pilot or production build must stay HTTPS-only —
which `AppConfig.validate()` already enforces with `TLS_REQUIRED`.

## 4. Network preconditions

The device must be able to open a TCP connection to the workstation running the API. Two
things bite here:

- **The workstation firewall.** With `firewalld`, the zone bound to the Wi-Fi interface
  allowed only `ssh` and `dhcpv6-client`. The symptom is nasty: `ping` from the terminal to
  the workstation succeeds (ICMP is allowed) while TCP to the API fails with `No route to
host`. Test from the device, not from the workstation:

  ```sh
  adb shell "timeout 5 toybox nc -w 3 <workstation-ip> 4001 < /dev/null && echo TCP_OK || echo TCP_FAIL"
  ```

  For a development session: `sudo firewall-cmd --zone=public --add-port=4001/tcp`
  (runtime only; it reverts on reload or reboot). A pilot that needs inbound access makes
  that permanent on purpose, and only for the port the deployment actually uses.

- **The API must listen on the LAN, not only on loopback.** Check with
  `ss -tlnp | grep 4001`; `0.0.0.0:4001` is what the device needs.

## 5. The device key (the iOS parallel)

The device proves possession of a key on pairing, PIN login and refresh. Three backends sit
behind `DeviceKey`: the software Ed25519 key (default, everywhere), a desktop TPM key, and
the mobile platform keystore.

On **iOS** the gate is an entitlement: `keychain-access-groups`
(`$(AppIdentifierPrefix)co.umiconsulting.umiPos`). See
`docs/research/2026-10-03-ios-from-linux.md` — including the correction that Keychain
Sharing needs no portal step.

On **Android there is no equivalent permission.** `AndroidKeyStore` is always available to
the app; nothing is declared in the manifest. The two real requirements are:

1. Build with `--dart-define=UMIPOS_DEVICE_KEY=keystore`, or the app quietly uses the
   software key.
2. The native signer must actually run. `android/app/src/main/kotlin/.../DeviceKeySigner.kt`
   carries `REVIEW STATUS: written to the documented AndroidKeyStore contract but NOT
compiled or run in the build environment (no Android SDK/device there). It must be built
and exercised on a device before it is trusted.` The first Android build compiles it for
   the first time; the key is created at pairing, so pairing is its first real exercise.

The wire contract is already in place on both sides: `ensurePublicKey` returns SPKI DER,
`sign` returns `SHA256withECDSA` DER, `ecdsaSignatureToRaw()` normalises DER to the 64-byte
raw `r‖s`, and the server verifies `es256` with `dsaEncoding: 'ieee-p1363'`
(`apps/umi-api/src/modules/devices/device-proof.ts`). The signer asks for StrongBox and falls
back to TEE if the device rejects the flag, so a terminal without a discrete secure element
still gets a keystore-backed key.

## 6. Install and drive the device

```sh
adb connect <device-ip>:<port>            # wireless debugging; pair first with adb pair
adb install -r build/app/outputs/flutter-apk/app-debug.apk
adb shell am start -n co.umiconsulting.umi_pos/.MainActivity
adb exec-out screencap -p > /tmp/screen.png
```

`adb pair <ip>:<pairing-port> <six-digit code>` needs the port shown on the device's
wireless-debugging screen. The Arch build of `adb` has no mDNS, so discovery has to be
manual; `nmap -Pn -p 30000-50000 --open <ip>` finds the pairing and session ports.

Where the device reports its own facts without a debugger:

- `adb shell run-as co.umiconsulting.umi_pos ls /data/data/co.umiconsulting.umi_pos/` works
  on a debug build and shows whether secure storage actually wrote
  (`shared_prefs/FlutterSecureStorage.xml` holds the installation id).
- `adb logcat | grep umi_pos.bootstrap` prints one line per bootstrap state (§7).

## 7. Why an opaque card is now diagnosable

The failure card is the same for several phases, so a healthy API and a broken one looked
identical. `BootstrapController._setState` now logs the phase, the diagnostic category, the
client contract and version, the environment, the API and the device-key kind, gated by
`UMIPOS_DEVELOPMENT_DIAGNOSTICS`:

```
I flutter : umi_pos.bootstrap phase=readyForAuthentication category=- \
  clientContract=2.23.0 clientVersion=0.1.0 environment=development \
  api=http://192.168.1.9:4001 deviceKey=keystore
```

Read that line before the API log. If it names `recoverableFailure` with category
`apiUnavailable` and not one request reached the API, the fault is local (permission,
cleartext, firewall), not the server — the same lesson the Linux playbook records for the
keyring.

## 8. Enrollment

Dashboard → **Devices** → **Register UmiPOS** → name, type, platform → the eight-character
setup code. The code expires in five minutes and works once. Enter it on the till, approve
the matching installation from the Dashboard, wait for the device credential to be stored,
then enter the operator's personal PIN.

## 9. Traps, in the order they cost time

1. Release APK with no `INTERNET` permission: the card appears and no request is ever made.
2. Cleartext blocked at `targetSdk 36`: same card, and `ping` working is not evidence.
3. Workstation firewall rejecting TCP while allowing ICMP: `No route to host` from the
   device only.
4. Missing `UMIPOS_CONTRACT_VERSION`: the card appears even with a healthy API, because the
   compatibility gate compares a value the build never set.
5. A `flutter run` session prints nothing useful about the bootstrap; the diagnostics line
   is the instrument.

## 10. State at the site (2026-10-05)

The iMin D3-504 was factory-reset (10.3 GB free of 11.4 GB) and UmiPOS reaches
`readyForAuthentication`, showing _Registrar este dispositivo_ with the eight-character
field. Device identity, naming and the recovery of the previous ONCA system are in
`docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md`.
