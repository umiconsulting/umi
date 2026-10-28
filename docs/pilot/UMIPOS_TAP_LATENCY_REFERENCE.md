# UmiPOS tap latency — the reference numbers

Status: `MEASURED ON REAL HARDWARE`. Environment: staging. Date: 2026-10-16.
Hardware: iMin D3-504 (counter till, Android 11, RK3566) and Galaxy Tab A9+ (KDS).

This is what a tap costs on the till. It exists because the owner's requirement is
that no tap feels slow, and because the first attempt to measure that — from
outside, with a screen recording — could not be trusted.

## 1. Where the numbers come from

`TapLatencyProbe` (`apps/umi-pos/lib/core/observability/tap_latency_probe.dart`)
pairs the moment a pointer goes down with the frame the engine reports through
`SchedulerBinding.addTimingsCallback`. It is wired once, at the single
`ActivityListener` that already sees every press, so **every tap is measured
without touching any control**. It is off unless the build asks:

```sh
flutter build apk --profile --flavor staging … \
  --dart-define=UMIPOS_TAP_LATENCY_PROBE=true
```

Read it back with `adb shell "logcat -d | grep -F '[umipos] tap latency'"`.

It reports two different things, because there are two different failures:

- a tap that paints gives a latency plus the frame's own build and raster cost;
- a tap that paints **nothing** gives `STALLED` instead of a latency.

The second case is the one that matters most to an operator — a disabled control,
or the gap between two of them, is what they experience as "nothing happened" —
and a probe without the bound silently credits the next unrelated frame instead.

## 2. The numbers

Both devices, over staging, measured with the app in the foreground.

| Action                     | Device | n   | tap → paint           | frame build | frame raster |
| -------------------------- | ------ | --- | --------------------- | ----------- | ------------ |
| PIN keypad digit           | iMin   | 5   | 114–127 ms (mean 122) | 0–4 ms      | 5–8 ms       |
| Product add from the grid  | iMin   | 10  | 142–157 ms (mean 149) | 3–5 ms      | 29–36 ms     |
| Fire to the kitchen        | iMin   | 1   | 169 ms                | 4 ms        | 37 ms        |
| Section switch (left nav)  | iMin   | 10  | 166–218 ms (mean 187) | 25–43 ms    | 9–35 ms      |
| Catalogue category switch  | iMin   | 5   | 221–259 ms (mean 236) | 24–25 ms    | 31–36 ms     |
| Any press that paints none | iMin   | 6   | `STALLED` at 1001 ms  | —           | —            |
| Retry on the recovery card | A9+    | 1   | 118 ms                | 1 ms        | 2 ms         |

### 2.1 After the SQLite working copy

Measured on the same iMin against staging after the local-first catalogue came
online. The catalogue had 3 categories, 4 cached pages and 51 products in
`umipos-working-copy.sqlite`.

| Action                                 | n   | tap → paint | frame build | frame raster |
| -------------------------------------- | --- | ----------- | ----------- | ------------ |
| Catalogue category switch, first pass  | 4   | 138–152 ms  | 3–4 ms      | 29–33 ms     |
| Catalogue category switch, second pass | 4   | 136–143 ms  | 3–4 ms      | 30–31 ms     |

The second pass is the stable value: **136–143 ms**, against the earlier
**221–259 ms**. A category page now comes from SQLite and the API refresh follows
the paint.

### 2.2 With the cart command queue

Measured on the iMin against staging. The API container was stopped before the
tap.

| Action                                 | n   | tap → paint                 | queue result                        |
| -------------------------------------- | --- | --------------------------- | ----------------------------------- |
| Add a simple product while offline     | 1   | 182 ms                      | `pos.cart.line.add painted=true`    |
| Add while the previous request is open | 2   | first 209 ms, second 144 ms | second line painted without waiting |
| Four-line offline account              | 4   | 153–194 ms                  | `pos.cart.open` + line commands     |

The offline tap entered the encrypted journal. When the API returned, replay
accepted the command and the server cart replaced the local projection.

### 2.3 After the local-first completion pass (2026-10-17)

Re-measured on the same iMin, online, with the reachability heartbeat running
every ten seconds and the product-detail warm-up completed. The question was
whether the work that makes the till survive an outage made the ordinary tap
slower.

| Action                                   | n   | tap → paint       | frame build | frame raster |
| ---------------------------------------- | --- | ----------------- | ----------- | ------------ |
| Catalogue category switch                | 6   | 148–155 ms        | 3–8 ms      | 34–37 ms     |
| Add a simple product, empty account      | 6   | 160–214 ms        | 19–37 ms    | 27–40 ms     |
| Add a simple product, two-line account   | 6   | 180–190 ms        | 34–40 ms    | 34–37 ms     |

Category switches sit roughly 10 ms above §2.1 — inside the jitter of synthetic
`adb input tap` and not a change in the frame itself, whose build is 3–8 ms.
Product adds match §2.2's queue-era 182 ms; against §2's pre-queue 142–157 ms the
difference is the cart panel's own build (3–5 ms then, 19–40 ms now) — more rows,
totals and the pending badge are repainted on every add.

