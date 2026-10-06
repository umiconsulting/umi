# Mercado Pago Point: the public integration surface and the USB question

Date: 2026-09-16
Author: research subagent (part C of the Point USB investigation)
Companion files:

- `01-official-integration-paths.md` (the full API walkthrough)
- `02-usb-observation-procedure.md` (the read-only capture procedure)
- `03-prior-art-terminal-integration.md` (other terminal vendors)
- `docs/research/2026-09-16-mexico-payments-and-fiscal.md` (the earlier Umi research)

This file answers one question: what does Mercado Pago itself publish about the Point
hardware and about any local USB, serial, or Bluetooth protocol?

## Scope

In scope:

- The public Mercado Pago documentation for the Point terminal family.
- The public Mercado Pago SDKs, repositories, and app kit for the terminal.
- The public hardware trail: FCC filings, teardowns, and community reports.
- The rules that restrict device access.

Out of scope:

- The design of the Umi POS payment feature.
- Any active probing of the user's terminal. No terminal was present during this research.
- Any attempt to bypass the terminal security. This file records reading only.

Constraint: the user owns a Point terminal of unknown model. This file does not assume a
model. It gives the evidence that separates the models.

## Method and Tools

Test day: 2026-09-16.
Workstation: the Umi Linux workstation. No login form was completed and no account was used.

Tools:

| Tool                  | Version    | Use here                                                                      |
| --------------------- | ---------- | ----------------------------------------------------------------------------- |
| `curl`                | 8.5.0      | Every HTTP call.                                                              |
| `gh`                  | 2.45.0     | GitHub repository, code, and issue search (authenticated as `umi-juanlopez`). |
| `jq`                  | 1.7        | JSON parsing.                                                                 |
| `python3`             | 3.12.3     | HTML to text extraction, search-result parsing, archive inspection.           |
| `fccid.io`            | web mirror | FCC filing lookup after the official FCC form refused the call.               |
| `unzip` and `grep -a` | system     | Inspection of the public Mercado Pago Android AAR.                            |

The single most useful channel was the machine-readable documentation index:

```
https://www.mercadopago.com.mx/developers/es/docs/llms.txt
https://www.mercadopago.com.mx/developers/en/docs/llms.txt
https://www.mercadopago.com.br/developers/pt/docs/llms.txt
https://www.mercadopago.com.ar/developers/es/docs/llms.txt
```

Each of these four files returned HTTP 200 with a full page list. A second channel of the
same family was the raw Markdown form of any documentation page: append `.md` to the URL.
This returned clean Markdown, and it removed the JavaScript problem completely.

Source rungs follow `docs/agents/tool-and-research-doctrine.md` section 4.

### Step 0: the five questions

| Question                              | Answer                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes. The vendor documentation index, the GitHub search CLI, and the FCC filing mirror. No hand-rolled scraper was needed. |
| Is it installed here?                 | Yes. `curl`, `gh`, `jq`, and `python3` are present.                                                                       |
| Can an agent drive it with no prompt? | Yes. All calls are non-interactive.                                                                                       |
| What is the adoption cost?            | Zero. The documentation index and the `.md` suffix cost one call each.                                                    |
| What is the fallback?                 | The Wayback Machine for a dead page, and `fccid.io` for the FCC form.                                                     |

Tool result: the `.md` suffix on a Mercado Pago documentation URL is the best tool for this
job. It converts a JavaScript portal into plain text at no cost. Use it first.

## Answer to the headline question

**NO. Mercado Pago publishes no USB, serial, or Bluetooth protocol for the Point terminal.**

No primary source describes a host protocol that lets a computer or a POS app drive a Point
terminal. The answer above is a documented absence, and the sections below record what
Mercado Pago publishes instead.

Four findings support the answer.

1. **Documented fact.** The supported integration is a cloud API. The terminal loads the
   order from Mercado Pago servers. The POS never opens a channel to the device.
   Source: [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md)
   (rung 1).
2. **Documented fact.** The on-device SmartApp documentation forbids the use of the USB port
   for information transmission. It also forbids `android.permission.USB_PERMISSION` and
   `android.permission.USB_SET`. Source:
   [SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)
   (rung 1).
3. **Documented fact.** The same page states that card reading, printing, Bluetooth, and the
   camera "must be invoked exclusively through the Mercado Pago SDK and not through direct
   use of permissions declared in the `AndroidManifest`". Source: the same restrictions page
   (rung 1).
4. **Documented fact.** A development Point Smart terminal is the only unit with the USB port
   enabled. "Unlike production devices, development devices have the USB port enabled by
   default and debugging configuration activated." Source:
   [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)
   (rung 1). Mercado Pago issues that unit through its business team only.

What the search found instead of a protocol:

