# The 18 steps

Run in order. Each step names its tool, its output, and the condition that ends it.
A step that cannot run is **blocked**, not passed. Record the block and continue.

## Planning

### 1. Write the question in one sentence

- **Tool:** none. The requester writes it.
- **Output:** one sentence at the top of the file.
- **Stop:** the sentence names one decision and no more. A sentence with an "and"
  in it is two questions.

### 2. Name the decision the pass informs

- **Tool:** none.
- **Output:** a line that reads `This informs: <one decision>`.
- **Stop:** the decision is a placement, a build, or a no-build. A pass that informs
  nothing is a reading exercise.

### 3. Fix the date and the evidence window

- **Tool:** `date`.
- **Output:** the file date and the window the evidence covers.
- **Stop:** the window is stated, and the file name carries the date.

### 4. Name the competitors, and name the count

- **Tool:** the requester, and CodeGraph for Umi's own prior notes.
- **Output:** 4 to 8 product names.
- **Stop:** at least 4 names, or a written reason that fewer exist. Include the
  regional incumbents, not only the American brands; Umi sells in Mexico.

### 5. Read the repo before the web

- **Tool:** `rg` over `docs/research/`, then CodeGraph for the owning module.
- **Output:** the prior Umi files on this topic, and the module that owns it.
- **Stop:** every prior file on the topic is read, or excluded by name with a reason.
  This step is the cheapest and it is the one that gets skipped.

## Evidence

### 6. Collect vendor documentation

- **Tool:** `curl`, `gh api`, the vendor help centre, `r.jina.ai` for a JavaScript
  page.
- **Output:** notes, each with its URL and its HTTP status.
- **Stop:** every named product has a rung-1 page, or a recorded block.

### 7. Collect the changelog and the release notes

- **Tool:** `curl`, the vendor RSS feed, the GitHub releases API.
- **Output:** dated entries for the last 6 months.
- **Stop:** 6 months are covered, or the vendor publishes nothing and you say so.

### 8. Read the source and the schema for the same capability

- **Tool:** CodeGraph, then `github.com` or the vendor repository.
- **Output:** a file path and a line number for every Umi claim.
- **Stop:** every claim about Umi carries a repo location. A claim about Umi with no
  line number is a guess.

### 9. Collect user-generated content

- **Tool:** the Apple App Store review API, the Google Play listing, a Discourse
  `/latest.json` or `/search.json`, the Reddit `.rss` feed, a Zendesk help centre's
  `/api/v2/help_center/articles/search.json`.
- **Output:** verbatim quotes, each with a permalink and a date.
- **Stop:** 20 or more items, or a recorded block for each channel.

Read [channels.md](channels.md) before this step. It records which channel answers
which market question and which ones never work here.

### 10. Capture the screens

- **Tool:** Playwright Chromium with `headless: false` and `DISPLAY=:0`.
- **Output:** one image per screen, plus `assets/INDEX.md` with the source URL, the
  device class, and the capture date for each.
- **Stop:** every named screen of every named product has a capture, or a recorded
  block with the routes tried.

A help centre often renders its product images only after JavaScript runs, so the
served HTML holds none. A capture of the rendered page is the evidence. Do not
hotlink.

### 11. Read practitioner writing for the traps

- **Tool:** the Hacker News Algolia API, a Substack RSS feed, the dev.to articles
  API, an engineering blog.
- **Output:** a link plus the trap each source names.
- **Stop:** 3 or more sources, or a recorded gap.

### 12. Read the standard that applies

- **Tool:** `curl`, then the Wayback Machine CDX index.
- **Output:** the clause that applies, quoted, with the standard's name and year.
- **Stop:** one standard is cited, or the item is marked UNVERIFIED. Do not cite a
  standard you did not read.

## Writing

### 13. Write the route-failure log

- **Tool:** none.
- **Output:** a table of host, route, and result.
- **Stop:** every blocked host has 2 or more routes tried, with the status recorded.

### 14. Label every claim

- **Tool:** none.
- **Output:** each claim marked **Documented fact** (with URL), **Source-backed
  tradeoff**, or **Inference**.
- **Stop:** no claim is unlabelled. Anything unconfirmed reads UNVERIFIED.

### 15. Build the comparison grid

- **Tool:** none.
- **Output:** one row per capability, one column per product.
- **Stop:** every cell holds a value, a "no", or "not verified". A blank cell is a
  claim that nobody checked.

### 16. State where the sources disagree

- **Tool:** none.
- **Output:** the conflict, with both sources named.
- **Stop:** no conflict stays silent. A disagreement between two vendors is usually
  the most useful fact in the file.

### 17. Write what did not change since the prior file

- **Tool:** `ls docs/research/ | sort | tail`.
- **Output:** a short unchanged list beside the changed list.
- **Stop:** the prior file is named, or the pass states that none exists.

### 18. Write the recommendation and the alternatives

- **Tool:** none.
- **Output:** the decision, the runner-up, and the reason to reject the runner-up.
- **Stop:** a reader can accept or reject the decision without reading the evidence
  again. A recommendation with no runner-up is an opinion.
