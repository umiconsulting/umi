# Prior art: driving a payment terminal from a POS host over USB, serial, or Bluetooth

Date: 2026-09-16
Part: 03 of the MercadoPago Point USB research set.
Sibling files: `01-official-integration-paths.md`, `02-usb-observation-procedure.md`,
`04-mercadopago-point-integration-surface.md`.

## Scope

This file answers one question. Which payment-terminal vendors publish a LOCAL, host-side
integration route that a Linux POS can use?

The target is the Flutter POS at `apps/umi-pos`. That app must eventually integrate a MercadoPago
Point terminal over USB.

In scope:

- Host-side SDKs that a POS application links.
- Local transports: USB, serial (RS-232 or virtual COM), and Bluetooth.
- Open protocols and published standards for the host-to-terminal link.
- PCI SSC and EMVCo rules that constrain that link.
- Public prior art, including open-source projects, for Bluetooth and serial control of a terminal.

Out of scope, except for contrast:

- Cloud-only payment APIs. These are recorded only to say "that is not a local route".
- On-terminal application development. It is recorded only where the product name collides with a
  host-side SDK name.

This file deliberately does not repeat the MercadoPago depth. Another agent covers that in
`01-official-integration-paths.md` and `04-mercadopago-point-integration-surface.md`.

## Method and Tools

Research day: 2026-09-16. Workstation: Umi (`/home/jc`), Pop!_OS 24.04, kernel 6.17.

### Tools used, with the reason

| Task                               | Tool                                                        | Version | Why this tool                                                                                     |
| ---------------------------------- | ----------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Read a vendor doc page             | `curl`                                                      | 8.5.0   | The playbook tested this client from this workstation. No login is needed.                        |
| Read a JavaScript-heavy doc portal | the portal's own Markdown twin (`.md` suffix) or `llms.txt` | n/a     | `curl` gets an empty shell from these portals. Verifone and Stone both publish a Markdown index.  |
| Search GitHub                      | `gh` CLI                                                    | 2.45.0  | Authenticated as `umi-juanlopez`. Anonymous search is rate-limited to 10 search calls per minute. |
| Read a public PDF                  | `pdftotext`                                                 | poppler | The PCI PTS POI requirements are a PDF. Text extraction makes the requirement quotable.           |
| Read a dead page                   | Wayback Machine CDX index plus `id_` replay                 | n/a     | The Ingenico POSgate developer page survives only in the archive.                                 |
| Parse JSON responses               | `jq`                                                        | 1.7     | Used for the WordPress REST API of PCI SSC and for GitHub API output.                             |
| Extract readable text from HTML    | `python3` plus a regular expression                         | 3.12.3  | Small local helper. No dependency install was needed.                                             |

Every `curl` call sent this header, as the playbook requires:

`User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36`

### Research ladder

Rung numbers in this file use the doctrine's ladder.

| Rung | Source type                                 |
| ---- | ------------------------------------------- |
| 1    | Vendor documentation and API reference      |
| 2    | Changelog, release notes, status page       |
| 3    | Repository, issues, file trees              |
| 4    | Practitioner writing                        |
| 5    | Communities                                 |
| 6    | Social                                      |
| 7    | Primary research, specifications, standards |

### Evidence labels

| Label                  | Meaning                                           |
| ---------------------- | ------------------------------------------------- |
| Documented fact        | A source owns the claim. The URL is in this file. |
| Source-backed tradeoff | Two sources disagree, or a source states a cost.  |
| Inference              | The author reasoned from the facts.               |
| UNVERIFIED             | The claim was not confirmed on this workstation.  |

### Search channels that worked, and channels that did not

Working channels: direct `curl` on vendor sites, the vendor Markdown indexes (`llms.txt`), the PCI
SSC WordPress REST API, the GitHub API through `gh`, and the Wayback Machine CDX index.

Broken channels: Bing RSS returned unrelated results for every query (3 attempts, HTTP 200).
DuckDuckGo returned a bot challenge on both the HTML and the lite endpoints (HTTP 202). The
Wayback Machine replay host returned "Temporarily Offline" for part of the session. `iso.org`
returned a Cloudflare challenge (HTTP 403). `docs.cloud.ingenico.com` and
`developer.verifone.com` did not resolve by DNS. Details are in "Failed source attempts".

## Vendor SDK matrix

Legend: **[D]** documented fact, **[T]** source-backed tradeoff, **[I]** inference.
USB device class (CDC-ACM, HID, or vendor class) and Bluetooth profile (SPP or BLE) are
**UNVERIFIED** for every vendor. That detail sits behind every vendor gate.

| Vendor              | Host-side SDK                                                                     | Host OS and language                                                           | Documented local transports                                                                  | Access                                            | Rung                                |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| Ingenico            | "Developer Program - SDK packages"; legacy **POSgate** middleware                 | iOS, Android, Windows; Xcode, Android Studio, Eclipse, Visual Studio, Netbeans | IP, Wi-Fi, Bluetooth, 4G; **USB, Serial, Ethernet**                                          | Registration plus T&Cs                            | 1 (POSgate page via rung 1 archive) |
| Verifone            | **PSDK** (semi-integrated), **CAM-XPI** (host-driven), **PSDK-SDI** (on-terminal) | PSDK: Android, iOS, Windows, **Linux**. SDI: Kotlin and Swift                  | XPI: **RS232, USB, Wi-Fi, Ethernet, Bluetooth, WebSocket**; port 12345; serial 8n1 at 115200 | Public doc index; detail behind login             | 1                                   |
| PAX                 | **POSLink** (Core, Semi, Admin modules; `POSLink.dll`)                            | Android/Java (`com.pax.poslink`), Windows/.NET                                 | TCP-IP, **USB**, AIDL, serial; Bluetooth in the Android wrapper                              | Registration with an NDA step; no public download | 1, 3                                |
| Newland             | Newland NPT names **NPSC SDK Toolkit** and **NAPI / NSDK**                        | UNVERIFIED                                                                     | UNVERIFIED for payments                                                                      | Partner-gated (affiliate or strategic tier)       | 1                                   |
| Castles Technology  | Not found on the vendor site                                                      | UNVERIFIED                                                                     | UNVERIFIED                                                                                   | No public developer page found                    | 1 (negative result)                 |
| Stone               | **SDK Android** (`BluetoothConnectionProvider` for a Bluetooth pinpad)            | Android (Java/Kotlin)                                                          | **Bluetooth pinpad**, POS Android                                                            | Docs public; partnership required for the SDK     | 1                                   |
| PagSeguro (PagBank) | **PlugPag**; legacy 1.x has a **Linux** and a **Raspberry** build                 | Android, iOS, Windows, **Linux/Raspberry** (1.x); Android only (4.x)           | **Bluetooth serial** (`btserial`) exposed as a virtual COM port                              | Public GitHub repository                          | 3                                   |
| MercadoPago Point   | No host-side terminal SDK for a third party                                       | n/a                                                                            | No documented USB, serial, or Bluetooth payment link                                         | Cloud API only; see part 01                       | 1                                   |

### Ingenico (TETRA / Telium, and AXIUM / Tetra Android terminals)

**[D] rung 1** - Ingenico publishes a Developer Program. The live page
`https://ingenico.com/en/developers` lists "Payment APIs", "Terminal management APIs", and "SDK
packages". It also offers "Technical Docs & Guides" with "API and SDK specs".

**[D] rung 1 via the Wayback Machine** - the archived POSgate page is the only Ingenico-owned page
that states a full transport matrix. It publishes "Communications Options: IP, WiFi, Bluetooth
(refer to supported iOS devices), 4G" and "Connectivity Options: USB, Serial, WiFi, Ethernet".
Source:
`https://web.archive.org/web/20230925174728id_/https://ingenico.com/apac/products-services/services/pos-middleware/developers`

