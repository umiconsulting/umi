import type { ApiError } from '@umi/contract';

/**
 * A refusal an operator can act on, raised from the repository and turned into a
 * response by the service.
 *
 * WHY THIS EXISTS. `openShift` used to answer a register that another shift still
 * held with `throw new Error('REGISTER_NOT_AVAILABLE')`. Nothing mapped that
 * message to a status, so it came out of the catch-all filter as a **500** with
 * the body `{"code":"INTERNAL_ERROR","message":"Internal server error"}` — the
 * operator saw a server fault, the log said `detail=REGISTER_NOT_AVAILABLE`, and
 * nothing on either side said which terminal held the drawer or what to do about
 * it. Plan §4 forbids exactly that: "Every failure shows a typed message with a
 * recovery action. No raw technical code outside the diagnostics surface."
 *
 * The register is a conflict, not a fault: the drawer exists, the cash is in it,
 * and a specific terminal has it. So the status is the caller's to name and the
 * facts travel in `details`, which `all-exceptions.filter.ts` passes through on
 * 4xx only.
 *
 * The repository raises it where the transaction is still open, so the refusal
 * rolls the command back and is NOT recorded as failed — the same shape a plain
 * throw had. The service is the only place that knows about HTTP.
 */
export class CashRefusal extends Error {
  constructor(
    readonly code: ApiError['code'],
    readonly status: number,
    readonly details: Record<string, string | number | boolean | null> = {},
  ) {
    super(code);
    this.name = 'CashRefusal';
  }
}
