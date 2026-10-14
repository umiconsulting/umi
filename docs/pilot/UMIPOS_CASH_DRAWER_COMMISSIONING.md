# Cash drawer commissioning — iMin D3-504 and Epson TM-T20IIIL

Status: `CODE READY AND VERIFIED AS FAR AS THE TERMINAL ALLOWS` — the physical pulse waits for the
drawer itself, which is at another site.
Owner: site operations and UmiPOS deployment.
Last updated: 2026-10-14.

The drawer has never been tested with UmiPOS because it is not on site. Everything up to the
physical pulse is now in place, for **both** places the cable can be plugged into, so the day
the drawer arrives it is a wiring decision and a button, not a development task.

## 1. Two sockets, one drawer

A drawer is a dumb box: it opens when a line pulses. On this till there are two lines to pulse,
and UmiPOS can drive both.

|                       | Path A — terminal (default assumption)                                           | Path B — receipt printer                                                   |
| --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Socket                | `CashBox` **RJ12** on the back of the iMin D3-504                                | `DK` **RJ12** on the Epson TM-T20IIIL                                      |
| What pulses           | the board's cashbox GPIO, written by the terminal's own hardware channel         | `ESC p m t1 t2` inside the printer's byte stream                           |
| Umi transport         | `platform_channel_foundation` (`cash_drawer`)                                    | `usb_foundation` (`cash_drawer`), sharing the printer's USB link           |
| Verified on this unit | the node exists, is mode `0666`, and an app-domain process can write it (see §6) | the printer's USB link is live and answers `DLE EOT 1`; the printer prints |

**Which one is it?** Watch the drawer's cable. If it ends at the back of the terminal next to
the USB ports, it is path A. If it ends at the printer, it is path B. The Parrot-era system that
ran on this same terminal is strong evidence for path A: its source calls
`IminSDKManager.opencashBox(this)` — the terminal's own cashbox API — every time a cash sale or a
withdrawal is booked, while it printed its receipts over the Epson's USB. Its log holds 75
"señal enviada" pulses against 7 failed attempts at a manual open.

## 2. What the vendor documents

| Fact                                                                                                                                                                                       | Source                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| iMin desktop models expose the drawer directly; the drawer uses the **RJ12** connector, and is opened with `IminSDKManager.opencashBox(Context)`; `isCashBoxOpen(Context)` reads its state | [iMin — General Function Modules, "CashBox(RJ12)"](https://oss-sg.imin.sg/docs/en/GeneralFunctionModules.html)      |
| iMin's RJ11 is a **serial** port (four-wire, no hard flow control), not the drawer socket — on the D3-504 that port is `/dev/ttyS1`                                                        | [iMin — General Function Modules, "Serial port(RJ11)"](https://oss-sg.imin.sg/docs/en/GeneralFunctionModules.html)  |
| The D3's port bank is `RJ11 x 1, RJ12 (24V) x 1, RJ45 x 1, USB-A x 4`, with a cash-drawer status micro switch                                                                              | [iMin D3 user manual](https://manuals.plus/m/fd83ca9cc7419d38b9ae2b9c454eab276a7924edc1e98b32bf5c15e696b2b0e1)      |
| `ESC p m t1 t2`: `m = 0` → kick-out pin 2, `m = 1` → pin 5; the pulse is **t1 × 2 ms on, t2 × 2 ms off**, and `t2` must exceed `t1`                                                        | [Epson ESC/POS — ESC p](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html)                   |
| The drawer is connected to the printer's kick connector, whose **pin 4 carries 24 V** for driving it                                                                                       | [Epson TM-T20III Technical Reference Guide](https://files.support.epson.com/pdf/pos/bulk/tm-t20iii_trg_en_reva.pdf) |

What UmiPOS sends on each path:

- Path A: one write of the board's configured value to the cashbox node. The pulse width is the
  board's, not the app's — the node takes a level, not a timing. `drawerPulseOnMs` is kept in the
  record and is not what the till sends.
- Path B: `1B 70 <pin> <t1> FA`, i.e. `onUnits = drawerPulseOnMs / 2` in the 2 ms units the
  command is defined in, with `t2 = 250` (500 ms off). This matches the vendor's units exactly.

## 3. How to configure it in Umi

The registry record is what selects the path; nothing is configured on the device.

| Field                    | Path A                                              | Path B                                          |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------- |
| Type                     | `cash_drawer`                                       | `cash_drawer`                                   |
| Transport                | `platform_channel_foundation`                       | `usb_foundation`                                |
| Capabilities             | `drawer.open`, `drawer.status`                      | `drawer.open`, `drawer.status`                  |
| Connection configuration | defaults (`drawerPulsePin` 0, `drawerPulseOnMs` 50) | as above; the pin/pulse ride the printer's link |
| Assignment               | assign to the till that owns the socket             | assign to the same till as its printer          |

In the till: **Ajustes → Hardware → "Buscar cajón de la terminal"** asks the terminal whether it
has the port and files the drawer with the node it will pulse, then assigns it here. The manual
path is **"Registrar dispositivo" → Cajón de efectivo → Conexión: "Puerto de la terminal (RJ11
iMin)"**. Path B is the existing **"USB (puerto del POS)"** choice, which registers the drawer on
the printer's link.