**[D] rung 1** - the same archive shows the host toolchain list: Xcode, Android Studio, Eclipse,
Visual Studio, Netbeans, for iOS, Android, and Windows.

**UNVERIFIED** - no Linux host library for Ingenico was found. No page states the USB device class.
The Bluetooth line itself carries a vendor hedge ("refer to supported iOS devices"), so the
Bluetooth path is device-dependent.

**[D] rung 1** - there is no official Ingenico GitHub organisation. `gh api orgs/Ingenico` returns
HTTP 404.

### Verifone (Verix / VOS, and Engage / Android)

**[D] rung 1** - `https://docs.verifone.com/xpi/xpi-getting-started.md` is the strongest single
source in this whole review. It states: "CAM-XPI lets your host application control Verifone PIN
pads and payment devices." It also states: "The host starts every action. The device stays in
receiving mode and responds to commands."

**[D] rung 1** - the same page publishes the transport list: "XPI supports RS232, USB, WiFi,
Ethernet, Bluetooth, and WebSocket." It publishes the defaults too: port `12345` for IP and
WebSocket, and `8n1` at `115200` for Engage and UX serial communication. Framing uses STX, ETX, and
LRC, controlled by the `SAPF` parameter.

**[D] rung 1** - `https://docs.verifone.com/psdk/readme.md` states that the semi-integrated PSDK
covers "4 merchant platforms (Android, iOS, Windows, Linux)". Linux is therefore a named target for
the Verifone host SDK.

**[D] rung 1** - `https://docs.verifone.com/llms.txt` is public. It is a 3317-line Markdown index of
the whole Verifone documentation set. Any page is readable as Markdown by appending `.md` to the URL.

**[D] rung 1** - the detailed material is gated. The pages repeat this sentence: "Please login or
register to gain access to the detailed material on this page."

**UNVERIFIED** - the USB device class and the Bluetooth profile are not stated on any public page.
No NDA is quoted on any page that was reachable. Treat "NDA required" for Verifone as UNVERIFIED.

### PAX Technology (NeptuneLite and Android terminals)

**[D] rung 1** - `https://www.pax.us/support/developer-portal/` offers "Register Now or Sign In".
The page carries no SDK download link.

**[D] rung 1 and 3** - `https://developer.pax.us/` is a JavaScript single-page app. Its own route
table, read from `https://developer.pax.us/js/index.ffa6c954.js`, contains `/login`,
`/isvs/registration`, `/isvs/agreements`, `/nda`, `/eula`, and `/api/v1`.

**[I]** - the `/nda` route is evidence that a non-disclosure step sits in the registration flow. No
fetched page states that the NDA is mandatory before download.

**[D] rung 3** - POSLink ships as Android modules and as a Windows .NET assembly. Real integration
code calls `CommSetting.setType(...)` with `CommSetting.TCP`, `CommSetting.USB`, and
`CommSetting.AIDL`. Source:
`https://github.com/multipos-app/pos/blob/main/android/app/src/main/java/cloud/multipos/pos/devices/PaxPayment.kt`

**[D] rung 3** - the Windows `POSLink.CommSetting` object exposes `DestIP`, `DestPort`,
`SerialPort`, `CommType`, `BaudRate`, and `TimeOut`. So Windows POSLink documents TCP/IP and a
serial port. Source:
`https://github.com/syedMohib44/SuperGiz/blob/master/SupergizWinApp/Services/CommSetting_Service.cs`

**[T] rung 3** - the public POSLink binaries that were found live in third-party repos
(`rotenderco/react-native-poslink`, `OsparkSolutions/expo-pax-poslink`, `multipos-app/pos`). Those
redistributions carry the SDK without a visible licence grant from PAX.

**UNVERIFIED** - no Linux library and no iOS framework for POSLink was confirmed. No page states the
USB device class or the Bluetooth profile.

### Newland (NPT and the "NQuire" name)

**[D] rung 1** - "NQuire" is not an SDK. It is the AIDC division's Android touch-panel-computer
family. The product URLs on `https://www.newland-id.com/` are `nquire-1000-manta-iii`,
`nquire-500-skate-ii`, `nquire-10-trygon`, and similar, all under
`/en/products/touch-panel-computers/`. The "NQuire SDK" in the original question is a name mismatch.

**[D] rung 1** - the payment division is Newland NPT. `https://www.newlandnpt.com/support.html`
names "NPSC SDK Toolkit" and, under Retailer, "NAPI / NSDK". The page carries no hyperlink for any
of those names.

**[D] rung 1** - the only public Newland SDK downloads are for barcode scanners.
`https://www.newland-id.com/en/support/software-drivers/` publishes a Windows SDK, an Android SDK,
and a **Linux SDK** for scanners. None of these is a payment-terminal host SDK.

**[D] rung 1** - `https://www.newland-id.com/en/partners/isv-partner-program/` states that
"Affiliate Partners Gain access to SDKs, APIs, technical documentation". The payment SDKs are
therefore partner-gated.

**UNVERIFIED** - no public Newland page states the host link for a payment terminal: not USB class,
not serial, not Bluetooth, not Ethernet.

### Castles Technology

**[D] rung 1, negative result** - `https://www.castlestech.com/` is live (HTTP 200). Its
`page-sitemap.xml` and `resources-sitemap.xml` expose only product, solution, and logo pages. The
site exposes no developer portal, no SDK download page, and no API reference.

**[D] rung 1** - the product sitemap shows Android and Linux terminal families
(`/product-types/android/`, `/product-types/linux/`) and named models such as `s1f4ct`, `s1p2-plus`,
and `s1u2-m3f`. A Linux terminal is not the same thing as a Linux host SDK.

**UNVERIFIED** - Castles publishes no public host-side SDK that this review could find. Castles
appears in the market as an OEM terminal vendor, so the integration path would be expected through
the acquirer or the terminal's software owner. That expectation is **[I]**, not a documented fact.

### Stone (Stone Pagamentos, Brazil)

**[D] rung 1** - `https://www.stone.com.br/devcenter` is the developer entry point. It advertises
"APIs e SDKs para construir seus produtos" and names "SDK Android" plus "Pinpad Bluetooth (leitor
de cartões mobile)".

**[D] rung 1** - `https://sdkandroid.stone.com.br/llms.txt` is a public Markdown index. It lists
"Provider de Conexão com Pinpad Bluetooth".

**[D] rung 1** - the Bluetooth page is precise. It states that the SDK performs the pinpad
connection through a `BluetoothConnectionProvider`. The host lists paired devices with the Android
call `BluetoothAdapter.getBondedDevices()`. Source:
`https://sdkandroid.stone.com.br/reference/provedor-conexao-pinpad-bluetooth.md`

**[D] rung 1** - the docs may be public, but the SDK is not free to use. The portal carries the call
to action "Quero ser parceiro Stone!" (I want to be a Stone partner).

**UNVERIFIED** - the host in the documented flow is Android. No Linux or Windows host path for the
Stone SDK was found.

### PagSeguro and PagBank (Brazil)

**[D] rung 3** - `https://github.com/pagseguro/plugpag` is public. The repository describes itself
as "Integracao via bluetooth" (Bluetooth integration). It has 59 stars and its last push was
2026-08-25.

**[D] rung 3** - the repository README states the transport and the host platforms directly. It
says PlugPag is "uma biblioteca para integrar aplicativos, via bluetooth, com os leitores ... e
terminais ... do PagSeguro". For version 1.x it lists the platforms: **Android, iOS, Windows,
Linux**.

**[D] rung 3** - the version 1.x tree contains the matching directories: `1.x/linux`,
`1.x/raspberry`, `1.x/windows`, and `1.x/demos/Linux`. The Raspberry directory contains
`btserial-1.3.3.tar.gz` and `plugpag-1.3.3.tar.gz`. The demos contain a C program
(`CommandPromptTest.c`), a `makefile`, and a pre-built binary.

