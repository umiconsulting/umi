# Issue tracker: Azure Boards (+ GitHub PRs as the review surface)

Work items and specs for this repository live in **Azure Boards**. Code review happens
on **GitHub pull requests**. A work item is the _spec_ — what the change must do. A pull
request is the _implementation and the review_.

- Organization: `https://dev.azure.com/umiconsulting`
- Project: **`Umi Consulting`**
- Work items read as a bare number: `#93`, `AB#93`

Use the **Azure DevOps MCP** for every work-item operation, and the `gh` CLI for pull
requests.

⚠ **Pin the organization on every call.** The local `az` login belongs to a different
organization and is not authorized here. Never rely on a global CLI default.

If the Azure DevOps MCP is not connected in the current session, say so and stop. Do not
guess the contents of a work item.

Work items and pull requests are independent. A work item can exist with no pull request —
future work, a bug handed to another person, a request a client phoned in. A pull request
can exist with no work item, for a small fix. A work item can come from the ticket skills
(`to-tickets`, `to-spec`, `triage`) or from a person straight in the UI. Both are equally
valid.

## Retired trackers

Two systems held this role before. Neither holds it now. Do not read a specification from
either one.

| System     | Status                | What to do with it                                                                                                                                                                                       |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trello** | Retired.              | The `build-v3` lineage sent `code-review` and `pr-gates` here, and the board holds no Build v3 work. The MCP server is removed from `.mcp.json`.                                                         |
| **Plane**  | Retired as a tracker. | Declared by GitHub PR #91 on `main`. The `plane.umiconsulting.co` instance stays up until its data is exported. Its MCP server stays declared for that export only. It is not a source of specification. |

## Where the spec lives

The spec for a change is its Azure Boards work item:

- **Description** — the requirement and the measured condition.
- **Acceptance Criteria** — what must be true to close it.
- **Repro Steps** — on a Bug, the observed and the expected result.
- **Comments** — clarifications and decisions.
- **State** — status. **Area Path** — the owning product. **Tags** — type and phase.

**Read every field, not only the description.** A work item is not one text field. A
correction that lands in the description and not in the repro steps leaves the reader
following the stale half.

## One project, area paths per product

The `Umi Consulting` project holds the whole monorepo. The **Area Path** carries the
product: `Platform\Database`, `Platform\API`, `Products\Umi Cash`, `Products\Umi Dashboard`,
`Products\UmiPOS`, `Operations\Security`, `Operations\Cutover`, `Program`.

The project boundary follows the repository and its deployment, not the directory. The
monorepo deploys as a unit, so it plans as a unit. A separate repository gets its own
project when it starts. `Umi Ticket Seller` is such a project, and it is not this one.

## Linking a pull request to its work item

The Azure Boards app is installed on the GitHub organization, so a reference inside a
commit message or a pull-request description creates a real link. **The syntax decides
whether the work item also moves.**

| Form          | Effect                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AB#93`       | Links only. The state does not change.                                                                                                                     |
| `Fixes AB#93` | Links, and transitions the work item when the pull request completes. Also `Fix`, `Fixed`, `Close`, `Closes`, `Closed`, `Resolve`, `Resolves`, `Resolved`. |

**Use the bare form by default.** A merge is rarely the whole of a work item in this
repository, because most items ask for attached evidence that no automation can produce.

Use the transition form only when completing the pull request genuinely completes the item,
including its acceptance evidence.

## When a work item closes

A work item closes when the work is done **and** tested. When the code is done and the test
is missing, the item stays `Active` and names what is missing.

Evidence is the **output of a command**, with its date and its commit. A sentence that says
"proven" is not evidence. A closed item with no evidence is an item that nobody can
re-verify.

⚠ **A state value is legal for a work-item type, not for the project.** `Removed` is valid
for a User Story and returns HTTP 400 for a Bug. On a Bug, use `Closed` with a reason.

⚠ **`System.Parent` is read-only.** Set the parent when you create the item, or use the
work-item link API. A direct field write fails.
