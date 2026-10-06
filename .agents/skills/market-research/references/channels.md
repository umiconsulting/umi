# Channels, and the route that works for each

Tested on this workstation between 2026-09-16 and 2026-09-18. A route that worked
once is not a guarantee, but a route that failed the same way four times is not
worth a fifth attempt.

## Pick the channel by the question

| The question | The channel | The route that works |
| --- | --- | --- |
| What does the product claim it does? | Vendor documentation | `curl` the help centre. A JavaScript page needs `https://r.jina.ai/<url>` in front, or real Chromium |
| What changed recently? | Changelog, release notes | The vendor RSS feed, `changelog.<vendor>.com`, `gh api repos/<owner>/<repo>/releases` |
| Where exactly does the screen live, and who may open it? | The help centre's own search API | A Zendesk centre answers `/api/v2/help_center/articles/search.json?query=...` when its pages do not |
| What does the screen look like? | The rendered page | Playwright Chromium, `headless: false`, `DISPLAY=:0`. See the trap below |
| What does the operator say in their own words? | The App Store, Google Play, a forum | `itunes.apple.com/lookup?id=<appid>` and the review feed; a Discourse board's `/search.json`; Reddit's `.rss` |
| What does the operator complain about after a year? | Review sites | **Blocked here.** G2, Capterra, Trustpilot, Software Advice, GetApp, TrustRadius, Slashdot, SourceForge, SaaSworthy, AlternativeTo all answer 403 |
| What is the price? | The pricing page | `curl`. A marketplace listing holds it too |
| What is the real behaviour, not the claim? | The source, the schema, the migration | CodeGraph for Umi. `github.com` for a vendor. `gh api` for an issue or a discussion |
| What is the standard or the obligation? | The standards body | `curl`. Fall back to the **Wayback CDX index** |

## Search is the weak link

Search is unreliable from this workstation. Do not build a pass on it.

| Engine | Route | Result |
| --- | --- | --- |
| **DuckDuckGo** | `curl` | HTTP 202 with a bot challenge |
| **DuckDuckGo** | **real Chromium over Playwright** | **Works.** This is the discovery route. Read `a[data-testid="result-title-a"]` |
| Bing | RSS and HTML | HTTP 200, and it ignores the query. It returns pages for a different query |
| Brave | `curl` | Works for about two queries, then HTTP 429 |
| Mojeek, Marginalia, Startpage, Yandex | `curl` | HTTP 200, and no parseable result set |

**Go where there is an API instead.** A help centre's search API, a sitemap, a
Discourse `/latest.json`, or a vendor's own index answers what search cannot, and
it answers with the source that owns the claim.

## The API routes worth knowing

| What | Endpoint |
| --- | --- |
| Apple app search | `https://itunes.apple.com/search?term=<name>&entity=software&country=us&limit=5` |
| Apple app detail, with screenshots | `https://itunes.apple.com/lookup?id=<appid>&country=us` |
| App Store reviews | `https://itunes.apple.com/us/rss/customerreviews/id=<appid>/sortBy=mostRecent/json` |
| A Zendesk help centre | `https://<host>/api/v2/help_center/articles/search.json?query=<terms>` |
| A Discourse forum | `https://<host>/latest.json`, `https://<host>/search.json?q=<terms>` |
| Reddit, when the JSON is blocked | `https://www.reddit.com/r/<sub>/search.rss?q=<terms>&restrict_sr=1` |
| Hacker News | `https://hn.algolia.com/api/v1/search?query=<terms>&tags=story` |
| A page in the past | `http://web.archive.org/cdx/search/cdx?url=<host>&output=json` |

**The App Store screenshot trick.** The feed returns a thumbnail. Replace the last
path segment with `2000x2000bb.<ext>` to read the full asset.

**The Apple review permalink.** An entry's `author.uri.label` is a real review URL.
Verify it returns 200 before you quote it.

## Traps that cost a run

**A rendered page is not the served page.** `support.toasttab.com` is a Next.js
app. It answers HTTP 200 with 627 KB of shell and holds no product image. Real
Chromium renders 31 product screens from it. An earlier pass recorded "the vendor
publishes no screenshots" and that was wrong.

**A help centre's pages and its API disagree.** Pages need JavaScript; the
`/api/v2/help_center` endpoint does not. Try the API first.

**A forum is not always Discourse.** `community.shopify.com` is Discourse and
answers `.json`. `community.squareup.com` is Khoros and answers 404 to `.json`; its
`/t5/...` HTML answers a plain `curl` with a Chrome user agent.

**Chrome 145 refuses a local address.** A CDP browser launched by the harness
cannot navigate to `127.0.0.1` or `localhost` — it reports "Access to private
network is not allowed". Launch your own Chromium with
`--disable-features=LocalNetworkAccessChecks`, or use the profile the harness
owns.

**Reddit rate-limits by IP, not by session.** The `.rss` route works. Pace the
calls at 40 to 50 seconds. A container restart does not clear the block.

**`web.archive.org` can answer `AbuseAlleviationError`.** The CDX index is the
part that usually still answers.

**A bot wall is usually the IP, not the browser.** Four browser stacks were
measured against review sites and all four got 403. No library fixes that. It is a
purchasing decision, and it is not worth the spend while a help centre API answers
the same question.

## The rendering stack, in the order to try

1. `curl` with a Chrome user agent.
2. `https://r.jina.ai/<url>` — a text proxy for a JavaScript shell.
3. Playwright Chromium, `headless: false`, `DISPLAY=:0` — the full render.
4. Obscura over CDP (`docker run -d -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura`) —
   a native V8 browser with no Chromium, for a fingerprint wall.
5. The Wayback CDX index, then `archive.ph`.
