# The state that moved only when the screen did

Date: 12 October 2026, 01:00–01:20 MST. Device: iMin D3-504, Estación build 23. API from this tree
on `:4001`, database `umi_local`. Evidence: `docs/reports/evidence/2026-10-12-imin-hardware-status`.

Environment note. This session used one API on port `:4001` and one database, `umi_local`, in the
docker container `umi-bv3-pg` on port `4003`. The old local clones and their databases are removed.

## What the owner asked

Two sentences, in order:

1. "Do not let the user set the number of failed attempts. Leave three."
2. "Also the state — is it possible to know it in real time without many resources of the app?"

Then the owner named the field: the **device status check**, the setting that reads the state every
few seconds.

## What the till does with that field

| Part                                    | Cadence                                             | Cost                                                                      |
| --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| The sweep timer in the adapter resolver | the policy value: 15 seconds now, 30 seconds before | a local probe of each link                                                |
| The probe itself                        | on each read of the runtime                         | `DLE EOT 1` on USB, or a socket health read                               |
| The relay in `AppCompositionRoot`       | every 10 seconds                                    | one `GET /hardware/runtime` and one `GET /hardware/commands/remote/claim` |
| The registry state                      | only when somebody asks                             | it is a verdict of the last diagnostic, possibly old                      |

Two facts decide the design.

First, the probe is **local**. The till asks its own USB port or its own socket. The probe costs no
network and no server work.

Second, the registry state is **not** the state. The till replaces it with the state it measured,
and a device this till never reached reads `unknown`. A printer that is switched off can no longer
read "Conectado".

## The defect this session found

The centre read the runtime when it opened, and it kept that reading. The relay, which reads the
runtime every ten seconds while an operator session is open, made newer readings that no screen
ever saw.

The owner reported the effect on 11 October: "after I found the printer and it printed, the status
did not change". The screen was a photograph, not a window.

## The fix

Two changes, both small:

1. `HardwareService` publishes its newest reading. The `latestRuntime` notifier carries the reading
   the relay took, the reading a screen took, and a restored reading after an offline start.
2. `HardwareSurface` follows that notifier. It folds each new reading into the runtime it shows
   (`adoptHardwareReading`), so the device rows and the print queue on screen are the last state
   this till measured. A reading for another register is ignored.

The fold keeps the device rows of the screen and takes the newer state of each device, because the
centre reads with the disabled devices included and the relay reads without them. A reading never
deletes a row and never adds one.

The centre therefore stays current at the cadence of the relay, and it makes **no request of its
own** for that. It still reads on demand: when it opens, after the print test, after the drawer
test, and after each action that reaches a device.

## The settings form

Both rows are statements, not questions:

| Row                 | Value            | Why                                                                                                                                                                   |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reintentos si falla | 3 (fijo)         | Three is the top of the range the contract accepts. An operator cannot judge the right number during a rush.                                                          |
| Revisión del estado | Cada 15 segundos | Fifteen seconds is the fastest sweep the contract accepts (`hardwareHealthIntervalSeconds`, 15..300). The row also states that the centre re-reads after each action. |

The form writes both values on every save. The pilot register policy now holds
`hardwareRetryLimit: 3` and `hardwareHealthIntervalSeconds: 15` (version 5).

## The cost, measured

The API log from 06:04Z to 08:10Z, 124 minutes, holds 793 reads of `/hardware/runtime` and 743
claims of `/hardware/commands/remote/claim`. That is one pair each ten seconds — about 12 requests
per minute, and about 17 thousand per day.

| Measure              | One read of the runtime | One claim           |
| -------------------- | ----------------------- | ------------------- |
| Calls in 142 minutes | 862                     | 802                 |
| Calls each hour      | 359                     | 334                 |
| Server time, mean    | 37 ms                   | 4.9 ms              |
| Server time, p95     | 49 ms                   | 6 ms                |
| Response, measured   | about 40 KB             | a few hundred bytes |

The read gets slower while the day runs. The mean server time by ten-minute block starts at 28 ms at
06:00 and reaches 48 ms at 08:20 — seventy five percent more, with no change to the code.

The cause is the print queue. `printJobs` in `apps/umi-api/src/modules/pos-hardware/pos-hardware.repository.ts`
takes every job of the location (up to 100) and then reads each job with **its own query**. The
location held 59 jobs, so one read runs about 64 SQL statements: 1 for the function, 1 for the
devices, 1 for the job list, 59 for the jobs, 1 for the policy, and 1 for the unknown commands.
That is about 550 thousand statements each day from one till, for a status poll.

The response is large for the same reason: the API shape of one job is 653 bytes, so 59 jobs are
38.5 KB of the 40 KB. The queue keeps its growth: the cap of 100 jobs makes one read about 65 KB.
The reading the till held in its own secure storage was 43 KB of JSON, which agrees.

Each day, for one till:

| Measure        | Value                                    |
| -------------- | ---------------------------------------- |
| Requests       | about 16,600 (8,600 reads, 8,000 claims) |
| Server time    | about 6 minutes of one core              |
| SQL statements | about 550 thousand                       |
| Data out       | about 344 MB — near 10 GB each month     |

