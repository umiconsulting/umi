# Research Channels Playbook

Date: 2026-09-16

Purpose: this file gives a working method and a fallback for each research source.
The agent must collect evidence from engineering blogs, forums, social media, and long-form writing.
The agent must work without an interactive login.

Test day: 2026-09-16.
All tests ran on the Umi workstation from `/home/jc/umi`.
Tools: `curl` 8.5.0, `python3` 3.12.3, `node` v22.23.2, `gh` 2.45.0, `jq` 1.7.
The test client sent this header: `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36`.

## Status words

| Word       | Meaning                                             |
| ---------- | --------------------------------------------------- |
| WORK       | The method answered the test on 2026-09-16.         |
| KEY        | The method needs an API key or a token.             |
| ACCOUNT    | The method needs a login or a member account.       |
| BLOCK      | The host refused the test from this workstation.    |
| UNVERIFIED | We did not confirm the item on this workstation.    |
| 429        | The host answered, but it limited the request rate. |

## Rules

1. Try the cheap method first. Use the RSS feed, then the JSON endpoint, then the API.
2. Send a User-Agent with a contact address. Some hosts block a default client.
3. Sleep between calls. Reddit answers one call and then sends 429.
4. Keep the terms of service. Read the "Terms" note in each section.
5. Record the observed status for each call. Do not write a claim without a source URL.

## Decision table

| Source          | Method                   | Command or URL                                                                                                                            | Auth         | Tested                            | Fallback                  |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------- | ------------------------- |
| X               | Syndication JSON         | `curl -s "https://cdn.syndication.twimg.com/tweet-result?id=20&token=a"`                                                                  | No key       | WORK, 200, 920 bytes              | oEmbed, or `lightbrd.com` |
| X               | oEmbed                   | `curl -s "https://publish.twitter.com/oembed?url=https://twitter.com/jack/status/20"`                                                     | No key       | WORK, 200                         | Syndication JSON          |
| X               | Official API v2          | `curl -s -H "Authorization: Bearer $X_TOKEN" "https://api.x.com/2/tweets?ids=20"`                                                         | KEY          | KEY, 401 without a token          | Syndication JSON          |
| X               | Front end `lightbrd.com` | `curl -s "https://lightbrd.com/jack"`                                                                                                     | No account   | WORK, 200, 24 posts               | Wayback Machine           |
| Reddit          | Atom feed                | `curl -s "https://www.reddit.com/r/restaurantowners/new/.rss"`                                                                            | No key       | WORK, 200; a second call sent 429 | Wayback Machine           |
| Reddit          | JSON endpoint            | `curl -s "https://www.reddit.com/r/programming/hot.json"`                                                                                 | No key       | BLOCK, 403                        | Atom feed                 |
| Reddit          | Old interface            | `curl -s "https://old.reddit.com/r/programming/hot.json"`                                                                                 | No key       | BLOCK, 200 but HTML, not JSON     | Atom feed                 |
| Reddit          | Official API             | `https://oauth.reddit.com/r/programming/hot`                                                                                              | KEY, ACCOUNT | BLOCK, 403                        | Atom feed                 |
| Hacker News     | Algolia search           | `curl -s "https://hn.algolia.com/api/v1/search?query=restaurant%20pos&tags=story&hitsPerPage=2"`                                          | No key       | WORK, 200                         | Firebase API              |
| Hacker News     | Firebase API             | `curl -s "https://hacker-news.firebaseio.com/v0/topstories.json"`                                                                         | No key       | WORK, 200                         | Algolia search            |
| Hacker News     | RSS feed                 | `curl -s "https://news.ycombinator.com/rss"`                                                                                              | No key       | WORK, 200                         | Algolia search            |
| Substack        | RSS feed                 | `curl -s "https://stratechery.substack.com/feed"`                                                                                         | No key       | WORK, 200                         | Posts API                 |
| Substack        | Posts API                | `curl -s "https://stratechery.substack.com/api/v1/posts?limit=2"`                                                                         | No key       | WORK, 200                         | RSS feed                  |
| Medium          | User RSS feed            | `curl -s "https://medium.com/feed/@ev"`                                                                                                   | No key       | WORK, 200                         | Tag RSS feed              |
| Medium          | Tag RSS feed             | `curl -s "https://medium.com/feed/tag/restaurant"`                                                                                        | No key       | WORK, 200                         | User RSS feed             |
| Medium          | Page HTML                | `curl -s "https://medium.com/@ev"`                                                                                                        | No account   | BLOCK, 403                        | RSS feed                  |
| dev.to          | Articles API             | `curl -s "https://dev.to/api/articles?tag=webdev&per_page=2"`                                                                             | No key       | WORK, 200                         | User RSS feed             |
| dev.to          | User RSS feed            | `curl -s "https://dev.to/feed/ben"`                                                                                                       | No key       | WORK, 200                         | Articles API              |
| Lobsters        | JSON listing             | `curl -s "https://lobste.rs/hottest.json"`                                                                                                | No key       | WORK, 200                         | RSS feed                  |
| Lobsters        | RSS feed                 | `curl -s "https://lobste.rs/rss"`                                                                                                         | No key       | WORK, 200                         | JSON listing              |
| Lobsters        | Search page              | `curl -s "https://lobste.rs/search?q=pos&what=stories"`                                                                                   | No key       | BLOCK, bot check page             | Bing site search          |
| GitHub          | CLI search               | `gh search repos "restaurant pos" --limit 2 --json fullName`                                                                              | ACCOUNT      | WORK                              | Anonymous REST            |
| GitHub          | Code search              | `gh search code "shift close" --limit 2 --json repository,path`                                                                           | ACCOUNT      | WORK                              | HTML search with a login  |
| GitHub          | Discussions GraphQL      | `gh api graphql -f query='{search(query:"point of sale", type:DISCUSSION, first:2){discussionCount}}'`                                    | ACCOUNT      | WORK, 2001 results                | Web page                  |
| GitHub          | Anonymous REST search    | `curl -s "https://api.github.com/search/repositories?q=pos+restaurant&per_page=2"`                                                        | No key       | WORK, 200                         | `gh` CLI                  |
| Stack Overflow  | Stack Exchange API       | `curl -s "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=point%20of%20sale&site=stackoverflow&pagesize=2"` | No key       | WORK, 200, quota 300/day          | Data dump                 |
| Stack Overflow  | Site pages               | `curl -s "https://stackoverflow.com/questions"`                                                                                           | No account   | BLOCK, 403                        | Stack Exchange API        |
| Stack Overflow  | Data dump                | `https://archive.org/download/stackexchange`                                                                                              | No key       | WORK, 200                         | Stack Exchange API        |
| YouTube         | Watch page               | `curl -s "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`                                                                                   | No key       | WORK, 200, caption tracks present | oEmbed                    |
| YouTube         | Transcript API           | `yt-dlp --skip-download --write-auto-subs --sub-format vtt --sub-langs en <URL>`                                                          | No key       | UNVERIFIED, tool not installed    | Watch page parse          |
| Discord         | Gateway                  | `curl -s "https://discord.com/api/v10/gateway"`                                                                                           | No key       | WORK, 200                         | None                      |
| Discord         | Channel messages         | `curl -s "https://discord.com/api/v10/channels/<ID>/messages"`                                                                            | ACCOUNT, KEY | 401 without a token               | Ask a member              |
| Slack           | Web API                  | `curl -s "https://slack.com/api/conversations.history?channel=C123"`                                                                      | ACCOUNT, KEY | 200 with `not_authed`             | Workspace export          |
| Community forum | Discourse JSON           | `curl -s "https://community.shopify.com/latest.json"`                                                                                     | No key       | WORK, 200                         | Site HTML                 |
| Community forum | Discourse search         | `curl -s "https://community.openai.com/search.json?q=rate+limit"`                                                                         | No key       | WORK, 200                         | Bing site search          |
| Search          | Bing RSS                 | `curl -s "https://www.bing.com/search?q=test&format=rss"`                                                                                 | No key       | WORK, 200, 10 items               | Bing HTML                 |
| Search          | Google News RSS          | `curl -s "https://news.google.com/rss/search?q=restaurant+pos"`                                                                           | No key       | WORK, 200                         | Bing RSS                  |
| Search          | Google CSE API           | `https://www.googleapis.com/customsearch/v1?q=test`                                                                                       | KEY          | KEY, 403 without a key            | Bing RSS                  |
| Search          | Bing Web Search API v7   | `https://api.bing.microsoft.com/v7.0/search?q=test`                                                                                       | KEY          | KEY, 401 without a key            | Bing RSS                  |
| Text extract    | Wayback Machine          | `curl -s "http://web.archive.org/cdx/search/cdx?url=lobste.rs&output=json&limit=2"`                                                       | No key       | WORK, 200                         | archive.today             |
| Text extract    | archive.today            | `curl -s "https://archive.ph/newest/https://lobste.rs/"`                                                                                  | No key       | WORK, 200                         | Wayback Machine           |
| Text extract    | `r.jina.ai`              | `curl -s "https://r.jina.ai/https://news.ycombinator.com/"`                                                                               | KEY          | BLOCK, 403 challenge page         | Wayback Machine           |
| Text extract    | Sitemaps                 | `curl -s "https://dev.to/robots.txt"`                                                                                                     | No key       | WORK, sitemap line present        | Wayback Machine           |

