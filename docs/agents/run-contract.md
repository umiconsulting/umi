# Run contract

This contract defines one unit of delivery work. Use it for a run with a named brief and a
stop condition. Activation is explicit: the owner names the brief and the stop condition
before work starts. The contract is a manual procedure for the run. The repository also has
an executable evidence gate for the packet checks. The gate does not replace this contract.

## 1. Task

The brief states six items:

- **Goal** — the result the user needs.
- **Scope** — the work included and the work excluded.
- **Inputs** — the files, data, and decisions that the run can read.
- **Outputs** — the files and effects that the run must produce.
- **Done when** — the checkable acceptance criteria.
- **Stop** — the condition that ends the run, with or without a result.

A run without a stop condition is not a contracted run.

## 2. Files

- **One owner per artifact.** Only the owner writes the artifact.
- **Owned paths.** The brief lists every path that the owner can write.
- **Read-only inputs.** Every other path is read-only for the run.
- **One state writer.** One agent writes the run record. Other agents write their own
  evidence folder. No agent edits another owner's record.

## 3. Bar

The bar is a list of checkable acceptance criteria. Each criterion names the evidence that
proves it. The evidence is a command, its raw output, its exit code, and the SHA-256 hash of
the tested content. A statement of completion is not evidence.

## 4. Return

The owner returns these items:

- The verdict: pass, fail, or blocked.
- The artifact paths.
- The patch, limited to the owned paths.
- The exact commands that ran.
- The raw stdout and stderr.
- The real exit codes.
- The SHA-256 hash of every tested file.
- The timestamps.
- The completed effects, such as a file write or a state change.
- The areas that remain unverified.

## 5. Independent verifier

The verifier did not write the change. The verifier reruns the commands and reads the raw
output. The verifier rejects proof that is missing, stale, or mismatched. The verifier
records the rejection reason and the final verdict.

The verifier does not repair the artifact. The owner repairs it.

## 6. Evidence binding

Bind each claim to four items:

1. The SHA-256 hash of the tested content.
2. The exact command.
3. The raw log.
4. The real exit code.

Hash the tested content, not HEAD alone. A changed file hash, a different command, or a
missing log makes the proof stale. A stale proof fails the bar.

## 7. Evidence gate

The repository has one evaluator. Three commands call it:

| Command                                    | What it enforces                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm evidence:capture -- --check-id <id>` | Runs one approved command. Writes a packet with the real exit, raw logs, and the pre-run hash of each input.       |
| `pnpm evidence:check`                      | Validates the policy and the required packets. Rejects a stale hash, a missing log, a bad exit, and a path escape. |
| `pnpm evidence:check:ci`                   | Re-executes every required command and validates the fresh packet. Does not trust a stored exit.                   |

`pnpm check:pr` starts with `pnpm evidence:check`. The `lint` workflow has a prepared
`pnpm evidence:check:ci` step. The pre-push hook is prepared and inactive. This run makes no
claim that the CI step or the hook is active.

A cold checkout has no `packages/contract/dist`. The contract package exports that
directory, and `pnpm install` does not build it. Before `pnpm evidence:check:ci`, run
`pnpm --filter @umi/contract build:runtime`. The `lint` workflow runs this command in the
step before the evidence gate. Without it, the guard fails with
`Failed to resolve entry for package "@umi/contract"` and collects 0 tests.

Coverage is two checks: `evaluator-selftest` and `pos-checkout-partial-guards`. To add a
check, add an entry to `scripts/evidence/policy.json` and capture its packet. Add every
input that can change the result to `tested`.

The local validator is self-reported. A local actor can write a self-consistent packet.
`pnpm evidence:check:ci` supplies the stronger check because it runs the approved command
again. The evaluator hashes the tested inputs and the policy file before the command and
after the command. A change stops the capture with `N11`.

The decision record is `.verify-auto-evidence-20261114/lead/ADR-0001-evidence-gate.md`.

## 8. Non-claims

This contract makes no claim that the hook or the CI job is active. The gate is a local
control. A document does not enforce itself. Enforcement needs a separate, tested control.

## 9. Verification loop

Use the Surface, Run, Drive, Observe, Isolate, and Cleanup loop in
`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`. A result on one surface does not prove
another surface.

## 10. Operating loops

Use one loop for one type of uncertainty. A loop is active only when its trigger occurs.
Do not open a loop for work that has no trigger.

### Decision loop

- **Trigger:** two or more credible options have different consequences.
- **Owner:** the delivery lead.
- **Next action:** name the question. Label each input as documented fact, source-backed
  tradeoff, or Umi inference. Choose one option. Record its implementation consequence.
- **Stop:** one option has an owner, a date, and an implementation consequence.
- **Evidence:** the decision row in the run record and the affected file.

### Delivery loop

- **Trigger:** an accepted artifact must reach staging.
- **Owner:** one artifact owner.
- **Next action:** name the user result, the owned paths, the dependencies, the acceptance
  checks, the isolated branch, and the independent verifier.
- **Stop:** the exact final bytes pass the acceptance checks. An independent verdict exists.
- **Evidence:** commit, command, raw log, exit code, content hash, and verifier verdict.

### Incident loop

- **Trigger:** a check fails twice, or a failure escapes a gate.
- **Owner:** the artifact owner.
- **Next action:** reproduce the failure. Bound the cause. Add the smallest regression check
  at the failure boundary. Repair the cause. Verify the repair.
- **Stop:** the new check fails on the fault and passes on the repair.
- **Evidence:** the fault proof, the regression command, the exit codes, and the closure
  condition.

A loop is not complete without a trigger, an owner, a next action, a stop, and evidence.
Do not use a loop to bypass a gate. Do not call a known product failure accepted.

## 11. Recoverable handoff

One state writer records each handoff in the run record. The handoff has these fields:

- State version and timestamp.
- Exact input commit or branch.
- Completed external effects, with their identifiers.
- Pending dependencies and their owners.
- The next executable action.

On resume, read the state, then recheck the target identity and the applicability of each
inherited decision. Do not repeat a completed merge, closure, deployment, or message. If the
target moved, treat the handoff as stale and make a new decision.

## 12. Routing check

The live routing inputs are `.agents/skills/task-router/registry.md` and `node-resolver.md`.
After a routing change, run:

```sh
node scripts/check-task-router.mjs
```

The check rejects a retired tracker, a retired owner path, and a stale dashboard or Cash
description. It also runs a fault proof. A change to the router is not complete until this
check passes and the routing ledger records one representative route.
