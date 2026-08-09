# UmiPOS Hardware Runtime

Status: Gate 3G-B code-controlled pilot stack complete with physical validation observations.

This runtime is the only UmiPOS path to physical hardware. Flutter features call `HardwareService`.
The service uses generated contracts, server commands, and a registered device adapter.

## Architecture

The runtime has these layers:

1. `HardwareRegistry` stores devices, assignments, capabilities, versions, and safe health facts.
2. `HardwareCoordinator` validates a command and selects one `DeviceAdapter`.
3. A `DeviceAdapter` executes one canonical command.
4. A transport adapter owns the connection lifecycle.
5. Simulator adapters provide deterministic development and CI behavior.

Business modules do not instantiate adapters. Vendor names do not select business behavior.

## Registry and assignments

The UMI API owns the registry. Each device has an exact merchant and location scope.
An assignment can add a register and an enrolled POS device.

The registry stores these facts:

- device type, manufacturer, model, and public serial reference;
- transport and explicit capabilities;
- enabled, archived, and primary-printer state;
- configuration version and optimistic version;
- last connection, heartbeat, and diagnostic state.

The database rejects cross-merchant and cross-location use. A disabled device cannot receive a new command.
An archived device remains available for historical references.

## Device types and transports

Gate 3G-A supports printer, cash drawer, barcode scanner, and customer display adapters.
It also defines payment terminal and scale foundations.

The transport model includes simulator, USB, Bluetooth, network, serial, and platform-channel foundations.
Gate 3G-B operates generic TCP printers, printer-attached drawers, and keyboard-wedge scanners.
The native socket stays behind the transport adapter. No business feature can open the socket.

## Hardware commands

Each physical side effect has one command ID, idempotency key, correlation ID, and payload fingerprint.
The command also binds merchant, location, register, POS device, operator, source fact, and configuration version.

The API persists command history before local dispatch. A response retry returns the original command.
The runtime never retries an unknown physical outcome without an explicit operator command.

## Printer runtime

The persistent queue supports receipt print, controlled receipt copy, test page, and kitchen-ticket foundations.
It uses deterministic order and bounded attempts.

The API rebuilds the print payload from the immutable receipt snapshot. It ignores client financial print facts.
The printer does not calculate financial totals.
The payload excludes gift-card secrets and private customer contacts.

A known pre-dispatch failure can become retryable. An unknown result stays `unknown_outcome`.
The operator must verify the receipt before a controlled reprint. A reprint creates a new audited job.
The default copy policy creates deterministic audited copy jobs only after the official print has known success.

The pilot adapter renders printer-neutral commands into generic ESC/POS-compatible bytes.
The renderer supports text, alignment, emphasis, rows, totals, QR, feed, cut, and safe capability degradation.
It uses CP850 by default and includes explicit Spanish character mappings. UTF-8 is a configured option.
The renderer limits each document to 32,000 characters. The adapter uses bounded TCP connection and command timeouts.

## Cash drawer runtime

The drawer command requires an explicit reason and exact permission. Supported reasons include committed cash sale,
cash refund, paid in, paid out, safe drop, register open, and manager test.

The cash ledger action commits before the drawer command. A drawer failure does not change a financial fact.
The default no-sale path remains disabled. Merchant policy can enable it. A separate manager approval is mandatory.
Each drawer command binds to one committed cash fact. The same fact cannot emit a second pulse.

The pilot drawer adapter sends one generic pulse through its assigned printer endpoint.
An ambiguous write becomes `unknown_outcome`. The runtime does not send a second automatic pulse.

## Scanner runtime

The scanner emits a canonical event with symbology, normalized value, and sequence.
The runtime bounds the input and removes duplicate bursts. An unknown barcode does not create a product.

The keyboard-wedge adapter uses a bounded buffer, terminator, and timeout. It disables capture during PIN entry.
It does not keep unrelated typed content. Manual barcode input remains available.

The pilot adapter supports EAN, UPC, Code128, and QR values from the scanner.
It suppresses one duplicate burst within 120 milliseconds. It preserves rapid scans of different values.
The POS sends each scan through the exact barcode query. One match opens the normal product selection flow.
No match gives `UnknownBarcode`. Multiple matches give a typed ambiguity.

## Customer display runtime

The display accepts only a customer-safe state. It supports idle, active sale, payment, completed, and safe error states.
The projection can contain safe items, totals, tender summary, change, and a receipt QR foundation.

