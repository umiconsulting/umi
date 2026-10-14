# Site device inventory — UmiPOS

Status: `BORROWED PACKAGE, MIGRATION IN PROGRESS`.
Owner: site operations and UmiPOS deployment.
Last updated: 2026-10-05.

Source: 17 photographs taken 2026-10-05 plus one of the printer's rear panel. The hardware is
a package borrowed from a café/restaurant, today branded and driven by Parrot
(`parrotconnect`). The goal is to move the whole package to Umi.

This is the site's physical identity record. Every value marked `(verify)` was read from a
photograph and must be confirmed against the device before it is used as a network or
enrollment identity.

## 0. Where the commissioning stands (2026-10-06)

| Piece                       | State                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iMin D3-504 (counter till)  | Wiped (§9), UmiPOS built and installed, boots to `readyForAuthentication`                                                                                                                                                                                                                                                                                                                                                                                     |
| **Enrollment, all devices** | **Was blocked by a client bug, not by the network.** The app sent `platform: 'Android'` / `'iOS'` — Dart's spelling — where the contract requires `android` / `ios`, so the API refused **every** claim with `400 VALIDATION_FAILED`. Confirmed live against the deployed API: the capitalised value returns `fieldErrors: {platform: […]}`; the lower-case one reaches the code check (`401 ENROLLMENT_REJECTED`). Fixed in `fix/umipos-enrollment-platform` |
| Android release build       | Had **no `INTERNET` permission** outside the debug and profile manifests, so a release APK had no network at all and stopped on the recovery card reporting `apiUnavailable` while the API was healthy. Fixed here, with the dev-only cleartext scoped to debug and profile                                                                                                                                                                                   |
| Tablet A9+ (KDS)            | UmiPOS not yet installed                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Tablet A11 (mobile POS)     | UmiPOS not yet installed                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Epson TM-T20III             | Not on the network yet; IP, port 9100 test and paper width pending                                                                                                                                                                                                                                                                                                                                                                                            |
| TP-Link Archer C50          | Still `TP-Link_AE61` / `_5G`; rename, DHCP reservations and password rotation pending                                                                                                                                                                                                                                                                                                                                                                         |
| Cash drawer                 | **Wired to the terminal's own CashBox socket, not the printer** (closed 2026-10-14, §11). The pulse path is implemented and its node is proven writable; the physical pulse waits for the drawer itself to arrive. The printer's DK port remains the alternative.                                                                                                                                                                                             |

## 1. The package at a glance

