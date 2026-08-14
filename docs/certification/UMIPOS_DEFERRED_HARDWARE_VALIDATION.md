# UmiPOS Deferred Hardware and Provider Validation

Updated: 2026-08-13

Status: `DEFERRED TO GATE 13 — DOES NOT BLOCK SOFTWARE COMPLETION`.

This register contains validation that needs physical equipment, a real site, or an enabled provider. It does not contain missing software implementation.

## Rules

- Keep each capability disabled when the pilot does not require it.
- Test each required capability before real operation.
- Record the device, software version, environment, safe reference, result, and issue ID.
- Do not convert simulator, browser, static, or local-provider evidence into physical evidence.
- Stop an affected workflow for a P0 or P1 result.

## Validation matrix

| Capability            | Software evidence                                                                                     | Gate 13 validation                                                                                                  | Current status |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------- |
| Linux POS             | RC2 archive, Flutter tests, Linux build, enrollment, offline journal, and recovery passed             | Install on the selected device; test display, input, sleep, restart, network, and local storage                     | DEFERRED-G13   |
| iPad or iOS POS       | Flutter source and adaptive software behavior passed available checks                                 | Apple signing, install, safe areas, touch, background, restart, and network                                         | DEFERRED-G13   |
| KDS hardware          | Swift source, API boundary, simulation, lifecycle, reconnect, and static accessibility passed         | Install on the target iPad; test working distance, touch, background, reconnect, and full lifecycle                 | DEFERRED-G13   |
| Receipt printer       | Generic TCP adapter, thermal rendering, command queue, retry policy, and simulator passed             | Test discovery, width, Unicode, paper out, reconnect, original, COPY, and unknown outcome                           | DEFERRED-G13   |
| Cash drawer           | Printer-attached drawer command, authority, recovery, and simulator passed                            | Test register association, authorized pulse, unrelated actions, disconnect, and recovery                            | DEFERRED-G13   |
| Barcode scanner       | Keyboard-wedge routing, sensitive-input protection, rapid input logic, fallback, and simulator passed | Test product resolution, repeat scans, unknown code, focus, disconnect, and reconnect                               | DEFERRED-G13   |
| Customer display      | Scoped command model, privacy projection, recovery, and simulator passed                              | Test pairing, register isolation, totals, idle state, privacy, completion, and reconnect                            | DEFERRED-G13   |
| Real payment provider | Manual terminal assertion is certified; integrated authorization remains disabled                     | Test authorized sandbox first; then test authorization, capture, refund, events, retry, and secret safety           | DEFERRED-G13   |
| Object storage        | RC2 operates with storage disabled; configuration fails safely                                        | Test provider credentials, scope, upload, retrieval, outage behavior, privacy, lifecycle, and durability if enabled | DEFERRED-G13   |
| Pilot network         | Local failure and reconnect certification passed                                                      | Test DNS, TLS, latency, interruption, reconnect, KDS, devices, and transaction ambiguity at the site                | DEFERRED-G13   |

## Completion boundary

Gate 10 through Gate 12 can complete while these items remain deferred. Gate 13 owns final physical and real-world evidence.

Move an item back to software completion only when Gate 13 finds a reproducible software defect. A hardware absence is not a software defect.

## Activation record

Use `docs/certification/UMIPOS_CONTROLLED_PILOT_ACTIVATION.md` as the site evidence ledger. Replace each unknown value only with actual site evidence.
