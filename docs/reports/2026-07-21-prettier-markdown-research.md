# Prettier over authored Markdown — 2026 research

**Date:** 2026-07-21
**Status:** Research + recommendation. Nothing is adopted yet.
**Scope:** The in-flight Markdown reformat on branch `chore/format-pass` — 54 `.md` files under `docs/`
plus the root `AGENTS.md`, `CONVENTIONS.md`, `README.md`. `.agents/skills/` is already excluded by
`.prettierignore` and is out of scope.

**Question:** Does running Prettier over authored Markdown change how the document renders, or how an
LLM/agent reads it? Which changes are rendering-neutral, which change meaning, and what configuration
keeps the cosmetic benefits while preventing the meaning-changing ones?

**Why this file lives in `docs/reports/`:** `docs/reports/index.md` defines reports as "dated evidence
artifacts. They are not automatically current architecture." That is what this is — evidence, plus a
proposal the owner has not accepted. If the recommendation is accepted, the accepted parts belong in
`.prettierrc.json`, `.prettierignore` and `CONVENTIONS.md`, not here.

**Source rule used:** only primary sources — the CommonMark specification text itself, RFC 8259, the
JSON5 specification, Prettier's own documentation / release notes / source code / issue tracker, and
**direct measurement against the installed toolchain**. Where a claim could be tested, it was tested
rather than cited. Every experiment below was run on 2026-07-21 with `prettier@3.9.4` (the version
this repo resolves) and `commonmark@0.31.2` (the reference CommonMark implementation, matching spec
version 0.31.2) plus `markdown-it@14` in `commonmark` preset with GFM tables enabled.

---

## 0. Bottom line

**Nothing Prettier did to this repo's Markdown changes what the documents render to.** 44 of the 54
changed files produce byte-identical HTML before and after. Of the 10 that differ, 2 are hand edits
the author made in the same working tree, 3 are whitespace collapsing that HTML itself collapses, 3
are soft-line-break-to-space conversions the CommonMark spec explicitly declares equivalent, and
**2 are real content changes — both inside fenced code blocks.**

The distinction that matters is not "safe vs unsafe formatting." It is:

- **Rendering-neutral** — the source bytes changed, the rendered document did not. Everything outside
  code fences falls here, including the alarming-looking `+` → `-` bullet rewrites.
- **Meaning-changing** — the rendered document changed. **Only embedded code formatting does this**,
  and it is the one class that `embeddedLanguageFormatting: "off"` switches off completely.
- **Defect-surfacing** — Prettier rewrote the source because CommonMark was already parsing it in a
  way the author did not intend. The document was already wrong; Prettier made the wrongness visible
  in the source. These are bugs to fix in the prose, not reasons to configure Prettier.

The single genuine harm found in this repo is one trailing comma added to a `jsonc` sample that the
surrounding prose explicitly names as a `.json` file (§5.1). One config option prevents it.

---

## 1. What was measured in this repo

### 1.1 The reformat as it stands

Measured from the working tree with `git diff -U0 -- '*.md'` (read-only):

| Quantity                                       | Measured                            |
| ---------------------------------------------- | ----------------------------------- |
| `.md` files changed                            | 54                                  |
| Lines added / removed                          | 3,030 / 2,713                       |
| Lines that are table rows (`^\s*\|`)           | 1,874 added, 1,874 removed          |
| Single-asterisk emphasis runs on removed lines | 1,011                               |
| Single-underscore emphasis runs on added lines | 971                                 |
| Removed lines beginning `+ ` (prose "plus")    | 6, in 6 distinct files              |
| Code fences with changed content               | 4 (3 × ` ```ts `, 1 × ` ```jsonc `) |
| Fences normalized from an unclosed fence       | 1                                   |

(The brief estimated ~1,847 table lines, ~1,618 emphasis swaps and 5 `+`-bullet files; the measured
figures are 1,874, ~1,011 and 6. The emphasis figure differs because the brief appears to have
counted delimiters rather than emphasis runs. Everything else matches.)

### 1.2 The decisive test — render before, render after

Byte-diffing Markdown source tells you nothing about whether meaning changed. Rendering it does. For
each of the 54 files I rendered `git show HEAD:<path>` and the working-tree version through
`markdown-it@14` in `commonmark` preset with the GFM table and strikethrough rules enabled, and
diffed the HTML.

**Result: 44 of 54 files produce byte-identical HTML.** The 10 that differ:

| File                                                                       | HTML difference                                                                                 | Class                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------- |
| `CONVENTIONS.md`                                                           | Prose about Markdown scope rewritten                                                            | **Hand edit, not Prettier** |
| `docs/migration/build-v3/GATED_CUTOVER_PLAN.md`                            | Prose about Markdown scope rewritten                                                            | **Hand edit, not Prettier** |
| `docs/architecture/2026-07-01-kds-device-scope-and-location-resolution.md` | Inside ` ```ts `: `const tenantMatches   =` → `const tenantMatches =`, one statement re-wrapped | **Meaning-changing (code)** |
| `docs/architecture/2026-07-20-umipos-contract-seam.md`                     | Inside ` ```jsonc `: comment alignment collapsed **and a trailing comma added**                 | **Meaning-changing (code)** |
| `docs/architecture/2026-06-23-umi-api-centralization-spec.md`              | `<pre><code></code></pre>` → `<pre><code>\n</code></pre>` (empty code block gains a newline)    | Rendering-neutral           |
| `docs/migration/2026-06-16-database-integrity-spec.md`                     | `app.user_id` + 3 spaces + `—` → 1 space                                                        | Rendering-neutral           |
| `docs/migration/2026-06-18-curated-column-mapping.md`                      | Heading `core.tenants  ←` → single space                                                        | Rendering-neutral           |
| `docs/migration/2026-06-25-phase3-conversaflow-binding-preflight.md`       | Heading double space → single space                                                             | Rendering-neutral           |
| `docs/migration/2026-06-16-migration-plan.md`                              | A soft line break became a space                                                                | Rendering-neutral (§3.3)    |
| `docs/architecture/2026-07-09-enterprise-conceptual-review.md`             | Soft line breaks became spaces                                                                  | **Defect-surfacing** (§3.3) |