| Proposed ID          | Umi role              | Device                                  | Model     | Serial              | Base OS          |
| -------------------- | --------------------- | --------------------------------------- | --------- | ------------------- | ---------------- |
| `UMI-<SITE>-POS-01`  | Counter POS (till)    | iMin D3-504 all-in-one (Parrot-branded) | `D3`      | `ND3504XE2408C0013` | Android 11       |
| `UMI-<SITE>-POSM-01` | Mobile POS / handheld | Samsung Galaxy Tab A11 (8.7")           | `SM-X133` | `R8YL41106HT`       | Android 16       |
| `UMI-<SITE>-KDS-01`  | Kitchen display       | Samsung Galaxy Tab A9+ (11")            | `SM-X210` | `R92Y20P7ECY`       | Android 16       |
| `UMI-<SITE>-PRN-01`  | Receipt printer       | Epson TM-T20III                         | `M352A`   | `X5Z5120240`        | n/a (peripheral) |
| `UMI-<SITE>-NET-01`  | Local network         | TP-Link Archer C50 (ES) v6.0            | `AC1200`  | `22522F2000573`     | n/a              |

Roles confirmed by the operation: the **large tablet (11", Galaxy Tab A9+) is the KDS**; the
**small tablet (8.7", Galaxy Tab A11) is the mobile POS / handheld order taker**. The
**counter terminal is the iMin D3-504**, and it is the device that has the **cash drawer**.

## 2. Device detail

### 2.1 Tablet A — `UMI-<SITE>-POSM-01`

| Field                     | Value                                               |
| ------------------------- | --------------------------------------------------- |
| Product name              | Galaxy Tab A11                                      |
| Model                     | `SM-X133`                                           |
| Serial                    | `R8YL41106HT`                                       |
| Wi-Fi hardware MAC        | `10:AB:C9:17:D4:B5`                                 |
| Bluetooth MAC             | `10:AB:C9:17:D4:B4`                                 |
| Wi-Fi MAC (per network)   | Unavailable in the photo — the device randomises it |
| Ethernet MAC              | Unavailable                                         |
| FCC ID                    | `ZCASMX133`                                         |
| Power                     | DC 9 V, 1.67 A                                      |
| One UI / Android          | One UI 8.5 / Android 16                             |
| Build                     | `BP4A.251205.006.X133DXU4BZH1`                      |
| Kernel                    | `6.12.38-android16-5-abX133DXU4BZH1-4k`             |
| Android security patch    | 5 July 2026                                         |
| Google Play system update | 1 July 2026                                         |
| Service provider SW       | `SAOMC_SM-X133_OWO_MXO_16_0003` (`MXO/MXO`)         |
| SE for Android            | Enforcing, `SEPF_SM-X133_16_0001`                   |
| Knox                      | 3.13 (API level 40)                                 |

Newest device in the package. Comes with a rugged case.

### 2.2 Tablet B — `UMI-<SITE>-KDS-01`

| Field                     | Value                                               |
| ------------------------- | --------------------------------------------------- |
| Product name              | Galaxy Tab A9+                                      |
| Model                     | `SM-X210`                                           |
| Serial                    | `R92Y20P7ECY`                                       |
| Wi-Fi hardware MAC        | `FC:93:6B:ED:2C:84`                                 |
| Bluetooth MAC             | `FC:93:6B:ED:2C:85`                                 |
| Wi-Fi MAC (per network)   | Unavailable in the photo — the device randomises it |
| Ethernet MAC              | Unavailable                                         |
| FCC ID                    | `ZCASMX210`                                         |
| Power                     | DC 9 V, 1.67 A                                      |
| One UI / Android          | One UI 8.0 / Android 16                             |
| Build                     | `BP2A.250605.031.A3.X210XXUDEZGF`                   |
| Kernel                    | `6.1.172-android14-11-32532371-abX210XXUDEZGF`      |
| Android security patch    | 5 August 2026                                       |
| Google Play system update | 1 August 2026                                       |
| Service provider SW       | `SAOMC_SM-X210_OWO_MXO_16_0002` (`MXO/MXO`)         |
| Update shown on screen    | 507.47 MB (build `X210XXUDEZGF`)                    |

### 2.3 Counter terminal — `UMI-<SITE>-POS-01`

White-label Parrot terminal (boots with the `iMin` logo and `parrotconnect`). It is an iMin
D3-504: large touch display, Android, and a bank of peripheral ports.

| Field                   | Value                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| Device name             | `D3-504`                                                                                                   |
| Model                   | `D3` (`ro.product.model`); iMin D3 family, board `rk3566_rgo`                                              |
| Platform vendor         | `neostra` (iMin), brand `rockchip`                                                                         |
| SoC / ABI               | Rockchip RK3566 · `arm64-v8a`                                                                              |
| RAM                     | 1.9 GB (`MemTotal` 2 001 520 kB)                                                                           |
| OS                      | Android 11 (SDK 30)                                                                                        |
| Serial                  | `ND3504XE2408C0013`                                                                                        |
| Build                   | `1.0.3.4.23_230926` / `RQ3A.210705.001` (2023-09-26)                                                       |
| Fingerprint             | `rockchip/rk3566_rgo/rk3566_rgo:11/RQ3A.210705.001/eng.yeguif.20230926.065226:user/release-keys`           |
| IP before the wipe      | `192.168.1.10` on one screen and `192.168.3.10` on another                                                 |
| IPv6                    | `fe80::7f74:385:b8b4:d89c`, `2806:269:486:f03:957d:d1c1:64d9:d858`, `2806:269:486:f03:a887:98b5:6a5e:6c37` |
| Wi-Fi MAC               | `d0:c8:57:4a:11:6d`                                                                                        |
| Ethernet MAC            | `d0:c8:57:4a:10:a5`                                                                                        |
| Bluetooth               | Unavailable                                                                                                |
| Storage before the wipe | 11.4 GB data partition, **1.33 GB free (11%)**                                                             |
| Cash drawer             | Yes, on this terminal, and it is the terminal's own `CashBox RJ12` (§11)                                   |

The device shipped with Parrot's launcher and app, plus standard Android settings.

The storage figure is why the package needed work: Android wants roughly 10% of the volume
free for Play Services, ART and updates, and the terminal was already below that line. The
wipe resolved it — see §9.

### 2.4 Receipt printer — `UMI-<SITE>-PRN-01`

| Field                                                                                       | Value                                                                                        |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Make / family                                                                               | Epson TM-T20III                                                                              |
| Model on the label                                                                          | `M352A`                                                                                      |
| Serial                                                                                      | `X5Z5120240`                                                                                 |
| Power                                                                                       | AC 100–240 V, 50–60 Hz, 1.0 A                                                                |
| Manufacture                                                                                 | Made in the Philippines (SEIKO EPSON CORP.)                                                  |
| Certifications                                                                              | NOM, TÜV Rheinland, UL Listed, ID `000010000`                                                |
| Rear-panel ports (photograph 2026-10-05; corrected by the owner 2026-10-07, device in hand) | USB type B · DB9 serial (RS-232) · **DK (drawer kick, RJ12)** · power. **No Ethernet port.** |

The TM-T20III ships in two interface configurations — USB + serial, or Ethernet. **This unit is
the USB + serial one.** The rear-panel port that the photograph read as RJ45 is the drawer's
**DK** port: Epson uses a 6-pin RJ12 there, which is the same shape as Ethernet and narrower
(`TM-T20III Technical Reference Guide`, "Modular connector RJ12"). The label on the printer
says `DK`.

That matters, because UmiPOS prints only over TCP. Its printer adapters build a network
transport for `printer` + `network_tcp` and for `cash_drawer` + `printer_attached`
(`apps/umi-pos/lib/features/hardware/pilot_hardware_adapters.dart`), and the `Usb…` and
`Serial…` transports declared in `hardware_runtime.dart` have **no implementation**. A
USB-attached printer can therefore be seen by the till but not driven by it — no receipt, and
no drawer pulse, because the pulse leaves through the printer.

To reach the generic-TCP path described in `docs/product/UMIPOS_HARDWARE_RUNTIME.md`, the
printer needs a serial-to-Ethernet bridge on its DB9 (raw TCP, port 9100), or it must be
replaced with the Ethernet-variant TM-T20III. The drawer stays on the DK port either way.

**Bench probe, 2026-10-07, printer on a Linux workstation over USB.** Attached to the
workstation, the unit enumerates as `04b8:0e27` with the product string **`TM-T20IIIL`** — the
Latin-American variant, and a correction to the `M352A / TM-T20III` above; the two share the
ESC/POS command set (`GS I` applicability list includes `T20IIIL`). It exposes a single USB
**printer-class** interface (`Cls=07 Sub=01 Prot=02`, bulk OUT `0x01` / IN `0x82`), the kernel's
`usblp` driver binds it, and `/dev/usb/lp0` appears. The printer self-identified over the wire
with `GS I 'C'` → `_TM-T20IIIL`. A `DLE EOT 1` status request answered `0x16` — online, no
error — so the link is live and bidirectional. Raw ESC/POS written to `lp0` is accepted.

What that means for the client: a USB transport only has to open that bulk OUT endpoint and
write the same byte stream the TCP transport already writes — plus a `health()` that maps
`DLE EOT 1` to online/offline. The printer driver, the cable and the terminal are not the
problem; the app's missing USB transport is.

**Bench results, same session — the open items, closed.**

| Question the plan left open              | Answer                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paper width and column count             | **80 mm, 48 columns** in the default font. A line of exactly 48 characters fits on one line; 49 does not.                                                                                                                                         |
| Character set                            | **Correct as the app already sends it.** Code page 2 (PC850) with `1B 74 02`, accents (`é ñ á é í ó ú`) print correctly, and the receipts came out clean with the app's own byte stream.                                                          |
| Does the printer's own byte stream work? | Yes — a receipt built from `thermal_printer_adapter.dart`'s exact sequence prints and cuts.                                                                                                                                                       |
| Printer configuration                    | Firmware `10.04 ESC/POS`; serial port `38400 8N1`, handshaking `DTR/DSR`, receive error prints `?`; automatic line feed on CR **disabled** (the app sends LF per line, so this is right); buffer 4K; recovery point Factory; print density LIGHT. |
| Sensor health                            | Online, cover closed, no cutter or recoverable errors, paper present (`DLE EOT` 1/2/3/4 → `16 16 12 12`).                                                                                                                                         |
| Wear                                     | Thermal head 0.372 km, autocutter 3,085 cuts — a used but healthy unit.                                                                                                                                                                           |

The app defaults to `receiptWidthColumns: 42` (`pilot_hardware_adapters.dart`). This printer
holds 48, so 42 is six columns conservative: safe, and worth setting to 48 when the printer is
registered.

**And it prints from the POS itself, 2026-10-07.** With the printer moved to the counter
terminal (iMin **D3**, Android 11, `user` build, adbd as `shell`, **no root**), the POS
enumerates it at `/sys/bus/usb/devices/3-1 → 04b8:0e27 TM-T20IIIL`, and `dumpsys usb` reports
`EPSON / TM-T20IIIL` with its interfaces. The shell cannot print: the USB nodes are root-only
and `user` builds have no `su`, so Android requires an **app** to claim the interface — which
is exactly the gap in UmiPOS, whose `hardware_runtime.dart` declares `UsbFoundationTransport`
and implements nothing.

A throwaway probe app (`com.umiconsulting.usbprintprobe`, Android USB host + the same byte
sequence `thermal_printer_adapter.dart` builds) proved the rest: it claimed interface 0 —
`class=7` (printer), two bulk endpoints — and reported `bulkTransfer wrote 111 of 111`. The
terminal, the cable and the printer carry a USB receipt without root. What UmiPOS lacks is one
transport, not a capability of the hardware.

**One device detail that only the POS showed.** `DLE EOT 1` is not answered the instant the
query is written: reading straight after returned nothing (`read=0`), and the same query with a
250 ms settle answered `read=1, status=0x16` — online, no error. The transport's `status()`
settles and retries for exactly this reason; on Linux the read had been slow enough by
accident. Health is therefore a real reading on the till, not an assumption.

### 2.5 Local network — `UMI-<SITE>-NET-01`

| Field                | Value                            |
| -------------------- | -------------------------------- |
| Make / model         | TP-Link Archer C50 (ES) Ver: 6.0 |
| Type                 | AC1200 dual-band Wi-Fi router    |
| MAC on the label     | `BC:07:1D:CA:AE:81`              |
| SSID (2.4 GHz)       | `TP-Link_AE61`                   |
| SSID (5 GHz)         | `TP-Link_AE61_5G`                |
| Serial               | `22522F2000573`                  |
| Power                | 9 V, 0.85 A                      |
| Wi-Fi password / PIN | Printed on the device label      |
| Origin               | Made in China                    |

The Wi-Fi password is not recorded here by workspace policy. It is on the router label and
must be rotated when the network is renamed.

This router is the "mini network" that the whole Parrot package lives on today — the single
path for the terminal, both tablets, and the printer.

## 3. Proposed Umi names

Convention: `UMI-<SITE>-<ROLE>-<NN>`, where `<SITE>` is a short uppercase code (for example
`CAFE01`) defined once by the site's activation ledger.

| Today                       | Proposed Umi name              |
| --------------------------- | ------------------------------ |
| `D3-504` (Parrot terminal)  | `UMI-<SITE>-POS-01`            |
| Galaxy Tab A11 (mobile POS) | `UMI-<SITE>-POSM-01`           |
| Galaxy Tab A9+ (KDS)        | `UMI-<SITE>-KDS-01`            |
| Epson TM-T20III             | `UMI-<SITE>-PRN-01`            |
| TP-Link Archer C50          | `UMI-<SITE>-NET-01`            |
| SSID `TP-Link_AE61` / `_5G` | `UMI-<SITE>` / `UMI-<SITE>-5G` |

The visible name on each tablet and terminal is changed in
Settings → About device → Rename. The router name and SSIDs are changed in the Archer's
administration. Because the SSID is the network's identity, renaming it forces every device
to be reconfigured.

## 4. Proposed connection map

```
Internet
   │
   └── UMI-<SITE>-NET-01  (TP-Link Archer C50, AC1200)
        ├── wired → UMI-<SITE>-POS-01  (iMin D3-504, Ethernet d0:c8:57:4a:10:a5)
        │              └── cash drawer (pulse through the printer's endpoint)
        ├── wired → UMI-<SITE>-PRN-01  (Epson TM-T20III, RJ45)
        ├── Wi-Fi → UMI-<SITE>-KDS-01  (Tab A9+ 11",  FC:93:6B:ED:2C:84)
        └── Wi-Fi → UMI-<SITE>-POSM-01 (Tab A11 8.7", 10:AB:C9:17:D4:B5)
```

Suggested order of work:

1. Rename the router and the SSIDs to Umi; rotate the network password.
2. Pin DHCP reservations by hardware MAC, not by the randomised per-network MAC.
3. Rename the four devices to the Umi convention.
4. Enroll each device as a trusted device in Umi (`tenant.device`).
5. Record each serial as the public reference in the hardware registry.
6. Register the printer and assign it to each till that must print.

## 5. How it fits the Umi ecosystem

Findings that affect the connection, not just the inventory:

| Finding                                                                                                                                                          | Evidence                                                                        | Consequence                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UmiPOS is the Flutter app `apps/umi-pos`. Android is the same app but **is not a v1 release target**; the release target is Linux, with iOS deferred to Gate 13. | `apps/umi-pos/README.md`; `docs/architecture/2026-09-16-pos-is-a-native-app.md` | Decide before promising operation on these tablets. The Android build now installs and boots (§9).                                                                                                                                                                          |
| The KDS is **no longer a separate app**: it is a mode inside `umi-pos` (`features/kitchen/kitchen_board_surface.dart`). The SwiftUI `umi-kds` was retired.       | `docs/architecture/2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md`         | One app, two device roles.                                                                                                                                                                                                                                                  |
| The printer reaches the LAN.                                                                                                                                     | Owner, 2026-10-07, device in hand; `TM-T20III Technical Reference Guide`.       | **It does not, as shipped.** The unit is USB + serial, and the RJ45 the photograph showed is the drawer's DK (RJ12). Bridge serial → TCP (raw, port 9100) or swap for the Ethernet-variant T20III; then assign an IP, test 9100, and confirm paper width and character set. |
| The printer is also the drawer's opening path (the pulse leaves through the printer endpoint).                                                                   | `docs/product/UMIPOS_HARDWARE_RUNTIME.md`                                       | With the printer on the network the drawer pulse is reachable too. Confirm the drawer is wired to the printer's DK port.                                                                                                                                                    |
| The terminal had **1.33 GB free (11%)**.                                                                                                                         | Device "Storage" screen                                                         | Resolved by the factory reset (§9).                                                                                                                                                                                                                                         |
| The terminal reported two different IPs across two photos.                                                                                                       | Two "About device" captures                                                     | Might be the same device on two networks. The Archer's factory LAN is `192.168.0.x`, so the site network was already customised. Unify the addressing before reserving leases.                                                                                              |
| Both Samsung tablets expose a randomised Wi-Fi MAC (the per-network field is empty) beside the hardware MAC.                                                     | Device "Status information" screens                                             | Give and reserve leases by the **hardware MAC**, and disable MAC randomisation for the Umi SSID.                                                                                                                                                                            |
| The whole package is Parrot's and the router is the current Parrot network.                                                                                      | `parrotconnect`/`iMin` logos; router label                                      | Renaming to Umi touches the router, the SSIDs and all four devices at once. Do it in a maintenance window.                                                                                                                                                                  |

## 6. Open items

1. Confirm the site's physical location and the `<SITE>` code.
2. Confirm the D3-504's exact model string (`i20002` vs `i20D02`).
3. Printer: pin its IP (DHCP reservation or static) and test port 9100.
4. ~~Cash drawer: confirm the wiring (printer DK or the terminal).~~ **Closed 2026-10-14** — the
   terminal's own cashbox socket, §11.
5. Confirm whether there is a barcode scanner and a customer display.
6. Confirm the site's Internet plan and whether the Archer stays a router or becomes an AP.
7. Decide the operating platform per device, given Android is not a v1 target.
8. Define which devices are wired and which are on Wi-Fi (§4).
9. Rotate the network password when renaming.

## 7. Technical access for commissioning

Everything runs from a Linux workstation on the same network as the devices.

| Device                      | Access route                     | What it enables                                     | What it needs                         |
| --------------------------- | -------------------------------- | --------------------------------------------------- | ------------------------------------- |
| iMin D3-504                 | ADB over Wi-Fi or USB            | Install UmiPOS, screenshots, logs, network settings | Developer options + debugging enabled |
| Galaxy Tab A9+ (KDS)        | ADB over Wi-Fi or USB-C          | Same                                                | Same                                  |
| Galaxy Tab A11 (mobile POS) | ADB over Wi-Fi or USB-C          | Same                                                | Same                                  |
| Epson TM-T20III             | Ethernet, TCP 9100 (raw ESC/POS) | Test ticket, width, character set                   | Network cable to the same switch      |
| Archer C50                  | Web administration               | Rename the network, DHCP reservations, channel      | Reachable admin IP                    |
| Cash drawer                 | No electronics of its own        | Verified with a test pulse only                     | Printer or terminal connected         |

Notes:

- Wireless debugging (Android 11+) needs no cables: enable it on the device and pair with a
  six-digit code. The device and the workstation must share a network.
- ADB over USB needs a data cable: USB-C for the small tablet, and for the D3-504 the
  connector must be confirmed (the photographed panel shows a USB type B).
- `scrcpy` mirrors and controls the screen from the workstation.
- The printer is not "monitored": send a test ticket over TCP and watch the physical result,
  including the drawer.
- Enabling debugging is a security exposure on a point-of-sale device. Leave it on only
  during commissioning and turn it off afterwards.

### Wireless debugging vs USB

Wireless debugging is the same `adb` over TCP with TLS pairing — not a reduced mode. Install,
`shell`, `push`/`pull`, `logcat`, screenshots, `screenrecord`, `scrcpy`, port forwarding and
`adb reverse` all behave the same.

| Capability                            | Wi-Fi (Android 11+)                                     | USB                    |
| ------------------------------------- | ------------------------------------------------------- | ---------------------- |
| Install / uninstall apps              | Yes                                                     | Yes                    |
| Shell, logs, screenshots, `scrcpy`    | Yes                                                     | Yes                    |
| Port forwarding / `adb reverse`       | Yes                                                     | Yes                    |
| Transfer speed                        | Bound by Wi-Fi (2.4 GHz)                                | USB 2.0, faster        |
| Session stability                     | Drops on sleep or reboot; the port changes              | Stable while connected |
| Automatic reconnect                   | Android 16+ on a trusted network; Android 11 not always | n/a                    |
| Discovery                             | Depends on mDNS on the network                          | n/a                    |
| `fastboot` / bootloader / recovery    | No                                                      | Yes                    |
| Flashing or recovery (Odin, Heimdall) | No                                                      | Yes                    |
| Before the setup wizard completes     | No                                                      | Yes                    |

The tablets are Android 16, so they get the newer reconnecting behaviour. The D3-504 is
Android 11 and its Wi-Fi showed ~108 ms of ping, a sign of aggressive power saving: expect
drops there and keep a cable handy. Only firmware, bootloader and recovery are USB-only.

### Observed state before the wipe (2026-10-05)

The workstation sat on a `192.168.1.0/24` network whose gateway was a ZTE `F680`
(`192.168.1.1`, MAC `d4:b7:09:d7:ce:4f`) — **not** the package's Archer C50. The Archer
belonged to the site's previous network.

| Observation                                             | Result                                              |
| ------------------------------------------------------- | --------------------------------------------------- |
| Counter terminal `192.168.1.10`                         | Pinged; MAC `d0:c8:57:4a:11:6d` (its Wi-Fi)         |
| Terminal management ports (`80`, `443`, `5555`, `9100`) | Closed — wireless debugging off                     |
| KDS and mobile-POS tablets                              | Not on this network                                 |
| Printer                                                 | Not on this network                                 |
| Archer C50                                              | Not the current gateway; it is the previous network |

### Pre-flight before the wipe

`adb` arrived over Wi-Fi on `192.168.1.10`. `adbd` runs as `shell` (uid 2000), no root: read
and package administration, no partition access.

| Check                    | Result                   | Implication                             |
| ------------------------ | ------------------------ | --------------------------------------- |
| Google or other accounts | **0 accounts**           | No FRP risk on reset                    |
| Device administrators    | None                     | No MDM                                  |
| Device owner             | None                     | No policy block                         |
| Root                     | No (`adbd` = `shell`)    | The wipe goes through Settings/recovery |
| Free space               | 1.33 GB of 11.4 GB (11%) | Confirms the reset was needed           |

Top space consumers at that moment: `com.android.providers.media.module` 2 581 MB, Chrome
446 MB data + 407 MB cache, WhatsApp Business 399 MB, Play Services 383 MB,
`com.android.packageinstaller` 192 MB, and `com.bryajam.panpilot.trial6` (ONCA POS 14) with
131 MB of data.

## 8. The previous site system found on the device

The D3-504 did not only run Parrot. It shipped with the site's own point-of-sale system —
brand **ONCA** — with apps `com.bryajam.panpilot.trial4/5/6` and a version history in
`/sdcard/Download`: `piloto-pan` → `pan-y-bebidas-v10/v11`, `ONCA-POS-v13/v14`,
`Cocina-de-Pizzas-v1` (a kitchen display) and the handhelds `comandera-bebidas-v1` /
`comandera-barra-v4`.

What that system documents about itself, worth knowing before cutting over:

- Till (iMin) and handheld (tablet) talk over **local HTTP on port 8770** with a persistent
  24-character code; the handheld refreshes every four seconds.
- Bread never crosses the network: the handheld receives only name, quantity and drink
  category, with no prices and no payment.
- The till keeps sales, closes and prices **in the app's private data**, with no automatic
  restore. Its own instructions require exporting the CSV first.
- The source ZIPs include the **private signing key** that lets those apps be updated. It is
  a secret: it must not be published or committed.

**Catalog recovered without root.** `com.bryajam.panpilot.trial6` (ONCA POS 14) declares
`ALLOW_BACKUP`, so `adb backup` pulled its private data and with it `db/pan-pilot.db`. From
there: `products` (64 items), `orders` (121, from 2026-10-01 to 2026-10-05),
`daily_closures`, `cash_openings`, `cash_withdrawals`, `drawer_events` and `drinks_ready`,
exported to CSV under `~/umi-parrot-backup/2026-10-05/onca-pos-db/`. The app's preferences
also yielded the POS PIN and the handheld key; both are secrets and stay in the backup
folder. The translation of that catalog into Umi's schema is
`docs/pilot/ONCA_MENU_TO_UMI_MAPPING.md`.

## 9. After the wipe

The factory reset ran from Settings (two confirmations). The device returned to the network
on the same IP and re-paired over wireless debugging.

| Check                 | Before                                                                    | After                                                         |
| --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Free space on `/data` | 1.33 GB (11% free)                                                        | **10.3 GB (90% free)**                                        |
| Third-party apps      | Parrot POS, ONCA POS, AnyDesk, TeamViewer, WhatsApp Business, PanPilot ×3 | Only the vendor's Chrome (`/odm/bundled_uninstall_back-app/`) |
| Accounts              | 0                                                                         | 0                                                             |
| Serial / model        | `ND3504XE2408C0013` · `D3`                                                | Same                                                          |
| Initial setup         | complete                                                                  | `device_provisioned=1`, `user_setup_complete=1`               |

As predicted, the vendor's system apps survived: `IminManual` (`/system/app/IminManual/`,
the on-device D3-504 manual), `IoTDeviceService` (`/system/app/IoTDeviceService`, the vendor
peripheral service), `com.imin.appstore`, `autoinstallservice`, `bootboot`, `datacenter`,
`remote`, `scandemo` and the Neostra printer services. Shared storage was regenerated clean.

UmiPOS then built, installed and reached `readyForAuthentication` on this terminal. The
toolchain, the two Android manifest requirements and the dart-defines a build must carry are
in `docs/development/UMIPOS_ANDROID_INSTALL.md`.

Re-entry needs wireless debugging left enabled; the device is paired with the workstation
(`juan@juan-PC`). That is a security exposure while it is on: turn it off when commissioning
ends.

## 10. Evidence index

| Photo (`WhatsApp Image 2026-10-05 ...`) | Content                                           |
| --------------------------------------- | ------------------------------------------------- |
| `4.35.06 PM.jpeg`                       | Tab A11 Bluetooth (`10:AB:C9:17:D4:B4`)           |
| `4.35.06 PM (1).jpeg`                   | Tab A11 status (Wi-Fi/Bluetooth MAC, serial)      |
| `4.35.06 PM (2).jpeg`                   | Tab A9+ status (Wi-Fi/Bluetooth MAC, serial, FCC) |
| `4.35.07 PM.jpeg`                       | Tab A9+ software information                      |
| `4.35.07 PM (1).jpeg`                   | Tab A11 SE for Android / Knox / patches           |
| `4.35.07 PM (2).jpeg`                   | Tab A11 software information                      |
| `4.35.07 PM (3).jpeg`                   | Tab A9+ latest update (507.47 MB)                 |
| `4.35.07 PM (4).jpeg`                   | Tab A9+ About tablet                              |
| `4.35.08 PM.jpeg`                       | Tab A11 About tablet                              |
| `4.35.08 PM (1).jpeg`                   | TP-Link Archer C50 label                          |
| `4.35.08 PM (2).jpeg`                   | Parrot/iMin terminal boot                         |
| `4.35.09 PM.jpeg`                       | D3-504 About device                               |
| `4.35.09 PM (1).jpeg`                   | D3-504 IP/MAC/build                               |
| `4.35.10 PM.jpeg`                       | D3-504 storage (1.37 GB free)                     |
| `4.35.10 PM (1).jpeg`                   | D3-504 settings menu                              |
| `4.35.10 PM (2).jpeg`                   | D3-504 on-device manual                           |
| `4.38.19 PM.jpeg`                       | Epson TM-T20III label                             |
| Rear panel (separate photo, 2026-10-05) | Printer ports: USB-B, DB9, RJ45 Ethernet          |

## 2026-10-12 — Native order flow verification

The Galaxy Tab A11 `SM-X133`, serial `R8YL41106HT`, connected through wireless debugging.
It serves as the mobile POS. The iMin D3 serves as the fixed POS.
Both use native Estación build 37 and the usual API on port 4001.
The tablet retains its existing `co.umiconsulting.umi_pos` package and has a separate Estación installation.

The active iMin connection uses ADB server 5037 at `192.168.1.10:5555`.
The tablet connection uses SDK ADB server 5038 at `192.168.1.13:35975`.
The separate server preserves the existing iMin debugging session.
Android can change the tablet connection port; read its wireless debugging screen if reconnection fails.
No pairing code is recorded here.

[The order flow report](../reports/2026-10-12-order-entry.md) records the physical screenshots and the isolated test database.

## 11. 2026-10-14 — The drawer's socket, and the open items around it, closed

The drawer was still off site, so it could not be pulsed. What could be settled without it was
settled, on the terminal, over ADB.

| Question that was open                                   | Answer                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Printer DK, or the terminal?                             | **The terminal.** `IminSDKManager.opencashBox(this)` is what the Parrot-era POS called on every cash sale and withdrawal while it printed over the Epson's USB, and the terminal carries its own drawer socket for it. |
| Does the terminal have that socket?                      | Yes: `/dev/imin/cashbox_ctl` (`cashbox_ctl`/`cashbox_det`/`rj11_vcc`, plus `ttyRJ11 -> /dev/ttyS3`) and the vendor's `neostra_gpioctl` node.                                                                           |
| Can UmiPOS pulse it without root?                        | Yes. The node is `rw-rw-rw-`, and an app-domain process can write it: `run-as co.umiconsulting.umi_pos.estacion sh -c 'echo 1 > /sys/class/neostra_gpioctl/dev/gpioctl'` returned 0.                                   |
| What is the drawer-detect reading today, with no drawer? | `1`, from `/dev/imin/cashbox_det`. The polarity is undocumented; the reading with the drawer attached is what makes it mean something.                                                                                 |
| Is the Epson link real?                                  | Yes, and it prints in the field. The unit enumerates at `/sys/bus/usb/devices/3-1` as `04b8:0e27 TM-T20IIIL`, one printer-class interface.                                                                             |

UmiPOS now drives **both** sockets: the terminal's own port through the new
`platform_channel_foundation` cash-drawer transport, and the printer's DK port through the
drawer pulse it already sends on the printer's link. The commissioning steps, the registry
fields for each path, and the day-of checklist are in
[UMIPOS_CASH_DRAWER_COMMISSIONING.md](./UMIPOS_CASH_DRAWER_COMMISSIONING.md).

The physical pulse remains unproven, for the one reason it always was: the drawer is elsewhere.