## X (Twitter)

Test day status: three methods work without a key. The official API needs a token.

### Working method 1: syndication endpoint

This endpoint gives the full tweet object as JSON.
It works without a key.
The `token` parameter must be present. A dummy value is sufficient.

```bash
curl -s "https://cdn.syndication.twimg.com/tweet-result?id=20&token=a"
```

Test results:

- `?id=20&token=a` gave 200 and 920 bytes of JSON.
- `?id=20` without a token gave 200 and the body `{}`.
- `?id=2089808324938043411&token=x` gave 200 and 2275 bytes of JSON.
  The response holds `text`, `created_at`, `favorite_count`, and `user`.
- `?id=2000000000000000000&token=x` gave 404. That tweet does not exist.

Source: `https://cdn.syndication.twimg.com/tweet-result`.
This endpoint is not in the official documentation. It is an internal endpoint.
The rate limit is UNVERIFIED. Use one call per second at most.

### Working method 2: oEmbed

This endpoint gives an HTML blockquote with the tweet text.
It works without a key.

```bash
curl -s "https://publish.twitter.com/oembed?url=https://twitter.com/jack/status/20"
```

Test result: 200 and 630 bytes.
The body holds `author_name`, `author_url`, and `html`.
The HTML does not hold engagement counts.

Source: `https://publish.twitter.com/oembed`.

### Working method 3: the `lightbrd.com` front end

This site renders an X profile and post pages as HTML.
It works without an account.

```bash
curl -s "https://lightbrd.com/jack"
```

Test result: 200 and 107350 bytes.
The page holds 24 posts with user names, post dates, and engagement counts.
Post links use this pattern: `https://lightbrd.com/jack/status/2089808324938043411`.

Limits: the site blocked the search page and a single post page during the test with 403.
The profile page worked. Use it as a secondary method.

### Method 4: the official API

The v2 API needs a bearer token.

```bash
curl -s -H "Authorization: Bearer $X_TOKEN" "https://api.x.com/2/tweets?ids=20"
```

Test result: 401 `Unauthorized` without a token on `api.x.com` and on `api.twitter.com`.

The product page lists a free tier and paid tiers.

Source: `https://developer.x.com/en/portal/products` (200 on the test day).
The exact tier prices are UNVERIFIED. The page needs a login for full detail.
Terms: `https://developer.x.com/en/developer-terms/agreement-and-policy` (200 on the test day).

### Alternative front ends: the current state

| Front end                              | Test result         | Note                                       |
| -------------------------------------- | ------------------- | ------------------------------------------ |
| `https://nitter.net/jack`              | Connection failed   | The host did not answer.                   |
| `https://nitter.poast.org/jack`        | DNS failure         | The host name did not resolve.             |
| `https://nitter.house/jack`            | Connection failed   | The host did not answer.                   |
| `https://nitter.tiekoetter.com/jack`   | 200, bot check page | The page needs a JavaScript proof of work. |
| `https://xcancel.com/jack`             | 451                 | The host refused the request.              |
| `https://twstalker.com/jack`           | 403                 | The host refused the request.              |
| `https://lightbrd.com/jack`            | 200, real content   | Works.                                     |
| `https://rsshub.app/twitter/user/jack` | 404                 | The public instance has no Twitter route.  |

The Nitter project is archived.
Source: `https://github.com/zedeus/nitter` (repository `archived: true`, last push 2026-09-07).
Do not build a new pipeline on Nitter.

`snscrape` is stale. Its last push was 2023-11-15.
Source: `https://github.com/JustAnotherArchivist/snscrape`.

`twscrape` is active, but it needs X account credentials.
Source: `https://github.com/vladkens/twscrape` (last push 2026-08-28).
This method breaks the X terms. Do not use it for the Umi research loop.

### Terms note for X

The official API is the compliant method.
The syndication endpoint and the front ends are unofficial.
The syndication endpoint serves public data and needs no login.
Use it at a low rate and keep the source URL in the note.

## Reddit

Test day status: the JSON endpoints are blocked from this workstation.
The Atom feeds work, but the rate limit is tight.

### Working method: Atom feeds

```bash
curl -s -A "umi-research-agent/1.0 (research; contact owner@example.com)" \
  "https://www.reddit.com/r/restaurantowners/new/.rss"
```

Test result: 200 and 43771 bytes of valid Atom XML.
The feed holds `entry` elements with `title`, `link`, `updated`, and `content`.