The projection removes contacts, internal IDs, tokens, PINs, and gift-card codes.
Gate 3G-B keeps the customer display simulator operational. A physical secondary-display adapter remains device-dependent.

## Diagnostics and failures

Diagnostics support status, connection, capability, printer test, drawer test, scanner test, display test, and runtime snapshot.
Results contain safe status, latency, failure code, timestamp, and correlation reference.
Each operational diagnostic executes a canonical hardware command before the API stores its safe result.

The failure model separates retryable transport failures from terminal failures. It includes disconnected, busy,
paper out, timeout, stale configuration, scope mismatch, unsupported capability, and unknown outcome.
The UI does not receive raw vendor errors, credentials, or stack traces.

## Simulated hardware lab

The lab includes printer, drawer, scanner, and customer display simulators. Each simulator uses deterministic failure injection.
The printer keeps a safe print artifact for test inspection. The scanner can emit barcode, QR, duplicate, and disconnect events.

The lab needs no external hardware. Future vendor adapters must implement the same interfaces.

The deterministic cashier walkthrough scans products, completes a cash sale, opens the drawer, and prints the receipt.
It then completes a refund and verifies command replay. The replay creates no second physical effect.

## Pilot configuration and connection

The Hardware Center can register, assign, enable, disable, test, and configure pilot devices.
The API owns the transport endpoint, timeouts, encoding, width, drawer pulse, scanner terminator, and scanner timing.
The API also owns auto-print, drawer, retry, health, scanner, and customer-display policies.

The TCP transport uses `Disconnected`, `Connecting`, `Connected`, `Recovering`, `Failed`, and `Disabled` states.
It retries only a known pre-write failure. It uses one to three bounded connection attempts.
It does not retry an ambiguous write.
The runtime replaces and closes an adapter when its configuration changes. A bounded health timer uses the server interval.
The Hardware Center combines the server registry with the safe local transport state.

## Recovery

The secure recovery store saves dispatch state before a physical side effect. A runtime restart during dispatch becomes unknown.
It does not dispatch the same side effect again.

Print recovery supports pending, safe retry, unknown, and controlled reprint states. Manual first print uses the original receipt command identity.
Drawer recovery preserves unknown movement status. A manager test is a separate authorized command with a new command ID.
Financial recovery remains separate. Hardware commands reference the committed sale, receipt, refund, or cash action.
The Recovery Center can retry known-safe offline hardware commands. It restores the protected assignment snapshot and keeps each original command ID.
The cache binds the merchant, location, register, POS device, and credential version. The cache expires after 15 minutes.
An unknown print offers Verify Print or a controlled COPY. An unknown drawer action offers one explicit new open command.

## Sale, refund, and cash integration

A completed sale can request receipt print, drawer open for cash, and a completed display state.
A committed refund can request a compensation print and a drawer open for cash compensation.
Opening float, paid in, paid out, and safe drop can request a drawer command after commit.

Hardware failure never rolls back or repeats a financial command.

## Offline behavior

Native offline hardware remains a controlled foundation. A local command journal must preserve command identity and unknown outcomes.
A provisional receipt must use the existing provisional receipt policy. Server replay must not print it again automatically.

Web has no secure native hardware parity. It can use simulators for development only.

Gate 3G-B adds no financial offline authority. A local hardware command must reference the existing offline command.
Replay must keep the same physical command identity. Unknown local effects stay in hardware recovery.
The native runtime keeps deterministic print and drawer command IDs for each provisional sale.
The runtime prints the `OFFLINE PROVISIONAL RECEIPT` marker and does not repeat a known physical effect.

## Permissions

The runtime uses exact permissions. It does not use role names as authority.

- Cashier and Staff can read assigned devices, print receipts, use scanners, update displays, and open eligible drawers.
- Supervisor can run selected diagnostics and controlled reprints.
- Manager can run all pilot diagnostics and drawer tests.
- Owner and Admin can register, assign, enable, disable, and diagnose devices.
- Viewer has no hardware mutation permission.

All commands require `hardware.command.execute` and the exact command permission.
All commands also require merchant, location, device, entitlement, credential, and operator-session scope.

## Security boundary

The database uses RLS and FORCE RLS for all hardware authority tables. Command and print history are append-only.
The runtime stores no transport secret, PIN, token, gift-card code, or unrestricted diagnostic payload.

Gate 3G-B does not certify hardware. No supported physical device was available in the validation runner.
The generic adapters and simulators prove the code-controlled pilot behavior.
Payment terminal and scale remain disabled foundations. Gate 4A is authorized but has not started.