Multiple consecutive spaces in HTML text collapse to one during rendering — CSS Text Module Level 3,
[§3 White Space Processing](https://www.w3.org/TR/css-text-3/#white-space-processing): the `normal`
value of `white-space` means "sequences of white space are collapsed." So rows 5–8 above are
byte-different HTML with identical rendered output.

**Every `+` → `-` bullet rewrite, every `*x*` → `_x_` swap, and every table-padding change in this
repo landed in the 44 files whose HTML is byte-identical.** They are cosmetic by measurement, not by
assumption.

---

## 2. Prettier's Markdown printer, option by option

Versions: `prettier@3.9.4` is what this repo resolves (`package.json` declares `^3.4.2`; npm `latest`
is 3.9.6 as of 2026-07-21). Prettier's Markdown parser was swapped from `remark-parse` v8 to
`micromark` v4 in **3.9.0** (2026-06-27) — see
[Prettier 3.9 release notes](https://prettier.io/blog/2026/06/27/3.9.0) (#18277): "This upgrade
significantly enhances CommonMark and GFM compliance, resolves numerous long-standing parsing bugs."
That is a recent and large change to the exact code path under discussion; §6.4 covers the risk.

### 2.1 `proseWrap` — confirmed, it does not reflow prose

Default is `"preserve"`.
[Options / Prose Wrap](https://prettier.io/docs/options#prose-wrap): "By default, Prettier will not
change wrapping in markdown text since some services use a linebreak-sensitive renderer, e.g. GitHub
comments and BitBucket." `"preserve"` = "Keep the existing wrapping as-is."

Verified. Input:

```
line one of ordinary prose
line two of ordinary prose
line three.
```

Output: identical, three lines. Prettier does **not** reflow prose at the default.

**One exception, and it is a safety behavior, not a reflow.** When a soft-wrapped continuation line
_begins with what would be a list marker_, Prettier joins it onto the previous line rather than emit a
line that a reader would misread. Verified:

```
paragraph with a numeral wrap
14. the number of doors is 6.
```

becomes `paragraph with a numeral wrap 14. the number of doors is 6.` on one line. This is why
`docs/migration/2026-06-16-migration-plan.md` changed (§3.3). It is rendering-neutral by spec (§3.3),
but it is the one case where `proseWrap: "preserve"` moves prose.

### 2.2 `embeddedLanguageFormatting` — yes, it reformats fenced code, and `"off"` stops it

Default `"auto"`.
[Options / Embedded Language Formatting](https://prettier.io/docs/options#embedded-language-formatting):
"Control whether Prettier formats quoted code embedded in the file." `"auto"` = "Format embedded code
if Prettier can automatically identify it." `"off"` = "Never automatically format embedded code."

The mechanism is in Prettier's own source,
[`src/language-markdown/embed.js`](https://github.com/prettier/prettier/blob/main/src/language-markdown/embed.js):

```
case "code": {
  const { lang: language } = node;
  if (!language) {
    return;
  }
  ...
  parser = inferParser(options, { language });
  if (!parser) {
    return;
  }
```

Three facts fall out of that:

1. **A fence with no info string is never touched.** `if (!language) return`. Verified: a bare
   ` ``` ` fence with `plain fence   with   spaces` inside came out unchanged.
2. **A fence whose info string maps to a Prettier parser is formatted as if it were a file of that
   language, using this repo's options.** The same file even overrides the filepath — `if (language
=== "ts" || language === "typescript") { textToDocOptions.filepath = "dummy.ts"; }` — so a
   ` ```ts ` block is formatted exactly as a `.ts` file, `printWidth: 100`, `semi: true`,
   `singleQuote: true`, `trailingComma: "all"` and all.
3. **The set of affected languages is exactly Prettier's parser set.** From
   `prettier --support-info` on 3.9.4, 23 languages have parsers: Angular, CSS, Flow, GraphQL,
   Handlebars, HTML, JavaScript, JSON, JSON with Comments, JSON.stringify, JSON5, JSX, Less,
   Lightning Web Components, Markdown, MDX, MJML, PostCSS, SCSS, TSX, TypeScript, Vue, YAML — each
   with its aliases (`ts`, `js`, `jsonc`, `yml`, `md`, …). Anything else — `sql`, `sh`, `bash`,
   `python`, `text`, `diff` — is left alone. Verified: a ` ```sql ` block with ragged spacing came out
   untouched; ` ```ts `, ` ```jsonc `, ` ```json `, ` ```json5 ` and ` ```yaml ` were all rewritten.

**Setting `embeddedLanguageFormatting: "off"` stops all of it.** Verified: with `--embedded-language-formatting=off`,
the identical input file came out with every fence byte-for-byte as authored — `ts`, `jsonc`, `json`,
`json5`, `yaml` — while tables, emphasis and list markers were still normalized. This is the single
option that solves the whole embedded-code class.

**Caveat:** the option is global, not Markdown-scoped. Set at the top level it also disables CSS-in-JS,
GraphQL-in-template-literal and `<style>`-in-HTML formatting everywhere. Verified: with the option off
globally, a tagged `css` template literal and a tagged `graphql` template literal in a `.ts` file both
stopped being formatted. §6 scopes it with `overrides` so only Markdown is affected.

### 2.3 List markers — `+` and `*` are rewritten to `-`, and there is no option

Verified. `+ plus bullet` → `- plus bullet`. There is no configuration for it.

The history is on the record. [prettier/prettier#4251](https://github.com/prettier/prettier/issues/4251)
requested exactly this option in 2018. Maintainer `@lipis`: "Most polls are showing that people prefer
hyphen.. and **we don't want more options** (we have already too many for an opiniated code
formatter). I would go with option 2 and change it to hyphen." Maintainer `@azz`: "I'm happy with
switching to `-` in Prettier 2.0. **I'm not happy with adding an option for it.**" The default was
changed to `-`; no option was added.

This is consistent with the stated policy:
[Option Philosophy](https://prettier.io/docs/option-philosophy) — "Prettier has a few options because
of history. But we won't add more of them" and "Option requests aren't accepted anymore."

One quirk worth knowing before reviewing a diff: **Prettier alternates the marker between adjacent
sibling lists.** Verified — a `-` list followed by a blank line and another list came out as `-` then
`*` then `-`. This is not randomness; CommonMark requires it. [CommonMark 0.31.2 §5.3
Lists](https://spec.commonmark.org/0.31.2/#lists): "Two list items are of the same type if they begin
with a list marker of the same type… **Changing the bullet or ordered list delimiter starts a new
list**" (Example 303 shows `- foo / - bar / + baz` rendering as two separate `<ul>`s). If Prettier
emitted `-` for both, it would silently merge two lists into one. The alternation preserves meaning.

### 2.4 Emphasis delimiters — `*x*` → `_x_`, and there is no option

Verified: `Some *emphasis* and __strong__ text` → `Some _emphasis_ and **strong** text`. Emphasis
normalizes to `_`, strong to `**`.

**Confirmed: no option controls this.** `prettier --support-info` on 3.9.4 reports **29 options in
total**, and the only Markdown-specific one is `proseWrap`. There is no emphasis-delimiter option, no
bullet-marker option, and no table-padding option. Same policy as §2.3.

It is rendering-neutral by spec. [CommonMark §6.2 Emphasis and strong
emphasis](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis) opens by quoting Gruber:
"Markdown treats asterisks (`*`) and underscores (`_`) as indicators of emphasis. Text wrapped with
one `*` or `_` will be wrapped with an HTML `<em>` tag." Example 352 gives `*foo bar*` →
`<p><em>foo bar</em></p>`; Example 359 gives `_foo bar_` → `<p><em>foo bar</em></p>`. Identical output.

The one place the two are **not** interchangeable is intraword. §6.2: "An underscore delimiter run…
is a left-flanking or right-flanking delimiter run only if it is not part of a word." Example 358:
`5*6*78` → `<p>5<em>6</em>78</p>`. Example 362: `foo_bar_` → `<p>foo_bar_</p>` (no emphasis).
Prettier knows this and does not perform the swap where it would break: the printer only converts
where `_` is legal. Verified across all 54 files — no HTML difference attributable to an emphasis
swap appeared in any of them.

### 2.5 `trailingComma: "all"` and the `jsonc` / `json5` fence — the embedded case does **not** differ

The brief's premise deserves correction: **it is not that embedded JSON behaves differently from
files. It is that `jsonc`/`json5` behave differently from `json`, in fences and in files alike.**

Measured, `prettier@3.9.4 --trailing-comma=all`, standalone files and Markdown fences side by side:

| Parser  | Standalone file gets trailing comma? | Same content in a Markdown fence? |
| ------- | ------------------------------------ | --------------------------------- |
| `json`  | **No**                               | **No**                            |
| `jsonc` | **Yes**                              | **Yes**                           |
| `json5` | **Yes**                              | **Yes**                           |

So `.json` files are safe because the `json` parser ignores `trailingComma`, not because file-vs-fence
matters. ` ```jsonc ` in Markdown is treated exactly like a `.jsonc` file, because `embed.js` calls
`inferParser(options, { language })` and `jsonc` is a registered alias of the "JSON with Comments"
language (`prettier --support-info`).

This behavior arrived in **Prettier 3.2.0** (2024-01-12). From the
[3.2 release notes](https://prettier.io/blog/2024/01/12/3.2.0): "The new added `jsonc` parser: Always
quote the object keys. Wrap strings with double quotes. Of course, respect the `trailingComma`
option." Setting `--trailing-comma=none` suppresses it (verified).

Why this is a real hazard and not a taste question:

- **Strict JSON forbids it.** [RFC 8259 §4](https://www.rfc-editor.org/rfc/rfc8259#section-4):
  `object = begin-object [ member *( value-separator member ) ] end-object`.
  [§5](https://www.rfc-editor.org/rfc/rfc8259#section-5):
  `array = begin-array [ value *( value-separator value ) ] end-array`. Neither production admits a
  comma before the closing bracket.
- **JSON5 permits it.** [json5.org](https://json5.org/): "Objects may have a single trailing comma"
  and "Arrays may have a single trailing comma."
- **JSONC is the ambiguous one, and its originator discourages it.**
  [VS Code / JSON docs](https://code.visualstudio.com/docs/languages/json): "The mode also accepts
  trailing commas, but they are **discouraged and the editor will display a warning**."

### 2.6 Table cells — padded to the widest cell

Verified: `| a | bbbb | c |` with a `|---|---|---|` delimiter row becomes

```
| a   | bbbb | c   |
| --- | ---- | --- |
| 1   | 2    | 3   |
```

GFM tables are not in CommonMark; they are a GitHub extension, and padding inside a cell is stripped
before the cell content is parsed. This is the single largest source of diff churn here (1,874 lines,
62% of the whole reformat) and produced **zero** HTML differences across all 54 files. No option
controls it.

### 2.7 Ignoring Markdown — exact syntax

From [Ignoring Code](https://prettier.io/docs/ignore) (official docs), verified by running each:

- **Whole files:** a `.prettierignore` at the repo root, "uses gitignore syntax." Prettier also
  ignores version-control directories and `node_modules` by default.
- **Next node only:**

  ```
  <!-- prettier-ignore -->
  ```

  placed immediately before the block. Verified: it preserved an unpadded table and preserved
  `*emphasis*` in the paragraph directly after it, while the next paragraph was still normalized.

- **A range (Markdown only, since v1.12.0):**

  ```
  <!-- prettier-ignore-start -->
  ...anything...
  <!-- prettier-ignore-end -->
  ```

  The docs state: "This type of ignore is only allowed to be used in top-level and aimed to disable
  formatting for auto-generated content," and "**You must have a blank line before**
  `<!-- prettier-ignore-start -->` **and** `<!-- prettier-ignore-end -->` for Prettier to recognize the
  comments." Verified: inside the range, table padding, emphasis normalization **and embedded `jsonc`
  formatting** were all suppressed; the paragraph after `-end` was normalized again.

---

## 3. What CommonMark says the source already meant

This section is the reason the classification in §4 is not "5 files had their meaning changed."

### 3.1 A `+` at the start of a soft-wrapped line was already a bullet

[CommonMark §5.3 Lists](https://spec.commonmark.org/0.31.2/#lists): "In CommonMark, a list can
interrupt a paragraph. That is, no blank line is needed to separate a paragraph from a following
list." Example 305:

```
Foo
- bar
- baz
```

renders as `<p>Foo</p><ul><li>bar</li><li>baz</li></ul>`.

[§5.2 List items](https://spec.commonmark.org/0.31.2/#list-items), Basic case, Exception 1: "When the
first list item in a list interrupts a paragraph—that is, when it starts on a line that would
otherwise count as paragraph continuation text—then (a) the lines _Ls_ must not begin with a blank
line, and (b) if the list item is ordered, the start number must be 1." And §5.2 defines a bullet list
marker as "a `-`, `+`, or `*` character" — all three interrupt equally. The only stated blocker for
bullets is the empty item (Example 287: `foo` / `*` stays a paragraph).

So `+ 2 more retries were added` on a continuation line **was already a `<li>` before Prettier ran.**
Verified against the reference implementation:

- Authored source → `<p>A soft-wrapped paragraph…</p><ul><li>2 more retries…</li></ul>`
- Prettier output → **byte-identical HTML.**

All 6 occurrences in this repo are of this shape — a `+` meaning the word "plus" on a continuation
line. Every one of them was already misrendering. Prettier converted `+` to `-` and inserted the blank
line CommonMark implies, which is why the diff looks alarming; the render never moved.

**This is defect-surfacing, and the fix belongs in the prose.** [§2.4 Backslash
escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes) makes the intent explicit. Verified:
writing `\+ 2 local-auth tables)` renders the literal `+ 2 local-auth tables)` as paragraph text, and
Prettier preserves the escape and is idempotent over it. Rewriting the sentence to use the word "plus"
works equally well and reads better.

### 3.2 An ordered marker that is not `1.` never interrupted at all

The mirror-image case, and the more instructive one. §5.2 Exception 1(b) above: an ordered list can
only interrupt a paragraph "if the list item is ordered, **the start number must be 1**." Example 306:

```
The number of windows in my house is
14.  The number of doors is 6.
```

→ `<p>The number of windows in my house is\n14.  The number of doors is 6.</p>`. One paragraph.

`docs/architecture/2026-07-09-enterprise-conceptual-review.md` contains:

```
**P1 — Legibility & layers (the owner's #1 ask; mostly mechanical renames):**
4. Rename schema `tenant` → `cafe`, …
5. Apply mandatory domain prefixes …
```

That numbered list — items 4 through 17, across four "P" sections — **was never a list.** Start number
4 ≠ 1, no blank line above, so every line was paragraph continuation text. Verified against the
reference implementation: the authored source renders as a single run-on `<p>`.

### 3.3 Prettier's response, and why it is still rendering-neutral

Prettier joined those continuation lines onto one physical line — because emitting `4. Rename…` at the
start of a printed line would be ambiguous. The rendered difference is exactly one thing: a soft line
break became a space.

[CommonMark §6.9 Soft line breaks](https://spec.commonmark.org/0.31.2/#soft-line-breaks): "A regular
line ending (not in a code span or HTML tag) that is not preceded by two or more spaces or a backslash
is parsed as a softbreak. (**A soft line break may be rendered in HTML either as a line ending or as a
space. The result will be the same in browsers.**)" And: "A conforming parser may render a soft line
break in HTML either as a line ending or as a space."

So the rendered document is unchanged. Hard line breaks are untouched — verified, a line ending in two
spaces survives Prettier intact (§6.7 of the spec defines those separately).

**But the raw source got materially worse to read.** A list-shaped block of 5 numbered items became
one 900-character line. For a human skimming the file, and for an agent reading raw bytes rather than
rendered HTML, that is a real regression in legibility — of a document that was already broken and
nobody had noticed. Same conclusion as §3.1: fix the prose. Renumber the list to start at `1.`, or add
a blank line and let it be a real `<ol>` with `start`, or escape the numerals.

### 3.4 The unclosed fence

[CommonMark §4.5 Fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks): "If the
end of the containing block (or document) is reached and no closing code fence has been found, the
code block contains all of the lines after the opening code fence until the end of the containing
block (or document)."

So an unclosed fence already swallowed everything after it. Verified: a document with an unclosed
` ```ts ` fence and three paragraphs after it renders all three paragraphs inside `<pre><code
class="language-ts">`, before and after Prettier, **byte-identical HTML**. Prettier added the closing
fence that the parser had already inferred.

The one case in this repo is a lone trailing ` ``` ` with nothing after it, which Prettier turned into
an empty code block. Rendered: `<pre><code></code></pre>` before, `<pre><code>\n</code></pre>` after —
a newline inside an otherwise empty `<pre>`. That is the only genuinely non-identical rendering
outside code fences in the entire reformat, and it is one whitespace character in an empty block.
**The right action is to delete the stray fence**, which is a defect either way.

---

## 4. Classification

| Observed change                                             | Count here | Class                   | Primary source backing the classification                                                                                                                                                       | Configurable away?                                                                            |
| ----------------------------------------------------------- | ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Table cell padding / delimiter-row alignment                | 1,874 rows | **Rendering-neutral**   | Measured: 0 HTML differences across 54 files. Padding is stripped before cell content is parsed.                                                                                                | **No option.** `prettier-ignore` only.                                                        |
| `*x*` → `_x_` emphasis delimiter                            | ~1,011     | **Rendering-neutral**   | [CommonMark §6.2](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis), Ex. 352 vs 359 — both give `<em>`. Measured: 0 HTML diffs.                                                 | **No option.**                                                                                |
| `__x__` → `**x**` strong delimiter                          | —          | **Rendering-neutral**   | Same section — "double `*`'s or `_`'s will be wrapped with an HTML `<strong>` tag."                                                                                                             | **No option.**                                                                                |
| `+`/`*` bullet → `-`                                        | —          | **Rendering-neutral**   | [§5.3](https://spec.commonmark.org/0.31.2/#lists) — marker choice does not affect output; alternation preserves list boundaries (Ex. 303).                                                      | **No option.** ([#4251](https://github.com/prettier/prettier/issues/4251) refused)            |
| Prose `+` at line start became a `-` bullet                 | 6 files    | **Defect-surfacing**    | [§5.2 Ex. 1](https://spec.commonmark.org/0.31.2/#list-items) + [§5.3 Ex. 305](https://spec.commonmark.org/0.31.2/#lists). Measured: identical HTML — it was already a `<li>`.                   | Fix the prose: `\+` or the word "plus".                                                       |
| Non-`1.` numbered lines joined into one paragraph line      | 2 files    | **Defect-surfacing**    | [§5.2 Exc. 1(b)](https://spec.commonmark.org/0.31.2/#list-items) + [§6.9](https://spec.commonmark.org/0.31.2/#soft-line-breaks) — was never a list; softbreak ≡ space.                          | Fix the prose: renumber from `1.`.                                                            |
| Multiple spaces collapsed in prose and headings             | 3 files    | **Rendering-neutral**   | [CSS Text 3 §3](https://www.w3.org/TR/css-text-3/#white-space-processing) — "sequences of white space are collapsed."                                                                           | **No option.**                                                                                |
| Blank lines collapsed / trailing blank lines removed        | —          | **Rendering-neutral**   | [Prettier Rationale](https://prettier.io/docs/rationale) — "Prettier collapses multiple blank lines into a single blank line."                                                                  | **No option.**                                                                                |
| Unclosed fence closed                                       | 1          | **Defect-surfacing**    | [§4.5](https://spec.commonmark.org/0.31.2/#fenced-code-blocks) — an unclosed fence already runs to EOF. Measured: identical HTML.                                                               | Delete the stray fence.                                                                       |
| Empty code block gained a newline                           | 1          | **Rendering-neutral**\* | Only non-identical non-code render found; one whitespace char inside an empty `<pre>`.                                                                                                          | Delete the stray fence.                                                                       |
| ` ```ts ` block reformatted (spacing, wrapping, semicolons) | 3          | **Meaning-changing**    | Prettier [`embed.js`](https://github.com/prettier/prettier/blob/main/src/language-markdown/embed.js) formats the fence as a `.ts` file with repo options.                                       | **Yes — `embeddedLanguageFormatting: "off"`.**                                                |
| ` ```jsonc ` block gained a **trailing comma**              | 1          | **Meaning-changing**    | [RFC 8259 §4/§5](https://www.rfc-editor.org/rfc/rfc8259#section-4) grammar admits no trailing comma; [VS Code docs](https://code.visualstudio.com/docs/languages/json) call them "discouraged." | **Yes — `embeddedLanguageFormatting: "off"`,** or `trailingComma: "none"` scoped to Markdown. |

\* Strictly, one byte of HTML differs. It renders as an empty code block either way.

---

## 5. Documented harm cases on `prettier/prettier`

Searched via the GitHub API against the owning repo. These are the reports that matter for a docs
repo, all read from the issue tracker itself:

### 5.1 The `jsonc` trailing comma — [#15956](https://github.com/prettier/prettier/issues/15956), **open since 2024-01-18**

"Prettier should _not_ format JSONC with trailing commas." The reporter's argument: "Prettier's
insertion of trailing commas goes against the recommendations of the entity that introduced /
maintains the format… trailing commas are not part of any specification (and are explicitly
discouraged). Rather, trailing commas are supported by certain specific applications."

The thread contains a report of **exactly this repo's situation** — @JounQin, 2024-01-19:

```
It's in markdown, so `overrides` won't work.
I'm using jsonc to add comments inside, but the content is still expected to be json without comments.
```

Later, @ottodevs (2026-05-30): "A formatter should never rewrite a file into a less portable or
potentially invalid form by default… the reference `jsonc-parser` has `allowTrailingComma` set to
`false` by default." The issue remains open and labelled "needs discussion" after two and a half
years. Related fallout reports: [#15945](https://github.com/prettier/prettier/issues/15945)
(`.eslintrc.json`) and [#15960](https://github.com/prettier/prettier/issues/15960) (`.babelrc`).

**This is precisely the case in `docs/architecture/2026-07-20-umipos-contract-seam.md`.** The prose
directly above the fence reads "Emitir desde `@umi/contract` un solo archivo, neutral al lenguaje:
**`umi-contract-<semver>.json`**". The document tells the reader the artifact is a `.json` file; the
fence is tagged `jsonc` only so the sample can carry explanatory comments; Prettier added trailing
commas to it. A reader copying that sample and stripping the comments gets a file that
`JSON.parse` rejects. **This is the one real harm in the whole reformat.**

### 5.2 Markdown formatting that changed meaning — real, and recent

- [#17746](https://github.com/prettier/prettier/issues/17746) — "[3.6 regression] Semantically changes
  Markdown loose list to tight list." Opened 2025-07-22, closed 2026-06-04. `- a` / blank / `  - b`
  had its blank line removed, converting a loose list to a tight one. The reporter cites the spec
  directly: loose vs tight is "the difference in HTML output is that paragraphs in a loose list are
  wrapped in `<p>` tags." Genuinely meaning-changing, and a regression, not a design decision.
- [#19488](https://github.com/prettier/prettier/issues/19488) — "[3.9 regression] Markdown: multi-line
  `{{% … %}}` shortcode corrupted — standalone `%}}` line rewritten to `}`." Opened 2026-06-28, fixed
  in **3.9.3** the next day. "the `%}` is dropped and the document's meaning changes… Silently
  rewriting syntax it doesn't fully parse is **data corruption**." Attributed by the reporter to the
  3.9.0 `remark-parse` → `micromark` swap.
- [#3834](https://github.com/prettier/prettier/issues/3834) — "[Markdown] Changes literal underscores
  to emphasis." **Open since 2018-01-28.** `**__foo, __bar**` becomes `****foo, **bar**`, which
  renders differently from what both GitHub and commonmark.js produce for the input.
- [#19322](https://github.com/prettier/prettier/pull/19322) / [#17857](https://github.com/prettier/prettier/pull/17857)
  — "Fix blank lines between list items and nested sub-lists being removed in Markdown/MDX."

The pattern: **the meaning-changing Markdown bugs are regressions in specific releases, not the steady
state.** They get found and fixed within days-to-months. None of them is prevented by configuration —
the mitigation is version discipline and a render-diff check (§6.4), not an option.

Prettier itself sets expectations here.
[Rationale — non-standard syntax](https://prettier.io/docs/rationale): "Prettier is often able to
recognize and format non-standard syntax such as … Markdown syntax extensions not defined by any
specification. The support for such syntax is considered **best-effort and experimental.
Incompatibilities may be introduced in any release and should not be viewed as breaking changes.**"

---

## 6. Recommended configuration

### 6.1 `.prettierrc.json`

Add one `overrides` entry to the existing config. Everything else stays as it is.

```json
{
  "$schema": "https://json.schemastore.org/prettierrc",
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf",
  "overrides": [
    {
      "files": ["*.md", "*.markdown", "*.mdx"],
      "options": {
        "embeddedLanguageFormatting": "off"
      }
    }
  ]
}
```

**Yes — `embeddedLanguageFormatting: "off"` solves the `jsonc` and `ts` cases completely, and it is
the only thing that needs to change.** Verified end to end with this exact config file: the Markdown
table was padded, `*emphasis*` became `_emphasis_`, `+ plus` became `- plus`, and the ` ```jsonc ` and
` ```ts ` fences came out byte-identical to the authored source. In the same run, a `.ts` file still
had its tagged `css` and `graphql` template literals formatted, because the override is scoped to
Markdown — which is why this belongs in `overrides` rather than at the top level.

**Why not `trailingComma: "none"` scoped to Markdown instead?** It would fix the one trailing comma
but leave the other three cases: TypeScript samples still get re-wrapped, re-quoted and
semicolon-corrected to this repo's house style, and JSON samples still get arrays collapsed. A code
sample in a document is quoted evidence — its shape is often the point ("this is what the config looks
like today"). `"off"` is the correct scope of fix; `trailingComma` is a narrower patch on one symptom.

**Why keep Markdown formatting on at all?** Because §1.2 measured the cost as zero. 44/54 files render
byte-identically; the other 10 are hand edits, whitespace HTML already collapses, spec-equivalent
softbreaks, and the code fences this override removes. Padded tables and one bullet character are a
real readability win in a repo where docs are the primary artifact.

### 6.2 `.prettierignore`

The current file is already well-reasoned and needs no structural change. Two additions to consider:

```
# Verbatim quoted artifacts. These reproduce a file that exists elsewhere byte
# for byte; reformatting them makes the quote stop being a quote.
# (Nothing currently qualifies — add paths here, not blanket globs.)
```

Guidance, in preference order:

1. **`.prettierignore` for whole files** only where the file is a verbatim reproduction of something
   external, or generated. Not for "this file has code samples in it" — the override in §6.1 already
   covers that, and blanket-ignoring `docs/` would give up the benefit for no remaining risk.
2. **`<!-- prettier-ignore-start -->` / `<!-- prettier-ignore-end -->`** for a region inside an
   otherwise-formatted file — generated tables, ASCII diagrams, sample documents that must stay
   byte-exact. Remember the blank-line requirement (§2.7) and that the docs restrict it to top level.
3. **`<!-- prettier-ignore -->`** for a single following block.

### 6.3 Fix the prose, do not configure around it

The `+`-as-"plus" and non-`1.` numbered lists are pre-existing document defects (§3.1, §3.2), and
Prettier is currently the only thing in this repo that detects them. Fixes, in preference order:

- Rewrite `+ 2 local-auth tables)` as `plus 2 local-auth tables)`. Best: reads correctly in source and
  in render.
- Or escape: `\+ 2 local-auth tables)`. Verified to render the literal `+` and to survive Prettier
  idempotently.
- For the numbered lists: renumber from `1.` and add the blank line above, so they become the `<ol>`
  the author intended. Prettier will then keep them as a list.
- Delete the stray unclosed fence in `docs/architecture/2026-06-23-umi-api-centralization-spec.md`.

### 6.4 Two operational guards

- **Pin the Prettier minor.** The Markdown parser was replaced wholesale in 3.9.0 (§2), and §5.2
  documents a meaning-changing regression in 3.9.0 fixed in 3.9.3 and another in 3.6. The repo
  declares `prettier: "^3.4.2"` and resolves 3.9.4 — a floating caret across a parser rewrite. Prefer
  an exact pin, bumped deliberately.
- **Render-diff, don't eyeball.** The check that actually answers "did meaning change" is the one in
  §1.2: render `HEAD:<file>` and the working copy through a CommonMark implementation and diff the
  HTML. It is ~40 lines of Node against `markdown-it`, it runs in seconds over 54 files, and it turns
  a 3,000-line unreviewable diff into a 10-line answer. Worth keeping as a script for any future bulk
  Markdown reformat; not worth adding to CI, since it only has meaning on a reformat commit.

---

## 7. What cannot be configured away

Stated plainly, because this is the part that has no workaround:

1. **Emphasis delimiter normalization (`*x*` → `_x_`).** No option exists. `--support-info` on 3.9.4
   lists 29 options; `proseWrap` is the only Markdown-specific one.
2. **Strong delimiter normalization (`__x__` → `**x**`).** No option.
3. **List-marker normalization (`+`/`*` → `-`, with alternation between sibling lists).** No option.
   Explicitly requested and explicitly refused —
   [#4251](https://github.com/prettier/prettier/issues/4251), "I'm not happy with adding an option for
   it," and [Option Philosophy](https://prettier.io/docs/option-philosophy), "Option requests aren't
   accepted anymore."
4. **Table cell padding.** No option.
5. **Whitespace and blank-line collapsing.** No option.
6. **Joining a soft-wrapped continuation line that begins with a would-be list marker.** No option;
   `proseWrap: "preserve"` does not prevent it.

The only escapes for any of these are file-level (`.prettierignore`) or block-level
(`<!-- prettier-ignore -->` / `-start`/`-end`) — all-or-nothing, never per-rule. **If the repo wants
padded tables it must also accept `_` emphasis and `-` bullets.** The measurement in §1.2 is what makes
that an acceptable trade: the cost is zero rendered difference.

---

## 8. Does it change how an LLM or agent reads the file?

The rendered document is what a human sees; the **raw bytes** are what an agent sees. So the answer is
not identical to the rendering answer.

- **Neutral for retrieval and comprehension.** `_x_` vs `*x*`, `-` vs `+`, and padded table cells are
  all forms a model has seen at enormous scale. Consistency across a corpus is, if anything, mildly
  helpful. Padded tables also line columns up in a monospace context, which helps a reader — human or
  model — associate a cell with its header.
- **Mildly negative on token count.** 1,874 padded table rows add whitespace that costs tokens and
  carries no information. In a repo where agents read `docs/` heavily this is a real but small cost,
  and it is the price of the readability win.
- **The one genuine regression is §3.3.** Collapsing a five-item numbered block into a single
  900-character paragraph line removes the structural cue an agent would otherwise use. But the block
  was already a single paragraph in every conforming parser — the cue was false. The right fix is to
  make it a real list (§6.3), which restores the structure for both audiences.
- **The one genuine hazard is §5.1.** An agent asked to "use the contract file format from the docs"
  now reads a sample with trailing commas and a `.json` filename beside it. That is a defect that
  propagates into generated code. `embeddedLanguageFormatting: "off"` removes it.

---

## 9. Uncertainties

1. **The render-diff used `markdown-it@14` in `commonmark` preset with GFM tables enabled, not
   GitHub's renderer.** GitHub runs `cmark-gfm` with additional extensions (autolinks, task lists,
   alerts, footnotes). A difference confined to one of those extensions would not have been caught. No
   evidence any exists here, but the 44/54 figure is "identical under a CommonMark+tables renderer,"
   not "identical on github.com."
2. **The emphasis counts (1,011 removed `*…*`, 971 added `_…_`) are regex approximations** over the
   diff, not parse-tree counts. The 40-run gap is almost certainly counting error (nested emphasis,
   emphasis inside code spans) rather than 40 lost emphasis runs — the HTML comparison found no
   emphasis-attributable difference in any of the 54 files. Treat the numbers as scale, not as exact.
3. **`CONVENTIONS.md` and `docs/migration/build-v3/GATED_CUTOVER_PLAN.md` contain hand edits mixed into
   the same working tree** as the reformat. I classified their HTML differences as hand edits from
   reading the diff, not by isolating the formatter's contribution. If the two need to be separated,
   run Prettier on the `HEAD` version of each and diff against the working copy.
4. **Whether any of the 54 files is consumed by something other than a Markdown renderer** — a doc
   generator, a parser in `apps/`, an agent skill loader with its own conventions — was not checked.
   `.agents/skills/` is already ignored; nothing else in `docs/` is obviously machine-parsed.
5. **`prettier@3.9.4` was measured; the repo declares `^3.4.2`.** A fresh install after a 3.10 release
   could behave differently in Markdown, which is the entire point of §6.4's pin recommendation.

---

## Source list

All primary: the specification texts themselves, the RFC, Prettier's own documentation, release notes,
source code and issue tracker, and direct measurement.

**CommonMark** — [Spec 0.31.2 (current; index of all versions)](https://spec.commonmark.org/) ·
[§4.5 Fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks) ·
[§5.2 List items](https://spec.commonmark.org/0.31.2/#list-items) ·
[§5.3 Lists](https://spec.commonmark.org/0.31.2/#lists) ·
[§6.2 Emphasis and strong emphasis](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis) ·
[§6.9 Soft line breaks](https://spec.commonmark.org/0.31.2/#soft-line-breaks) ·
[§2.4 Backslash escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes) ·
[spec.txt source](https://raw.githubusercontent.com/commonmark/commonmark-spec/master/spec.txt)
(v0.31.2, dated 2024-01-28; example numbering computed from it)

**JSON** — [RFC 8259 §4 Objects / §5 Arrays](https://www.rfc-editor.org/rfc/rfc8259#section-4) ·
[JSON5 specification](https://json5.org/) ·
[VS Code — JSON with Comments](https://code.visualstudio.com/docs/languages/json)

**W3C** — [CSS Text Module Level 3, §3 White Space Processing](https://www.w3.org/TR/css-text-3/#white-space-processing)

**Prettier docs** — [Options](https://prettier.io/docs/options) ·
[Ignoring Code](https://prettier.io/docs/ignore) ·
[Rationale](https://prettier.io/docs/rationale) ·
[Option Philosophy](https://prettier.io/docs/option-philosophy) ·
[Configuration File](https://prettier.io/docs/configuration)

**Prettier releases** — [3.9.0 — Major parser upgrades (2026-06-27)](https://prettier.io/blog/2026/06/27/3.9.0) ·
[3.2.0 — jsonc parser (2024-01-12)](https://prettier.io/blog/2024/01/12/3.2.0) ·
[release tags 3.8.0 – 3.9.6](https://github.com/prettier/prettier/releases)

**Prettier source** — [`src/language-markdown/embed.js`](https://github.com/prettier/prettier/blob/main/src/language-markdown/embed.js)

**Prettier issues** — [#15956 jsonc trailing commas (open)](https://github.com/prettier/prettier/issues/15956) ·
[#15945 `.eslintrc.json`](https://github.com/prettier/prettier/issues/15945) ·
[#15960 `.babelrc`](https://github.com/prettier/prettier/issues/15960) ·
[#15553 the request that added it](https://github.com/prettier/prettier/issues/15553) ·
[#17746 loose→tight list regression](https://github.com/prettier/prettier/issues/17746) ·
[#19488 shortcode corruption, fixed in 3.9.3](https://github.com/prettier/prettier/issues/19488) ·
[#3834 literal underscores (open since 2018)](https://github.com/prettier/prettier/issues/3834) ·
[#4251 list bullet option — refused](https://github.com/prettier/prettier/issues/4251) ·
[#7875 the PR that added `--embedded-language-formatting`](https://github.com/prettier/prettier/pull/7875)

**Measurement** — `prettier@3.9.4` (`--support-info`, `--file-info`, and ~15 formatting experiments),
`commonmark@0.31.2` (reference implementation), `markdown-it@14` (`commonmark` preset + GFM tables),
and read-only `git diff` / `git show` over this repo's working tree. All run 2026-07-21.