Test results for the other feeds:

- `https://www.reddit.com/r/programming/.rss` gave 200 and 29542 bytes.
- A second call to the same URL a few seconds later gave 429.
- `https://old.reddit.com/r/programming/.rss` gave 200 but the body was the HTML shell page.

Feed patterns:

- Subreddit: `https://www.reddit.com/r/<subreddit>/.rss`
- New posts: `https://www.reddit.com/r/<subreddit>/new/.rss`
- User: `https://www.reddit.com/user/<name>/.rss`
- Search: `https://www.reddit.com/search.rss?q=<query>&sort=new`

Test result for the search feed: 429 on the test day.

Rule: sleep 30 seconds or more between Reddit calls.
The host sent 429 after two calls in one minute.

Source: `https://www.reddit.com/dev/api/` (200 on the test day, 302905 bytes of API reference).

### Blocked method: the `.json` endpoints

```bash
curl -s -A "umi-research-agent/1.0 (research; contact owner@example.com)" \
  "https://www.reddit.com/r/programming/hot.json?limit=1"
```

Test results:

| URL                                                      | Result                                   |
| -------------------------------------------------------- | ---------------------------------------- |
| `https://www.reddit.com/r/programming/hot.json?limit=2`  | 403, 189908 bytes, HTML block page       |
| `https://www.reddit.com/r/programming.json`              | 403, HTML block page                     |
| `https://www.reddit.com/search.json?q=point%20of%20sale` | 403, HTML block page                     |
| `https://api.reddit.com/r/programming/hot?limit=2`       | 403, HTML block page                     |
| `https://oauth.reddit.com/r/programming/hot`             | 403, HTML block page                     |
| `https://old.reddit.com/r/programming/hot.json?limit=2`  | 200, but the body is the HTML shell page |
| `https://old.reddit.com/r/programming/`                  | 200, HTML shell page                     |
| `https://www.reddit.com/api/v1/access_token`             | 403, page title "Blocked"                |

The block page holds the text "Welcome to Reddit" and a JavaScript payload.
The block comes from the network address of this workstation.
A different network address may get a different result. Mark it UNVERIFIED from here.

### Official API

The official API needs OAuth with a client ID and a client secret.
Registration needs an account, and the registration form needs a review.

Source: `https://www.reddit.com/dev/api/` and `https://developers.reddit.com/`.

Terms: the Data API Terms say that commercial use needs a separate agreement.
The same page says that Reddit sets the rates at its own discretion.
Source: `https://redditinc.com/policies/data-api-terms` (200 on the test day, section 3, "Fees; Restrictions on Use").
The public price list is UNVERIFIED.

### Fallback for Reddit

1. Use the Atom feed with a 30 second sleep.
2. Use the Wayback Machine for an old thread. See the "Fallbacks" section.
3. Use Bing site search with the operator `site:reddit.com`. Bing worked on the test day.

## Hacker News

Test day status: all methods work without a key.

### Method 1: the Algolia search API

This is the best search method for Hacker News.

```bash
curl -s "https://hn.algolia.com/api/v1/search?query=restaurant%20pos&tags=story&hitsPerPage=2"
```

Test results:

| URL                                                              | Result          |
| ---------------------------------------------------------------- | --------------- |
| `/api/v1/search?query=restaurant%20pos&tags=story&hitsPerPage=2` | 200, 4342 bytes |
| `/api/v1/search_by_date?query=pos&tags=comment&hitsPerPage=1`    | 200, 1960 bytes |
| `/api/v1/search?tags=front_page&hitsPerPage=1`                   | 200, 2308 bytes |
| `/api/v1/items/1`                                                | 200, 993 bytes  |

The `tags` parameter accepts `story`, `comment`, `show_hn`, `ask_hn`, `front_page`, and `author_<name>`.
The `items` route gives the full comment tree of one item.

Source: `https://hn.algolia.com/api` (200 on the test day).
The rate limit for this service is UNVERIFIED. Use one call per second.

### Method 2: the official Firebase API

```bash
curl -s "https://hacker-news.firebaseio.com/v0/topstories.json"
curl -s "https://hacker-news.firebaseio.com/v0/item/1.json"
```

Test results: 200 and 4501 bytes for `topstories.json`.
200 and 164 bytes for `item/1.json`.

The API needs one call per item. The Algolia API is faster for search.

Source: `https://github.com/HackerNews/API`.

### Method 3: RSS and HTML

```bash
curl -s "https://news.ycombinator.com/rss"
curl -s "https://news.ycombinator.com/item?id=1"
```

Test results: 200 and 11390 bytes for the RSS feed.
200 and 6495 bytes for the item page.

The host has no sitemap. `https://news.ycombinator.com/sitemap.xml` gave 404.

## Substack

Test day status: the RSS feed and the JSON API work without a key.

### Method 1: RSS feed

```bash
curl -s "https://stratechery.substack.com/feed"
curl -s "https://www.platformer.news/feed"
```

Test results: 200 and 2450 bytes for Stratechery.
200 and 366813 bytes for Platformer.
The feed holds `item` elements with `title`, `link`, `pubDate`, `description`, and `content:encoded`.

Pattern: `https://<publication>.substack.com/feed`, or `https://<custom-domain>/feed`.

### Method 2: JSON API

```bash
curl -s "https://stratechery.substack.com/api/v1/posts?limit=2"
curl -s "https://stratechery.substack.com/api/v1/archive?sort=new&limit=2"
curl -s "https://substack.com/api/v1/reader/feed?limit=1"
```

Test results: 200 for all three calls.
The `posts` route gives the full post body as HTML.
The `archive` route gives the post list with `canonical_url` and `post_date`.

Source for the feed pattern: the publication home page, for example `https://stratechery.substack.com/archive`.
Sources for the feed: `https://substack.com/sitemap.xml` (200 on the test day) and the tested feed URL itself.
The Substack help center returned 403 on the test day. Mark the help-center content UNVERIFIED.
The JSON routes are unofficial. Mark them UNVERIFIED as a supported interface.

### Fallback for Substack

Use the Wayback Machine for a post behind a paywall.
The feed holds the free preview only.

## Medium

Test day status: the RSS feeds work without a key. The page HTML is blocked.

### Working method: RSS feeds

```bash
curl -s "https://medium.com/feed/@ev"
curl -s "https://medium.com/feed/towards-data-science"
curl -s "https://medium.com/feed/tag/restaurant"
```

Test results:

| URL                                            | Result           |
| ---------------------------------------------- | ---------------- |
| `https://medium.com/feed/@ev`                  | 200, 49250 bytes |
| `https://medium.com/feed/towards-data-science` | 200, 70931 bytes |
| `https://medium.com/feed/tag/restaurant`       | 200, 15921 bytes |

The feed holds the full post body in `content:encoded` for a public post.

Patterns:

