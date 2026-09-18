# Tool selection and research doctrine

## 1. Scope

This instruction applies to every task in this workspace. It applies to a one-line question
and to a full program. It applies before the work starts, while the work runs, and in the
report at the end.

Every agent reads it. It is not advice.

## 2. The rule

1. Name the best available tool before you build anything by hand.
2. Research the approach, not only the fact. A correct decision with a poor approach is
   still a poor result.
3. Be persistent. When a source blocks, try another route before you give up.
4. Record the tool, its version, and the source that recommended it.
5. A hand-rolled solution needs a written reason.

## 3. Step 0 of every task

Before the first command, answer five questions. Write the answers in the task output.

| Question                              | Why it matters                                            |
| ------------------------------------- | --------------------------------------------------------- |
| Does a proven tool already do this?   | Hand-rolled work costs more and hides errors.             |
| Is it installed here?                 | An installed tool beats a tool that needs a setup detour. |
| Can an agent drive it with no prompt? | An interactive tool breaks an automated run.              |
| What does adoption cost?              | A large migration needs a reason beyond taste.            |
| What is the fallback?                 | The fallback is the answer when the tool fails.           |

The task output is the reply to the user, the commit message, or the plan step. One of them
must name the tool.

## 4. The research ladder

Start at rung 1. Fall back only when the rung above is silent or blocked. Record the rung
you used.

| Rung | Source                                                                           | Use it for                                |
| ---- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| 1    | Vendor documentation and the API reference                                       | The capability and the exact parameter    |
| 2    | Changelog, release notes, status page                                            | What is current, and what is broken today |
| 3    | The source: repository, issues, discussions, pull requests                       | The real behaviour, and the workarounds   |
| 4    | Practitioner writing: engineering blogs, Substack, dev.to, Hacker News, Lobsters | The approach, and the traps               |
| 5    | Communities: Reddit, Discord, Slack, Stack Overflow                              | The undocumented case                     |
| 6    | Social: X                                                                        | The newest practice, when access allows   |
| 7    | Primary research: papers, specifications, standards                              | The measured truth                        |

Rung 3 is the most under-used. A closed issue in the tool's own repository often answers a
question that no documentation page answers.

## 5. Persistence

One failed attempt is not a result. When a source blocks, try a second route, then a third.
Record each attempt and what it returned.

Routes that work when a page blocks: the official API, an RSS or Atom feed, a public JSON
endpoint, the sitemap, the help centre instead of the marketing page, a different locale,
the Wayback Machine, a text extraction service, or the vendor's own repository.

The channel playbook with tested results is
`docs/research/2026-09-16-research-channels-playbook.md`.

## 6. The evidence standard

Label every claim in one of three ways.

| Label                  | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| Documented fact        | A source owns it. Give the URL.                  |
| Source-backed tradeoff | Two sources disagree, or a source states a cost. |
| Inference              | You reason from the facts. Mark it as inference. |

Mark anything you could not verify as UNVERIFIED. Never invent an endpoint, a flag, a price,
a limit, or a capability.

## 7. Where the findings go

| Kind of finding              | Location                            |
| ---------------------------- | ----------------------------------- |
| Research on a topic          | `docs/research/YYYY-MM-DD-topic.md` |
| A decision with alternatives | an ADR under `docs/architecture/`   |
| A program or a feature plan  | `docs/plans/`                       |
| A repeatable procedure       | `.agents/skills/<name>/SKILL.md`    |

The task output names the file. A finding that lives only in a chat message is lost.

## 8. The tool map

The full map, with versions and sources, is in
`docs/research/2026-09-16-agent-toolbox-and-devtools.md`. The short version:

