# The desktop till's flows, and what a hidden window does to them

Date: 11 October 2026, 01:30–02:00 MST. Two flows were failing in the suite
(`docs/reports/2026-10-10-offline-drill-workstation.md` left them open). One is fixed and passes;
the other cannot be trusted while somebody else is using the machine, and this report says why
with the measurement.

## The tables flow: an instrument race, now fixed

`pos-tables-merge-split` failed with "The plan offers 0 free table(s)" while the Salón held five
free tables. The screen at that moment is the evidence:
`/tmp/ux/pos-native-shots/2026-10-11T08-37-01-423Z/floor-plan-before-merge.png` shows
**"Carga del plano…"** with `0 mesas` in the header — the flow measured a floor plan that had not
arrived. `waitSettled` is no defence: a loading screen is a _stable_ screen, so it settles on it.

`tablesNow()` in `pos-native-flows.mjs` now polls for the first table node (15 s), which is the
same wait `pos-tables-open` already had. Re-run:

| Run            | Result                                                             |
| -------------- | ------------------------------------------------------------------ |
| before the fix | `FAILED — 5 taps, 53697ms` · "The plan offers 0 free table(s)"     |
| after the fix  | **ok — 7 taps, 32725ms** (budget 9 taps / 45000ms), `passed: true` |

The gesture itself is real: the flow picked two free tables, combined them, split them, and the
room was left as it was found.

## The restart flow: the environment, measured

`pos-restart-recovery` failed four times with two different symptoms:

| Run  | Symptom                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | after the restart, `Bloquear operador` left the till on the catalog with `No fue posible completar la acción de venta de forma segura.` |
| 2    | the same, with the API log on a port this session owns                                                                                  |
| 3, 4 | the PIN pad did not register the typed digits: `Expected "PIN" to stop reading "0 dígitos"`                                             |

What the API saw (a second instance of the same build and database, started by this session so its
log was readable): the `lock` call **succeeded** (`POST /pos/operator-sessions/<id>/lock → 201`),
and every request after it answered `403 PERMISSION_DENIED`, which is correct — a locked operator
session is no longer `active`, so `authorize` refuses it.

What the machine saw, which the app cannot be blamed for: the till's window lives on a workspace
nobody is showing, and pointer events aimed at it are delivered **only sometimes**. Measured
directly, with the app healthy (its semantics tree answered, its VM service replied in 9 ms, the
process at 1.9 % CPU):

| Presses aimed at the PIN keypad, at the keypad's own coordinates | Counter after |
| ---------------------------------------------------------------- | ------------- |
| 4 (raw `mousemove` + `mousedown`/`mouseup`)                      | `2 dígitos`   |
| the driver's own click, with its hover frame and re-resolve      | `0 dígitos`   |

Two of four landed. That is not a product fact, and it is exactly why the same flow passed earlier
in the day with the window on a workspace that was showing.

**The instrument now says so.** When a click does not land, `pos-native-driver.mjs` appends the
workspace pair to the verdict, from Hyprland rather than from X (`xdotool`'s `get_desktop` reports
one flat desktop under XWayland and would have said "same desktop" about a window nobody is
showing):

```
retry 1: nothing on the screen changed, so the click did not land; re-resolving "1" before
pressing again. The till is on workspace 4 and workspace 1 is showing, so the compositor may drop
the press: this verdict is not yet evidence about the till. Bring the till forward (or run when
the screen is free) before believing it.
```

## What to do about it

1. **Run the desktop flows when the screen is free**, or accept that a failure which reports this
   note is not yet a finding about the product.
2. **For on-device truth, use the iMin pass** (`pnpm ux:pos:device:clicks`): the device answers to
   `adb` taps and does not care who is looking at the workstation — see
   `2026-10-11-imin-device-retest.md`.
3. The lock behaviour itself was measured on a quiet till and is correct: `Bloquear operador`
   reached the PIN screen in **4.2 s** from a signed-in catalog.

## Still open

The restart flow's own scenario — kill the till mid-shift, sign in again, and charge without
retyping anything — has not been completed end to end in this session. The parts that were
observed all behaved: the restart came back to `readyForAuthentication`, the PIN sign-in minted a
new operator session, the till resumed the open cash shift (`POST /cash/shifts/<id>/resume → 201`),
and the lock reached the server. The remaining unknown is the app's own final screen, and it needs
a quiet machine to measure.