**[D] rung 1 in the repository** - the Linux demo README gives the install order: first install
`btserial`, then install `plugpag`, which pairs with the terminal. The example call is
`./CommandPromptTest COM0 1 1 1 123 ABC`.

**[T] rung 3** - version 4.x is Android-only. The README states "Atualmente a versao e
disponibilizada para a plataforma Android". So the Linux route is legacy code, not a current one.

**UNVERIFIED** - whether the version 1.x Linux libraries still work with current terminal firmware.
The repository README ties PlugPag 1.x to terminal firmware "3.10.x ou superior", and that statement
is from the era of the Moderninha Pro and Moderninha Wifi models.

### MercadoPago Point

See `01-official-integration-paths.md` and `04-mercadopago-point-integration-surface.md` for the
full treatment. Four lines are enough here.

**[D] rung 1** - the MercadoPago developer documentation is a JavaScript portal. The page
`https://www.mercadopago.com.mx/developers/en/docs/point-api` returns a 2.95 MB shell to `curl` with
no useful text.

**[D] rung 1, from the sibling research** - the documented third-party route is the Orders API over
HTTPS, not a local link. The MercadoPago SmartApps restrictions forbid `USB_PERMISSION`, `USB_SET`,
the `BLUETOOTH*` family, and "the use of the USB port for information transmission".

**[I]** - MercadoPago publishes no host-side terminal protocol. A third-party POS therefore cannot
drive a Point terminal the way a PagSeguro or Verifone host drives its terminal.

## Open protocols and standards

This section answers the question directly. Is there a documented OPEN protocol for talking to a
payment terminal over USB or Bluetooth from a host?

Short answer, as an **[I]**: yes for the message layer, and rarely at the physical layer. The
published and free protocols define what the ECR says to the terminal. The transport below them is
usually left to the vendor, and the interesting part of the link is behind a gate.

| Protocol or standard        | Owner                                                     | What it actually covers                                                                                                                   | Public?                                               | Rung |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---- |
| ISO/IEC 7816 (parts 1 to 4) | ISO and IEC                                               | The contact smart-card interface: physical characteristics, electrical signals, and the APDU command set                                  | Paid standard. Preview only.                          | 7    |
| ISO 8583                    | ISO                                                       | A financial **message** format between a card acquirer and a card issuer. It is a network format. It is not a USB or Bluetooth transport. | Paid standard.                                        | 7    |
| ZVT / ECR-Interface         | Verband der Terminalhersteller in Deutschland e.V. (VdTH) | A vendor-neutral command protocol between a payment terminal and a cash register or a vending machine, over a byte stream                 | **Free download**, no account                         | 7    |
| nexo Retailer Protocol      | nexo standards                                            | A message protocol between a "sale system" and a "payment system" on or near one POS. EMV-adjacent, ISO 20022 schemas.                    | Free package download offered; login state UNVERIFIED | 7    |
| EMV specifications          | EMVCo                                                     | Chip and contactless payment application behaviour, and payment tokenisation                                                              | Free download after registration                      | 7    |
| PCI P2PE                    | PCI SSC                                                   | Encryption of account data at the point of interaction, and the P2PE solution programme                                                   | Standard page public; PDF access UNVERIFIED           | 7    |
| PCI SPoC                    | PCI SSC                                                   | Software-based PIN entry on commercial off-the-shelf devices                                                                              | Public. **Sunset ends 2026-10-31.**                   | 7    |
| PCI MPoC                    | PCI SSC                                                   | Mobile payments on commercial off-the-shelf devices. The successor to SPoC and CPoC.                                                      | Public                                                | 7    |
| "ECD" and "SCO"             | Unknown                                                   | Not identified. See below.                                                                                                                | UNVERIFIED                                            | -    |
| "OTI" and "OPEN-INTERFACE"  | Unknown                                                   | Not identified. See below.                                                                                                                | UNVERIFIED                                            | -    |
| "Android Payment Terminal"  | Unknown                                                   | Not identified. See below.                                                                                                                | UNVERIFIED                                            | -    |

### ISO/IEC 7816

**[D] rung 7** - the PCI PTS POI Modular Security Requirements cite "ISO 7816" in the requirement
list. The citation confirms that the smart-card interface standard is the reference for card
communication inside a POI device. Source: `PCI_PTS_POI_SRs_v6-1_Final.pdf`, page 8 list of
references.

**[D] rung 7** - the same document cites ISO 9564 for PIN block encipherment. That is the PIN-block
standard, separate from ISO 7816.

**UNVERIFIED** - the ISO catalogue page `https://www.iso.org/standard/77170.html` returned HTTP 403
with a Cloudflare challenge from this workstation. The standard is paid. Its exact text was not
read here.

**[I]** - ISO/IEC 7816 is a card-to-reader interface. It is not a host-to-terminal link. It matters
here only because the terminal is the reader.

### ISO 8583