| Task                           | Tool                                                                                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read a failed Vercel build     | `npx vercel@latest inspect <deployment> --logs`                                                                                                                                                                                                                            |
| Read a failed Cloudflare build | `gh run view <run> --log-failed`                                                                                                                                                                                                                                           |
| Watch a pull request           | `gh pr checks <n> --watch`                                                                                                                                                                                                                                                 |
| Find a lost feature            | `git log --all -S<string>`, `git worktree list`, `git stash list`                                                                                                                                                                                                          |
| Understand the code            | CodeGraph                                                                                                                                                                                                                                                                  |
| Inventory every control        | Playwright over CDP                                                                                                                                                                                                                                                        |
| Measure a screen               | Chrome DevTools Protocol                                                                                                                                                                                                                                                   |
| Read the native POS tree       | the Dart VM service                                                                                                                                                                                                                                                        |
| Drive the Flutter app          | patrol and integration_test                                                                                                                                                                                                                                                |
| Query the database             | psql, `explain analyze`                                                                                                                                                                                                                                                    |
| Verify a deploy                | curl, the health endpoint, the release commit                                                                                                                                                                                                                              |
| Scrape a site that blocks curl | **Obscura** over CDP (`docker run -d -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura`) for anything with a JS or fingerprint wall; **Scrapling** (`uv pip install "scrapling[fetchers]"`) for TLS-impersonating HTTP with no browser. Evaluated 2026-09-17 — see the trap below |

**A bot wall is usually the IP, not the browser, and the two tools tell you which.** Measured
2026-09-17 against G2, Capterra and Reddit: a windowed real Chromium got 403 on all three; **Scrapling
0.4.15** (`Fetcher` with Chrome TLS impersonation _and_ `DynamicFetcher` on Playwright Chromium) also
got 403 on all three; **Obscura** (Rust, native V8, no Chromium, CDP on 9222) got Reddit 200 with
33 KB of real content and still 403 on G2. So Obscura is the better default for research scraping, and
neither tool will open an IP-blocked site — G2 and Capterra need residential or mobile egress, which
is a purchasing decision rather than a library one. Before buying anything, spend the same effort on
the route that actually worked: **go where there is an API.** Trustpilot, Apple's App Store search
and review API, and any Zendesk help centre's public `/api/v2/help_center/articles/search.json`
answered everything substantive about a whole software category that three browser stacks could not.
Reddit is readable through Obscura only when you use its `.json` endpoints with `restrict_sr=1`; the
global `search.json` ignores the query and returns the front page, which looks like a successful
crawl of the wrong thing.

**Driving the native POS.** The runtime of record is the Linux build with the Dart VM service
published (`--debug`), driven with real pointer events on the X11 window by
`tools/ux-sweep/pos-native-driver.mjs`; `tools/ux-sweep/pos-native-flows.mjs` holds the named flows
and reports one line per flow. Three things about it are not obvious and each one cost a run:

- **A control that comes from an API read is not absent, it is early.** The tender screen draws its
  method tiles and its split control from the location's policy, which the sheet fetches when it
  opens. A flow that snapshots the screen on the first frame cannot tell "this location forbids it"
  from "the answer is still in flight", and those are opposite conclusions. Wait on the control
  (`driver.waitFor`), with an explicit timeout, and treat the timeout as the real "not offered".
- **A flow whose precondition is not the default policy should check both answers, not demand
  one.** `tender-split-is-a-decision` runs on a location that allows mixed tender and on one that
  does not: the replace-by-default behaviour is asserted either way, and the split itself is
  asserted only where the policy offers it — with the honest alternative (the screen says one
  method per sale) asserted where it does not. Mutating the shared database to make a flow happy is
  the other option; it is worse, and it must be restored if you do it.
- **An expectation that matches text already on screen passes before the state it means to
  assert.** Waiting for `Cobro dividido` after tapping a second method succeeds immediately,
  because the notice title is already there from the arming step. Wait for something only the new
  state has — the numbered legs — or the screenshot proves the previous screen.

`xdotool search --name '^UmiPOS$'` matches two windows for one running till: the GTK toplevel and
its leader window. `wmctrl -l -x` is the check that distinguishes that from two instances. The
driver reports the count as `windowCount`; a `2` there is not on its own a reason to kill anything.

## 9. Before you finish

Run this checklist. Report the answers when the task is not trivial.

1. Did you name the tool?
2. Did you record the version and the source?
3. Did you try at least two routes for a blocked source?
4. Did you mark the unverified claims?
5. Did you avoid hand-rolling what a tool already does?
6. Did the research land in a file?