The repository holds no VPS invoice, so the money is a conversion, not a measurement. Six minutes of
one core each day is 0.4 percent of a core-month: about USD 0.04 each month on a two-vCPU host of
USD 20. Ten GB each month of egress is USD 0.50 at the USD 0.05 per GB rate of `Railway`, and it is
free on a host with included traffic. **The money is small today. The statements are the load, and
they grow with the number of sales.**

The read is read-only. `merchant.read_hardware_runtime` selects, and it does not write
`last_heartbeat_at`. The dashboard accepts a hardware state that is up to **10 minutes** old
(`HARDWARE_STATUS_FRESH_MS` in `apps/umi-dashboard/src/screens/devices.jsx`).

So the relay keeps two duties apart: the claim is the delivery path for a remote command, and the
read is the freshness path for the screens. Only the second one can slow down, and this report does
not change it yet.

## Verified

| Check                     | Command                                                                                                 | Result                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static analysis           | `flutter analyze lib/features/hardware test/hardware_reading_test.dart test/hardware_service_test.dart` | no issues                                                                                                                                         |
| Till suite                | `flutter test`                                                                                          | 751 tests pass                                                                                                                                    |
| New assertions            | `test/hardware_reading_test.dart`, one test in `test/hardware_service_test.dart`                        | the fold and the notifier behave as stated                                                                                                        |
| On the device             | build 23 on the iMin D3-504                                                                             | the centre reads "Conexión: Conectado" for the Epson TM-T20IIII, and the form shows "3 (fijo)" and "Cada 15 segundos"                             |
| On the device, print path | "Ejecutar prueba" on build 23                                                                           | the till reported "Prueba enviada a Epson TM-T20IIII: el dispositivo respondió", and the queue gained "Página de prueba" with the state `Impreso` |

Build 23 was made with the recipe in `2026-10-11-imin-keyboard-stays-open.md`, with the base URL
`http://127.0.0.1:4001` and contract `2.29.0`. The temporary `applicationId` edit was reverted after
the build.

## The two changes, and what they saved

The owner asked for the cost, and then approved the fix. Two of the three changes are in this tree
and on the pilot till (build 26):

1. **The queue travels in one statement.** `printJobs` in `pos-hardware.repository.ts` lists the
   jobs of the location with one lateral join. It was one list query and then **one query for each
   job**. One read of the runtime was about 64 statements with 59 jobs; it is now 5.
2. **The background read waits for its minute.** `HardwareService.runtimeReadDue` holds the cadence:
   the relay reads the runtime every ten seconds while a screen at the hardware watches, and once
   each minute with no screen there. The claim of a remote command stays at ten seconds, because it
   is the delivery path and it is cheap.

Measured on the pilot till with build 26, in the API log:

| Window                    | Reads each minute    | Claims each minute |
| ------------------------- | -------------------- | ------------------ |
| The centre is closed      | 1.0 (gaps of 70 s)   | 5.9                |
| The centre is open        | 6.0 (gaps of 10.0 s) | 5.9                |
| Before the change, always | 6.0                  | 5.8                |

Measured on the same log, the time the API spends in one read fell from a mean of 44 ms to 8–11 ms
— the read no longer grows with the queue of the day.

Each day, for one till:

| Measure              | Before             | After            | Saved      |
| -------------------- | ------------------ | ---------------- | ---------- |
| Requests             | about 17,000       | about 9,800      | 43 percent |
| Reads of the runtime | 8,600              | 1,440            | 83 percent |
| Server time          | about 7 minutes    | about 55 seconds | 87 percent |
| SQL statements       | about 550 thousand | about 7 thousand | 98 percent |
| Data out             | about 344 MB       | about 58 MB      | 83 percent |

The print path was checked on the device after the change, because a slower background read must not
cost a sale its paper: **Ventas → Abrir recibo → Imprimir recibo** on a sale of 01:06 printed a
controlled copy (`receipt_copy`), with the runtime of the till up to sixty seconds old.

## What remains open

1. **The field check of the live state.** With the centre open, unplug the printer. The row must read
   `Desconectado` within about ten seconds. The unit tests prove the fold; a hand on the cable proves
   the whole path.
2. **The size of one read.** The payload is still about 40 KB, and 38 KB of it is the print queue.
   Send the jobs a screen needs — the unfinished ones and the recent ones — and the read becomes
   about 5 KB. This change needs one more piece first: `HardwareService.printReceipt` looks for the
   original job of the receipt **in that queue** to print a copy instead of refusing with
   `IDEMPOTENCY_CONFLICT`, and Ventas lets an operator reprint a sale of any hour of the day. So the
   till needs to ask for that one job by receipt (`sourceAggregateId`) when the queue no longer
   carries it. The contract caps `printJobs` at 100, so a smaller cap is a contract change, and the
   till needs a new build.
3. **The location policy of ONCA.** The register policy says `receiptCopiesDefault: 1` and wins. The
   location row of 8 October still says 3. Delete the shadowed value or align it.