**The probe earned its keep during this pass.** Five taps in a row reported
`STALLED`, and the reason was not a freeze: a product with variants had opened
its option sheet on the first tap, and the rest were landing on the barrier. The
instrument says "this tap painted nothing", which is exactly what the operator
experienced — it just needed someone to look at the screen before calling it a
regression.

## 3. What the numbers mean

A second pass, hours later and after a full sale had run through the till,
re-measured the section switches and reproduced them:

```
KDS 166 ms · Ventas 195 ms · Comanda 170 ms · Ventas 186 ms · KDS 171 ms
```

That matters more than the individual figures: the earlier section-switch pass
gave 166–218 ms, and this one 166–195 ms on different targets. The numbers are a
property of the screen and the device, not of one session's luck.

**The floor is ~114–120 ms, and it is not the network.** A keypad digit touches
no server at all and still costs 114–127 ms, while adding a product — a write to
the API — costs only ~25 ms more. The frame itself is cheap: 5–8 ms for a keypad
dot, and even a full cart re-layout is 30–36 ms. The remaining ~100 ms is input
dispatch, vsync alignment and presentation, and it is the same hundred
milliseconds on both devices.

**That floor sits above 100 ms**, which is the threshold below which a response
stops feeling instantaneous. This is the number that explains "se siente lento",
and it is not something a faster API can fix.

**Catalogue category switching is the most expensive tap at ~236 ms** — more than
a section switch, and it is also the most common action while browsing. Its build
time (24–25 ms) plus raster (31–36 ms) accounts for only a quarter of that.

**The device polls hard while idle.** Over five minutes with one open account, the
till made ~25 wide-area round trips per minute:

```
57 × GET /kitchen/orders/{id}
30 × GET /health/live
30 × GET /hardware/commands/remote/claim
 5 × GET /hardware/runtime
```

That chatter shares the till with the tap that is being measured, and it is worth
a look on its own: the kitchen board has a `watch` long-poll precisely so it does
not have to poll.

## 4. How to repeat it

1. Build with `UMIPOS_TAP_LATENCY_PROBE=true` and install.
2. `adb shell logcat -c`, then drive the taps, then
   `adb shell "logcat -d | grep -F '[umipos] tap latency'"`.

**Verify every coordinate against a current screenshot first.** Three separate
measurement runs in this session produced useless numbers because taps were aimed
at positions read from an older screenshot; the probe reported `STALLED` for all
of them, which is how the mistakes were caught. The nav items sit at y=246 and
y=335 and the catalogue tabs at y=285 — not the values an earlier layout
suggested.

Space taps at least 4 seconds apart. A second tap before the first is painted
replaces its mark, so two quick taps yield one measurement, not two.

## 5. Limitations, stated plainly

- **These are APP-SIDE numbers, and they are a lower bound.** The mark is taken
  in Flutter's `onPointerDown`, and the end is the engine's frame-timings
  callback. Two legs are therefore outside every figure in this document:
  everything before the pointer reaches the app (the touch panel's scan, the
  kernel, Android's input dispatch) and everything after the frame is rasterised
  (the compositor and the display). The real finger-to-photon cost is this number
  **plus** both, so treat the table as the floor of the floor rather than the
  whole story. One of the two legs is measurable from what is already here: a
  SurfaceFlinger reading of this device showed frames presented ~22–26 ms after
  their target while the app produced them in ~2 ms, so the display adds roughly
  20 ms on top. The input leg has no measurement on this hardware.
- **A tap injected with `adb shell input tap` cannot measure the input leg.**
  `input tap` injects through the framework's `InputManager`, so the touch never
  crosses `/dev/input` — `getevent` sees nothing, and the kernel timestamps that
  would anchor the input path do not exist for it. Correlating the input leg
  needs a real finger (with `getevent -lt` running on `ilitek_ts`, the panel on
  this iMin) or a hardware rig; the injection used throughout this document is
  the wrong instrument for that one leg.
- **It measures acknowledgement, not completion.** The number is pointer-down to
  the first frame on the glass. It is not when the server confirmed, and a screen
  that paints optimistically and reconciles afterwards is exactly the shape this
  rewards.
- **The bound is one second.** A frame arriving later than that is reported as
  `STALLED`, not as a latency, because it cannot be shown to be this tap's answer.
  A genuine multi-second freeze therefore reads as `STALLED` rather than as
  "3400 ms" — correct, but coarser than it sounds.
- **Two clock approaches were tried and abandoned**, and both are recorded in the
  probe's own comments so they are not repeated. `currentSystemFrameTimeStamp` is
  the last frame the engine _began_, so on an idle screen it is as stale as the
  last repaint — it once reported 866, 2107, 3434 and 15167 ms for taps that
  worked. `DateTime.now()` against `rasterFinishWallTime` is worse: measured on
  the iMin those are not the same epoch, so no tap's own frame ever qualified and
  each mark was answered by the _next_ tap's frame. The committed version uses a
  stopwatch, which measures one interval and needs no two clocks to agree.
- These are single-session measurements on one till and one KDS, indoors, on the
  café's shared 2.4 GHz network. They are a reference point, not a benchmark.