- User: `https://medium.com/feed/@<user>`
- Publication: `https://medium.com/feed/<publication>`
- Tag: `https://medium.com/feed/tag/<tag>`

Source: the feed URL pattern above. The Medium help center returned 403 on the test day.
Mark the help-center content UNVERIFIED.
The `medium.com` sitemap is at `https://medium.com/sitemap/sitemap.xml` (declared in `robots.txt`).

### Blocked method: page HTML

`https://medium.com/@ev` gave 403 and 5040 bytes.

### Closed method: the write API

`https://api.medium.com/v1/me` gave 401 with `An access token is required.`
Medium stopped the issue of new tokens. Source: `https://github.com/Medium/medium-api-docs`.

### Fallback for Medium

Use the Freedium reader or the Wayback Machine for a blocked page.
`https://freedium.cfd/<medium-url>` is UNVERIFIED on this workstation.

## dev.to

Test day status: the API works without a key for read access.

### Method 1: the articles API

```bash
curl -s "https://dev.to/api/articles?tag=webdev&per_page=2"
curl -s "https://dev.to/api/articles/4658227"
curl -s "https://dev.to/api/articles?username=ben&per_page=1"
curl -s "https://dev.to/api/tags"
```

Test results: 200 for all four calls.
`/api/articles?tag=webdev&per_page=2` gave 4643 bytes.
`/api/articles/4658227` gave 34457 bytes with the full `body_markdown`.

Common parameters: `tag`, `username`, `top`, `page`, `per_page` (maximum 1000).

Source: `https://developers.forem.com/api/v1`.
Read calls need no key. Write calls need an API key.
The rate limit is UNVERIFIED. The documentation page is a JavaScript application, so a plain `curl` call cannot read a limit value.

### Method 2: RSS feed

`https://dev.to/feed/ben` gave 200 and 27709 bytes of XML.

### Method 3: sitemap

`https://dev.to/robots.txt` declares `Sitemap: https://dev.to/sitemap-index.xml`.

## Lobsters

Test day status: the JSON endpoints work. The search page is behind a bot check.

### Working method: JSON listing

```bash
curl -s "https://lobste.rs/hottest.json"
curl -s "https://lobste.rs/newest.json"
```

Test results: 200 and 14077 bytes for `hottest.json`.
200 and 14741 bytes for `newest.json`.
The body holds `short_id`, `created_at`, `title`, `url`, `score`, `comment_count`, and `tags`.

### Working method: RSS feed

`https://lobste.rs/rss` gave 200 and 16672 bytes.

### Blocked method: search and HTML pages

`https://lobste.rs/search?q=pos&what=stories` gave 200 with 4445 bytes.
The body is the "Making sure you're not a bot!" page from the Anubis service.
`https://lobste.rs/about` gave the same page.

Fallback: use Bing with the operator `site:lobste.rs`.

### Sitemap

`https://lobste.rs/robots.txt` declares `Sitemap: https://lobste.rs/sitemap.xml.gz`.

## GitHub

Test day status: the `gh` CLI is authenticated on this workstation.
Anonymous REST search works for repositories and issues. Anonymous code search does not.

### Method 1: the `gh` CLI (recommended)

```bash
gh search repos "restaurant pos" --limit 2 --json fullName,stargazersCount
gh search issues "kds kitchen display" --limit 2 --json title,url
gh search code "shift close" --limit 2 --json repository,path
```

Test results: all three commands returned data.
The repository search found `emreeren/SambaPOS-3` and `G4brym/Laravel-Restaurant-POS`.
The issue search found a KDS feature request in `ravindu2012/pos-prime`.
The code search found files in `dkandalov/tab-shifter` and other repositories.

### Method 2: GraphQL for discussions

GitHub Discussions are not in the REST issue search.
The GraphQL `search` field with `type: DISCUSSION` finds them.

```bash
gh api graphql -f query='{search(query:"point of sale", type:DISCUSSION, first:2){discussionCount nodes{... on Discussion{title url}}}}'
```

Test result: 200. `discussionCount` was 2001 for the query "point of sale".
Two example results: `https://github.com/citizenfx/rfc/discussions/499` and `https://github.com/CaspianTools/script-caspian-store/discussions/170`.

To list the discussions of one repository, use `repository(owner:..., name:...){discussions(first:10){nodes{title url}}}`.
The repository must have the Discussions feature enabled.

### Method 3: anonymous REST

```bash
curl -s "https://api.github.com/search/repositories?q=pos+restaurant&per_page=2"
```

Test result: 200 and 12461 bytes.

Test results for the other anonymous calls:

| URL                                                                      | Result                         |
| ------------------------------------------------------------------------ | ------------------------------ |
| `https://api.github.com/search/repositories?q=pos+restaurant&per_page=2` | 200                            |
| `https://api.github.com/search/issues?q=restaurant+pos+in:title`         | 200                            |
| `https://api.github.com/search/code?q=shift+close`                       | 401, `Requires authentication` |
| `https://api.github.com/graphql`                                         | 403                            |
| `https://api.github.com/rate_limit`                                      | 200                            |

Anonymous limits from `https://api.github.com/rate_limit`: core 60 per hour, search 10 per minute.

Authenticated limits from `gh api rate_limit`: core 5000 per hour, search 30 per minute, code search 10 per minute, GraphQL 5000 per hour.

### Method 4: the search web page

`https://github.com/search?q=restaurant+pos&type=repositories` gave 200 and 275137 bytes with real repository links.
`https://github.com/search?q=shift+close&type=code` gave 200, but the page holds "Sign in to search code".

### Current token

`gh auth status` on this workstation: account `umi-juanlopez`, scopes `admin:public_key`, `gist`, `read:org`, `repo`.

Source: `https://docs.github.com/en/rest/search/search` (200 on the test day).
Source for GraphQL discussions: `https://docs.github.com/en/graphql/guides/forming-calls-with-graphql`.

## Stack Overflow and Stack Exchange

Test day status: the Stack Exchange API works without a key. The site pages are blocked.

### Method 1: the Stack Exchange API

```bash
curl -s "https://api.stackexchange.com/2.3/questions?order=desc&sort=activity&site=stackoverflow&pagesize=2"
curl -s "https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=point%20of%20sale&site=stackoverflow&pagesize=2"
```

Test results: 200 for both calls.
`questions` gave 1593 bytes. `search/advanced` gave 1439 bytes.
The body holds `quota_max: 300` and `quota_remaining: 296`.

The quota is 300 calls per day per network address without a key.
An app key raises the quota. Registration is free and needs an account.

Sources: `https://api.stackexchange.com/docs` (200 on the test day) and `https://api.stackexchange.com/docs/throttle`.

### Method 2: site feeds

```bash
curl -s "https://stackoverflow.com/feeds/question/11227809"
curl -s "https://stackoverflow.com/feeds"
```

