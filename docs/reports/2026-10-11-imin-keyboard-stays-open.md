# The keyboard on `Pagado`: found with an instrument, fixed, and verified on the till

Date: 11 October 2026, 03:30–04:15 MST. Device: iMin D3-504 running the Estación build rebuilt from
this tree (the recipe is at the end of this report).

This is the oldest open defect on this package — `docs/reports/2026-10-10-imin-device-test.md`
reported it on 10 October, and a previous session committed a source fix for it. Tonight that fix
was measured on the hardware for the first time and **did not work**. The cause was then found with
an instrument, fixed, and re-measured on the shipping build.

## What is measured

| Step of a cash charge                              | `dumpsys input_method`            | What Gboard logs                                                              |
| -------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| catalog, product panel, cart                       | `mInputShown=false`               | —                                                                             |
| `Cobrar` sheet opens, `Efectivo`, `Importe exacto` | `mInputShown=false`               | —                                                                             |
| **`Cobrar · MXN 65.00` (the commit)**              | **`mInputShown=true` within 3 s** | `onStartInput(… inputType=8001 …)`, `onStartInputView`, `onKeyboardViewShown` |
| `Pagado`, 10 s later                               | `mInputShown=true`                | —                                                                             |
| one `BACK`                                         | `mInputShown=false`               | —                                                                             |

`inputType=8001` is `TYPE_CLASS_NUMBER | TYPE_NUMBER_FLAG_DECIMAL`, and the semantics tree holds
**no editable at all** once the keyboard is up — which is why "unfocus the field that has focus"
could never be the answer: by then there is no field left to unfocus.

## The three attempts that did not work, each measured on the device

| Attempt                                                                                           | Where it lives | Result          |
| ------------------------------------------------------------------------------------------------- | -------------- | --------------- |
| `FocusManager.instance.primaryFocus?.unfocus()` on the result screen (the previous session's fix) | `_receipt()`   | keyboard stayed |
| the same, plus `SystemChannels.textInput.invokeMethod('TextInput.hide')` on the result screen     | `_receipt()`   | keyboard stayed |
| `unfocus()` **and** `TextInput.hide` _before_ the commit, in the charge action                    | `_review()`    | keyboard stayed |

All three were built into the APK, installed with `adb install -r`, and the charge re-run to
`Pagado`; each run ended with `mInputShown=true` and the keyboard covering the lower half of the
till. They failed for two different reasons, and neither was a careless mistake: the `_receipt`
attempts were aimed at a field that has nothing to do with it, and the `_review` attempt landed
**before** Android's asynchronous `showSoftInput` answered.

## The cause, named by an instrument

Two temporary prints — one on every `PosField`'s focus node, one on every focus change in the app
root — were built into the APK and read back from `logcat` during a charge:

```
POSFIELD_FOCUS label=null hint=Buscar nombre, SKU o código
  key=[<'hardware-barcode-search'>] hasFocus=true text=(empty)
```

The field that takes focus as the sale commits is the **catalog's own search field**, and the code
that asks for it is a deliberate piece of the "ready for the next customer" feedback
(`catalog_surface.dart`, `_saleChanged`):

```dart
if (widget.sales.state.readyForNextCustomer) {
  WidgetsBinding.instance.addPostFrameCallback((_) {
    _search.clear();
    widget.catalog.search('');
    _searchFocus.requestFocus();   // ← the cursor goes back, and Android opens its keyboard
  });
}
```

On a desktop till that is only a cursor. On Android, focusing a text field asks the platform for the
soft keyboard, and `showSoftInput` arrives asynchronously _after_ any hide issued in the same frame —
which is exactly why the earlier attempts lost. The comment in the code even states the intent:
clearing the search and putting the cursor back is the feedback, replacing a bar that used to cover
`Nuevo pedido`.

## The fix

Keep the cursor, put the keyboard away once the platform has finished answering the focus change:

```dart
_searchFocus.requestFocus();
Future<void>.delayed(const Duration(milliseconds: 250), () {
  unawaited(SystemChannels.textInput.invokeMethod<void>('TextInput.hide'));
});
```

That keeps what the feedback is for — the cursor is in the field, the scanner wedge still routes
while a text input has focus, and the operator's next keystroke belongs there — and removes what the
touch till cannot live with.

**Measured on the shipping build** (the instrument removed, `flutter analyze` clean, 684 tests
passing): `Pagado` with `dumpsys input_method` reporting **`mInputShown=false`**, and the screenshot
showing the completion screen at full height with both actions reachable.

The 250 ms is a race-winner, not a constant of nature: it waits for Android's `showSoftInput` to
land. If a slower keyboard ever wins again, the durable answer is a product decision — do not raise
the keyboard at all for this feedback on a touch till — and the instrument above is how to check it
rather than guess.

## The build, so anyone can repeat it

The Estación app on the till is this tree with one temporary edit —
`applicationId = "co.umiconsulting.umi_pos.estacion"` in `apps/umi-pos/android/app/build.gradle.kts`,
reverted straight after the build — and the defines the design comparison used:

```sh
cd apps/umi-pos
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME="$HOME/Android/Sdk"
flutter build apk --profile --target-platform android-arm64 --build-name 0.1.0 --build-number 1 \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL=http://127.0.0.1:4013 \
  --dart-define=UMIPOS_DEVICE_KEY= --dart-define=UMIPOS_CONTRACT_VERSION=2.27.0 \
  --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
adb -s 192.168.1.10:5555 install -r build/app/outputs/flutter-apk/app-profile.apk
```

The signing key matches the installed app (`~/.config/.android/debug.keystore`, SHA-1
`C1:B6:D1:F5:…`), so `-r` keeps the device's registration and its data. The APK as it was before
this session is in `/tmp/imin-apk-backup/estacion-current.apk`.