**[D] rung 3** - ISO 8583 is implemented by host-side message libraries, not by device drivers.
`https://github.com/jpos/jPOS` ("jPOS Project", 720 stars, pushed 2026-09-16) and
`https://github.com/moov-io/iso8583` ("A golang implementation to marshal and unmarshal iso8583
message", 533 stars, pushed 2026-09-16) are both message codecs.

**[D] rung 7** - the ISO catalogue entry is `https://www.iso.org/standard/31628.html`. That page
returned HTTP 403 from this workstation.

**[I]** - ISO 8583 is a network message format between a terminal or acquirer host and a card
issuer. It cannot carry a terminal command over a USB cable. Anyone who proposes "ISO 8583 over
USB" as a MercadoPago route has confused the message layer with the transport layer.

### ZVT / ECR-Interface

This is the best-documented free protocol in this review. It is also the closest analogue to what a
Linux POS would need.

**[D] rung 7** - the specification is published by the Verband der Terminalhersteller in Deutschland
e.V. The download page `https://www.terminalhersteller.de/downloads.aspx` states that the site is a
"neutrales Portal, welches die jeweils aktuelle Versionen des ZVT-Kassenprotokolls jedem
Interessierten zum freien Download anbietet". The listed revisions run from 13.07 to **13.13**.

**[D] rung 7** - the same page defines the protocol: "Die ZVT-Spezifikation ist ein
herstellerunabhaengiges Kommunikationsprotokoll zwischen Bezahlterminals und elektronischen
Registrierkassen bzw. Verkaufsautomaten."

**[D] rung 3** - `https://github.com/EVerest/zvt` (24 stars, Apache-2.0, pushed 2026-09-11) is a
Rust implementation. Its README names the owner of the spec: "It follows the ECR-Interface / ZVT -
Protocol specification defined by the Verband der Terminal Hersteller e.V."

**[D] rung 3** - the same README records production use on a Linux host: "The code also implements
extensions defined by Feig, because this is the Terminal that Qwello uses in production in most of
our charging stations." An EV charging station is a Linux host.

**[D] rung 3** - the EVerest library is transport-agnostic. Its `io.rs` reads and writes through any
`AsyncRead` and `AsyncWrite` source. The production stream in `zvt_feig_terminal/src/stream.rs` is a
reconnecting **TCP** stream to port `22000`.

**[D] rung 3** - `https://github.com/Portalum/Portalum.Zvt` (103 stars, MIT, pushed 2026-04-22) is a
.NET implementation. Its README states: "Communication via Network (TCP) and communication via a
serial connection is supported."

**[D] rung 3** - `https://github.com/mathiasfrey/ecrterm` (34 stars, LGPL-3.0, last push
2021-03-24) is a Python ZVT 700 interface for electronic cash registers. A Python implementation on
a Linux host is direct prior art for scripted terminal control.

**[T] rung 7** - ZVT names serial and TCP as the reference transports. The spec's own transport
section is written for a byte stream, so a Bluetooth serial port profile can carry it. No ZVT
document found in this review names Bluetooth as a transport. That step is **[I]**.

### nexo Retailer Protocol

**[D] rung 7** - `https://www.nexo-standards.org/standards/nexo-retailer-protocol` states: "The nexo
Retailer protocol defines a set of interfaces between a card payment application and a retail point
of sale system." It promises "a clear separation between sale and payment".

**[D] rung 7** - nexo lists its standards publicly: nexo FAST Specification, nexo Implementation
Specification, nexo Security Specification, nexo Acquirer Protocol, **nexo Retailer Protocol**,
nexo TMS Protocol, and nexo ATM Protocol.

**[D] rung 7** - `https://www.nexo-standards.org/standards/nis-packages` offers a "Download NIS
v4.0 Package" action.

**UNVERIFIED** - no static download URL is exposed to `curl`, and whether the download needs a
membership is not stated on the fetched page.

**[I]** - nexo Retailer is the strongest candidate for a standards-based ECR-to-terminal link. It
is also the protocol family behind the PAX "ECR on Device" demo, which uses NEXO retailer messages
(`https://github.com/SwedbankPay/pax-ecr-on-device`).

### EMV and EMVCo

**[D] rung 7** - `https://www.emvco.com/specifications/` lists the EMV specification families:
EMV 3-D Secure, EMV Contact Chip, EMV Contactless Chip, EMV Payment Tokenisation, EMV QR Codes, and
EMV Secure Remote Commerce.

**[D] rung 7** - the same site publishes approval programmes: card and mobile laboratory
recognition, product approval or assessment, and security evaluation with a list of evaluated
products.

**[I]** - EMVCo certifies terminal kernels and payment applications. It publishes no host-to-terminal
link protocol. The specification list contains no ECR interface.

### PCI SPoC, CPoC, MPoC, and P2PE

**[D] rung 7** - PCI SSC announced the end of SPoC and CPoC. Source:
`https://www.pcisecuritystandards.org/wp-content/uploads/2026/05/PCI_SPoC_and_PCI_CPoC_Sunset_Bulletin.pdf`
(bulletin dated 01 May 2026, download HTTP 200, text extracted).

**[D] rung 7** - the bulletin states the timeline: "Effective Date of Sunset Period: May 01, 2026"
and "Sunset Period Ends: October 31, 2026". After that date, "No new PCI SPoC or PCI CPoC
submissions will be accepted by PCI SSC."

**[D] rung 7** - the same bulletin points to the successor: organisations "should also evaluate
future product development strategies in alignment with applicable PCI SSC standards, including
PCI MPoC where appropriate".

**[I]** - a new project started in 2026 must plan for MPoC, not SPoC. Any SPoC-based advice found in
older blog posts is on a sunset path.

### "ECD", "SCO", "OTI", and "OPEN-INTERFACE"

**[D] - negative result.** These names were searched for and were not identified as payment
terminal protocols.

Searches run: `gh search code "ECD protocol payment terminal"` (0 results),
`gh search code "ECD-Schnittstelle"` (1 unrelated German retirement-app file),
`gh search code "OPEN-INTERFACE terminal protocol"` (0 results),
Bing RSS for `"ECD" protocol payment terminal ECR specification` (HTTP 200, no relevant result),
and DNS and HTTP probes of `openinterface.org` (no DNS), `openinterface.io` (HTTP 200, a
commercial "OpenInterface / Sci-Net" login page for an unrelated product), `oti.org` (HTTP 200, a
parking-page redirect), and `opi-forum.org` (no DNS).

**UNVERIFIED** - "ECD" and "SCO" may be internal or regional names, or an error for "ECR" and
"ZVT". "OTI" and "OPEN-INTERFACE" may refer to a vendor-private document. No public specification
was found under either name.

### "Android Payment Terminal"

**[D] - negative result.** `https://github.com/AndroidPaymentApp` returns HTTP 404.
`androidpaymentapp.org` does not resolve. A GitHub repository search for "android payment terminal"
returned one unrelated app repository with 0 stars.

**[D] rung 3** - the real and adjacent pattern is "ECR on Device". In that pattern the POS
application and the payment application run on the same Android terminal and talk over an Android
`Intent`, not over a cable. Example: `https://github.com/SwedbankPay/pax-ecr-on-device` (3 stars,
last push 2026-05-13), which uses NEXO retailer messages.

**[I]** - "ECR on Device" does not help a Flutter POS on a Linux workstation. It removes the cable
by moving the POS onto the terminal.

## PCI and EMVCo constraints on a host that talks to a PIN pad

This section answers question 3. Does PCI SSC or EMVCo restrict a POS vendor from talking directly
to a certified PIN pad over USB?

**Answer, as an [I] on top of the documented facts below:** no document found in this review
forbids the cable. The documents constrain the DATA and the DEVICE. The host may speak to the PIN
pad. The host may not receive clear-text account data or a clear-text PIN. The PIN pad must stay
PCI-approved, and it must encrypt at the point of interaction.

All quotes below come from one public PDF:
`https://www.pcisecuritystandards.org/documents/PCI_PTS_POI_SRs_v6-1_Final.pdf`
(HTTP 200, 891621 bytes, "Payment Card Industry (PCI) PIN Transaction Security (PTS) Point of
Interaction (POI) Modular Security Requirements, Version 6.1, March 2022").

### The device constraint: approval and interfaces

**[D] rung 7** - the document stages its scope: "This document is only concerned with the life cycle
for POI devices up to the point of initial key loading". After deployment, "the responsibility for
the device falls to the acquiring financial institution and its agents, for example merchants and
processors, and is covered by the operating rules of the Participating Payment Brands and the PCI
PIN Security Requirements."

**[D] rung 7** - requirement D1, in "Evaluation Module 3: Communications and Interfaces", says:
"All protocols and all interfaces available on the device are accurately identified by the device
vendor." It continues: "All public domain protocols and interfaces available on the device are
clearly identified in the Open Protocols - Protocol Declaration Form."

**[D] rung 7** - requirement D2 says the device must not be steered into a bad state: "The device's
functionality shall not be influenced by logical anomalies such as (but not limited to) unexpected
command sequences, unknown commands, commands in a wrong device mode, and supplying wrong
parameters or data, which could result in the device outputting the clear-text PIN or other
sensitive data."

**[D] rung 7** - Appendix B extends the rules to wireless links: "In addition to other applicable
requirements, devices implementing open protocols, for example Bluetooth, Wi-Fi and TLS, must be
validated against the requirements noted in Implements Open Protocols."

**[I]** - the phrase "Open Protocols - Protocol Declaration Form" and the explicit Bluetooth and
Wi-Fi wording are the closest thing to a rule about a host link. The rule binds the terminal vendor,
not the POS vendor. The terminal vendor must declare every interface, and must defend each one.

### The PIN constraint

**[D] rung 7** - requirement C2.5 limits the PIN-entry surface: "The PIN-accepting POI terminal must
be equipped with only one payment card PIN-acceptance interface, for example a keyboard. If another
interface is present which can be used as a keyboard, a mechanism must exist to prevent its use for
PIN entry."

**[D] rung 7** - requirement B22 covers PIN protection between the PIN-encrypting device and the
card reader. It requires encipherment under ISO 9564 when the two are not in the same secure module.

**[I]** - C2.5 and B22 both aim inward, at the terminal. Neither one names the POS host. The host
never needs to see the PIN, because the PIN pad collects and encrypts it.

### The account-data constraint: SRED

This is the decisive requirement for the USB question.

**[D] rung 7** - requirement B23 states: "When operating in encrypting mode, there is no mechanism
in the device that would allow the outputting of clear-text account data except as described in DTR
B23."

**[D] rung 7** - requirement B23.1 states: "When operating in encrypting mode, the secure
controller can only release clear-text account data to authenticated applications executing within
the device."

**[D] rung 7** - the glossary defines Secure Reading and Exchange of Data (SRED) and the related
approval designations. Devices must be validated against "Protects Account Data" to receive the
"SRED" designation.

**[I]** - B23.1 is the constraint that shapes a real integration. "Authenticated applications
executing within the device" excludes the POS host. So the host link carries ciphertext, a
transaction reference, and status messages. It does not carry the PAN.

**[I]** - a "semi-integrated" design follows directly from B23.1. Verifone names that model
explicitly in its own docs: "The payment device contains a complete payment application which
interfaces to an external ECR/POS system."

### The other PCI documents

**[D] rung 1** - `https://www.pcisecuritystandards.org/standards/pin-security-requirements-and-testing-procedures/`
is the PIN Security Requirements page. The document library entry exists. The PDF itself was not
reachable by a direct URL from this workstation, so its text is **UNVERIFIED** here.

**[D] rung 1** - `https://www.pcisecuritystandards.org/standards/point-to-point-encryption-p2pe/`
is the P2PE standard page. It is part of the public standards index. The P2PE standard PDF URL was
not recovered in this pass, so its text is **UNVERIFIED** here.

**[D] rung 1** - the PCI SSC standards index also lists PTS POI, PIN Security, MPoC, CPoC, SPoC,
PTS HSM, and TSP. Source: `https://www.pcisecuritystandards.org/standards/`

**[D] rung 1** - the PCI SSC Document Library is at
`https://www.pcisecuritystandards.org/document_library/`. It is a JavaScript app. Its content is
served through `admin-ajax.php`. However, the WordPress REST API does expose the document titles
at `https://www.pcisecuritystandards.org/wp-json/wp/v2/doc_lib_document`, and the PTS POI PDF is
reachable at a stable `documents/` path. So the library is not fully closed.

### Practical reading for the Umi POS

**[I]** - four rules follow from the documents above.

1. The Point terminal must appear as a PTS-approved POI. Umi cannot reimplement the payment
   application.
2. The host must never receive the PAN or the PIN. Any protocol that returns clear-text card data
   to the POS would break B23 and would void the SRED designation.
3. The host must not command the terminal in a way that changes the PIN-entry surface. Requirement
   C2.5 blocks a "second keyboard" over USB.
4. A Bluetooth link needs a validated "Implements Open Protocols" story from the terminal vendor.
   Appendix B names Bluetooth directly.

## Bluetooth prior art

Question 4 asks for public work on driving a payment terminal over Bluetooth (SPP or BLE) from a
Linux host.

### The strongest find: PagSeguro PlugPag 1.x on Linux and Raspberry Pi

**[D] rung 3** - `https://github.com/pagseguro/plugpag` (59 stars, MIT-style public repo, last push
2026-08-25). The repository description is "Integracao via bluetooth".

**[D] rung 3** - the repository README lists Linux as a supported platform for PlugPag 1.x:
"Essa versao e disponibilizada para as seguintes plataformas: Android, iOS, Windows, Linux."

**[D] rung 3** - the tree confirms it. `1.x/linux/1.3.3/x64`, `1.x/raspberry/1.3.3/` with
`btserial-1.3.3.tar.gz` and `plugpag-1.3.3.tar.gz`, and `1.x/demos/Linux/` with `CommandPromptTest.c`,
a `makefile`, and a pre-built `CommandPromptTest` binary.

**[D] rung 1 in the repository** - the demo README describes the transport. Step 1 installs the
`btserial` package. Step 2 installs `plugpag` and pairs with the terminal at that moment. The
runtime call takes a COM port name: `CommandPromptTest COM0 1 1 1 123 ABC`.

**[I]** - `btserial` creates a virtual serial port over Bluetooth. The host then speaks to the
terminal on a COM-style port. That is the Bluetooth Serial Port Profile pattern, not BLE. The
profile itself is **UNVERIFIED**.

**[I]** - this is the single most relevant piece of prior art in this review. It is a vendor-published,
publicly downloadable, Linux-hosted C library that drives a certified terminal over Bluetooth.

**[T] rung 3** - the caveat. Version 4.x is Android-only, and the README states the 1.x line gets no
further fixes. The Linux route is legacy and depends on old terminal firmware.

### Android hosts with a Bluetooth pinpad

**[D] rung 1** - Stone's Android SDK. `BluetoothConnectionProvider` takes a `PinpadObject` built
from `BluetoothAdapter.getBondedDevices()`. Source:
`https://sdkandroid.stone.com.br/reference/provedor-conexao-pinpad-bluetooth.md`

**[D] rung 3** - SumUp SDK wrappers exist for Flutter, React Native, and Cordova, for example
`PurpleSoftSrl/sumup_flutter_plugin` (21 stars, Kotlin, pushed 2026-08-31). All of them target
Android and iOS. None targets Linux.

**[D] rung 1** - Verifone XPI names Bluetooth in its transport list, alongside RS232, USB, Wi-Fi,
Ethernet, and WebSocket. Source: `https://docs.verifone.com/xpi/xpi-getting-started.md`

**[D] rung 3** - PAX POSLink carries Bluetooth classes in the Android wrapper
(`bluetoothscan/BluetoothScanner.java`, `BluetoothConnectionException.java`) and a MAC-shaped
`deviceName` field. Source:
`https://github.com/rotenderco/react-native-poslink/tree/main/android/src/main/java/com/poslink`

### Negative results for Bluetooth

**[D] - negative result.** These GitHub repository searches returned no relevant Linux Bluetooth
payment-terminal project: `"payment terminal bluetooth"` (0 results), `"rfcomm payment terminal"`
(0 results), `"bluetooth pinpad"` (1 result, an Android app), `"zvt bluetooth"` (0 results), and
`"pinpad serial"` (0 results).

**[D] - negative result.** Hacker News Algolia searches for "ZVT protocol", "payment terminal
bluetooth", and "card terminal serial" returned no relevant story or comment.

**[D] - negative result.** GitHub code search for `bluez`, `rfcomm`, and `/dev/rfcomm` inside
`pagseguro/plugpag` returned 0 results, even though the repository ships a `btserial` package. The
LPT `btserial` source is distributed as a tarball binary artifact, not as readable source in the
repository tree.

**[I]** - the honest verdict for Bluetooth: the prior art is thin and almost entirely Android-based.
PagSeguro is the one public exception on Linux. Every other vendor ships a Bluetooth path only
inside an Android or iOS host SDK.

## MercadoPago specifics (brief)

Full detail is in `01-official-integration-paths.md` and `04-mercadopago-point-integration-surface.md`.

**[D] rung 1** - the third-party integration route is the Orders API over HTTPS with
`POST /v1/orders` and a `config.point.terminal_id`. That is a cloud call, not a local link.

**[D] rung 1** - MercadoPago's SmartApps restrictions forbid `USB_PERMISSION`, `USB_SET`, the
`BLUETOOTH*` permission family, and "the use of the USB port for information transmission". The
only supported local code is an Android AAR that runs inside a Point Smart terminal.

**[D] rung 1** - the accepted terminal models in the terminal list are the Newland N950 and the PAX
A910, with IDs of the form `NEWLAND_N950__<serial>`.

**[I]** - MercadoPago is the negative case in this review. It publishes no host-side terminal
protocol at all. The USB cable on a Point Smart exists for development and deployment (ADB), not
for a payment protocol from a third-party POS.

**[I]** - this finding is the reason the Umi POS needs a designed fallback. If the Flutter app must
run on Linux and must drive a MercadoPago Point locally, no documented route exists today.

## Failed source attempts

Two routes were tried for every blocked source. The table records the URL, the observed status, the
fallback, and the outcome.

| URL                                                                                                                                                                    | Status                                                                                                                           | Fallback tried                                                                                                              | Outcome                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://docs.cloud.ingenico.com/`                                                                                                                                     | 000, DNS failure (no bytes)                                                                                                      | Wayback CDX `?url=docs.cloud.ingenico.com&matchType=domain`, then `ingenico.com/en/developers` and `developer.ingenico.com` | CDX returned an empty set: the host was never archived. The substitute pages worked (HTTP 200).                                                 |
| `https://developer.verifone.com/`                                                                                                                                      | 000, DNS failure                                                                                                                 | `https://docs.verifone.com/llms.txt`                                                                                        | The substitute worked: HTTP 200, 591393 bytes, the full public documentation index.                                                             |
| `https://www.verifone.com/en/developer`                                                                                                                                | 404                                                                                                                              | `https://www.verifone.com/` link inventory                                                                                  | Found `docs.verifone.com` and the partner-registration target.                                                                                  |
| `https://www.ingenico.com/`                                                                                                                                            | 403                                                                                                                              | `https://ingenico.com/en/developers`                                                                                        | HTTP 200, 135453 bytes.                                                                                                                         |
| `https://ingenico.com/en/products-services/services/posgate`                                                                                                           | 404 twice (`/posgate` and `/posgate/developers`)                                                                                 | Wayback snapshot 20230925174728 of the APAC pos-middleware page                                                             | Recovered: HTTP 200, 84382 bytes, including the full transport matrix.                                                                          |
| `https://dev.ingenico.com/en/welcome`                                                                                                                                  | 200, but the body is "Failed to load the application. Refresh" (9106 bytes)                                                      | `https://developer.ingenico.com/`                                                                                           | HTTP 200, 54579 bytes with readable content. The SPA serves no text to `curl`.                                                                  |
| `https://partner.ingenico.com/`                                                                                                                                        | 200, but an Angular shell of raw i18n keys (22820 bytes)                                                                         | none available                                                                                                              | No text extractable without JavaScript.                                                                                                         |
| `https://showcase.ingenico.com`, `https://resources.ingenico.com`                                                                                                      | 000, DNS failure each                                                                                                            | none available                                                                                                              | Both hosts are dead from this workstation.                                                                                                      |
| `https://paxdeveloper.com/`                                                                                                                                            | 000, DNS failure                                                                                                                 | `https://developer.pax.us/`                                                                                                 | HTTP 200, but a 3556-byte SPA shell.                                                                                                            |
| `https://www.pax.us/sdk/`                                                                                                                                              | 301 live                                                                                                                         | Wayback snapshot 20200910202830                                                                                             | HTTP 200 in the archive. Even historically the page held only a sales contact form.                                                             |
| `https://developer.pax.us/` plus `/docs`, `/sdk`, `/poslink`, `/download`, `/api/`, `/en`                                                                              | 200, 3556 bytes each                                                                                                             | Read the SPA's own JS route table                                                                                           | Route names recovered, including `/nda`. No page renders without JavaScript.                                                                    |
| `https://en.newland-id.com/`, `https://dev.newland-id.com/`, `https://developer.newland-id.com/`, `https://nquire.newland-id.com/`                                     | 000, DNS failure, 4 hosts                                                                                                        | Product pages under `www.newland-id.com`                                                                                    | Worked. Confirmed that NQuire is a product family.                                                                                              |
| `https://www.iso.org/standard/77170.html` (ISO/IEC 7816-4)                                                                                                             | 403, Cloudflare "Just a moment" challenge (5779 bytes), also with a full browser-like header set and a Google referrer           | Wayback CDX for the same URL, then `archive.ph`, then the IEC webstore search                                               | CDX returned an empty set. `archive.ph` returned 404. The IEC webstore search page is JavaScript-driven. **ISO content stays UNVERIFIED.**      |
| `https://www.iso.org/standard/31628.html` (ISO 8583)                                                                                                                   | 403, same challenge                                                                                                              | same fallbacks                                                                                                              | Same result.                                                                                                                                    |
| `https://www.iso.org/obp/ui`                                                                                                                                           | 403                                                                                                                              | none                                                                                                                        | The Online Browsing Platform is blocked from this workstation.                                                                                  |
| `https://www.pcisecuritystandards.org/documents/PCI_PTS_POI_SRs_v6-2_Final.pdf`                                                                                        | 404 (640349 bytes of HTML)                                                                                                       | Try v6-1, then the Document Library app                                                                                     | `PCI_PTS_POI_SRs_v6-1_Final.pdf` returned **200, 891621 bytes, application/pdf**. v6.1 is the newest version reachable by a direct path.        |
| `https://www.pcisecuritystandards.org/documents/PCI_P2PE_Standard_v2-1.pdf`                                                                                            | 404                                                                                                                              | `?category=p2pe` document library page (200 but JavaScript-only), WordPress REST API `doc_lib_document` queries             | The P2PE standard PDF URL was not recovered. Its text stays UNVERIFIED.                                                                         |
| `https://www.pcisecuritystandards.org/document_library/?category=pts`, `?category=p2pe`, `?category=SPoC`, `?category=mpoc`, `?category=pci_pin`                       | 200, but every category returned the identical 667741-byte shell                                                                 | WordPress REST API `wp-json/wp/v2/doc_lib_document`                                                                         | The REST API worked and returned document titles and links. That is the usable route.                                                           |
| `https://blog.pcisecuritystandards.org/software-based-pin-entry-on-cots-spoc`                                                                                          | 404 (68169 bytes)                                                                                                                | `https://www.pcisecuritystandards.org/standards/` link inventory                                                            | Found the sunset bulletin PDF instead, which is stronger.                                                                                       |
| `https://docs.pagseguro.com/`                                                                                                                                          | 000, DNS failure                                                                                                                 | `dev.pagbank.uol.com.br`                                                                                                    | 000 as well, but it redirects to `https://developer.pagbank.com.br/`, which returned 200 (1627598 bytes).                                       |
| `https://devs.pagseguro.uol.com.br/`                                                                                                                                   | 000, DNS failure                                                                                                                 | the GitHub repository route                                                                                                 | `github.com/pagseguro/plugpag` gave the real answer.                                                                                            |
| `https://developer.stone.com.br/`, `https://developers.stone.com.br/`, `https://sdk.stone.com.br/`                                                                     | 000, DNS failure each                                                                                                            | `www.stone.com.br/devcenter`                                                                                                | HTTP 200. That page names the Android SDK and the Bluetooth pinpad, and links `sdkandroid.stone.com.br`.                                        |
| `https://www.castles.com.tw/`                                                                                                                                          | 000, DNS failure                                                                                                                 | `https://www.castlestech.com/`                                                                                              | HTTP 200, 218756 bytes. The vendor domain for the English site is `castlestech.com`.                                                            |
| Bing RSS, `https://www.bing.com/search?q=<query>&format=rss`                                                                                                           | 200 on every query, but unrelated results (for example a Hong Kong primary school for a "ZVT 700 Protokoll Spezifikation" query) | Direct site fetch, sitemaps, GitHub search, Wayback CDX                                                                     | Bing RSS is unusable as a search channel from this workstation. **Abandoned after 5 attempts.**                                                 |
| Bing RSS with quoted operators, for example `"PTS POI" "modular security requirements" site:pcisecuritystandards.org`                                                  | 200, no relevant results                                                                                                         | the PCI standards index `https://www.pcisecuritystandards.org/standards/`                                                   | The index link inventory found the correct standard pages.                                                                                      |
| DuckDuckGo `html.duckduckgo.com/html/?q=...` and `lite.duckduckgo.com/lite/?q=...`                                                                                     | 202 with a bot challenge ("Select all squares containing a duck")                                                                | none                                                                                                                        | Both DuckDuckGo endpoints are blocked from this workstation.                                                                                    |
| `https://web.archive.org/web/2026/https://www.iso.org/standard/77170.html`                                                                                             | 404                                                                                                                              | CDX index for the same URL                                                                                                  | CDX returned an empty set; no snapshot exists.                                                                                                  |
| `http://web.archive.org/cdx/search/cdx?...` (the whole host, mid-session)                                                                                              | An "Internet Archive: Temporarily Offline" page from `web.archive.org`                                                           | `archive.ph/newest/<url>`                                                                                                   | `archive.ph` returned 404 for the ISO URL. The CDX index recovered later and did answer.                                                        |
| `https://openinterface.org`, `https://www.opi-forum.org`, `https://www.androidpaymentapp.org`                                                                          | 000, DNS failure each                                                                                                            | `openinterface.io`, `oti.org`, `github.com/AndroidPaymentApp`                                                               | `openinterface.io` is a login page for an unrelated product. `oti.org` redirects to a parking lander. The GitHub path returns 404.              |
| `gh search code "OPEN-INTERFACE terminal protocol"`, `"ECD protocol payment terminal"`                                                                                 | 200, 0 results each                                                                                                              | `gh search code "ECD-Schnittstelle"` and repository searches                                                                | One unrelated German file, then no relevant result.                                                                                             |
| `gh search repos "payment terminal bluetooth"`, `"rfcomm payment terminal"`, `"zvt bluetooth"`, `"pinpad serial"`, `"terminal protocol eftpos"`, `"ecr interface zvt"` | 200, 0 results each                                                                                                              | narrower and wider query terms                                                                                              | Recorded as negative findings, not as tool failures.                                                                                            |
| `gh api orgs/Ingenico`, `orgs/Newland`, `orgs/NewlandNPT`, `orgs/newland-id`, `orgs/VerifoneGlobal`, `orgs/AndroidPaymentApp`                                          | 404 each                                                                                                                         | `gh search repos` and the live vendor sites                                                                                 | No official organisation exists for those names. `orgs/verifone` exists with 2 dormant repos. `orgs/newlandpayment` exists with 0 public repos. |
| `https://www.mercadopago.com.mx/developers/en/docs/point-api`                                                                                                          | 200, but a 2952427-byte JavaScript shell                                                                                         | the sibling research set used the `.md` twins and `llms.txt`                                                                | Handled by `01-official-integration-paths.md`.                                                                                                  |

## Open questions

1. **USB device class.** No vendor states whether its USB link is CDC-ACM, HID, or a vendor class.
   This is the single largest gap. Without it, a Linux implementation cannot be scoped.
2. **Bluetooth profile.** No vendor states SPP or BLE. The PagSeguro `btserial` package implies a
   serial-profile bridge, but that is an inference from a file name and a COM-port argument.
3. **ZVT over Bluetooth.** The ZVT spec is transport-oriented and free. Whether any certified
   terminal exposes ZVT over a Bluetooth serial port is unconfirmed. Portalum and EVerest both use
   TCP or a wired serial port.
4. **nexo Retailer access.** The NIS package page offers a download. Whether it needs membership,
   and which terminals implement the nexo Retailer protocol, is unknown.
5. **PCI P2PE and PIN Security text.** Both documents are referenced from public pages. Their PDF
   text was not read in this pass, so their exact requirement numbers are unverified here.
6. **Current PTS POI version.** Version 6.1 (March 2022) was the newest direct-path PDF. A v6.2
   bulletin exists at `https://www.pcisecuritystandards.org/wp-content/uploads/2023/01/PTS_POI_v6.2_Bulletin.pdf`,
   so a newer numbered version very likely exists behind the document library. The current version
   number is UNVERIFIED.
7. **Castles Technology.** No public SDK page exists. The integration route for a Castles terminal
   would run through the acquirer or the terminal software owner. That assumption is unverified.
8. **PlugPag 1.x viability.** The Linux and Raspberry artifacts are real and public. Their
   compatibility with terminals and firmware sold in 2026 is UNVERIFIED.
9. **ISO 7816 and ISO 8583 text.** Both catalogue pages are Cloudflare-blocked from this
   workstation. Their titles and paywall status come from indirect evidence, not from reading the
   catalogue pages.
10. **MercadoPago SmartApp restrictions.** The restrictions list `USB_PERMISSION` and `BLUETOOTH*`
    as forbidden. Whether an acquirer-side or partner-side exception exists is covered in
    `01-official-integration-paths.md`.

## Sources

### Rung 1, vendor documentation and portals

- `https://ingenico.com/en/developers` - Ingenico Developer Program (HTTP 200)
- `https://developer.ingenico.com/` - Ingenico portal with the sign-up gate (HTTP 200)
- `https://ingenico.com/en/products-services/payment-terminals/integrated-pos` - Ingenico Integrated POS (HTTP 200)
- `https://dev.ingenico.com/en/welcome` - Ingenico SPA portal target (HTTP 200, no text)
- `https://docs.verifone.com/llms.txt` - Verifone complete public documentation index (HTTP 200)
- `https://docs.verifone.com/xpi/xpi-getting-started.md` - CAM-XPI host-driven ECR SDK, transports, port 12345, 8n1 at 115200, SAPF framing (HTTP 200)
- `https://docs.verifone.com/psdk/readme.md` - Verifone PSDK, four host platforms including Linux (HTTP 200)
- `https://docs.verifone.com/psdk-sdi/readme.md` - Verifone PSDK-SDI, on-terminal Kotlin and Swift (HTTP 200)
- `https://docs.verifone.com/psdk/not-sure-where-these-live/integration_types.md` - Verifone semi-integrated definition (HTTP 200)
- `https://www.verifone.com/` - Verifone partner and developer link inventory (HTTP 200)
- `https://partner-registration.verifone.com/` - Verifone registration target named in the docs gate
- `https://www.pax.us/support/developer-portal/` - PAX registration gate (HTTP 200)
- `https://developer.pax.us/` and `https://developer.pax.us/js/index.ffa6c954.js` - PAX portal SPA and its route table with `/nda` (HTTP 200)
- `https://www.pax.us/support/documents/` - PAX public document library (HTTP 200)
- `https://www.newlandnpt.com/support.html` - Newland NPT "NPSC SDK Toolkit" and "NAPI / NSDK" (HTTP 200)
- `https://www.newland-id.com/en/support/software-drivers/` - Newland public scanner SDKs, including a Linux SDK (HTTP 200)
- `https://www.newland-id.com/en/partners/isv-partner-program/` - Newland ISV gating language (HTTP 200)
- `https://www.newland-id.com/` - NQuire product family (HTTP 200)
- `https://www.castlestech.com/`, `https://www.castlestech.com/page-sitemap.xml`, `https://www.castlestech.com/resources-sitemap.xml` - Castles site and sitemaps (HTTP 200)
- `https://www.stone.com.br/devcenter` - Stone developer center (HTTP 200)
- `https://sdkandroid.stone.com.br/llms.txt` - Stone SDK Android documentation index (HTTP 200)
- `https://sdkandroid.stone.com.br/reference/provedor-conexao-pinpad-bluetooth.md` - Stone Bluetooth pinpad provider (HTTP 200)
- `https://www.mercadopago.com.mx/developers/en/docs/point-api` - MercadoPago Point docs shell (HTTP 200, no text)
- `https://www.terminalhersteller.de/downloads.aspx` - VdTH ZVT specification download page (HTTP 200)
- `https://www.nexo-standards.org/standards/nexo-retailer-protocol` - nexo Retailer Protocol (HTTP 200)
- `https://www.nexo-standards.org/standards/nis-packages` - nexo NIS packages (HTTP 200)

### Rung 1 via the Wayback Machine

- `https://web.archive.org/web/20230925174728id_/https://ingenico.com/apac/products-services/services/pos-middleware/developers` - Ingenico POSgate POS Developers page with the transport matrix (HTTP 200)
- `https://web.archive.org/web/20221126101258id_/https://ingenico.com/apac/developers` - Ingenico developers page, ECR API statement (HTTP 200)
- `https://web.archive.org/web/20200910202830id_/https://www.pax.us/sdk/` - historical PAX SDK page (HTTP 200, contact form only)

### Rung 2, release notes and version history

- `https://github.com/dearming623/compatiable-wrapper` (`MQPaxWrapper/info.txt`) - PAX `poslink.dll` version history from v1.07.00 to v1.12.00_20231031

### Rung 3, repositories, file trees, and issue surfaces

- `https://github.com/pagseguro/plugpag` - PlugPag, "Integracao via bluetooth", 59 stars, pushed 2026-08-25
- `https://github.com/pagseguro/plugpag/tree/master/1.x` - `linux`, `raspberry`, `windows`, `demos` trees
- `https://github.com/pagseguro/plugpag/blob/master/1.x/demos/Linux/README.txt` - `btserial` install order and the `COM0` argument
- `https://github.com/pagseguro/plugpag/blob/master/1.x/demos/Linux/CommandPromptTest.c` - C host demo
- `https://github.com/pagseguro/plugpag/blob/master/1.x/raspberry/1.3.3/btserial-1.3.3.tar.gz` - Raspberry Bluetooth serial artifact
- `https://github.com/EVerest/zvt` - Rust ZVT implementation, 24 stars, Apache-2.0, pushed 2026-09-11
- `https://github.com/EVerest/zvt/blob/main/zvt/src/io.rs` - transport-agnostic packet transport
- `https://github.com/EVerest/zvt/blob/main/zvt_feig_terminal/src/stream.rs` - reconnecting TCP stream to port 22000
- `https://github.com/Portalum/Portalum.Zvt` - .NET ZVT client, 103 stars, MIT, TCP and serial, pushed 2026-04-22
- `https://github.com/Portalum/Portalum.Zvt.EasyPay` - ZVT payment tool, 22 stars, MIT
- `https://github.com/mathiasfrey/ecrterm` - Python ZVT 700 interface, 34 stars, LGPL-3.0, pushed 2021-03-24
- `https://github.com/prosoftgmbh/zvt` - ZVT command line tool, 14 stars, pushed 2022-09-28
- `https://github.com/jpos/jPOS` - ISO 8583 host library, 720 stars, pushed 2026-09-16
- `https://github.com/moov-io/iso8583` - ISO 8583 codec in Go, 533 stars, pushed 2026-09-16
- `https://github.com/SwedbankPay/pax-ecr-on-device` - PAX "ECR on Device" demo with NEXO retailer messages, 3 stars, pushed 2026-05-13
- `https://github.com/multipos-app/pos` (`PaxPayment.kt`) - PAX `CommSetting.TCP`, `.USB`, `.AIDL`
- `https://github.com/syedMohib44/SuperGiz` (`CommSetting_Service.cs`) - PAX Windows `POSLink.CommSetting` fields
- `https://github.com/rotenderco/react-native-poslink` - POSLink Android artifacts and Bluetooth classes
- `https://github.com/OsparkSolutions/expo-pax-poslink` - POSLink `CommSetting` binding
- `https://github.com/PAXSTORE` - PAXSTORE organisation, 13 public repos (cloud and terminal-app SDKs, not host POSLink)
- `https://github.com/verifone` - Verifone organisation, 2 public repos, both last pushed 2018
- `https://github.com/PurpleSoftSrl/sumup_flutter_plugin` - SumUp Flutter plugin, 21 stars, Android and iOS only, pushed 2026-08-31

### Rung 4, practitioner writing

- `https://github.com/Yortw/Yort.Eftpos.Verifone.PosLink` - unofficial .NET implementation of the Verifone PosLink v2.2 pinpad protocol, 7 stars, pushed 2022-10-24
- `https://www.feig-payment.de/en/products/cvend-plug/` - Feig cVEND plug payment terminal product page (HTTP 200)

### Rung 7, specifications and standards

- `https://www.pcisecuritystandards.org/documents/PCI_PTS_POI_SRs_v6-1_Final.pdf` - PCI PTS POI Modular Security Requirements v6.1, March 2022 (HTTP 200, 891621 bytes). Quoted requirements: D1, D2, C2.5, B22, B23, B23.1, Appendix B.
- `https://www.pcisecuritystandards.org/wp-content/uploads/2023/01/PTS_POI_v6.2_Bulletin.pdf` - PTS POI v6.2 bulletin (HTTP 200, 138399 bytes)
- `https://www.pcisecuritystandards.org/wp-content/uploads/2026/05/PCI_SPoC_and_PCI_CPoC_Sunset_Bulletin.pdf` - SPoC and CPoC sunset bulletin, 01 May 2026 (HTTP 200, 110276 bytes)
- `https://www.pcisecuritystandards.org/standards/` - PCI SSC standards index (HTTP 200)
- `https://www.pcisecuritystandards.org/standards/pts-point-of-interaction-poi/` - PTS POI standard page (HTTP 200)
- `https://www.pcisecuritystandards.org/standards/software-based-pin-entry-on-cots-spoc/` - SPoC standard page (HTTP 200)
- `https://www.pcisecuritystandards.org/standards/point-to-point-encryption-p2pe/` - P2PE standard page (HTTP 200)
- `https://www.pcisecuritystandards.org/standards/mobile-payments-on-cots-mpoc/` - MPoC standard page (HTTP 200)
- `https://www.pcisecuritystandards.org/standards/pin-security-requirements-and-testing-procedures/` - PIN Security Requirements page (HTTP 200)
- `https://www.pcisecuritystandards.org/wp-json/wp/v2/doc_lib_document` - PCI SSC document library REST API (HTTP 200)
- `https://www.emvco.com/specifications/` - EMVCo specification families (HTTP 200)
- `https://www.terminalhersteller.de/downloads.aspx` - ZVT / ECR-Interface specification, revisions 13.07 to 13.13, free download
- `https://www.iso.org/standard/77170.html` - ISO/IEC 7816-4 catalogue entry (HTTP 403 from this workstation)
- `https://www.iso.org/standard/31628.html` - ISO 8583 catalogue entry (HTTP 403 from this workstation)

### GitHub and search commands used

- `gh search repos "<term>" --limit N --json fullName,description,stargazersCount,pushedAt`
- `gh search code "<term>" --limit N --json repository,path`
- `gh api repos/<owner>/<repo> --jq '{full_name,description,stargazers_count,pushed_at,language,license:.license.spdx_id,archived}'`
- `gh api orgs/<org>/repos?per_page=100`
- `curl -s -A "<browser UA>" ...` for every vendor page
- `curl -s "https://hn.algolia.com/api/v1/search?query=<term>&hitsPerPage=5"`
- `curl -s -A "<browser UA>" "https://www.bing.com/search?q=<term>&format=rss"` (unreliable, abandoned)
- `curl -s "http://web.archive.org/cdx/search/cdx?url=<host>&matchType=domain&output=json&limit=N&collapse=urlkey"`

## Before-you-finish checklist

1. Tool named: yes. `curl`, `gh`, `jq`, `pdftotext`, the vendor Markdown indexes, and the Wayback CDX index.
2. Version and source recorded: yes, in "Method and Tools".
3. Two routes tried for every blocked source: yes, in "Failed source attempts".
4. Unverified claims marked: yes, 30 explicit UNVERIFIED markers.
5. Hand-rolled work avoided: yes. No scraper and no browser harness was built. Where a portal was JavaScript-only, an existing Markdown route or REST API was used.
6. Findings written to a file: yes, this file.