Test results: 200 for both, `application/atom+xml`.
`https://stackoverflow.com/feeds/tag?tagnames=restaurant&sort=newest` gave 404.
Use the question feed and the site feed. Do not build on the tag feed.

### Blocked method: the site HTML

`https://stackoverflow.com/questions` gave 403 and 5231 bytes.
`https://stackoverflow.com/sitemap.xml` gave 404.
`https://stackoverflow.com/robots.txt` has no sitemap line.

### Method 3: the data dump

```bash
curl -s "https://archive.org/download/stackexchange"
```

Test result: 200 and 262108 bytes.
The listing holds one archive per site, for example `stackoverflow.com-Posts.7z`.
This is the only full-corpus method. It is a bulk download of several gigabytes.

Source: `https://archive.org/details/stackexchange`.

### Method 4: the data explorer

`https://data.stackexchange.com/stackoverflow/query/new` runs SQL against a recent dump.
The interface needs a browser and a form submission. It has no public JSON API.
Mark the scripted use UNVERIFIED.

## YouTube

Test day status: the watch page works. The direct transcript endpoint did not answer.

### Method 1: the watch page parse

```bash
curl -s "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Test result: 200 and 1316404 bytes.
The page holds `"captionTracks":[...]` inside `ytInitialPlayerResponse`.
Each entry has `baseUrl`, `languageCode`, and `kind` (`asr` for an automatic caption).
For this video the page listed `de-DE`, `es-419`, `en`, `en` (asr), `ja`, and `pt-BR`.

### Method 2: the timedtext endpoint

We took the signed `baseUrl` from `captionTracks` and called it with `&fmt=json3` and with `&fmt=srv3`.

Test result: 200 for each call with a body of 0 bytes.
This method did not work on the test day.

### Method 3: oEmbed

`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json` gave 200 and 868 bytes.
This method gives the title and the author only. It does not give the transcript.

### Recommended method: `yt-dlp`

`yt-dlp` is not installed on this workstation.
The package manager offers version 2026.8.19.

```bash
yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "en.*" \
  --sub-format vtt -o "%(id)s" "<video-url>"
```

`youtube-transcript-api` version 1.2.4 is also available. It works without a key.

Status for both tools: UNVERIFIED on this workstation, because they are not installed.
The package versions above come from a dry-run of `pip3 install`.

Source: `https://github.com/yt-dlp/yt-dlp` and `https://github.com/jdepoix/youtube-transcript-api`.

### Podcasts

Podcast RSS feeds work without a key.

```bash
curl -s "https://feeds.megaphone.fm/vergecast"
```

Test result: 200 and 6108561 bytes of XML.
The feed holds the enclosure URLs for the audio files.
Use `ffmpeg` to make a transcript file from the audio, or find the publisher transcript.

The Podcast Index API gave 401. It needs an API key and a secret.
Source: `https://podcastindex-org.github.io/docs-api/`.

## Discord and Slack

Test day status: both services answer on their public endpoints.
Both need an account and a token for message content.

### Discord

| Call                                                               | Result                                             |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| `https://discord.com/api/v10/gateway`                              | 200, `{"url":"wss://gateway.discord.gg"}`          |
| `https://discord.com/api/v10/channels/197038439483310086/messages` | 401, `{"message": "401: Unauthorized", "code": 0}` |

Discord servers are closed by default.
A bot reads a channel only after a member with the "Manage Server" right adds the bot.
The bot token gives access to the channels of that server only.

Source: `https://discord.com/developers/docs/reference` (200 on the test day).
Terms: `https://discord.com/terms` (200 on the test day).

A self-bot breaks the Discord terms. Do not use a user token.
Do not use a script on a user account.

### Slack

| Call                                                       | Result                                       |
| ---------------------------------------------------------- | -------------------------------------------- |
| `https://slack.com/api/conversations.history?channel=C123` | 200 with `{"ok":false,"error":"not_authed"}` |

Slack answers 200 with an error object. Check the `ok` field, not only the status code.

Slack workspaces are closed. A Slack app token needs an install by a workspace owner.
Public Slack archives are rare. Most "slack.com/archives" links need a workspace login.

Source: `https://api.slack.com/methods/conversations.history` (200 on the test day).
A valid export is a compliant alternative.
Source: `https://slack.com/help/articles/201658943-Export-your-workspace-data` (200 on the test day).

### What this means for the research loop

1. Treat Discord and Slack as closed sources.
2. Ask the owner for a bot invite or a channel export.
3. Use a search engine with the operator `site:` for public mirrors of a message.
4. Do not use a personal token. That step breaks the terms of both services.

## Vendor community forums

Many vendor forums run the Discourse software.
Discourse gives public JSON for a logged-out reader.

### Working pattern

```bash
curl -s "https://community.shopify.com/latest.json"
curl -s "https://community.openai.com/search.json?q=rate+limit"
```

Test results:

| Host                          | Path                        | Result           |
| ----------------------------- | --------------------------- | ---------------- |
| `meta.discourse.org`          | `/latest.json`              | 200, 75337 bytes |
| `meta.discourse.org`          | `/search.json?q=pos`        | 200, 73259 bytes |
| `community.shopify.com`       | `/latest.json`              | 200, 62612 bytes |
| `community.openai.com`        | `/search.json?q=rate+limit` | 200, 61766 bytes |
| `community.vercel.com`        | `/latest.json`              | 200, 39622 bytes |
| `community.home-assistant.io` | `/latest.json`              | 403              |
| `community.squareup.com`      | `/latest.json`              | 404              |
| `community.toasttab.com`      | `/`                         | 403              |

Useful Discourse routes:

- `/latest.json` for the newest topics
- `/search.json?q=<query>` for search
- `/t/<topic-id>.json` for one topic with the full post stream
- `/posts/<post-id>.json` for one post

Source: `https://docs.discourse.org/`.

### Other forum software

`community.squareup.com` is not Discourse. Its search page answered 200 with HTML only.
`community.toasttab.com` sits behind a bot filter.
For these hosts use the site HTML with a browser, or Bing site search.

Vendor forums for the Umi market, such as Square and Toast, need a check before each use.
Vendor documentation pages are usually open. Start there.

## Google and Bing programmatic search

Test day status: Bing gives results without a key. Google does not.

### Bing

| Method   | URL                                                            | Result                             |
| -------- | -------------------------------------------------------------- | ---------------------------------- |
| RSS      | `https://www.bing.com/search?q=test&format=rss`                | 200, valid RSS, 10 items           |
| HTML     | `https://www.bing.com/search?q=restaurant+pos`                 | 200, 123235 bytes, results present |
| News RSS | `https://www.bing.com/news/search?q=restaurant+pos&format=RSS` | 200, 2109 bytes                    |

The RSS body holds `item` elements with `title`, `link`, and `description`.
The test returned results in Spanish for the Mexico region.
Set the market with the `&mkt=en-US` parameter, or the `cc` parameter.