## 10. Anti-patterns, and what each one cost

| Anti-pattern                                                     | What it cost                             | The rule that prevents it                     |
| ---------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Read a deploy failure from a browser tab                         | one hour                                 | section 8, one command reads it               |
| Hand-rolled a browser harness                                    | a day of duplicated work                 | name the tool first                           |
| Ignored Chrome DevTools on a Chromium product                    | no performance evidence                  | section 8, measure every screen               |
| Declared a payment provider without checking the fiscal duty     | a wrong plan                             | research the obligation, not the feature      |
| Trusted a competitor claim without the primary source            | an inverted conclusion                   | rung 1 before rung 6                          |
| Wrote a finding only in the chat                                 | the next agent repeats the work          | section 7                                     |
| Read a control's absence from the first frame                    | a false "the feature is missing" verdict | wait on the flow's precondition, section 8    |
| Edited a 2 KB padded markdown table row with `s/…/…/`            | two failed commands                      | `sed '1894c\…'`, the delimiter is in the data |
| Widened a CHECK vocabulary with `if not exists`                  | a shipped 500 on the new value           | fix the constraint by its DEFINITION (below)  |
| Ran a DB-gated spec with `--config vitest.integration.config.ts` | "No test files found", a wasted run      | read the spec's gate: section 10b             |
| Proved a migration on a database someone had already patched     | evidence that proved nothing             | build the chain: section 10b                  |

### 10b. Three traps this codebase sets, and the cheap way past each

**A new value in an existing vocabulary is a constraint migration, not an INSERT.** `command_type`,
`status` and `kind` columns are `CHECK`-constrained to a literal list, and the list lives in the file
that created the table, not in the contract. Adding a value (a new kitchen command, a new tender
outcome) therefore needs a **definition-aware correction**: read `pg_get_constraintdef(c.oid)`, and
`elsif v_def not like '%new_value%' then drop constraint ...; add constraint ...`. An
`if not exists (… conname = '…')` guard finds the OLD constraint, does nothing, and the new value dies
at runtime with a bare `23514` that the client sees as a 500. The shape to copy is
`docs/migration/build-v3/70_tender.sql`'s `fiscal_document_stamped_shape` block; `74_kitchen_courses.sql`
does the same for `kitchen_command_command_type_check`. Assert it in `99_verify.sql` by the value's
name inside the expression, because "the guard exists" is exactly the state that ships broken.

**Build the chain, do not patch the database.** A migration correction like the above only runs when
an EARLIER file has created the old shape, so proving it on a database where someone already widened
the constraint by hand proves nothing. `bash docs/migration/build-v3/00_run.sh <fresh_db>` applies
every numbered file in order — that is the only run where the correction path is exercised, and it
ends with `99_verify.sql` asserting the result. Seed the harness fixture rows afterwards.

**The live Postgres is a Docker container, and the docs' port is stale.** `docker port
umi-buildv3-local-postgres-1` is the authority (currently `127.0.0.1:4003`, while several docs say
5233); the password is `umi-transition-local-only`, not `postgres`. Two different specs need two
different runners: `*.integration.ts` files go through `vitest.integration.config.ts`, while
`kds.repository.integration.spec.ts` matches the DEFAULT config and is gated on `GATE4A_DATABASE_URL`
instead — it needs the `postgres` superuser role, because the spec writes rows that RLS would
otherwise refuse. `apps/umi-api/.env` points at the shared rehearsal database; export
`GATE4A_DATABASE_URL` explicitly rather than sourcing `.env` to reach a disposable one.

## 11. Sources

- Toolbox and Chrome DevTools: `docs/research/2026-09-16-agent-toolbox-and-devtools.md`
- Research channels and fallbacks: `docs/research/2026-09-16-research-channels-playbook.md`
- Mexico payments and fiscal: `docs/research/2026-09-16-mexico-payments-and-fiscal.md`
- Design law: `docs/research/2026-09-15-ux-patterns-and-design-north-star.md`
- Tooling landscape and versions: `docs/research/2026-09-15-tooling-and-design-system-landscape.md`