Policy, owned by the API and published to the till:

| Policy                   | Default | Effect                                                        |
| ------------------------ | ------- | ------------------------------------------------------------- |
| `openDrawerOnCashSale`   | `true`  | a committed sale with cash tender pulses the drawer           |
| `openDrawerOnCashRefund` | `true`  | a committed cash refund pulses the drawer                     |
| `allowNoSale`            | `false` | a no-sale open, with mandatory manager approval, when enabled |

Permissions are exact, not role names: `hardware.drawer.open` for an operational pulse,
`hardware.drawer.test` for the manager test, `hardware.manage` to register or assign.

A drawer that names **another** terminal is not this till's to open, even when the registry
returns it: the assignment says who carries it, and a handheld has no socket to pulse. A drawer
with no assignment remains eligible, because a register's drawer predates the assignment model.
Without that rule a cash sale on the tablet would answer `El cajón no respondió` about a drawer
across the counter.

That is the product rule, not a workaround: **the tablets never open a drawer and are not
expected to** — they have no cash drawer socket. Only the iMin carries one, and only the iMin
pulses it.

## 4. Every POS function that needs the drawer

| Operator action                                        | Command / reason                                                    | Comes from                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Cobro en efectivo                                      | `open_drawer` / `cash_sale`                                         | `afterCheckoutCompleted`, only with cash tender              |
| Devolución en efectivo                                 | `open_drawer` / `cash_refund`                                       | committed refund with cash allocation                        |
| Apertura de turno, entrada, retiro, corte de seguridad | `open_drawer` / `opening_float`, `paid_in`, `paid_out`, `safe_drop` | cash movements in Caja, after the ledger commits             |
| Apertura sin venta                                     | `open_drawer` / `no_sale`                                           | policy `allowNoSale` plus manager approval                   |
| Prueba del gerente                                     | `test_drawer` / `manager_test`                                      | "Ejecutar prueba" on the drawer, or the manager test in Caja |
| Venta provisional sin conexión                         | `open_drawer` / `cash_sale`                                         | the offline journal, with a deterministic command identity   |
| Un cajón con resultado desconocido                     | one explicit new open                                               | Recovery Center / "Emitir segunda apertura autorizada"       |

A card sale, or a sale with no cash tender, never pulses it. A drawer failure never rolls back a
financial fact: the money is recorded either way, and the till says
`El cajón no respondió. La operación quedó registrada; ábrelo a mano y avisa al encargado.`

## 5. Before it arrives, and the day it arrives

One command answers everything the terminal can answer on its own, and writes nothing:

```sh
./scripts/imin-cashbox-check.sh 192.168.1.10:5555        # read the port, the sensor, the printer
./scripts/imin-cashbox-check.sh --pulse 192.168.1.10:5555 # go-live: the one step that moves hardware
```

The day the drawer arrives:

1. **Read the detect pin before the cable goes in** — `adb shell cat /dev/imin/cashbox_det`.
   Its polarity is undocumented; the reading now and the reading with a drawer attached are what
   turn it into a fact. (Measured 2026-10-14, no drawer: `1`.)
2. **Plug it in.** Path A: the terminal's `CashBox RJ12`. Path B: the Epson's `DK`.
3. **Read the pin again** and record both readings in this document.
4. **File the drawer** from the till (§3). A terminal with no port answers nothing and says so
   instead of filing a device row that could never open.
5. **Pulse it once** — the manager test. The drawer must open. If it does not:
   - Path A: the line is live (a write was accepted) but the box did not move. The board's drive
     value is the next thing to check: the vendor selects 12 V/24 V with
     `persist.sys.CASHBOX_ENABLE`, which is unset on this unit, so the factory value `1` is what
     UmiPOS writes. A drawer rated for the other voltage will not open.
   - Path B: check the printer's buzzer/drawer settings, which share those pins.
6. **Prove the money paths** in this order: a cash sale, a withdrawal, a cash refund, and a
   no-sale open (needs the policy and an approval). Each one must both move the drawer and leave
   its own line in the shift ledger.
7. **Turn debugging off** when commissioning ends: wireless debugging stays a security exposure
   on a till.

## 6. What is verified, and what is not