Source: `https://www.bing.com/`.

### Google

| Method                 | URL                                                   | Result                               |
| ---------------------- | ----------------------------------------------------- | ------------------------------------ |
| HTML                   | `https://www.google.com/search?q=restaurant+pos`      | 200, but no result links in the body |
| News RSS               | `https://news.google.com/rss/search?q=restaurant+pos` | 200, 136549 bytes                    |
| Custom Search JSON API | `https://www.googleapis.com/customsearch/v1?q=test`   | 403 without a key                    |

The Google HTML page is a JavaScript shell. A plain `curl` call cannot read the results.
Use the Custom Search JSON API with a key, or the News RSS feed.

Source: `https://developers.google.com/custom-search/v1/overview`.
The free quota is 100 queries per day. Mark the current quota UNVERIFIED.

### Other search services

| Service                   | Call                                                       | Result                                      |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| DuckDuckGo HTML           | `https://html.duckduckgo.com/html/?q=test`                 | 202, "anomaly" challenge page               |
| DuckDuckGo Lite           | `https://lite.duckduckgo.com/lite/?q=test`                 | 202, challenge page                         |
| DuckDuckGo Instant Answer | `https://api.duckduckgo.com/?q=restaurant+pos&format=json` | 200, instant answers only                   |
| Mojeek                    | `https://www.mojeek.com/search?q=restaurant+pos`           | 200, captcha page                           |
| Marginalia                | `https://search.marginalia.nu/search?query=restaurant+pos` | 200, page returned; result links UNVERIFIED |
| SearXNG public instance   | `https://searx.be/search?q=test&format=json`               | 200, HTML instead of JSON                   |
| Brave Search API          | `https://api.search.brave.com/res/v1/web/search?q=test`    | 422 without a key                           |
| Bing Web Search API v7    | `https://api.bing.microsoft.com/v7.0/search?q=test`        | 401 without a key                           |
| SerpApi                   | `https://serpapi.com/search.json?q=point+of+sale+software` | 401, `Invalid API key`                      |
| Tavily                    | `https://api.tavily.com/search`                            | 401                                         |
| Exa                       | `https://api.exa.ai/search`                                | 404                                         |
| Perplexity                | `https://api.perplexity.ai/chat/completions`               | 401                                         |
| Firecrawl                 | `https://api.firecrawl.dev/v1/scrape`                      | 405                                         |
| Ecosia                    | `https://www.ecosia.org/search?q=test`                     | 403                                         |

The SearXNG public instances block the JSON output, or limit the rate.
Other instances gave 429 or a bot check page.
Self-host SearXNG for a stable JSON search. Mark the self-hosted method UNVERIFIED.

The Microsoft "Bing Search API v7" endpoint exists but answers 401 without a key.
Microsoft announced the retirement of the Bing Search APIs.
Source: `https://learn.microsoft.com/en-us/bing/search-apis/`. Mark the retirement date UNVERIFIED.

## Fallbacks

Use these methods when the primary method fails.

### Wayback Machine: the best general fallback

| Method           | URL                                                                       | Result               |
| ---------------- | ------------------------------------------------------------------------- | -------------------- |
| CDX index        | `http://web.archive.org/cdx/search/cdx?url=lobste.rs&output=json&limit=2` | 200, JSON rows       |
| Raw replay       | `https://web.archive.org/web/2026id_/https://lobste.rs/`                  | 200, stored bytes    |
| Normal replay    | `https://web.archive.org/web/2026/https://news.ycombinator.com/`          | 200, 37839 bytes     |
| Availability API | `https://archive.org/wayback/available?url=news.ycombinator.com`          | 429, rate limit page |

Use the CDX index to find a snapshot.
Then fetch the snapshot with the `id_` suffix to get the original bytes without the toolbar.

Source: `https://archive.org/help/wayback_api.php` (200 on the test day).
The CDX index is reliable. The availability API answered 429 on the test day.

### archive.today

```bash
curl -s "https://archive.ph/newest/https://lobste.rs/"
```

Test result: 200 and 267836 bytes.
This service sometimes shows a captcha. Keep the Wayback Machine as the first choice.

### Text extraction proxies

| Service        | Call                                                         | Result                    |
| -------------- | ------------------------------------------------------------ | ------------------------- |
| `r.jina.ai`    | `https://r.jina.ai/https://news.ycombinator.com/`            | 403, Cloudflare challenge |
| AllOrigins     | `https://api.allorigins.win/raw?url=<encoded-url>`           | 500                       |
| CORS Proxy     | `https://corsproxy.io/?<url>`                                | 403                       |
| Textise        | `https://www.textise.net/showText.aspx?strURL=<encoded-url>` | 403                       |
| CodeTabs proxy | `https://api.codetabs.com/v1/proxy?quest=<url>`              | 522                       |
| Bing cache     | `https://cc.bingj.com/cache.aspx?q=<query>&d=123`            | 400                       |

Conclusion: none of these text proxies worked from this workstation on the test day.
`r.jina.ai` needs an API key for a reliable service. Mark the keyed use UNVERIFIED.
The Wayback Machine is more reliable than every proxy in this table.

### Google cache

Google removed the cache link from the search results.
The blog post URL `https://developers.google.com/search/blog/2024/09/search-cache-gone` gave 404 on the test day.
Mark the exact removal date UNVERIFIED.
Use the Wayback Machine in place of a cache.

### Site sitemaps

Read `https://<host>/robots.txt` first. Many hosts declare the sitemap there.

| Host                   | Sitemap                                  | Result                   |
| ---------------------- | ---------------------------------------- | ------------------------ |
| `dev.to`               | `https://dev.to/sitemap-index.xml`       | Declared in `robots.txt` |
| `medium.com`           | `https://medium.com/sitemap/sitemap.xml` | Declared in `robots.txt` |
| `substack.com`         | `https://substack.com/sitemap.xml`       | Declared in `robots.txt` |
| `lobste.rs`            | `https://lobste.rs/sitemap.xml.gz`       | Declared in `robots.txt` |
| `news.ycombinator.com` | No sitemap line                          | Test result              |
| `stackoverflow.com`    | No sitemap line                          | Test result              |
| `github.com`           | No sitemap line                          | Test result              |
| `reddit.com`           | No sitemap line                          | Test result              |

### Feed discovery

Many sites declare a feed in the page head.

```bash
curl -s "https://<host>/" | grep -o 'type="application/rss+xml"[^>]*' | head
```

### Microformats and oEmbed

For one post, try the oEmbed route of the host, or the Open Graph tags.

```bash
curl -s "https://<host>/<path>" | grep -o '<meta property="og:[^>]*>' | head
```

## The 10 minute research loop

Use this loop for a new question. Each step has a time budget.

### Minute 0 to 2: plan the query

1. Write the question in one sentence.
2. List three search terms. Include a product name and a technical term.
3. Pick the sources from the decision table. Start with Hacker News, GitHub, and a search engine.