| Found                                           | What it is                                                                         | Label                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| The Orders API and the Terminal API             | HTTPS endpoints on `api.mercadopago.com`.                                          | Documented fact         |
| The SmartApps SDK (Third-Apps Integration Kit)  | A private Android AAR that runs on the terminal and reaches the device hardware.   | Documented fact         |
| A legacy Android Intent integration             | A 2022 sample app that calls the Mercado Pago wallet app on the same device.       | Documented fact, legacy |
| A public app-kit repository with the AAR inside | `mercadolibre/mainapp-demo-android` and `mercadopago/point-smartapp-demo-android`. | Documented fact         |
| Reverse-engineering notes on the Newland N950   | Community work. It reports fastboot only, and no ADB after boot.                   | Community evidence      |

Search terms used, and the result:

| Query or source                                    | Result                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `usb` in the four `llms.txt` indexes               | No device protocol page.                                      |
| `serial`, `adb`, `hid`, `cdc` in the four indexes  | No page.                                                      |
| `android`, `sdk`, `apk` in the four indexes        | SmartApps pages only.                                         |
| GitHub code search for `isp_smart_mediator`        | No public application code.                                   |
| GitHub code search for `com.mercadopago.smartpos`  | One decompilation repository.                                 |
| GitHub issue search for `point smart adb`          | One issue, `mercadolibre/point-mainapp-demo-android#84`.      |
| Stack Exchange API search for `mercadopago point`  | No relevant question.                                         |
| Hacker News Algolia search for `mercadopago point` | One relevant story, a conference talk on Smart POS terminals. |

## Official integration paths

Mercado Pago publishes two families of path: cloud paths, and one on-device path.
The companion file `01-official-integration-paths.md` holds the full walkthrough. The table
below records the exact API names and the transport, as the task asked.

| #   | Exact name Mercado Pago uses                             | Transport                         | The call or the artifact                                                         | Label                   |
| --- | -------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| 1   | Orders API (current Point integration)                   | Cloud, HTTPS                      | `POST https://api.mercadopago.com/v1/orders`                                     | Documented fact         |
| 2   | Orders API, order query                                  | Cloud, HTTPS                      | `GET https://api.mercadopago.com/v1/orders/{order_id}`                           | Documented fact         |
| 3   | Orders API, refund                                       | Cloud, HTTPS                      | `POST https://api.mercadopago.com/v1/orders/{order_id}/refund`                   | Documented fact         |
| 4   | Terminal API, list                                       | Cloud, HTTPS                      | `GET https://api.mercadopago.com/terminals/v1/list`                              | Documented fact         |
| 5   | Terminal API, update operating mode                      | Cloud, HTTPS                      | `PATCH https://api.mercadopago.com/terminals/v1/setup`                           | Documented fact         |
| 6   | Stores API and Point of Sale API                         | Cloud, HTTPS                      | `POST .../users/{user_id}/stores` and `POST .../v2/pos`                          | Documented fact         |
| 7   | Point Integration API (legacy)                           | Cloud, HTTPS                      | `GET https://api.mercadopago.com/point/integration-api/devices`                  | Documented fact         |
| 8   | Payment Intents API (legacy)                             | Cloud, HTTPS                      | `POST .../point/integration-api/devices/{device_id}/payment-intents`             | Documented fact         |
| 9   | Orders notifications (webhooks)                          | Cloud, HTTPS                      | The `order.processed` family of events, signed with `x-signature`                | Documented fact         |
| 10  | SmartApps SDK, also named the Third-Apps Integration Kit | Local, on the terminal            | `nativesdk-<version>.aar` inside the Android app                                 | Documented fact         |
| 11  | Android Intent integration (legacy sample)               | Local, on the same Android device | Action `com.mercadopago.PAYMENT_ACTION`, target package `com.mercadopago.wallet` | Documented fact, legacy |

Sources for the table, all retrieved 2026-09-16 and all returning HTTP 200:

- [Point overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview.md)
- [Configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md)
- [Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md)
- [Legacy payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/payment-processing.md)
- [SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)
- [Legacy Android integration sample](https://github.com/mercadopago/point-android_integration)

Note on the legacy path. The sample app in `point-android_integration` sends an Android
Intent to the package `com.mercadopago.wallet` and listens for the broadcast
`com.mercadopago.merchant.PAYMENT_STATUS`. That repository has no push after 2022-05-12, and
the current documentation site does not list it. Treat the path as legacy. Marked
UNVERIFIED: whether a current production terminal still answers that Intent.

### Product names and where each one is sold

**Documented fact.** The Mexican store page lists `Point Smart 2`, `Point Air`, and
`Point Mini`. Source: [the Point store](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point)
(rung 1, HTTP 200).

**Documented fact.** The Brazilian store page also lists `Point Pro 3`. Source:
[the Brazilian Point store](https://www.mercadopago.com.br/ferramentas-para-vender/maquininhas-point)
(rung 1, HTTP 200).

**Documented fact.** The Point integration documentation names two supported integration
terminals, `Point Smart 1` and `Point Smart 2`. Source:
[Point overview](https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview.md)
(rung 1).

**Documented fact.** The SmartApp restrictions page names the two Point Smart hardware
variants by their OEM model code:

- "Point Smart A910 uses Android 6 - minimum API level: 23"
- "Point Smart N950 uses Android 12 - minimum API level: 31"

Source: [SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)
(rung 1).

## SDK and local-interface findings

This section is the part that the sibling files do not cover. It answers question 3.

### The SmartApps program

**Documented fact.** Mercado Pago runs a program named SmartApps. A SmartApp is a
company-owned Android application that runs on the Point Smart terminal itself. Source:
[SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)
(rung 1).

**Documented fact.** Mercado Pago documents two SmartApp types, read from the Spanish
landing page of the Brazilian portal:

| Type      | Technology                         | Operation model                                           |
| --------- | ---------------------------------- | --------------------------------------------------------- |
| Main Apps | Native Android                     | The app becomes the main interface of the terminal.       |
| Mini Apps | Native Android, Ionic, and Flutter | The user downloads the app from the terminal marketplace. |

Source: [Main Apps landing, Spanish](https://www.mercadopago.com.br/developers/es/docs/main-apps/landing)
(rung 1, HTTP 200). The table above is a translation of the page text.

**Source-backed tradeoff.** The English SmartApp overview page lists only Main Apps. The
Spanish landing page on the `.com.br` portal lists Main Apps and Mini Apps. Marked
UNVERIFIED: whether Mini Apps are available for Mexican accounts.

**Inference.** The Mini Apps row names Flutter. A Flutter POS app is therefore an allowed
technology for an on-device Mini App. The distribution is still closed, and Mercado Pago
approves each build.

### The kit and the SDK

**Documented fact.** Mercado Pago publishes two public GitHub repositories with the
integration kit:

- `https://github.com/mercadolibre/point-mainapp-demo-android` (created 2023-01-27)
- `https://github.com/mercadopago/point-smartapp-demo-android` (created 2026-06-30)

Rung 3. Both repositories return HTTP 200 on the GitHub API. Each one holds a demo app, a
kit release, and the SDK documentation archive.

**Documented fact.** The repositories commit the SDK binary itself. The tree of
`point-smartapp-demo-android` holds `app/libs/nativesdk-7.1.0.aar` and
`app/libs/nativesdk-7.2.0.aar`. The tree of `point-mainapp-demo-android` holds
`app/libs/nativesdk-7.0.0.aar`. Rung 3.

The documentation page also names the AAR. The `development-environment` page shows the
Gradle line `implementation files("libs/nativesdk-0.1.0.aar")`. Source:
[Configure development environment](https://www.mercadopago.com.mx/developers/en/docs/smartapps/development-environment.md)
(rung 1).

### What the AAR reveals about the local interface

Method: download `nativesdk-7.2.0.aar` from the public repository (HTTP 200, 731,917 bytes),
unzip it, and read its `AndroidManifest.xml` and its `classes.jar` strings. This is a
read-only inspection of a public binary.

**Documented fact, from the AAR manifest** (rung 3):

```xml
<uses-sdk android:minSdkVersion="23" />
<uses-permission android:name="com.mercadopago.android.isp_smart_mediator.provider.permission.READ_PROVIDER" />
<queries>
    <package android:name="com.mercadopago.smartpos" />
    <package android:name="com.mercadopago.android.isp_smart_mediator" />
    <provider android:authorities="com.mercadopago.smartpos.provider.integration" />
    <provider android:authorities="com.mercadopago.android.isp_smart_mediator.provider" />
</queries>
```

**Documented fact, from the AAR class strings** (rung 3). The SDK holds these URI literals:

```
content://com.mercadopago.android.isp_smart_mediator.provider
content://com.mercadopago.smartpos.provider.integration
content://com.mercadopago.smartpos.PREFFERENCE_AUTHORITY
```

**Inference.** The on-device interface between a third-party app and the Mercado Pago
payment services is an Android Content Provider, not an AIDL interface. The SDK holds a
custom read permission for that provider. The Android package names are
`com.mercadopago.smartpos` and `com.mercadopago.android.isp_smart_mediator`.

**Inference.** The search found no AIDL file and no native `.so` library inside the AAR. The
class list contains the names `MPManager`, `PaymentFlow`, `BluetoothUiSettings`,
`BitmapPrinter`, and `SmartInformationTools`. The provider is the transport.

**Documented fact.** The SDK class names appear in the public documentation as `MPManager`,
`MPConfigBuilder`, `PaymentFlow`, `PaymentsMethodsTools`, `PaymentStatus`,
`SmartInformationTools`, `BluetoothUiSettings`, `BluetoothIgnitor`, and `BitmapPrinter`.
Source:
[Integrate payment flow](https://www.mercadopago.com.mx/developers/en/docs/smartapps/integrate-payment-flow.md)
and
[Configure Bluetooth](https://www.mercadopago.com.mx/developers/en/docs/smartapps/terminal-features/configure-bluetooth.md)
(rung 1).

**Documented fact.** The SDK reads its configuration from `AndroidManifest.xml` metadata
names. The names must match exactly:

| Metadata name                                | Purpose                                     |
| -------------------------------------------- | ------------------------------------------- |
| `com.mercadolibre.android.sdk.CLIENT_ID`     | Required. Identifies the integration.       |
| `com.mercadolibre.android.sdk.OAUTH_ENABLED` | Optional or required, by integration model. |
| `com.mercadolibre.android.sdk.PLATFORM_ID`   | Optional or required.                       |
| `com.mercadolibre.android.sdk.INTEGRATOR_ID` | Available from SDK version 7.2.0.           |

Source: [Configure development environment](https://www.mercadopago.com.mx/developers/en/docs/smartapps/development-environment.md)
(rung 1).

### Deployment rules for a SmartApp

**Documented fact.** The deployment page states these rules (rung 1):

- The APK must be smaller than 50 MB.
- The APK must be signed with the same key every time, with Google signature schemes V1 and
  V2 where the platform version requires them.
- Mercado Pago reviews each APK against the restrictions page.
- The Mercado Pago team distributes the approved application to the terminals manually.

Source: [Deploy the SmartApp](https://www.mercadopago.com.mx/developers/en/docs/smartapps/deployment.md).

## Hardware and OEM findings

This section answers question 4. It gives the user the likely USB vendor IDs.

### Mercado Pago's own FCC filings

**Documented fact.** The FCC grantee code `2A5U9` belongs to Mercado Libre SRL, Caseros
3039, Ciudad Autonoma de Buenos Aires, Argentina, registered 2022-03-22. The grantee holds
four filings:

| FCC ID        | Product purpose | Application date |
| ------------- | --------------- | ---------------- |
| `2A5U9-MP100` | Mobile POS      | 2022-07-19       |
| `2A5U9-MP110` | Point GO        | 2022-07-20       |
| `2A5U9-MP200` | Mobile POS      | 2022-10-18       |
| `2A5U9-MP300` | Mobile POS      | 2022-07-19       |

Source: [FCC grantee 2A5U9](https://fccid.io/2A5U9) (rung 1 for the filing, mirrored by
rung 7 practice; HTTP 200).

**Documented fact.** The filing `2A5U9-MP100` lists only the frequencies 13.56 MHz and
2402-2480 MHz. That set is NFC plus Bluetooth. The filing `2A5U9-MP300` adds the cellular
and Wi-Fi bands 824.2-848.8 MHz and 2412-2462 MHz. Sources:
[2A5U9-MP100](https://fccid.io/2A5U9MP100) and
[2A5U9-MP300](https://fccid.io/2A5U9MP300).

**Inference.** The MP100/MP110/MP200/MP300 family is a Mercado Pago in-house design line.
The test firm is TA Technology (Shanghai), and the filing names the domain
`tashanghai.com`. The manufacturer is a Shanghai ODM. Mercado Pago, not a payment terminal
brand, is the applicant.

### The PAX A910

**Documented fact.** The FCC ID `V5PA910` belongs to PAX Technology Limited, equipment class
"Smart Mobile Payment Terminal", product code `A910`, latest filing 2019-06-24. Source:
[FCC ID V5PA910](https://fccid.io/V5PA910) (rung 1 filing, rung 3 mirror; HTTP 200).

**Documented fact.** The Brazilian sister model `V5PA910S` (product code `A910S`) has a
later filing, 2023-08-02. Source: [FCC search for PAX A910](https://fccid.io/search.php?q=PAX+A910)
(HTTP 200).

**Documented fact.** The Mercado Pago documentation uses `PAX_A910` as a device-type prefix.
The legacy device list returns ids such as `PAX_A910__SMARTPOS1234345545`. Source:
[Legacy payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/payment-processing.md)
(rung 1).

**Documented fact.** A public teardown of the Point Smart A910, dated 2023-02-08, reports
the following parts: a Spreadtrum SC9832A quad-core Cortex-A7 SoC, an MH1902T Megahunt
secure element, 8 Gbit LPDDR, a KLM8G1GETF 8 GB eMMC, a YC1021 Bluetooth and BLE radio, an
FM17550 13.56 MHz contactless front end, a thermal printer, a three-track magnetic stripe
reader, and a USB-C connector. The author writes: "Por los textos en el PCB, parece ser un
posnet PAX A910 con un rebranding a Mercadopago." Source:
[Desarme de Point Smart A910](https://martinnievas.github.io/myblog/2023-02-08-point-smart/)
(rung 4; HTTP 200).

**Inference.** The Point Smart 1 is a rebranded PAX A910. The USB connector on that device is
a charging and service port. This agrees with the Mercado Pago statement that only the
development unit has the USB port and the debug configuration enabled.

### The Newland N950

**Documented fact.** The Mercado Pago create-order reference uses the terminal id
`NEWLAND_N950__N950NCB801293324`. Source:
[Payment processing](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md)
(rung 1).

**Documented fact.** The SmartApp restrictions page names `Point Smart N950` with Android 12
and minimum API level 31. Source:
[SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)
(rung 1).

**Documented fact.** The FCC grantee `2AM6U` belongs to Fujian Newland Payment Technology
Co., Ltd. The filing `2AM6U-NA950` is a "POS Terminal", applied 2023-06-14, with Bluetooth,
NFC, a 670.5-690.5 MHz band, and 5180-5240 MHz. Source:
[FCC ID 2AM6U-NA950](https://fccid.io/2AM6UNA950) (HTTP 200).

**Inference.** `N950` is the Mercado Pago name and `NA950` is the Newland FCC product code
for the same terminal family. The exact mapping of `N950` to `NA950` is UNVERIFIED.

**Community evidence.** A public reverse-engineering knowledge base describes the terminal
"Newland N950 / MercadoPago Point Smart 2". It reports a Qualcomm QCM2290 SoC (codename
`scuba`, Bengal family), 4 GB LPDDR, 64 GB eMMC, stock Android 12, a UEFI/EDK2 bootloader,
and active Secure Boot. Source:
[n950-research](https://github.com/mercurioctrl/obsidian-hermess/blob/main/n950-research/n950-research.md)
(rung 5; HTTP 200). Marked as community evidence. The SoC claim is UNVERIFIED by a vendor
source.

**Source-backed tradeoff.** Newland publishes the N950 as a product line. The FCC filing
confirms the grantee and the equipment class. The exact Mercado Pago model name to Newland
model name mapping is not published by either party.

### Summary for the USB vendor ID

| Terminal              | Likely OEM                  | FCC ID                       | What the host may see                            |
| --------------------- | --------------------------- | ---------------------------- | ------------------------------------------------ |
| Point Smart 1         | PAX A910                    | `V5PA910`                    | PAX vendor id, or a Google id in fastboot mode.  |
| Point Smart 2         | Newland N950                | `2AM6U-NA950`                | Newland vendor id, or `0x18D1` in fastboot mode. |
| Point Mini, Point Air | Mercado Libre in-house line | `2A5U9-MP1xx`, `2A5U9-MP3xx` | Unknown. No USB mode reported.                   |

**Inference.** The vendor id in the Linux `lsusb` output is the fastest way to identify the
user's model. A PAX id points to the A910. A Newland id points to the N950.

## USB, ADB, and network-mode evidence

This section answers question 5.

### What Mercado Pago states

**Documented fact.** Only the development terminal has the USB port enabled. "Unlike
production devices, development devices have the USB port enabled by default and debugging
configuration activated." Source:
[SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)
(rung 1).

**Documented fact.** The kit instructions install the sandbox APK with `adb`:
`adb install <file>`. Source:
[Configure development environment](https://www.mercadopago.com.mx/developers/en/docs/smartapps/development-environment.md)
(rung 1).

**Documented fact.** The restrictions page prohibits these items inside a SmartApp:

- "Use of the USB port for information transmission."
- `android.permission.USB_PERMISSION`
- `android.permission.USB_SET`
- the `BLUETOOTH*` permission family

Source: [SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)
(rung 1).

**Inference.** ADB is an Android debugging channel for application deployment on a
development unit. It is not a payment protocol. Mercado Pago does not document it as an
integration path.

### What the community reports

**Community evidence.** The measure below comes from a reverse-engineering session on a
Point Smart 2 (Newland N950) in fastboot mode. Rung 5.

| Item                                      | Reported value                                                  |
| ----------------------------------------- | --------------------------------------------------------------- |
| USB vendor id : product id                | `0x18D1 : 0xD00D`                                               |
| `bcdUSB` / `bcdDevice`                    | `0x0210` / `0x0100`                                             |
| Interface 0.0 class / subclass / protocol | `0xFF` / `0x42` / `0x03` (Google fastboot)                      |
| Interface string                          | `fastboot`                                                      |
| Endpoints                                 | `ep 0x81` IN bulk 512 B, `ep 0x01` OUT bulk 512 B               |
| Device strings                            | `Google`, `Android`, `ncd100037318`, `fastboot`                 |
| MS OS string descriptor (`0xEE`)          | Not present                                                     |
| BOS descriptor                            | Present, Qualcomm boilerplate                                   |
| Service interfaces                        | None. No Sahara, Firehose, Diag, DM, or NMEA interface exposed. |

Source:
[Commands tested, USB descriptor section](https://github.com/mercurioctrl/obsidian-hermess/blob/main/n950-research/comandos-probados.md)
(HTTP 200). Label: community evidence. The descriptors are UNVERIFIED against an official
source. A local capture on the user's own device will settle it.

**Community evidence.** The same knowledge base reports "USB cliente disabled en runtime -
no se puede meter ADB". In plain terms: after the device boots Android, the USB client does
not enumerate. Neither fastboot nor ADB is then available. Source:
[n950-research, architecture notes](https://github.com/mercurioctrl/obsidian-hermess/blob/main/n950-research/arquitectura.md)
(HTTP 200). Label: community evidence, UNVERIFIED.

**Documented fact.** A public GitHub issue records a real attempt. The reporter writes: "Im
running `adb` but it can't recognize the Smart Point 2 connected to it the computer". The
same report notes that the sales contact did not know how to obtain a development unit.
Source:
[issue 84](https://github.com/mercadolibre/point-mainapp-demo-android/issues/84)
(open since 2025-11-15, HTTP 200, rung 3).

**Inference.** A production Point Smart 2 does not present a usable ADB interface over USB.
This agrees with the Mercado Pago restriction and with the community capture.

### What was not found

| Mode                                    | Result                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| USB HID                                 | Not found for any Point model.                                      |
| USB CDC-ACM, a virtual serial port      | Not found for any Point model.                                      |
| USB RNDIS or CDC-ECM, a network device  | Not found for any Point model.                                      |
| ADB on a production unit                | Not found. One public report says the terminal is invisible to ADB. |
| Vendor USB protocol documentation       | Not found.                                                          |
| Bluetooth serial protocol documentation | Not found. Bluetooth is a SmartApp feature that drives peripherals. |
| Network mode over USB from a host POS   | Not applicable. The POS talks to the cloud, not to the device.      |

**Documented fact.** On a Point Smart terminal, the SmartApp uses the terminal Bluetooth
radio to pair a keyboard, a printer, or a barcode scanner. Mercado Pago exposes this through
the SDK classes `BluetoothUiSettings` and `BluetoothIgnitor`. Source:
[Configure Bluetooth](https://www.mercadopago.com.mx/developers/en/docs/smartapps/terminal-features/configure-bluetooth.md)
(rung 1). This is the terminal acting as a Bluetooth host. It is not a Bluetooth service
that an external POS can drive.

**Documented fact.** Point Mini uses Bluetooth to connect to a telephone. Source: the Point
store page above (rung 1). The paired application is the Mercado Pago phone app. No public
protocol describes that link.

### A related field of prior art

**Documented fact.** PAX Android terminals run an operating system named PayDroid. Security
advisories for PAX models A920, A930, A50, and A920 Pro describe actions that "require
physical USB access to the device". Source:
[PayDroid advisories, as indexed by CVE references](https://wr3nchsr.github.io/pax-paydroid-vulnerabilities-advisory-2022/)
(rung 5, found through GitHub code search for `paydroid`).

**Inference.** Some PAX Android terminals expose a USB service interface on some firmware.
This does not prove the same for a Mercado Pago Point unit. A Point unit runs Mercado Pago
firmware under a different configuration, and Mercado Pago states that the production unit
has the USB port disabled.

**Documented fact.** A conference talk exists on this topic: "Exploring and Exploiting an
Android 'Smart POS' Payment Terminal", published 2025-06-01. Source:
[the talk](https://www.youtube.com/watch?v=a9BFGlxP71Y), found through the Hacker News
Algolia API (rung 5). The transcript was not read. `yt-dlp` is not installed on this
workstation. Marked UNVERIFIED.

## Certification and ToS constraints

This section answers question 6. It gives the exact words from the Mercado Pago pages.

**Documented fact, quote 1.** "Functionalities associated with the payment flow (such as
card reading and processing, receipt printing, _Bluetooth_ usage, and camera access for
barcode or QR code scanning) must be invoked exclusively through the Mercado Pago SDK and
not through direct use of permissions declared in the _AndroidManifest_ file." Source:
[SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md)
(rung 1).

**Documented fact, quote 2.** Under "Other restrictions", the list includes: "Use of the
_USB_ port for information transmission." Source: the same page (rung 1).

**Documented fact, quote 3.** Under "AndroidManifest Permissions", the not-allowed list
includes `android.permission.USB_PERMISSION` and `android.permission.USB_SET`, plus every
`android.permission.BLUETOOTH*` entry. Source: the same page (rung 1).

**Documented fact, quote 4.** "Before creating your application or starting any technical
setup, contact Mercado Pago's Business team. The SmartApp integration and approval process
can only begin after this formal contact." Source:
[SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md)
(rung 1).

**Documented fact, quote 5.** "To get one of these devices, you need to contact the account's
commercial advisor." The sentence is about the development terminal. Source: the same page
(rung 1).

**Documented fact, quote 6.** The restrictions page also prohibits third-party libraries
with these prefixes: `br.com.uol.pagseguro.*`, `cielo.lio.permission.*`, `com.getnet.*`,
`com.pax.*`, and `com.sunmi.*`. Source: the same page (rung 1).

**Documented fact.** Every SmartApp goes through a Mercado Pago review, then manual
distribution by the Mercado Pago team. Source:
[Deploy the SmartApp](https://www.mercadopago.com.mx/developers/en/docs/smartapps/deployment.md)
(rung 1).

**Inference.** The answer to the question in the task is: Mercado Pago requires its own
distribution path. On the terminal, the application must run inside the SmartApp model, and
it must use the Mercado Pago SDK. Direct device access from a host computer is not an
offered path. The cloud Orders API is the other offered path, and it needs no device access
at all.

**UNVERIFIED.** The general Mercado Pago Developers terms of use could not be read. The
pages `/developers/en/terms`, `/developers/es/terms`, and `/developers/es/terminos-y-condiciones`
all returned the same JavaScript shell of 2.87 MB, with no readable terms text. The Wayback
Machine held no snapshot of that path on the test day. This file therefore does not quote a
general clause about reverse engineering. The restriction quotes above come from the
SmartApp documentation, which returned readable Markdown.

**Inference with a caution.** The SmartApp rules are the terms for on-device applications.
They forbid the use of the USB port for information transmission. A plan to read the USB
channel of a production terminal for integration therefore contradicts the published rules.
Reading the bus for diagnosis is a different activity, and its legal position is
UNVERIFIED.

## Failed source attempts

Each row records the URL, the observed status, and the fallback that followed.

| Source attempt                                                              | Observed result                                                                                             | Fallback used                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `https://apps.fcc.gov/oetcf/eas/reports/GenericSearchResult.cfm?...`        | HTTP 403, "Access Denied"                                                                                   | `fccid.io` search and grantee pages               |
| `https://fccid.io/2ANDUN950`                                                | HTTP 300, "No exact FCC ID was found"                                                                       | Searched grantee `2AM6U`, then read `2AM6U-NA950` |
| `https://www.bing.com/search?q=...&format=rss`                              | HTTP 200, but the results were unrelated to the query                                                       | Bing HTML, then GitHub search                     |
| `https://www.bing.com/search?q=...` (HTML)                                  | HTTP 200, 10 results per query, all irrelevant                                                              | GitHub CLI and Stack Exchange API                 |
| `https://html.duckduckgo.com/html/?q=...`                                   | HTTP 202, challenge page                                                                                    | Bing HTML                                         |
| `https://lite.duckduckgo.com/lite/?q=...`                                   | HTTP 202, challenge page                                                                                    | Bing HTML                                         |
| `https://www.mojeek.com/search?q=...`                                       | HTTP 200, 5,516 bytes, no result list                                                                       | GitHub search                                     |
| `https://search.marginalia.nu/search?query=...`                             | HTTP 302 redirect                                                                                           | GitHub search                                     |
| `https://www.reddit.com/r/MercadoLibre/search.rss?q=point%20smart`          | HTTP 200, 834 bytes, zero entries                                                                           | Bing HTML                                         |
| `https://www.reddit.com/r/argentina/search.rss?q=point%20smart%20usb`       | HTTP 429, rate limited                                                                                      | Stopped Reddit calls                              |
| Stack Exchange API, `q=mercadopago point`                                   | HTTP 200, no relevant question                                                                              | GitHub issues                                     |
| Stack Exchange API, `q=point smart terminal`                                | HTTP 200, no relevant question                                                                              | GitHub issues                                     |
| `https://www.mercadopago.com.mx/developers/en/terms`                        | HTTP 200, JavaScript shell only, 2.87 MB                                                                    | Wayback Machine                                   |
| `https://www.mercadopago.com.mx/developers/es/terminos-y-condiciones`       | HTTP 200, identical shell, 2.87 MB                                                                          | Wayback Machine                                   |
| Wayback CDX for `mercadopago.com.mx/developers/en/terms`                    | HTTP 200, empty result list                                                                                 | Marked the terms UNVERIFIED                       |
| `https://web.archive.org/web/2025id_/.../developers/en/terms`               | HTTP 404 from the Wayback Machine                                                                           | Marked the terms UNVERIFIED                       |
| `https://www.mercadopago.com.mx/developers/en/docs/main-apps/landing.md`    | HTTP 404                                                                                                    | Used the `.com.br` Spanish landing page, HTTP 200 |
| `https://www.mercadopago.com.mx/ayuda/terminos-y-condiciones-de-point_2835` | HTTP 404                                                                                                    | Read the developer restrictions page instead      |
| `https://www.mercadopago.com.mx/ayuda/2595`                                 | HTTP 200, 95,747 bytes, JavaScript shell, no readable text                                                  | Stopped; help centre content UNVERIFIED           |
| `https://github.com/Charbelbenz/MercadoPoint`                               | Repository exists, description "Jailbreak de PAX A910 RD6-13EG", but the tree and the branch list are empty | No evidence could be taken from it                |
| `yt-dlp` for the Smart POS talk                                             | Tool not installed on this workstation                                                                      | Transcript UNVERIFIED                             |

Blocked pages that were recovered:

- The whole Mercado Pago documentation portal was recovered through `llms.txt` and the
  `.md` suffix. Every documentation page used in this file loaded as plain Markdown.
- The FCC search form was blocked, and the `fccid.io` mirror answered every filing lookup.
- The `.com.mx` main-apps page was missing, and the `.com.br` portal served the Spanish
  version.

## Open questions

1. **Which model does the user own?** The USB behavior differs between the A910 generation
   and the N950 generation. A single `lsusb` call answers this, because the vendor id maps to
   PAX, to Newland, or to neither.
2. **Does a production A910 expose ADB, unlike the N950?** The community evidence covers the
   N950 only. The A910 evidence covers fastboot and hardware access, not runtime ADB.
   UNVERIFIED.
3. **Can the `isp_smart_mediator` provider answer a caller that is not an approved SmartApp?**
   The provider holds a custom read permission. Whether Mercado Pago grants that permission
   outside the approved kit is UNVERIFIED.
4. **Does Mercado Pago issue development terminals in Mexico?** The public issue describes a
   failed attempt in Brazil. The Mexican process is UNVERIFIED.
5. **Are Mini Apps, and therefore Flutter, available to Mexican accounts?** The Spanish
   landing page lists Flutter for Mini Apps. The English SmartApp page does not list Mini
   Apps. UNVERIFIED for Mexico.
6. **What do the general developer terms say?** The page is JavaScript-only, and the Wayback
   Machine held no copy. UNVERIFIED.
7. **Which device is the `2A5U9-MP2xx` line?** The FCC filings show four in-house models. The
   commercial names are not mapped in public. The MP110 filing does carry the name
   "Point GO".
8. **Does the terminal accept a USB connection in any service mode that a merchant can
   reach?** Community work required test points and hardware tools. No merchant-reachable
   path was found.

## Sources

Primary vendor documentation, all retrieved 2026-09-16 with HTTP 200:

- Documentation index, machine readable:
  `https://www.mercadopago.com.mx/developers/es/docs/llms.txt`
  `https://www.mercadopago.com.mx/developers/en/docs/llms.txt`
  `https://www.mercadopago.com.br/developers/pt/docs/llms.txt`
  `https://www.mercadopago.com.ar/developers/es/docs/llms.txt`
- `https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview.md`
- `https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md`
- `https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md`
- `https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-printings.md`
- `https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/overview.md`
- `https://www.mercadopago.com.mx/developers/en/docs/mp-point-legacy/integration-configuration/integrate-with-pdv/payment-processing.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/development-environment.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/integrate-payment-flow.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/deployment.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/terminal-features/configure-bluetooth.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/terminal-features/configure-printings.md`
- `https://www.mercadopago.com.mx/developers/en/docs/smartapps/terminal-features/get-terminal-information.md`
- `https://www.mercadopago.com.br/developers/es/docs/main-apps/landing`
- `https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point`
- `https://www.mercadopago.com.br/ferramentas-para-vender/maquininhas-point`

Source code and issues (rung 3):

- `https://github.com/mercadolibre/point-mainapp-demo-android`
- `https://github.com/mercadolibre/point-mainapp-demo-android/issues/84`
- `https://github.com/mercadopago/point-smartapp-demo-android`
- `https://github.com/mercadopago/point-android_integration`
- `https://github.com/mercadopago/point-smartapp-demo-android/blob/master/app/libs/nativesdk-7.2.0.aar`
- `https://github.com/mercadopago/point-smartapp-demo-android/blob/master/app/src/main/AndroidManifest.xml`
- `https://api.github.com/orgs/mercadopago/repos`

Hardware and regulatory sources (rung 1 filings, rung 5 to 7 practice):

- `https://fccid.io/V5PA910`
- `https://fccid.io/2A5U9`
- `https://fccid.io/2A5U9MP100`
- `https://fccid.io/2A5U9MP300`
- `https://fccid.io/2AM6UNA950`
- `https://fccid.io/search.php?q=PAX+A910`
- `https://martinnievas.github.io/myblog/2023-02-08-point-smart/`

Community and practitioner sources (rung 4 and 5):

- `https://github.com/mercurioctrl/obsidian-hermess/blob/main/n950-research/n950-research.md`
- `https://github.com/mercurioctrl/obsidian-hermess/blob/main/n950-research/arquitectura.md`
- `https://github.com/mercurioctrl/obsidian-hermess/blob/main/n950-research/comandos-probados.md`
- `https://wr3nchsr.github.io/pax-paydroid-vulnerabilities-advisory-2022/`
- `https://www.youtube.com/watch?v=a9BFGlxP71Y`

Internal references:

- `/home/jc/umi/docs/research/2026-09-16-mexico-payments-and-fiscal.md` section 2
- `/home/jc/umi/docs/research/2026-09-16-mercadopago-point-usb/01-official-integration-paths.md`
- `/home/jc/umi/docs/research/2026-09-16-mercadopago-point-usb/02-usb-observation-procedure.md`

## Before you finish, the doctrine checklist

| Check                                                 | Answer                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Did you name the tool?                                | Yes. `llms.txt` plus the `.md` suffix on a documentation URL, `gh` 2.45.0, and `fccid.io`.                       |
| Did you record the version and the source?            | Yes. The tool table above, with versions and the source of each recommendation.                                  |
| Did you try at least two routes for a blocked source? | Yes. The failed-attempts table holds two or more routes for the FCC form, the terms pages, and the Reddit feeds. |
| Did you mark the unverified claims?                   | Yes. Every community claim and every unread page carries the UNVERIFIED marker.                                  |
| Did you avoid hand-rolling what a tool already does?  | Yes. No scraper was built. The vendor index and the CLI tools did the work.                                      |
| Did the research land in a file?                      | Yes. This file.                                                                                                  |
