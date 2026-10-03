# Pos runtime for low-end hardware

- Date: 2026-10-01
- Question: which UI runtime gives UmiPOS the best use of low-end hardware, and how far can Umi leave Flutter?
- Target hardware: a low-end PC, a low-end Android tablet, and a low-end Android phone. The phone runs some modules only. The design target is 4 GB of RAM. The floor is 2 GB of RAM.
- Scope: the Flutter POS in `apps/umi-pos`. The dashboard and the API are out of scope.
- Method: vendor documentation and source first. Primary research second. One local measurement of the running app.

Labels: **Documented fact**, **Source-backed tradeoff**, **Inference**, **UNVERIFIED**.

## 1. Answer

**Inference.** Keep Flutter as the runtime of UmiPOS. Do not rewrite the runtime in Rust. Get the design freedom from a Material-free widget layer, not from a new engine.

Three facts drive this answer.

1. Flutter starts at Android API 24, and Android 13 (Go edition) starts at 2 GB of RAM. A 2 GB Android device runs Flutter today. **Documented fact** (§3).
2. The Rust UI toolkits each fail one hard rule: licence, platform coverage, or maturity. Slint costs money for a POS terminal. Iced has no mobile target. Xilem is experimental. **Documented fact** (§6).
3. The large memory cost in this app is the debug build and the UI work, not the Dart language. The language is not the lever. **Inference** (§4, §7).

**Inference.** The real win is a release-build measurement and a memory budget per device. A runtime rewrite does not replace that work.

## 2. Method and source log

The research used these routes.

| Route                            | Result                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `docs.flutter.dev`               | Full access. Used for platform limits and the renderer.      |
| `source.android.com` Android CDD | Full access. Used for the memory tiers.                      |
| `developer.android.com`          | Full access. Used for Android (Go edition).                  |
| OpenAlex API                     | Full access. Used to find primary research.                  |
| arXiv API                        | Full access. Used to check for new studies.                  |
| Vendor sites and GitHub          | Full access. Used for the Rust toolkits and Qt.              |
| Semantic Scholar API             | Blocked. HTTP 429 rate limit.                                |
| DuckDuckGo HTML                  | Blocked. Bot challenge page.                                 |
| SearXNG (`searx.be`)             | Blocked. Bot challenge page.                                 |
| Springer full text               | Blocked. Paywall page. Recovered from the Brunel repository. |
| ACM `dl.acm.org` PDF             | Blocked. HTTP 403.                                           |
| UTFPR repository                 | Blocked. Connection timeout on port 8080.                    |
| `doria.fi` thesis PDF            | Blocked. HTTP 403.                                           |

**Inference.** The academic record on Flutter memory is thin. Most studies measure old Flutter versions. Treat every academic number as a trend, not as the current cost of Flutter 3.47.

## 3. The hardware envelope

### 3.1 Android memory tiers

**Documented fact.** The Android 15 CDD sets the memory tiers. These values are the "memory available to the kernel and userspace".

| Device memory     | CDD rule                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Under 1 GB        | MUST return true for `ActivityManager.isLowRamDevice()`, and MUST declare `android.hardware.ram.low`. |
| Under 2 GB        | MUST support only a single ABI.                                                                       |
| 2 GB to 4 GB      | STRONGLY RECOMMENDED to support only 32-bit userspace.                                                |
| 64-bit, up to HD+ | MUST have at least 944 MB.                                                                            |
| 64-bit, up to FHD | MUST have at least 1280 MB.                                                                           |
| 64-bit, up to QHD | MUST have at least 1824 MB.                                                                           |

