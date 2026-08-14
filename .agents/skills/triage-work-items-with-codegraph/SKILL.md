---
name: triage-work-items-with-codegraph
description: Triage an Azure Boards work item against the current Umi code with the CodeGraph index. Use this skill whenever the user wants to inspect pending work items, triage a WI or a backlog, check whether a work item is stale or already implemented, find the code or the missing tests that a work item affects, validate an Azure Boards item against the source, or use CodeGraph to scope work-item impact — even when the user does not name CodeGraph or Azure Boards.
---

# Triage work items with CodeGraph

A work item is a claim about the code. A person wrote that claim on one date.
The code moved after that date. Your task is to test the old claim against the
code of today.

Two sources answer this. CodeGraph shows the relations between symbols. The
source files show the facts. CodeGraph tells you where to look. It does not tell
you what is true. Keep the two sources separate in your report.

## Step 1 — Orient

1. Read the root `AGENTS.md`. It holds the product boundaries and the writing standard.
2. Use `task-router` to choose the owner repository or the root slice for this work item.
3. Record the chosen owner. Every later result must fit inside that owner.

## Step 2 — Read the work item

Query Azure Boards with these explicit values:

- Organization: `https://dev.azure.com/umiconsulting`
- Project: `Umi Consulting`

Do not use the global Azure CLI defaults. The local `az` login belongs to a
different organization and is not authorized here.

Read these fields: title, state, area path, tags, description, and acceptance
criteria. The description often names the exact files and the exact symbols. Use
those names. They make the graph query precise.

**The work item is read-only.** Do not change the item, its state, or its
comments. Ask the user first. A triage pass that edits the tracker destroys the
evidence that the next pass needs.

Some work items make a claim about the tracker's own services, not about the
code: a repository, a branch, a pipeline, a wiki page. Neither CodeGraph nor `rg`
can see that class. Read the service itself.

On 2026-08-14 an item said the Azure Repos mirror "lacks build-v3". The
repository named `Umi Consulting` holds **TicketSeller**, a different product,
and its `main` head exists in no Umi repository. Four items had reasoned for
weeks from a mirror that never existed. One `repo_file` call answered it.

## Step 3 — Prepare the graph

Run `codegraph status` before any code analysis.

The status output reports pending files. A pending file is a file that changed
after the last index. A query against a stale index returns an empty result for
new code. That empty result looks the same as absent code, and it is not.

Run `codegraph sync` when the index reports pending changes. The sync is fast.

Then check the branch. The index covers the working tree, and the working tree is
one branch. Run these two commands:

- `git rev-parse --abbrev-ref HEAD`
- `git rev-list --left-right --count origin/main...HEAD`

A branch that is behind `main` gives an index that is missing code which exists on
`main`. On Umi this is not rare. A triage on 2026-08-13 ran from a branch 54
commits behind `main`. That index held neither the `normalized_phone` writer from
PR #57 nor the multi-seal route. Both were live on `main`.

Report the branch and the divergence in every triage. Before you write that code
is absent, confirm it against the branch that the work item targets:

- `git show origin/main:<path>`
- `git log --all --oneline -S "<symbol>"`

"The code is not on this branch" and "the code does not exist" are different
claims. Only the second one can make a work item stale.

## Step 4 — Ask one structured question

Prefer the `codegraph_explore` MCP tool when the session exposes it. Use
`codegraph explore` as the CLI fallback. Both return the same payload.

Start with one query that carries the whole work item, not one keyword. Include
six parts:

1. The WI ID.
2. The WI title.
3. The current condition that the description states.
4. The files that the description names.
5. The symbols that the description names.
6. The expected outcome.

A query built from the work item finds the flow. A query built from one keyword
finds noise.

## Step 5 — Narrow with exact commands

Use these commands when the first result leaves a gap:

| Command | Use it to find |
| --- | --- |
| `codegraph node <name>` | One symbol, its source, and its call trail |
| `codegraph callers <symbol>` | Every caller of a symbol |
| `codegraph impact <symbol>` | The blast radius of a change |
| `codegraph affected --depth 2 <files>` | The candidate test set |

Treat the `codegraph affected` result as a candidate test set only. Do not treat
it as an authoritative CI gate at any depth.