| Claim                                                          | Standing                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The terminal has its own drawer socket and a drawer-detect pin | **Measured**: `/dev/imin/cashbox_ctl`, `cashbox_det`, `rj11_vcc`, `ttyRJ11 -> /dev/ttyS3`                                                                                                                                                                                                                                                                               |
| An app can pulse that line without root                        | **Measured, 2026-10-14, twice**: the node is `rw-rw-rw-`; `run-as co.umiconsulting.umi_pos.estacion sh -c 'echo 1 > /sys/class/neostra_gpioctl/dev/gpioctl'` returned 0; and a purpose-built probe APK installed on the till (uid 10137, `untrusted_app`) reported `iminservice=null`, `canWrite=true`, `VERDICT=PULSE_ACCEPTED`. The probe was uninstalled afterwards. |
| The `iminservice` system service does not exist on this build  | **Measured**: `getSystemService("iminservice")` is `null` on Android 11, so the node path is the one this till takes — as designed                                                                                                                                                                                                                                      |
| The pulse mechanism is the vendor's, not invented              | **Read from the vendor's own SDK** (`IminLibs.jar` v2.0.88, `com.imin.library.a`) and from their documentation (CashBox/RJ12)                                                                                                                                                                                                                                           |
| The previous site system used that path on this terminal       | **Read from the recovered source**: `IminSDKManager.opencashBox` on every cash sale and withdrawal                                                                                                                                                                                                                                                                      |
| The Epson prints from the till over USB, status byte included  | **Measured in the field**: the receipt printer works today                                                                                                                                                                                                                                                                                                              |
| The drawer physically opens                                    | **Not yet**: the drawer is at another site                                                                                                                                                                                                                                                                                                                              |
| The Android-13-and-newer `iminservice` path                    | **Untested here** — the pilot till is Android 11, so the code takes the node path                                                                                                                                                                                                                                                                                       |
| The sale-to-pulse path, without hardware                       | **Tested**: `hardware_service_test.dart` — "a cash sale pulses the drawer on the terminal port exactly once" (and the replay of the same sale does not pulse twice)                                                                                                                                                                                                     |
| The release build keeps the channel, through R8                | **Built**: `flutter build apk --release` succeeds and the channel's name is in the dex                                                                                                                                                                                                                                                                                  |

**The one dependency worth knowing about.** The kernel audit log shows the write being _denied_
by policy and _allowed_ by the ROM anyway:
`avc: denied { write } for name="gpioctl" ... scontext=u:r:untrusted_app:s0 tcontext=u:object_r:sysfs:s0 permissive=1`.
In other words the byte lands because this ROM's policy for app domains is permissive on that
file, not because a rule allows it. That is also why the vendor's own SDK works on this hardware
— it takes the same path — but it means a future OTA that tightens sepolicy would stop the pulse.
UmiPOS does not fail quietly if that happens: the write raises, the command comes back
`unknown_outcome`, and the till shows
`El cajón no respondió. La operación quedó registrada; ábrelo a mano y avisa al encargado.` The
drawer test on the go-live day is what catches it, which is why it is step 5.

## 7. Where the code lives

| Piece                                               | File                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The terminal's cashbox port, on the Android side    | `apps/umi-pos/android/app/src/main/kotlin/co/umiconsulting/umi_pos/CashDrawerChannel.kt`                           |
| The transport and its adapter                       | `apps/umi-pos/lib/features/hardware/terminal_cashbox_transport.dart`                                               |
| Binding a registered drawer to the channel          | `apps/umi-pos/lib/features/hardware/pilot_hardware_adapters.dart`                                                  |
| Registration, and the one-tap discovery of the port | `apps/umi-pos/lib/features/hardware/hardware_surface.dart`                                                         |
| Its tests                                           | `apps/umi-pos/test/terminal_cashbox_drawer_test.dart`                                                              |
| The sale-to-pulse path, proved without hardware     | `apps/umi-pos/test/hardware_service_test.dart` — "a cash sale pulses the drawer on the terminal port exactly once" |
| The one-command pre-flight                          | `scripts/imin-cashbox-check.sh`                                                                                    |

The transport is `platform_channel_foundation`, which the contract and the hardware schema
already carry — no API or database change was needed.

## 8. The build that carries it

The counter till runs the `estación` identity against the site's API. This artifact carries the
terminal-port drawer and installs over what is on the till today (same package, same debug
signature, `versionCode` 124 over 123), so enrollment survives:

```
~/umi-pos-builds/umi-pos-0.1.0-development-site-124-arm64.apk
sha256 46b60b3f7a331b9159115bd1b4867049dcc4d8a72fe6bf24a4fe9fd433585ece

adb -s 192.168.1.10:5555 install -r ~/umi-pos-builds/umi-pos-0.1.0-development-site-124-arm64.apk
```

It was built from this tree with the defines the installed build already carries — read off the
till's own bootstrap line (`environment=development api=http://192.168.1.9:4001 deviceKey=`):

```sh
cd apps/umi-pos
flutter build apk --profile --target-platform android-arm64 \
  -PumiposApplicationId=co.umiconsulting.umi_pos.estacion \
  --build-name 0.1.0 --build-number 124 \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL=http://192.168.1.9:4001 \
  --dart-define=UMIPOS_DEVICE_KEY= \
  --dart-define=UMIPOS_CONTRACT_VERSION=2.38.0 \
  --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 \
  --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
```

Installed and verified on the iMin on 2026-10-14: `versionCode=124`, signed with the same
certificate the till already trusts, and it reaches `phase=readyForAuthentication` with the same
API, environment and contract line as before.
