# Phase 0C — Assistant Platform Readiness

| Foundation                            | Status  | Evidence or blocker                                               |
| ------------------------------------- | ------- | ----------------------------------------------------------------- |
| Conversational service and tool loop  | PARTIAL | `apps/umi-api/src/modules/conversations` exists.                  |
| Tool schemas                          | PARTIAL | Current schemas are hand-maintained and commerce-specific.        |
| Permission-aware tools                | PARTIAL | Context exists. POS permissions and branch proof are absent.      |
| Safe read models                      | BLOCKED | POS financial projections do not exist.                           |
| Structured business errors            | MISSING | Current HTTP envelope lacks the Phase 0B taxonomy.                |
| Redacted telemetry correlation        | PARTIAL | Trace support exists. POS command correlation is absent.          |
| Immutable audit                       | MISSING | No POS audit event model exists.                                  |
| Human confirmation                    | PARTIAL | Conversation confirmation exists. It is not a financial control.  |
| Fresh PIN and manager approval        | MISSING | POS approval primitives do not exist.                             |
| Tool allowlists and schema validation | PARTIAL | Tool definitions exist. Server authority needs stronger metadata. |
| Prompt-injection defense              | PARTIAL | Turn safety exists. Retrieved content isolation needs proof.      |
| Tenant and branch isolation           | PARTIAL | Tenant context exists. Branch and worker paths remain.            |
| Rate and cost limits                  | MISSING | In-memory API limits are insufficient.                            |
| Consequential transaction boundary    | BLOCKED | Checkout, payment, refund, and cash writers do not exist.         |

Assistant work is not required before POS entry. Prepare the data, contract, permission, audit, and
error foundations now.

The Assistant must never execute SQL, receive a service role, bypass RLS, authorize payments,
repeat an ambiguous charge, alter history, self-approve, or expose sensitive data.