### Minute 2 to 5: run the cheap calls

```bash
# Hacker News search
curl -s "https://hn.algolia.com/api/v1/search?query=<TERM>&tags=story&hitsPerPage=10" | jq -r '.hits[] | "\(.points) \(.title) \(.url)"'

# Hacker News comments
curl -s "https://hn.algolia.com/api/v1/search?query=<TERM>&tags=comment&hitsPerPage=10" | jq -r '.hits[] | .comment_text' | head -40

# Bing RSS
curl -s "https://www.bing.com/search?q=<TERM>&format=rss" | python3 -c "import sys,re; d=sys.stdin.read(); [print(re.sub('<[^>]+>','',t), l) for t,l in zip(re.findall(r'<title>(.*?)</title>',d)[1:], re.findall(r'<link>(.*?)</link>',d))]"

# GitHub, three surfaces
gh search repos "<TERM>" --limit 10 --json fullName,description,stargazersCount
gh search issues "<TERM>" --limit 10 --json title,url,state
gh api graphql -f query='{search(query:"<TERM>", type:DISCUSSION, first:5){nodes{... on Discussion{title url}}}}'
```

### Minute 5 to 7: read the primary pages

1. Fetch each promising URL with `curl -sL "<URL>"`.
2. Extract the text with `python3 -c` and a regular expression, or with `trafilatura` after the install.
3. Keep the exact URL next to each note.

### Minute 7 to 9: fill the gaps

1. Reddit: use the Atom feed with a 30 second sleep.
2. Substack and Medium: use the RSS feed.
3. Vendor forums: try `<host>/latest.json` and `<host>/search.json?q=<term>`.
4. X: use the syndication endpoint with a known post ID, or the `lightbrd.com` profile page.
5. YouTube: use the watch page, then `yt-dlp` for the transcript.

### Minute 9 to 10: record the evidence

1. Write each finding with its source URL and the observed status.
2. Mark each unsupported item UNVERIFIED.
3. Write the date of the test.

## Recommended installs for this workstation

Check each version before the install. The versions below come from the registries on 2026-09-16.

### Already present

| Tool                     | State                                                                            | Note                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `gh` 2.45.0              | Installed and authenticated                                                      | Account `umi-juanlopez`. Scopes: `repo`, `read:org`, `gist`, `admin:public_key`.     |
| `curl` 8.5.0             | Installed                                                                        | Full test coverage in this file.                                                     |
| `python3` 3.12.3         | Installed                                                                        | Use a virtual environment for new packages. The system Python is externally managed. |
| `node` v22.23.2          | Installed                                                                        | Node has a built-in WebSocket client since version 22.                               |
| `jq` 1.7                 | Installed                                                                        | Use it for the JSON endpoints.                                                       |
| `ffmpeg`                 | Installed                                                                        | Use it for audio and video work, including podcast transcripts.                      |
| Playwright Chromium 1237 | Installed at `/home/jc/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome` | The binary reports `Google Chrome for Testing 152.0.7977.8`. See the limit below.    |
| `playwright-cli` 0.1.18  | Installed at `node_modules/.bin/playwright-cli`                                  | It needs `chromium_headless_shell-1237`. That build is absent.                       |

### Limit of the browser path on this workstation

We tested the browser path. The result was negative on 2026-09-16.

- `chrome --headless=new --dump-dom "https://example.com"` gave no output. A local `file://` page gave the same result.
- One run ended with exit code 124 after a 120 second timeout and 0 bytes of output.
- A start with `--remote-debugging-port=9222` logged a `bind()` failure and the process exited. A `curl` call to `http://127.0.0.1:9222/json/version` failed.
- `playwright-cli open` failed with `Browser "chromium" is not installed; expected executable at .../chromium_headless_shell-1237/...`.

Status: the browser path is UNVERIFIED on this workstation.
Do not count on the browser for a research task.
The direct `curl` calls in this file cover the same sources.

To repair the Playwright CLI path, run `npx playwright install chromium` and then test again.

### Python packages to install

Install them in a virtual environment. The `pipx` tool is not present on this workstation.

```bash
python3 -m venv ~/.venvs/research && . ~/.venvs/research/bin/activate
pip install youtube-transcript-api==1.2.4 yt-dlp==2026.8.19 trafilatura==2.2.0
```

| Package                  | Version   | Use                                                            |
| ------------------------ | --------- | -------------------------------------------------------------- |
| `yt-dlp`                 | 2026.8.19 | Video and audio download, captions, and subtitles.             |
| `youtube-transcript-api` | 1.2.4     | Transcript text for one video without a key.                   |
| `trafilatura`            | 2.2.0     | Readable text from an HTML page.                               |
| `mcp-server-fetch`       | 2026.8.18 | The official MCP fetch server. It converts a page to Markdown. |

The dry-run on 2026-09-16 reported these versions.
The install command needs `--break-system-packages` when you use the system Python.
Prefer the virtual environment.

### MCP servers worth installing

Check each package with `npm view <package> version` before the install.

| Package                                     | Version on 2026-09-16 | Use                                                      | Source                                                     |
| ------------------------------------------- | --------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `@playwright/mcp`                           | 0.0.81                | Browser automation for a JavaScript page.                | `https://github.com/microsoft/playwright-mcp`              |
| `firecrawl-mcp`                             | 3.24.0                | Page fetch and Markdown conversion. It needs an API key. | `https://github.com/firecrawl/firecrawl-mcp-server`        |
| `exa-mcp-server`                            | 3.4.1                 | Neural web search. It needs an API key.                  | `https://github.com/exa-labs/exa-mcp-server`               |
| `tavily-mcp`                                | 0.2.22                | Web search for an agent. It needs an API key.            | `https://github.com/tavily-ai/tavily-mcp`                  |
| `reddit-mcp-server`                         | 1.5.3                 | Reddit read access without an API key.                   | `https://github.com/jordanburke/reddit-mcp-server`         |
| `youtube-transcript-mcp`                    | 0.1.5                 | YouTube transcript fetch.                                | UNVERIFIED. The package declares no repository URL.        |
| `@modelcontextprotocol/server-brave-search` | 0.6.2                 | Brave Search. It needs an API key.                       | `https://github.com/modelcontextprotocol/servers-archived` |
| `searxng-mcp`                               | 1.1.0                 | Search on a self-hosted SearXNG instance.                | `https://github.com/9Ninety/SearXNG-MCP`                   |
| `@just-every/mcp-read-website-fast`         | 0.1.36                | Fast page-to-Markdown fetch.                             | `https://github.com/just-every/mcp-read-website-fast`      |
| `@gongrzhe/server-gmail-autoauth-mcp`       | 1.1.11                | Gmail access for newsletter sources.                     | `https://github.com/gongrzhe/server-gmail-autoauth-mcp`    |