The measured behavior on Umi is worse than a wide result. On the PassKit
controller, depth two returned five test files. Not one was a wallet test, and
the set missed `wallet-pass.service.spec.ts`, the test that sits beside the code.
The command can drop the covering test and add unrelated tests in one result.

Find the tests yourself. Look in the directory of the symbol first. Then run `rg`
on the symbol name across the test files. Use `affected` to widen that list, never
to define it. The full suite stays the CI gate.

## Step 6 — Reject the results that do not belong

The Umi graph covers every product in one index. A query can therefore return a
symbol from a product that the work item never names.

Test every returned symbol against the owner from Step 1:

- The path sits inside the chosen owner. Keep it.
- The path sits in another product. Discard it, or prove the call path is real.

When the first natural-language query returns foreign symbols, run a second
query with the exact method names from the description. Exact names beat prose.

## Step 7 — Verify against the source

The graph proposes. The source decides.

1. Use `rg` to confirm the exact names and the exact files.
2. Read the source at the lines that you will cite.
3. Cite each claim with a file path and a line number.

Use each tool for its strength. CodeGraph answers "what depends on this". `rg`
answers "where is this exact text". A work item that already names the file and
the string needs `rg` first.

## Limits of CodeGraph authority

State these limits in the report when they apply.

- **SQL.** The index holds SQL strings inside TypeScript. It cannot prove that a
  statement resolves against the live schema. Use the SQL preflight or the
  database validation for that answer.
- **Migrations and schema compatibility.** Same limit. These need a database.
- **Markdown.** The index does not cover Markdown. Read the architecture
  documents directly for ownership facts and program facts.
- **Indirect calls.** Static analysis misses runtime dispatch, reflection,
  dependency injection, and framework conventions. A missing edge is not proof
  of a missing caller.

An empty graph result is a retrieval outcome. It is not a fact about the code.
Never write that missing graph data proves missing code.

When the graph cannot answer the work item, say so. Use the verdict **Graph
insufficient** and name the tool that can answer.

## Verdicts

Give exactly one verdict for each work item.

| Verdict | Meaning |
| --- | --- |
| Confirmed pending | The code shows the stated condition. The work is open. |
| Partially implemented | Part of the request exists. Part is absent. |
| Appears implemented | The code satisfies the request. Acceptance evidence is still open. |
| Tracker drift | The code moved past the description. The item needs a re-scope. |
| Graph insufficient | CodeGraph cannot reach the answer. Another tool must decide. |
| External or manual work | The work sits outside this codebase. |
| Blocked by missing evidence | A required source, credential, or environment is absent. |

Use **Appears implemented**, not "complete". Only an acceptance test closes a
work item. Code that looks correct is not acceptance evidence.

## Report format

Put the main finding in the first line. The reader must learn the verdict before
the evidence.

Return these fields for each work item:

- **WI ID and title**
- **Current state** — the Azure Boards state
- **Owner** — the chosen repository or root slice
- **Verdict** — one of the seven above
- **Current implementation** — what the code does today
- **Relevant files and symbols** — with line numbers
- **Callers and affected code**
- **Existing tests**
- **Missing tests**
- **CodeGraph confidence** — high, medium, or low
- **Evidence gaps** — what you could not check
- **Recommended next action** — one action

Mark each claim with its source. Write "graph" for a CodeGraph relation. Write
"source" for a line that you read. A reader must be able to tell the two apart.

### CodeGraph confidence

- **High** — The graph found the symbols, and you confirmed them in the source.
- **Medium** — The graph found a partial path, or the flow crosses products.
- **Low** — The work item depends on SQL, schema, Markdown, or indirect calls.

## Rules

- Preserve every unrelated change in the workspace. Triage reads. It does not edit.
- Do not update Azure Boards unless the user asks for it.
- Follow ASD-STE100 for English technical text.

When the user does ask for a write:

- Verify each closure candidate against the source before you change a state. A
  request to "close the solved ones" is a claim to test, not an instruction to
  execute. Report the honest count. Never manufacture a closure.
- Separate "the stated defect does not reproduce" from "there is nothing left to
  do". Re-scope the item when a residual gap survives. A closure deletes the only
  record of that gap.
- A state value is legal for a work-item type, not for the project. `Removed` is
  valid for a User Story and returns HTTP 400 for a Bug. Use `Closed` with a
  reason there. Write the state into the body only after the write succeeds.
