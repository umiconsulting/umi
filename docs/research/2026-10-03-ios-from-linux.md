# Building and testing UmiPOS for iOS from Linux

- Date: 2026-10-03
- Question: the iOS target in `apps/umi-pos` has never been built. The developer has a Linux machine and a real iPhone, and no Mac. What can he do, and what is the better approach?
- Scope: building, signing, and installing UmiPOS on iOS. Not the App Store release process.
- Method: primary sources only. Vendor documentation first, then the source repositories of the tools.

Labels: **Documented fact**, **Source-backed tradeoff**, **Inference**, **UNVERIFIED**.

## 1. Answer

**Documented fact.** Xcode is required to build an iOS app, and Xcode runs on macOS only. Flutter's own iOS deployment guide states it plainly: "Xcode is required to build and release your app. You must use a device running macOS to follow this guide." The current Xcode is also Apple-silicon only ([Xcode on the App Store](https://apps.apple.com/us/app/xcode/id497799835)).

**Inference.** So the constraint is not "own a Mac". The constraint is "have access to macOS somewhere". Four things follow.

1. Do not build iOS locally. Build it in CI on a hosted macOS runner.
2. Sign it in the same place, or sign the artifact on Linux with `zsign`.
3. Install it on the iPhone through TestFlight. That path needs no Mac, no cable, no UDID, and no Developer Mode.
4. Keep the Dart work on Linux, where `flutter test` already runs.

**Inference.** The recommended path is a hosted macOS CI job that builds, signs, and uploads to TestFlight. The Linux-side tools exist and work, but they are the harder route for the same result.

## 2. What the sources establish

### 2.1 The build needs macOS