Every repository URL in the table above comes from the `repository.url` field of the package, or it is marked UNVERIFIED.
Not found on the npm registry on 2026-09-16: `@modelcontextprotocol/server-fetch` (npm), `mcp-hn`, `mcp-server-youtube-transcript`, and `apify-mcp-server`.
The official fetch server is a Python package. Its name is `mcp-server-fetch`.
The official GitHub MCP server is a Go binary. Source: `https://github.com/github/github-mcp-server`.

The workspace already declares these MCP servers in `.mcp.json`: `azure-devops`, `plane`, `playwright-mcp`, `puppeteer`, `deepseek`, `nano-banana`, and `dart`.

### CLI tools worth installing

| Tool            | Install                                           | Use                                                                                |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `yt-dlp`        | `pip install yt-dlp` in a virtual environment     | Captions and audio from YouTube and other sites.                                   |
| `gallery-dl`    | `pip install gallery-dl` in a virtual environment | Image and media download from many sites.                                          |
| `lynx` or `w3m` | `sudo apt install lynx`                           | Text browser for a simple HTML page.                                               |
| `ddgr`          | `pip install ddgr` in a virtual environment       | DuckDuckGo search in the terminal. It may hit the same block as the HTML endpoint. |
| `pandoc`        | `sudo apt install pandoc`                         | Convert between document formats.                                                  |

### Rate limit summary

| Source                   | Limit without a key                                            | Note                                           |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------------------- |
| Hacker News (Algolia)    | UNVERIFIED                                                     | Use one call per second.                       |
| Reddit                   | About one call, then 429                                       | Sleep 30 seconds or more.                      |
| Stack Exchange           | 300 calls per day per address                                  | `quota_remaining` is in each response.         |
| GitHub anonymous         | 60 per hour, search 10 per minute                              | From `https://api.github.com/rate_limit`.      |
| GitHub with `gh`         | 5000 per hour, search 30 per minute, code search 10 per minute | From `gh api rate_limit`.                      |
| GitHub GraphQL with `gh` | 5000 points per hour                                           | From `gh api rate_limit`.                      |
| Bing                     | UNVERIFIED                                                     | Use a low rate.                                |
| X syndication            | UNVERIFIED                                                     | One call per second at most.                   |
| `r.jina.ai`              | 403 without a key                                              | Use the Wayback Machine.                       |
| Wayback CDX              | UNVERIFIED                                                     | The availability API sent 429 during the test. |

## Sources

Official documentation:

- X API docs: `https://developer.x.com/en/docs/x-api`
- X products page: `https://developer.x.com/en/portal/products`
- X developer terms: `https://developer.x.com/en/developer-terms/agreement-and-policy`
- Reddit API docs: `https://www.reddit.com/dev/api/`
- Reddit Data API Terms: `https://redditinc.com/policies/data-api-terms`
- Reddit developer platform: `https://developers.reddit.com/`
- Hacker News API: `https://github.com/HackerNews/API`
- Hacker News search service: `https://hn.algolia.com/api`
- Substack: `https://substack.com/sitemap.xml`
- Medium feeds: `https://medium.com/feed/@ev` (tested). The Medium help center returned 403.
- Medium API documentation (closed): `https://github.com/Medium/medium-api-docs`
- Forem and dev.to API: `https://developers.forem.com/api/v1`
- Lobsters: `https://lobste.rs/`. Note: an HTML page from this workstation gives the bot check page. The JSON and RSS routes work.
- GitHub REST search: `https://docs.github.com/en/rest/search/search`
- GitHub GraphQL: `https://docs.github.com/en/graphql/guides/forming-calls-with-graphql`
- Stack Exchange API: `https://api.stackexchange.com/docs`
- Stack Exchange throttle: `https://api.stackexchange.com/docs/throttle`
- Stack Exchange data dump: `https://archive.org/details/stackexchange`
- YouTube Data API: `https://developers.google.com/youtube/v3`
- Discord developer docs: `https://discord.com/developers/docs/reference`
- Discord terms: `https://discord.com/terms`
- Slack Web API methods: `https://api.slack.com/methods/conversations.history`
- Slack export help: `https://slack.com/help/articles/201658943-Export-your-workspace-data`
- Discourse API: `https://docs.discourse.org/`
- Google Custom Search JSON API: `https://developers.google.com/custom-search/v1/overview`
- Bing search APIs: `https://learn.microsoft.com/en-us/bing/search-apis/`
- Brave Search API: `https://api-dashboard.search.brave.com/app/documentation`
- SerpApi: `https://serpapi.com/search-api`
- Tavily: `https://docs.tavily.com/`
- Exa: `https://docs.exa.ai/`
- Wayback Machine API: `https://archive.org/help/wayback_api.php`
- archive.today: `https://archive.ph/`
- Podcast Index API: `https://podcastindex-org.github.io/docs-api/`

Project pages:

- Nitter (archived): `https://github.com/zedeus/nitter`
- snscrape: `https://github.com/JustAnotherArchivist/snscrape`
- twscrape: `https://github.com/vladkens/twscrape`
- yt-dlp: `https://github.com/yt-dlp/yt-dlp`
- youtube-transcript-api: `https://github.com/jdepoix/youtube-transcript-api`
- trafilatura: `https://github.com/adbar/trafilatura`
- Official GitHub MCP server: `https://github.com/github/github-mcp-server`
- Official MCP servers: `https://github.com/modelcontextprotocol/servers`

Test evidence: all HTTP status codes and byte counts in this file come from the calls on 2026-09-16.

## Re-measurement, 2026-09-18

The routes were called again from this workstation. The agent was Chrome 126 on
Linux. Plain `curl` drove every call. This table is the baseline for the Firecrawl
comparison.

| Target | Code | Bytes | Verdict |
| --- | --- | --- | --- |
| G2 reviews | 403 | 1,704 | Blocked. The body is the wall. |
| Capterra reviews | 403 | 5,508 | Blocked. The body is the wall. |
| Reddit `.json` | 403 | 189,908 | Blocked. The body is large, but it is not the data. |
| Mojeek | 200 | 5,493 | Blocked. The body holds "automated queries". |
| DuckDuckGo HTML | 202 | 14,218 | Bot check. Not usable. |
| Bing | 200 | 122,955 | Works. Ten result rows were parsed. |
| `x.com` search | 200 | 298,325 | The JavaScript shell. No result text. |
| Hacker News | 200 | 34,128 | Control. Real content. |

New facts:

- **Bing answers this workstation again.** An earlier attempt on 2026-09-18 failed
  to connect. A later plain `curl` with a desktop agent returned ten parsed
  results.
- **A Bing result link is wrapped.** Every `href` points at `www.bing.com/ck/a`,
  not at the target. Read the title, or resolve the wrapper.
- **`x.com` returns 200 with 298 KB and no result text.** A status code is not
  evidence about X. Use the oEmbed route for a known post.
