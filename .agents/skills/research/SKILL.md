---
name: research
description: Investigate a question and pick the best tool for the job, against high-trust sources, and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, a tool chosen, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. **Name the tool first.** Research answers two questions: what is true, and what is the best
   instrument for the task. A tool answer needs the package or product name, the version, the
   licence, the maintenance state, and the adoption cost.
2. Investigate against **primary sources** — official docs, source code, specs, first-party
   APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
3. **Climb the ladder.** Vendor documentation, then the changelog and status page, then the
   repository with its issues and discussions, then practitioner writing, then communities,
   then social, then primary research. Record the rung you used.
4. **Be persistent.** One blocked page is not a result. Try the API, a feed, a sitemap, the
   help centre, the repository, the Wayback Machine, or a text extractor. Record what failed.
5. Write the findings to a single Markdown file, citing each claim's source.
6. Label each claim: documented fact, source-backed tradeoff, or inference. Mark anything
   unverified as UNVERIFIED. Never invent an endpoint, a flag, a price, or a capability.
7. Save it where the repo already keeps such notes; match the existing convention, and if
   there is none, put it somewhere sensible and say where.

Read `docs/agents/tool-and-research-doctrine.md` for the full rule, and
`docs/research/2026-09-16-research-channels-playbook.md` for the tested channel list.
