# Task 3C: preserve sibling station cards

Date: 2026-11-02.
Worktree: `/private/tmp/umi-redesign-parity-20261102`.
Branch: `feat/redesign-parity`.
Base: `c00978ad` (`fix(pos): invalidate account balance after checkout returns`).

## Result and scope

The accepted-command path now removes only the selected card through its existing `_cardKey` identity.
The identity contains the order, station, and business date.
Retained sibling cards receive the accepted version and timestamp through `_withServerVersion`.
The existing guard against older accepted responses remains in place.

The correction changes only `KitchenBoardController._acceptCommand`.
Request payloads, item selection, expected versions, idempotency, retries, queues, and offline behavior retain their existing owners.
Backend, contracts, schema, station permissions, and presentation retain their existing code.

## Cause and contract evidence

The previous terminal branch removed every card with the same `order.id`.
Its early return also skipped the shared version update for sibling cards.
The optimistic projection already used `_cardKey` and removed only the selected card.
This difference explains why the sibling disappeared only after acceptance.

The completed source audit is `task-3c-kds-station-contract-note.md` in this directory.
Both commands select station items. The kitchen order version is shared.
An aggregate `cancelled` response can leave another station notice pending.
The correction therefore preserves the sibling notice after the first `cancel_ack` response.

## Regression coverage

The tests use two station projections for the same kitchen order.
The repository double holds each response so the test can inspect the optimistic state.
The double also supplies a response status and timestamp.

- `station completion retains sibling work and its next version` checks a station completion with a `partially_ready` aggregate response.
- `station cancel acknowledgement retains the sibling notice` checks a `cancelled` aggregate response and then acknowledges the sibling notice.

Both tests check these results:

- The selected card disappears in the optimistic state.
- The sibling retains all its fields before acceptance.
- The sibling retains its station, date, items, and statuses after acceptance.
- Only its shared version and response timestamp change.
- The first request contains only the selected station item and expected version `1`.
- The sibling's next request contains only its own item and expected version `2`.
- The board uses its loaded snapshot without a refresh.
- The pending command count returns to zero after acceptance.

The completion test also checks that the sibling starts preparation and reaches version `3`.
The cancellation test checks that the sibling remains visible until its own acknowledgement.

## Red evidence

The new tests ran before the controller correction on base `c00978ad`.
Command, from `apps/umi-pos`:

```sh
/private/tmp/onca-flutter-sdk-3.47.5/bin/flutter test --no-pub test/features/kitchen/kitchen_board_test.dart --name 'station completion retains sibling work and its next version|station cancel acknowledgement retains the sibling notice' --reporter expanded
```

Result: exit `1`; both tests failed after the first accepted response.
Each test reported the same assertion failure:

```text
Expected: an object with length of <1>
  Actual: []
   Which: has length of <0>
```

The optimistic assertions passed before each failure.
This isolates the defect to the accepted-command path.

## Green evidence

The same focused command ran after the correction.
Result: exit `0`; `+2: All tests passed!`.

The full kitchen scope ran after Dart format, from `apps/umi-pos`:

```sh
/private/tmp/onca-flutter-sdk-3.47.5/bin/flutter test --no-pub test/kitchen_status_test.dart test/features/kitchen --reporter expanded
```

Result: exit `0`; `+150: All tests passed!`.
This scope includes board commands, pending commands, conflict handling, stale reads, retries, LAN forwarding, and kitchen presentation tests.

The analyzer ran on both changed Dart files:

```sh
/private/tmp/onca-flutter-sdk-3.47.5/bin/dart analyze lib/features/kitchen/kitchen_board_controller.dart test/features/kitchen/kitchen_board_test.dart
```

Result: exit `0`; `No issues found!`.

Format command:

```sh
/private/tmp/onca-flutter-sdk-3.47.5/bin/dart format lib/features/kitchen/kitchen_board_controller.dart test/features/kitchen/kitchen_board_test.dart
```

Result: exit `0`; two files formatted.
`git diff --check` also returned exit `0`.

## Tools and limits

The installed Flutter test runner is the existing tool for these Dart tests.
Flutter: `3.47.5`, framework `6a19cca564`, Dart `3.13.4`, DevTools `2.60.0`.
Sources: `apps/umi-pos/AGENTS.md`, the verification playbook, and the existing board tests.
The runner accepts noninteractive commands. Adoption required no new package or harness.
The existing SDK and test doubles were sufficient; no fallback tool was required.

The root instructions reference `product-feature-review`, but that skill was absent from the worktree and searched skill directories.
The assigned scope and the debugging, TDD, and verification skills governed this correction.

Native runtime validation remains with the root agent.
This task used no emulator, private runtime fixture, database, or backend process.
Controller and widget tests prove the local behavior described above. Native operator behavior remains unverified in this task.

The pre-existing modified plan and untracked test-data report retain their original state and remain outside this commit.
The requested report resides under an ignored directory and is explicitly included with `git add -f`.
