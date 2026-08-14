# Flutter or Kotlin Multiplatform for Umi KDS and POS

**Date:** 2026-07-25  
**Status:** Research and conditional recommendation  
**Scope:** A greenfield KDS and POS client for Android, iPadOS, and limited desktop use  
**Decision owner:** Umi product and engineering owners  
**Confidence:** Medium-high, subject to the hardware proof in section 9

This file is a dated evidence artifact. It does not change the current KDS or POS architecture.

The comparison treats both clients as greenfield products. It gives no weight to the current
Swift KDS, the prior Flutter proposal, or the proposed Dart generator.

## 1. Recommendation

Choose **Flutter** for the greenfield Umi KDS and POS clients.

Use two app targets and a small set of shared Dart packages. Keep POS state separate from KDS state.

Flutter is the better default for Umi for four reasons:

1. Umi needs one shared, custom tablet UI across Android and iPadOS.
2. Umi has a small team and needs short feedback cycles on physical devices.
3. The Umi API keeps domain truth on the backend and gives clients a neutral HTTP contract.
4. Flutter has the larger support surface and the more mature cross-platform delivery workflow.

Kotlin Multiplatform is a valid production option in 2026. Its iOS status is no longer a reason to reject it.

Kotlin Multiplatform becomes the better option when certified Android SDK access controls the product. This can apply to printers, drawers, scanners, or payment terminals.

Run the hardware proof before the final adoption. Select Kotlin Multiplatform if Flutter fails a required hardware test.

## 2. Decision basis

This report uses three evidence classes.

- **Documented fact:** An official source or current Umi code supports the statement.
- **Source-backed tradeoff:** Official facts support the tradeoff, but they do not select a winner.
- **Umi-specific inference:** The conclusion applies the facts to Umi constraints.

The recommendation assumes these production targets:

- Android is the production POS target.
- Current iPads are the first KDS target.
- macOS is a development or demonstration target.
- Web is not a production POS or KDS target.
- UmiPOS is Umi's own enrolled client of `umi-api`.
- Zettle is outside the new POS scope.

The recommendation also assumes a custom operator UI. Umi does not need a native consumer-app appearance.

## 3. Current Umi facts

### 3.1 Client role

**Documented fact:** KDS is a thin client. The backend owns normalized orders and command processing.

The current contract states these rules:

- The backend is the source of truth.
- KDS renders normalized orders and events.
- KDS stays channel-agnostic.
- The client uses an enrolled device token.

See [`apps/umi-kds/AGENTS.md`](../../apps/umi-kds/AGENTS.md) and
[`KDSArchitecture.md`](../../apps/umi-kds/Sources/Docs/KDSArchitecture.md).

**Documented fact:** The current Swift client uses HTTP JSON endpoints. It sends a device token in a request header.

See [`KDSAPIClient.swift`](../../apps/umi-kds/Sources/Data/KDSAPIClient.swift).

**Umi-specific inference:** The client language has little effect on backend ownership. Both options can consume this contract.

### 3.2 POS contract status

**Documented fact:** The current contract package includes `pos` as a product entitlement.

See [`packages/contract/src/entitlements.ts`](../../packages/contract/src/entitlements.ts).

**Documented fact:** The current repository has no implemented `apps/umi-api/src/modules/pos/` module.

**Documented fact:** The current contract package has no released POS route manifest or client emitter.

The dated seam proposal defines:

- a neutral JSON contract artifact;
- versioned `/api/v{major}` routes;
- device authentication;
- idempotency metadata;
- generated Dart models.

See [`2026-07-20-umipos-contract-seam.md`](../architecture/2026-07-20-umipos-contract-seam.md).

**Umi-specific inference:** Dart generation currently fits the proposal. Kotlin generation remains technically possible from the same neutral artifact.

The unfinished generator must not decide the framework. The hardware and delivery model must decide it.

### 3.3 Operational needs

The POS needs more than a UI framework.

- It needs a persistent offline command journal.
- It needs ordered replay with idempotency keys.
- It needs exact money rules.
- It needs printer, scanner, drawer, and payment ports.
- It needs long device sessions and device revocation.

