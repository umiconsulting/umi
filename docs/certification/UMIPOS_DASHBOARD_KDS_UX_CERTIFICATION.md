# UmiPOS Dashboard and KDS UX certification

Date: 2026-08-13

Gate: 8B

Source commit: `2e4cb24143d5243b731b94d339df6cb5fbfa8f9c` plus this certification commit

Verdict: COMPLETE WITH OBSERVATIONS

## Scope

This gate certified the Dashboard and the existing SwiftUI KDS. It did not repeat the POS certification.

The review used UmiPOS Design Language V1. Platform-native SwiftUI behavior remained valid for the KDS.

## Dashboard evidence

| Surface                              | Result | Evidence                                                                            |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| Shell and navigation                 | PASS   | The selected module, business, location, and user context remain clear.             |
| Permission navigation                | PASS   | Capability data controls modules. Deep links retain server denial.                  |
| Settings and membership              | PASS   | Business terms replace internal platform terms. Destructive states remain explicit. |
| Devices, registers, and hardware     | PASS   | Status, assignment, diagnostics, and recovery remain distinct.                      |
| Catalog and inventory                | PASS   | Existing forms, counts, and operational commands remain usable.                     |
| Sales, receipts, refunds, and shifts | PASS   | Money, compensation, print state, and shift state remain clear.                     |
| Customers and stored value           | PASS   | Contact masking and read-only value policy remain visible.                          |
| Recovery, audit, and diagnostics     | PASS   | Safe action, terminal state, and support detail remain separate.                    |
| Errors, loading, and empty states    | PASS   | The UI keeps local progress and business-language messages.                         |
| Responsive layout                    | PASS   | Browser checks passed at 1440, 1024, and 390 CSS pixels.                            |
| Keyboard and accessibility           | PASS   | Sidebar items are native buttons. Focus indicators and labels remain visible.       |
| Localization                         | PASS   | Normal Spanish UI no longer exposes the reviewed internal terms.                    |

The browser test reported no global horizontal overflow. Dense tables can still use local horizontal scroll.

## KDS evidence

| Surface                       | Result                | Evidence                                                                           |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| Board                         | PASS                  | Connection, workload, state columns, and station work remain clear.                |
| Order cards                   | PASS                  | Quantity, modifiers, safe notes, age, and state remain readable.                   |
| Timers and priority           | PASS                  | Text and hierarchy supplement color. Raw priority values do not appear.            |
| Preparation actions           | PASS                  | Large controls show a pending state and disable unsafe degraded mutations.         |
| Recall and cancellation       | PASS                  | Server states return through the ordered event stream and snapshot reconciliation. |
| Degraded and reconnect states | PASS                  | Cached work stays visible. Mutations fail closed until reconciliation.             |
| Empty and loading states      | PASS                  | Idle, snapshot, pairing, and error states have distinct presentations.             |
| Accessibility                 | PASS                  | Cards, connection, settings, columns, and actions have accessibility labels.       |
| Responsive layout             | PASS WITH OBSERVATION | The adaptive column code passed review. Physical iPad rendering remains pending.   |
| Localization                  | PASS WITH OBSERVATION | The current KDS language architecture remains unchanged.                           |

The Linux runner did not include Xcode. This gate did not claim physical iPad evidence.

## Operational walkthroughs

| Walkthrough                                                                            | Result |
| -------------------------------------------------------------------------------------- | ------ |
| Owner: location, sale, receipt, refund, inventory, customer, hardware, recovery, audit | PASS   |
| Manager: approval, inventory, refund, diagnostics, kitchen exception, recovery         | PASS   |
| KDS: idle, receive, prepare, item ready, priority, complete, cancel, reconnect         | PASS   |
| Dashboard and KDS failure states                                                       | PASS   |

The walkthrough review used the certified command surfaces and focused UI tests. It did not repeat financial certification.

## Defect register

| Surface              | Severity | Issue                                                   | Operational impact                                         | Correction                                                   | Status |
| -------------------- | -------- | ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------ |
| Dashboard shell      | P1       | Widths below 1280 pixels forced page overflow.          | Compact administration lost content.                       | Removed the fixed page width and added compact layout rules. | CLOSED |
| Dashboard navigation | P1       | Sidebar actions used simulated buttons.                 | Keyboard activation was incomplete.                        | Replaced them with native buttons and visible focus.         | CLOSED |
| Dashboard copy       | P1       | Normal views exposed internal and mixed-language terms. | Operators could mistake platform scope for business scope. | Replaced visible terms with business language.               | CLOSED |
| Dashboard tooling    | P1       | The Tweaks panel appeared outside a development need.   | Internal controls reduced operator confidence.             | Limited the panel to the development environment.            | CLOSED |
| KDS detail           | P1       | Priority and item state could show raw values.          | Kitchen state was difficult to scan.                       | Added operator labels and removed the event sequence.        | CLOSED |
| KDS cards            | P1       | Cards did not show modifiers.                           | Preparation details could remain hidden.                   | Added modifier text and accessible card summaries.           | CLOSED |
| KDS accessibility    | P1       | Key board controls lacked complete labels.              | Assistive use had incomplete context.                      | Added labels, hints, and grouped column semantics.           | CLOSED |

Open P0 defects: 0.

Open P1 defects: 0.

## Design-language adoption

Dashboard classification: ALIGNED after focused refinements.

KDS classification: PLATFORM-SPECIFIC ACCEPTABLE after focused refinements.

No new shared rule was necessary. UmiPOS Design Language V1 did not change.

## Remaining observations

- Validate touch distance and Dynamic Type on a physical iPad.
- Validate printer, drawer, scanner, and display states with physical hardware.
- Record Owner aesthetic preferences during the pilot dry run.
- External payment provider UI remains outside this gate.

## Authorization

Gate 9A, Pilot Dry Run, is authorized with observations. This gate did not start Gate 9A.
