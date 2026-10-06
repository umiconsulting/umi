---
name: market-research
description: Run a market or competitive research pass for a new module, a redesign, or a build-or-buy question, and capture it as one dated file with labelled claims, captured screens, and a route-failure log. Use when the user asks how competitors handle something, wants a market scan or a competitive grid, wants the evidence before a product decision, or asks to standardise research.
---

# Market research

This skill answers one question well: **how does the market solve this, and what
should Umi do?** It produces one dated file under `docs/research/`.

The general `research` skill still owns a question with no market angle. Read it
first. This skill adds the market frame.

## The four non-negotiables

These are the four things that separate a market pass from a browsing session.
They are the reason this skill exists.

1. **Capture the screen.** A claim about an interface is weak without a picture of
   it. Every named screen of every named product gets a capture, or a recorded
   block. Use Playwright Chromium on `DISPLAY=:0`; a help centre usually renders
   its product images only after JavaScript runs.
2. **Label every claim.** Documented fact (with the URL), source-backed tradeoff,
   or inference. Anything unconfirmed reads UNVERIFIED. No claim goes unlabelled.
3. **Log the routes that failed.** A blocked source is a result. Record the host,
   the route, and the status. Try two routes before you give up.
4. **Say what did not change.** Read the prior file on the topic first. Report the
   unchanged list beside the changed one, so a redesign does not re-litigate
   settled ground.

## The run order

The full procedure is in [references/procedure.md](references/procedure.md). It has
18 steps: 5 to plan, 7 to collect, 6 to write. Each step names its tool, its output,
and its stop condition. Run it in order.

The short version:

1. Write the question in one sentence, and name the decision it informs.
2. Name 4 to 8 competitors, and name the count.
3. **Read the repo before the web.** `rg` over `docs/research/`, then CodeGraph for
   the owning module. A prior pass may answer the question already.
4. Collect, in this order: vendor documentation, the changelog, the source or the
   schema, user-generated content, the screens, practitioner writing, the standard.
5. Write: the route-failure log, the labels, the comparison grid, the conflicts,
   the unchanged list, and the recommendation with the runner-up.

## Which channel answers which question

Do not guess a route. [references/channels.md](references/channels.md) holds the
tested list, including the ones that work when search is blocked and the ones that
never work from this workstation.

The two facts that save the most time:

- **Search engines are unreliable here.** DuckDuckGo serves a bot challenge to
  `curl`; Bing ignores the query. DuckDuckGo through real Chromium works. Go
  straight to the help centre, the sitemap, or the vendor's own API instead.
- **Go where there is an API.** A help centre's `/api/v2/help_center` answers when
  its pages do not. Apple's lookup API answers when its web page does not.

## The file layout

One file when the pass reads only. A folder when the pass captures screens.

```
docs/research/YYYY-MM-DD-<topic>.md
docs/research/YYYY-MM-DD-<topic>/
  README.md            the compressed finding
  assets/INDEX.md      each image, its source URL, its device class, and its date
  assets/              the captures
  report.html          the illustrated report, when a person reads it
```

Commit the index. **Do not commit a bulk harvest.** The index holds the source URL
and the capture route for every image, so the images are reproducible, and a
53 MB harvest against a 91 MB `.git` is not worth the history. See the
`.gitignore` note at the repository root for the entry that enforces this.

## Before you finish

Answer these in the file, not in chat:

1. Does every claim carry a label?
2. Does every named screen have a capture or a recorded block?
3. Does every blocked host have two routes tried and a status?
4. Is the comparison grid complete, with "no" and "not verified" as real cells?
5. Does the recommendation name the runner-up and the reason to reject it?
6. Does the file say what changed since the prior pass, and name that pass?