The KDS needs:

- a landscape board;
- fast touch actions;
- reconnect and reconciliation behavior;
- an optional local cache;
- long foreground sessions.

**Umi-specific inference:** Offline correctness stays in the shared application layer. Native UI access does not solve replay correctness.

## 4. Current official platform status

### 4.1 Flutter

**Documented fact:** Flutter 3.44.7 supports Android, iOS, Windows, macOS, Linux, and web.

The current support table includes Android API 24 through 37. It also includes iOS 13 through 26.

Source: [Flutter supported deployment platforms](https://docs.flutter.dev/reference/supported-platforms).

**Documented fact:** Flutter compiles mobile and desktop releases to machine code.

Flutter uses platform channels for Kotlin or Swift code. Flutter also supports native calls through FFI.

Source: [Flutter architectural overview](https://docs.flutter.dev/resources/architectural-overview).

**Documented fact:** A Flutter plugin can contain Dart, Kotlin, Java, Swift, or Objective-C code.

Flutter supports federated plugins with separate platform implementations.

Source: [Developing Flutter packages and plugins](https://docs.flutter.dev/packages-and-plugins/developing-packages).

**Documented fact:** Flutter has stateful hot reload on a physical or virtual mobile device.

Native Kotlin or Swift changes still require a full restart.

Source: [Flutter hot reload](https://docs.flutter.dev/tools/hot-reload).

**Documented fact:** Flutter publishes official patterns for offline-first repositories and SQL storage.

Sources:

- [Flutter offline-first support](https://docs.flutter.dev/app-architecture/design-patterns/offline-first)
- [Flutter SQL storage architecture](https://docs.flutter.dev/app-architecture/design-patterns/sql)

**Documented fact:** Flutter has an active 2026 roadmap.

The roadmap includes Android renderer work, platform support, tooling, and open-source governance.

Source: [Flutter and Dart 2026 roadmap](https://blog.flutter.dev/flutter-darts-2026-roadmap-89378f17ebbd).

### 4.2 Kotlin Multiplatform and Compose Multiplatform

This comparison means Kotlin Multiplatform with shared Compose UI. Logic-only KMP requires separate UI implementations.

**Documented fact:** Google officially supports KMP for shared Android and iOS business logic.

Google calls KMP stable and production-ready. Google identifies Compose Multiplatform as the shared UI option.

Source: [Kotlin Multiplatform on Android Developers](https://developer.android.com/kotlin/multiplatform).

**Documented fact:** Core KMP is stable for Android, iOS, and JVM desktop.

Compose Multiplatform is also stable for Android, iOS, and desktop. Its Wasm web target is Beta.

Source: [KMP platform stability](https://kotlinlang.org/docs/multiplatform/supported-platforms.html).

**Documented fact:** Compose Multiplatform 1.11.1 supports Android 5, iOS 14, macOS 13, Windows 10, and Ubuntu 20.04.

Current Compose releases support 64-bit targets.

Source: [Compose compatibility and versions](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html).

**Documented fact:** Compose Multiplatform for iOS became stable in May 2025.

Source: [Compose Multiplatform 1.8.0 release](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/).

**Documented fact:** Shared Kotlin code can call platform APIs through platform source sets.

The `expect` and `actual` mechanism checks that each target has an implementation.

Sources:

- [Expected and actual declarations](https://kotlinlang.org/docs/multiplatform/multiplatform-expect-actual.html)
- [Use platform-specific APIs](https://kotlinlang.org/docs/multiplatform/multiplatform-connect-to-apis.html)

**Documented fact:** Android-specific dependencies use the normal Android dependency workflow.

Source: [Add Android dependencies to KMP](https://kotlinlang.org/docs/multiplatform/multiplatform-android-dependencies.html).

**Documented fact:** iOS integration uses a generated framework and an Xcode project.

Supported integration methods include direct build integration, SwiftPM, and CocoaPods.

Source: [KMP iOS integration methods](https://kotlinlang.org/docs/multiplatform/multiplatform-ios-integration-overview.html).

**Documented fact:** Kotlin Swift export and direct Swift package import remain pre-stable.

This can require a thin Swift adapter for a Swift-only vendor SDK.

Sources:

- [Kotlin Swift export](https://kotlinlang.org/docs/native-swift-export.html)
- [Import Swift packages into KMP](https://kotlinlang.org/docs/multiplatform/multiplatform-spm-import.html)

**Documented fact:** Room supports Kotlin Multiplatform.

Its platform setup and SQLite driver rules still differ from Android-only Room.

Source: [Set up Room for KMP](https://developer.android.com/kotlin/multiplatform/room).

**Documented fact:** Compose hot reload runs on the JVM desktop target.

Developers can use a desktop target for fast UI work. They must still verify the iOS and Android targets.

Source: [Compose platform specifics](https://kotlinlang.org/docs/multiplatform/compose-platform-specifics.html).

## 5. Source-backed tradeoffs

### 5.1 Shared UI

Both options support a shared Android and iOS UI.

Flutter started as a shared UI framework. Its tools and package model follow that design.

KMP lets a team select the sharing level. A team can share logic, UI, or both.

**Tradeoff:** Flutter gives Umi one direct path. KMP gives Umi more architectural choices.

More choices can help a large native team. They can also add decisions for a small team.

### 5.2 Native hardware access

Flutter uses a plugin boundary for native SDK access. The boundary can use a platform channel or FFI.

KMP Android source can add a vendor Android dependency directly. Shared code calls it through a platform interface.

**Tradeoff:** KMP has the shorter path to an Android-only vendor SDK.

Flutter can reach the same SDK. It adds a Dart-to-native adapter and related tests.

This difference matters for a POS. It matters less for the KDS.

Current vendor examples show why the hardware model must come first.

Epson publishes native Android and iOS POS SDKs. Some transport support differs between those platforms.

Source: [Epson ePOS SDK platform support](https://download4.epson.biz/sec_pubs/pos/reference_en/technology/epson_epos_sdk.html).

Stripe Terminal lists Android, iOS, JavaScript, and React Native SDKs. It does not list Flutter or KMP SDKs.

Sources:

- [Stripe Terminal integration options](https://docs.stripe.com/terminal/payments/setup-integration)
- [Stripe Terminal overview](https://docs.stripe.com/terminal/overview)

**Tradeoff:** KMP can use the Android Stripe SDK through normal Android source code.

Both options can require an adapter for iOS or for a shared client interface.

### 5.3 iPad integration

Flutter can call Swift or Objective-C code through a plugin.

KMP can call supported Apple APIs from Kotlin/Native. It still needs an iOS app target and Xcode integration.

**Tradeoff:** KMP gives more direct native source access. Flutter gives a more uniform shared app model.

Umi does not need many iPad system features today. The KDS uses touch, networking, secure storage, and device state.

### 5.4 Offline storage

Flutter has official offline-first guidance and SQL storage patterns.

KMP has a shared Room option and other multiplatform storage choices.

**Tradeoff:** Both can implement the required local journal.

Neither framework supplies Umi replay semantics. Umi must define ordering, retries, conflicts, and final acknowledgement.

### 5.5 Developer feedback cycle

Flutter hot reload works on mobile targets and keeps app state.

Compose hot reload uses the JVM desktop target. Mobile verification remains a separate step.

**Tradeoff:** Flutter gives faster direct work on the actual KDS and POS device.

KMP can still give a fast desktop preview loop. It adds a target switch before device verification.

### 5.6 Performance

Flutter and KMP use different rendering and runtime paths.

Flutter renders through its engine. Compose uses Jetpack Compose on Android and Kotlin/Native on iOS.

**Tradeoff:** Public framework benchmarks do not predict Umi field performance.

Umi must measure:

- ticket board frame times;
- startup time;
- memory after an eight-hour shift;
- printer latency;
- reconnect time;
- offline replay time.

No current official source proves a general winner for this workload.

### 5.7 API fit

Both options support JSON, HTTP, secure local storage, and generated models.

The Umi contract artifact is language-neutral by design.

**Tradeoff:** Generate Dart for Flutter or Kotlin for KMP from the same neutral artifact.

The existing Dart proposal gives Flutter no score in this greenfield comparison.

## 6. Developer climate

Community data is a support signal. It is not a product benchmark.

### 6.1 Measurable support surface

The following counts were read on 2026-07-25:

| Signal                   | Flutter |                 Kotlin Multiplatform or Compose |
| ------------------------ | ------: | ----------------------------------------------: |
| GitHub stars             | 177,938 |                19,244 for Compose Multiplatform |
| Stack Overflow questions | 200,416 | 2,203 for KMP and 351 for Compose Multiplatform |

Sources:

- [Flutter GitHub repository](https://github.com/flutter/flutter)
- [Compose Multiplatform GitHub repository](https://github.com/JetBrains/compose-multiplatform)
- [Stack Exchange Flutter tag API](https://api.stackexchange.com/2.3/questions?site=stackoverflow&tagged=flutter&pagesize=1&filter=total)
- [Stack Exchange KMP tag API](https://api.stackexchange.com/2.3/questions?site=stackoverflow&tagged=kotlin-multiplatform&pagesize=1&filter=total)
- [Stack Exchange Compose tag API](https://api.stackexchange.com/2.3/questions?site=stackoverflow&tagged=compose-multiplatform&pagesize=1&filter=total)

These counts have important limits:

- Flutter is older.
- KMP questions can use broader Kotlin or Android tags.
- Stars do not measure production quality.
- Question volume can include old or low-quality material.

**Source-backed tradeoff:** Flutter has a much larger searchable support surface today.

**Documented fact:** JetBrains reports KMP use growth from 7 percent in 2024 to 18 percent in 2025.

This source comes from the KMP vendor. Treat it as an adoption trend, not a market-share estimate.

Source: [JetBrains KMP adoption reasons](https://kotlinlang.org/docs/multiplatform/multiplatform-reasons-to-try.html).

### 6.2 Forum and social sentiment

Recent discussion has a consistent split.

Flutter supporters cite:

- faster delivery;
- stateful hot reload;
- a larger package ecosystem;
- one uniform UI model.

KMP supporters cite:

- Kotlin preference;
- direct native API access;
- normal Android SDK use;
- the option to keep native SwiftUI.

Common Flutter concerns include:

- dependence on Dart;
- plugin quality for specialized hardware;
- concern about long-term Google commitment.

Common KMP concerns include:

- Gradle and version compatibility;
- a smaller multiplatform library set;
- iOS build and integration work;
- less direct mobile hot reload.

Representative threads:

- [r/Kotlin: Flutter or KMP in 2025](https://www.reddit.com/r/Kotlin/comments/1ogi1lx/best_crossplatform_framework_to_learn_in_2025/)
- [r/androiddev: Why use KMP or Flutter](https://www.reddit.com/r/androiddev/comments/1j5q1mw/for_any_devs_using_kotlin_multiplatform_or/)
- [r/Kotlin: Compose iOS stable release discussion](https://www.reddit.com/r/Kotlin/comments/1kgafgh/compose_multiplatform_for_ios_is_stable_and/)
- [r/FlutterDev: July 2026 Flutter job and KMP discussion](https://www.reddit.com/r/FlutterDev/comments/1v51e4o/is_it_just_me_or_are_flutter_devs_getting_hit/)
- [Hacker News: Flutter production and project-risk discussion](https://news.ycombinator.com/item?id=44848843)

These sources contain personal reports and strong selection bias.

One March 2025 thread called Compose iOS immature. That claim predates the May 2025 stable release.

**Community signal:** Flutter feels safer for general cross-platform delivery.

**Community signal:** KMP feels safer when native Android access is the main concern.

The job-market comments are regional and inconsistent. They do not support a hiring winner for Umi.

## 7. Umi decision matrix

This matrix is a decision aid. It is not a measured benchmark.

Scores use a scale from 1 to 5. Higher is better for the stated Umi assumptions.

| Criterion                 |   Weight |  Flutter | KMP with Compose | Basis                                             |
| ------------------------- | -------: | -------: | ---------------: | ------------------------------------------------- |
| Shared app foundations    |      20% |      5.0 |              4.0 | Flutter has one direct shared-app model.          |
| Shared operator UI        |      15% |      5.0 |              4.0 | Both work. Flutter has the longer stable history. |
| POS hardware access       |      20% |      3.0 |              5.0 | KMP uses Android vendor SDKs directly.            |
| Offline journal           |      15% |      4.0 |              4.0 | Both have credible SQL paths.                     |
| Small-team feedback cycle |      15% |      5.0 |              3.5 | Flutter reloads the actual mobile target.         |
| Support surface           |      10% |      5.0 |              3.0 | Flutter has more searchable material.             |
| Native escape path        |       5% |      3.5 |              5.0 | KMP stays closer to native source sets.           |
| **Weighted result**       | **100%** | **4.38** |         **4.08** | Flutter wins under the current assumptions.       |

The hardware score has the largest uncertainty.

If the selected terminal requires a difficult vendor SDK, KMP can win the matrix. The proof must use the final hardware model.

## 8. Recommended Flutter shape

Create two executables.

```text
apps/
  umi-pos/
  umi-kds-next/
packages/
  device_client/
  umi_contract/
  offline_journal/
  hardware_ports/
  design_tokens/
```

Share these concerns:

- device enrollment;
- token storage;
- HTTP transport;
- contract models;
- retry policy;
- offline journal primitives;
- telemetry fields;
- design tokens;
- hardware port interfaces.

Keep these concerns separate:

- POS cart;
- checkout;
- payment;
- cash shift;
- KDS board;
- ticket transitions;
- kitchen reconciliation.

Use owned plugins for certified hardware. Wrap each vendor SDK behind a narrow Dart interface.

Do not depend on an unverified community printer package for production.

Keep the server as the source of truth. The local journal stores pending commands only.

## 9. Required hardware proof

Complete this proof before the final framework lock.

Use the actual Android terminal, iPad, printer, scanner, drawer, and payment device.

### 9.1 Hard pass criteria

The Flutter proof must:

1. Print 500 receipts without a lost or duplicate receipt.
2. Open the drawer only after the approved command.
3. Scan 500 barcodes without a stuck input session.
4. Recover after Bluetooth, USB, and network interruptions.
5. Preserve every queued sale after a forced process stop.
6. Replay each accepted command exactly once.
7. Run an eight-hour shift without harmful memory growth.
8. Keep the KDS board responsive during polling and reconciliation.
9. Store device secrets in the platform secure store.
10. Produce release builds for the final Android and iPad targets.

The test must record:

- framework version;
- operating system version;
- vendor SDK version;
- device firmware;
- connection type;
- failure logs;
- recovery time.

### 9.2 Decision rule

Adopt Flutter when all hard criteria pass.

Adopt KMP when Flutter fails because the native SDK boundary is unsafe or incomplete.

Fix application defects before a framework change. Change the framework only for a structural platform limit.

## 10. Risks and controls

| Risk                                         | Option  | Control                                                  |
| -------------------------------------------- | ------- | -------------------------------------------------------- |
| An abandoned hardware plugin blocks release. | Flutter | Own the plugin and wrap the certified vendor SDK.        |
| Gradle or Xcode versions break the build.    | KMP     | Pin the complete version matrix and test it in macOS CI. |
| Shared code couples POS and KDS domains.     | Both    | Share infrastructure packages only.                      |
| Offline replay duplicates a sale.            | Both    | Require idempotency keys and server result lookup.       |
| A framework upgrade changes rendering.       | Both    | Pin versions and run device golden tests.                |
| iPad support excludes an old device.         | KMP     | Verify that every target iPad supports iOS 14.           |
| Community sentiment drives the decision.     | Both    | Use the hardware proof and measured shift tests.         |

## 11. Final conclusion

Flutter is the better greenfield choice for Umi today.

The Umi API does not require Flutter. Umi’s delivery model makes Flutter the better fit.

KMP is now stable enough for production. It remains the strongest fallback for native Android hardware access.

Approve Flutter only after the certified hardware proof passes. This condition protects the POS from the main Flutter risk.