Source: [Android 15 CDD, section 7.6.1](https://source.android.com/docs/compatibility/15/android-15-cdd).

**Documented fact.** Android (Go edition) sets a minimum RAM for each release. The 2 GB floor is recent.

| Release           | Minimum RAM |
| ----------------- | ----------- |
| Android 8.1 to 10 | 512 MB      |
| Android 11 to 12  | 1 GB        |
| Android 13        | 2 GB        |

Source: [Android (Go edition) specifications](https://developer.android.com/guide/topics/androidgo).

**Documented fact.** The CDD also sets a smoothness bar. Inconsistent frame latency MUST NOT happen more than 5 frames in one second, and SHOULD stay below 1 frame in one second.

Source: same CDD, section 8.1.

### 3.2 What this means for Umi

**Inference.** The working floor is 2 GB, because Android 13 Go starts there. A 2 GB device is a 32-bit or a single-ABI device, and the CDD classifies it as memory-tight. The app must fit a small budget on that device. The budget must cover the app plus the operating system plus the web view and other processes.

**Inference.** The phone case is the hardest case. The phone runs "certain modules". Those modules must hold a much smaller memory budget than the till.

## 4. What the runtime costs

### 4.1 A local measurement of the real app

The POS ran on this workstation during the research. The build was a **debug** Linux desktop build.

| Metric                    | Value                                  |
| ------------------------- | -------------------------------------- |
| Process                   | `build/linux/x64/debug/bundle/umi_pos` |
| VmRSS                     | 596 MB                                 |
| PSS                       | 519 MB                                 |
| Private dirty (anonymous) | 422 MB                                 |
| Threads                   | 46                                     |
| Bundle size on disk       | 124 MB                                 |

Command: read `/proc/<pid>/status` and `/proc/<pid>/smaps_rollup`.

**Inference.** This number is not the product number. A debug build keeps the Dart VM, the just-in-time compiler, the service isolate, and the kernel blob. A release build is ahead-of-time compiled and much smaller. Do not quote 596 MB as the cost of the till.

**Inference.** This measurement shows the size of the debug-and-release gap. The gap is the first lever, and it is free.

### 4.2 The Flutter engine

**Documented fact.** Flutter supports Android API 24 to 37. API 23 and earlier are unsupported. Flutter also supports arm32, arm64, and x64 on Android.

Source: [Flutter supported deployment platforms](https://docs.flutter.dev/reference/supported-platforms).

**Documented fact.** Impeller is the default renderer on Android API 29 and later. On older Android versions, and on devices without Vulkan, Impeller falls back to the legacy OpenGL renderer. The fallback needs no action from the developer.

Source: [Flutter Impeller](https://docs.flutter.dev/perf/impeller).

**Source-backed tradeoff.** Impeller removes most shader-compilation jank. The OpenGL fallback keeps old and cheap devices working. The fallback can be slower than the Vulkan path on the same device class.

**Inference.** A low-end device without Vulkan runs the OpenGL path. Umi must measure that path. Do not assume the Vulkan performance on a device that lacks Vulkan.

### 4.3 The academic measurements

**Documented fact.** One study built the same app in six technologies and measured it on physical Android devices. The APK sizes were:

| Technology       | Version | APK size |
| ---------------- | ------- | -------- |
| Native Android   | –       | 2.7 MB   |
| Model-driven DSL | –       | 3.2 MB   |
| React Native     | 0.53.2  | 9.7 MB   |
| Ionic            | 3.9.2   | 10.3 MB  |
| NativeScript     | 3.4.1   | 30.2 MB  |
| Flutter          | 0.5.1   | 32.8 MB  |

Source: [An empirical investigation of performance overhead in cross-platform mobile development frameworks](https://doi.org/10.1007/s10664-020-09827-6), _Empirical Software Engineering_, 2020.

**Documented fact.** The same study reports that Flutter had the highest idle-state memory of all tested frameworks, "up to a tenfold increase for the geolocation task compared to native". Flutter used little extra memory during a task.

Source: same study.

**Source-backed tradeoff.** Flutter version 0.5.1 is from before Flutter 1.0. The absolute numbers are not current. The trend is repeated in later work, so the direction is credible and the values are not.

**Documented fact.** A 2025 review of Jetpack Compose performance reports two conclusions from earlier studies. Study [9] found that Flutter used less CPU and more memory than Jetpack Compose. Study [11] compared Java, Flutter, and Kotlin/Native, and found Java best and Flutter worst for install size, startup time, and RAM, with Flutter best on CPU.

Source: [Performance analysis of Jetpack Compose components in mobile applications](https://ph.pollub.pl/index.php/jcsi/article/download/7914/5284), 2025.

**Inference.** Across independent studies, the pattern holds: Flutter trades memory for CPU. For a till, memory is the scarce resource on a 2 GB device. Plan for the memory cost, and benefit from the lower CPU cost.

## 5. Candidate comparison

| Runtime                       | Language              | Android | Linux desktop | iOS    | Memory profile                         | Licence                           | Maturity        |
| ----------------------------- | --------------------- | ------- | ------------- | ------ | -------------------------------------- | --------------------------------- | --------------- |
| Flutter (current)             | Dart                  | API 24+ | Yes           | Yes    | Higher RAM, lower CPU                  | BSD-3                             | High            |
| Compose Multiplatform         | Kotlin                | Yes     | Yes           | Stable | JVM on desktop, ART on Android         | Apache-2.0                        | High on Android |
| Android native (Kotlin/Views) | Kotlin                | Yes     | No            | No     | Lowest RAM in studies                  | Apache-2.0                        | High            |
| Slint                         | Rust, C++, JS, Python | Yes     | Yes           | Yes    | "Less than 300KiB RAM" runtime claim   | GPLv3 / Royalty-free / Commercial | Medium          |
| egui (eframe)                 | Rust                  | Yes     | Yes           | No     | Low, immediate mode redraws each frame | MIT / Apache-2.0                  | Medium          |
| iced                          | Rust                  | No      | Yes           | No     | Low, retained mode                     | MIT                               | Medium          |
| Xilem / Masonry               | Rust                  | No      | Yes           | No     | Prose only                             | Apache-2.0                        | Experimental    |
| Dioxus                        | Rust                  | Yes     | Yes           | Yes    | Web view or experimental WGPU renderer | MIT / Apache-2.0                  | Medium          |
| Qt Quick / QML                | C++ / QML             | Yes     | Yes           | Yes    | UNVERIFIED in this research            | GPL / Commercial / LGPL           | High            |
| Tauri                         | Rust + web UI         | Yes     | Yes           | Yes    | Web view memory, small bundle          | MIT / Apache-2.0                  | Medium          |
| Electron                      | JS + web UI           | Limited | Yes           | No     | Bundles Chromium, high                 | MIT                               | High            |

## 6. The candidates in detail

### 6.1 Flutter (current)

**Documented fact.** One Flutter binary serves Linux desktop, Android, and iOS from one Dart codebase. This repository has an ADR that makes the native build the runtime of record.

Source: [The POS is a native app](../architecture/2026-09-16-pos-is-a-native-app.md).

**Source-backed tradeoff.** Flutter owns its rendering. Umi gets pixel control on every platform. Umi also pays the engine's memory on every platform.

**Inference.** Flutter already meets the multi-form-factor rule for this product. The desktop build, the tablet build, and the phone build come from the same source.

### 6.2 Compose Multiplatform and Android native

**Documented fact.** Compose Multiplatform shares one UI across Android, iOS, desktop, and web. It uses Jetpack Compose APIs and Material components.

Source: [Compose Multiplatform](https://www.jetbrains.com/compose-multiplatform/).

**Documented fact.** JetBrains publishes a customer report. One app with 100+ screens is "fully optimized to run on low-end devices and slow networks", with an Android size under 10 MB.

Source: same page. This is a vendor case study, not a controlled measurement.

**Source-backed tradeoff.** Compose Multiplatform is strong on Android and adds a Java runtime on desktop. That runtime is a new memory cost on the low-end PC. Compose also brings Material by default, which is the look Umi wants to leave.

**Inference.** Compose is the best alternative if Umi leaves Flutter. It costs a full UI rewrite for a small design gain.

### 6.3 Slint

**Documented fact.** Slint compiles the UI description to machine code. Slint selects a rendering method per device: GPU, DMA2D, framebuffer, or line-by-line. Slint claims a runtime footprint "less than 300KiB RAM".

Source: [Slint](https://slint.dev/).

**Documented fact.** Slint has Android support in the source tree, including `api/rs/slint/android.rs` and an Android continuous-integration job.

Source: `slint-ui/slint` repository tree, read 2026-10-01.

**Documented fact, and the decisive one.** The Slint royalty-free licence does not cover embedded systems. The Slint FAQ names a point-of-sale terminal as an example of an embedded system. A proprietary POS on Slint needs the Commercial licence, or the GPLv3.

Source: [Slint FAQ](https://github.com/slint-ui/slint/blob/master/FAQ.md).

**Inference.** Slint is the strongest Rust candidate on footprint. The licence is the blocker for a closed POS product. Treat the Commercial licence as a purchase, and treat the GPLv3 as a product decision, not a technical one.

### 6.4 egui, iced, Xilem, Dioxus

**Documented fact.** egui is an immediate-mode library. It redraws the interface every frame. eframe supports web, Linux, macOS, Windows, and Android, but not iOS. The authors state that immediate mode is easier to use and less powerful, and that layout is its main weakness.

Source: [egui](https://github.com/emilk/egui).

**Documented fact.** iced is a retained-mode library in the Elm style. It supports Windows, macOS, Linux, and web. It does not list Android or iOS.

Source: [iced](https://github.com/iced-rs/iced).

**Documented fact.** Xilem is an experimental Rust architecture. It uses the Masonry retained widget tree. The repository marks it as experimental.

Source: [Xilem](https://github.com/linebender/xilem).

**Documented fact.** Dioxus builds for web, desktop, and mobile. It styles the UI with HTML and CSS. It renders with a web view, or with an experimental WGPU renderer.

Source: [Dioxus](https://github.com/DioxusLabs/dioxus).

**Source-backed tradeoff.** A per-frame redraw costs CPU on every idle screen. That cost suits a 60 fps game loop. A till spends most of its time on a still screen.

**Inference.** Iced fails the platform rule for the phone and tablet. Xilem fails the maturity rule. Dioxus and egui put a web view or a per-frame redraw in the path.

### 6.5 Qt Quick and the web-view runtimes

**Documented fact.** Tauri uses the web view of the operating system. A minimal Tauri app "can be less than 600KB in size".

Source: [Tauri](https://v2.tauri.app/start/).

**Source-backed tradeoff.** The Tauri number is bundle size, not memory. The memory of a web-view app is the memory of the web view. On Android, that is the system WebView, which is a second browser engine next to the operating system.

**Documented fact.** Electron bundles Chromium. Its own performance guide treats memory, CPU, and disk as the main concerns.

Source: [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance).

**UNVERIFIED.** This research did not find a primary Qt memory figure for a low-end Android device.

**Inference.** A web-view runtime adds a browser engine to a 2 GB device. That is the wrong direction for the floor case.

## 7. The Umi-specific facts that change the cost

**Documented fact.** The POS hardware layer uses network sockets, not Flutter platform channels. The printer adapter reports the transport `network_tcp`. The cash drawer reports `printer_attached`. The byte transport is a plain Dart `Socket`.

Sources: `apps/umi-pos/lib/features/hardware/hardware_socket_client_io.dart` and `thermal_printer_adapter.dart`.

**Inference.** The hardware is decoupled from the UI runtime. A different UI runtime could speak the same socket protocol. This lowers the cost of a runtime change, and it removes the usual "the plugins hold us" argument.

**Documented fact.** The app has three Flutter plugins with platform code: `flutter_secure_storage`, `shared_preferences`, and `connectivity_plus`.

Source: `apps/umi-pos/pubspec.yaml`.

**Documented fact.** The app is about 49,500 lines of Dart across 107 files. It uses Material widgets heavily: 84 `FilledButton`, 77 `TextButton`, 50 `showDialog`, 46 `AlertDialog`, and 46 `TextField`.

Source: count over `apps/umi-pos/lib`, 2026-10-01.

**Inference.** A runtime rewrite discards this code, its tests, and its learned behaviour. A widget-layer rewrite keeps it. The second option costs much less.

## 8. How far can Umi leave Flutter?

**Documented fact.** Flutter is built in layers. Above the engine sit `dart:ui`, then the painting, rendering, and widgets layers, then the Material and Cupertino libraries. An application can import `package:flutter/widgets.dart` alone.

Source: [Flutter architectural overview](https://docs.flutter.dev/resources/architectural-overview).

**Inference.** Umi can remove Material completely and keep the runtime. The floor is `flutter/widgets.dart` plus `dart:ui`. Umi keeps layout, hit testing, gestures, focus, animation, and overlays. Umi loses the Material button, menu, dialog, and theme vocabulary, and the Material Icons font.

**Inference.** Removing Material gives design freedom. It does not give a large speed gain, because Material is Dart code over the same render objects.

## 9. Conclusion

**Inference.** Umi should keep Flutter and remove Material from the UI.

The reasons are:

1. Flutter meets the platform rule. One codebase serves the low-end PC, the tablet, and the phone.
2. Flutter meets the floor. API 24 and Android 13 Go at 2 GB are both supported today.
3. The alternatives fail a hard rule. Slint needs a paid licence for a POS. Iced has no mobile target. Xilem is experimental. Tauri and Electron add a browser engine.
4. The migration cost is real. A runtime rewrite discards about 49,500 lines of Dart and its test suite.
5. The hardware layer survives a runtime change, because it uses sockets. This helps a later decision. It is not a reason to decide now.
6. The memory win is in the build mode and the UI work, not in the language.

**Inference.** The design goal and the memory goal do not conflict. A Material-free widget layer serves both.

## 10. What to measure next

The conclusion is only as good as the numbers behind it. Measure these items in this order.

1. Build a **release** Linux binary and measure RSS and PSS. Compare it with the 596 MB debug value in §4.1.
2. Install a release Android build on the real tablet and the real phone. Measure with `adb shell dumpsys meminfo <package>`.
3. Record the cold start time on each device.
4. Record the jank count against the CDD bar: below 1 inconsistent frame in one second.
5. Set a memory budget per device class. Test the budget before the design work starts.
6. Test on one device without Vulkan, to exercise the OpenGL fallback.

## 11. Facts that would change the answer

Change the recommendation if any of these becomes true.

- A release build on the 2 GB device exceeds the memory budget after normal optimisation.
- The measured jank rate stays above the CDD bar on the target device.
- Umi needs a second runtime for the phone, and the two runtimes diverge.
- The vendor grants a Slint licence that covers a POS terminal at no cost, and the team accepts the migration cost.
- The hardware moves from sockets to platform-native drivers, and a plugin gap appears.

## 12. Sources

- [Android 15 Compatibility Definition Document](https://source.android.com/docs/compatibility/15/android-15-cdd)
- [Android (Go edition) specifications](https://developer.android.com/guide/topics/androidgo)
- [Flutter supported deployment platforms](https://docs.flutter.dev/reference/supported-platforms)
- [Flutter Impeller](https://docs.flutter.dev/perf/impeller)
- [Flutter architectural overview](https://docs.flutter.dev/resources/architectural-overview)
- [An empirical investigation of performance overhead in cross-platform mobile development frameworks](https://doi.org/10.1007/s10664-020-09827-6)
- [Performance analysis of Jetpack Compose components in mobile applications](https://ph.pollub.pl/index.php/jcsi/article/download/7914/5284)
- [Compose Multiplatform](https://www.jetbrains.com/compose-multiplatform/)
- [Slint](https://slint.dev/)
- [Slint FAQ](https://github.com/slint-ui/slint/blob/master/FAQ.md)
- [egui](https://github.com/emilk/egui)
- [iced](https://github.com/iced-rs/iced)
- [Xilem](https://github.com/linebender/xilem)
- [Dioxus](https://github.com/DioxusLabs/dioxus)
- [Tauri](https://v2.tauri.app/start/)
- [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- Local measurement: `/proc/<pid>/status` and `/proc/<pid>/smaps_rollup` for the running `umi_pos` process, 2026-10-01.