**Documented fact.** Flutter: "Xcode is required to build and release your app. You must use a device running macOS to follow this guide." ([Flutter iOS deployment](https://docs.flutter.dev/deployment/ios)).

**Documented fact.** Xcode 27 "Requires macOS 26.6 or later and a Mac with Apple M1 chip or later" ([App Store](https://apps.apple.com/us/app/xcode/id497799835)).

**Inference.** An Intel Mac can no longer run current Xcode. This matters when renting a cloud Mac.

### 2.2 The install does not need Xcode

**Documented fact.** TestFlight: testers "use the TestFlight app to view your invite and install your beta", and "you don't need to keep track of UDIDs, or provision tester profiles" ([Apple TestFlight](https://developer.apple.com/testflight/)).

**Documented fact.** Developer Mode is not needed for TestFlight. Apple: the feature "doesn't affect ordinary installation techniques, such as buying apps from the App Store or participating in a TestFlight team. Instead, Developer Mode focuses on scenarios like building and running an app from Xcode, or installing an `.ipa` file with [Apple Configurator]..." ([Apple: enabling Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)).

**Documented fact.** A beta build must be uploaded to App Store Connect first. TestFlight shares "up to 100 builds", and testers can hold them "on up to 30 devices" (same Apple page).

**Documented fact.** External testers need beta app review. Apple requires "your beta app description and beta app review information... in order to share your beta with external testers" (same Apple page).

**Inference.** An internal tester group is the fast loop. It skips review. Put the developer's own Apple ID in it.

### 2.3 Signing can be done on Linux

**Documented fact.** `zsign` describes itself as "a fast, open-source, cross-platform `codesign` alternative for iOS 12+. It re-signs `.ipa` packages, Mach-O binaries, and `.app` bundles with custom certificates and provisioning profiles — without Xcode, without macOS." Its platform badge lists macOS, **Linux**, Windows, Android and FreeBSD ([zsign](https://github.com/zhlynn/zsign)).

### 2.4 A Linux machine can talk to an iPhone

**Documented fact.** `pymobiledevice3` is "a pure Python 3 implementation for interacting with iOS devices" and "runs on Windows, **Linux**, and macOS". It ships a CLI and a Python API ([pymobiledevice3](https://github.com/doronz88/pymobiledevice3)).

**Documented fact.** `ideviceinstaller` (libimobiledevice) "allows interacting with the app installation", supports install of an "app package, carrier bundle and developer .app directory", and is "Tested on **Linux**, macOS, Windows and Android platforms" ([ideviceinstaller](https://github.com/libimobiledevice/ideviceinstaller)).

**Inference.** A Linux machine can install a signed build over USB. That path needs Developer Mode on the iPhone, because Apple puts it in the developer scenario, not the TestFlight one.

### 2.5 Where to build for free

**Documented fact.** Codemagic's free plan is "single-user... unlimited number of applications and **500 free build minutes refilled every month**", with "500 free macOS M2 minutes / month", one parallel build, and 30-day build history ([Codemagic pricing](https://codemagic.io/pricing/)).

**Documented fact.** GitHub Actions "is free for self-hosted runners and for public repositories that use standard GitHub-hosted runners". The standard macOS runner costs $0.062 per minute on a private repository ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [minute multipliers](https://docs.github.com/en/billing/reference/actions-minute-multipliers)).

**Documented fact.** This repository is public at the time of writing (`repos/umiconsulting/umi` returns `private=false`).

**Source-backed tradeoff.** GitHub Actions costs nothing while this repository stays public, and the repository is scheduled to go private. Codemagic stays free at 500 macOS minutes per month either way, but it is a second CI system to operate.

### 2.6 What cannot be tested on a simulator

**Documented fact.** `ios/Runner/DeviceKeySigner.swift` generates the device key inside the Secure Enclave. Its own header records: "REVIEW STATUS: written to the documented Secure Enclave contract but NOT compiled or run in the build environment... It must be built and exercised on a device before it is trusted."

**Inference.** A simulator has no Secure Enclave. The device-key path can only be exercised on real hardware. A real iPhone is therefore not a convenience here; it is the only place that path can be proven.

## 3. The options

| Approach                                      | Build             | Sign                   | Install                                          | Cost                                                               | Needs a Mac in hand                |
| --------------------------------------------- | ----------------- | ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------- |
| Hosted macOS CI to TestFlight                 | CI                | CI                     | TestFlight app                                   | Free on Codemagic's free tier; free on GitHub Actions while public | No                                 |
| Hosted macOS CI to `.ipa`, install from Linux | CI                | CI or `zsign` on Linux | `pymobiledevice3` or `ideviceinstaller` over USB | Same                                                               | No                                 |
| Xcode Cloud                                   | Apple's cloud     | Apple                  | TestFlight                                       | Included with membership, 25 compute hours a month                 | Yes, to author the workflow        |
| Rent a cloud Mac                              | On the rented Mac | On it                  | TestFlight or USB                                | About $15 a day on AWS `mac2.metal`; subscriptions elsewhere       | No, but you drive a remote desktop |
| Run on a real device from a Mac               | Xcode             | Xcode                  | USB                                              | A Mac                                                              | Yes                                |

## 4. The recommended approach for this repository

**Inference.** One CI job, three steps, in this order.

1. **Prove it compiles.** `flutter build ios --no-codesign` on a macOS runner. This is the cheapest useful result, because nothing has ever built the iOS target. It also fails loudly on the two known gaps: the missing iOS entitlements file and the iOS 13.0 deployment target that sits below Flutter's iOS 15 floor.
2. **Sign and upload.** `flutter build ipa`, then upload to App Store Connect with an API key.
3. **Install and test.** TestFlight internal testing on the real iPhone.

The job needs four secrets, all from the Apple Developer account:

| Secret                                               | Where it comes from                                       |
| ---------------------------------------------------- | --------------------------------------------------------- |
| App Store Connect API key (`.p8`, key id, issuer id) | App Store Connect, Users and Access, Integrations         |
| Distribution certificate (`.p12` plus password)      | Apple Developer portal, or `xcodebuild` on a macOS runner |
| Provisioning profile                                 | Apple Developer portal                                    |
| Apple team id                                        | Apple Developer portal, Membership                        |

**Inference.** Step 1 alone is worth doing today. It is free, it needs no Apple secrets, and it answers a question that is currently open: does the iOS target compile at all?

## 5. What the sources do not settle

- **UNVERIFIED.** The current internal-tester limit and the external-tester limit. Apple's TestFlight page gives the build limit (100) and the device limit (30) but not the tester counts on the page read here.
- **UNVERIFIED.** How `zsign` behaves with the Secure Enclave entitlement. No source read here shows an app whose device key lives in the enclave re-signed by a third-party tool.
- **Inference.** Flutter's own guide assumes macOS. It gives no supported path to build an iOS app on Linux. The Linux tools solve signing and installing, not building.

## 6. Criteria that would change this conclusion

- Apple ships a browser-based Xcode, or Flutter ships an iOS build that runs off macOS.
- The Apple Developer account cannot issue a distribution certificate to CI, for a policy reason.
- The pilot needs the till on an iPhone before the repository can run CI, which would force a rented Mac.
- A simulator proves enough. It does not, for the device key.

## 7. Sources

- [Flutter: iOS deployment](https://docs.flutter.dev/deployment/ios)
- [Xcode on the Mac App Store](https://apps.apple.com/us/app/xcode/id497799835)
- [Apple: TestFlight](https://developer.apple.com/testflight/)
- [Apple: enabling Developer Mode on a device](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device)
- [zsign](https://github.com/zhlynn/zsign)
- [pymobiledevice3](https://github.com/doronz88/pymobiledevice3)
- [ideviceinstaller](https://github.com/libimobiledevice/ideviceinstaller)
- [Codemagic pricing](https://codemagic.io/pricing/)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub Actions minute multipliers](https://docs.github.com/en/billing/reference/actions-minute-multipliers)
- [Apple: Xcode Cloud](https://developer.apple.com/xcode-cloud/)
- Repository facts: `apps/umi-pos/ios/` (41 tracked files), `apps/umi-pos/ios/Runner/DeviceKeySigner.swift`, `apps/umi-pos/macos/Runner/DeviceKeySigner.swift`
