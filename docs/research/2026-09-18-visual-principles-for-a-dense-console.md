# Visual principles for a dense console

Date: 2026-09-18

Scope: the design law that the Umi owner console needs. The owner reports three
symptoms. The screens feel overwhelming. Some screens feel out of place. The UI
does not look finished. This file gives the laws, a primary source for each law,
and a test that a reviewer can apply to a screenshot or to a computed style.

This file is a research result. It holds no product decision. A decision needs an
ADR under `docs/architecture/`.

## How to read the labels

Each claim carries one label.

| Label                  | Meaning                                            |
| ---------------------- | -------------------------------------------------- |
| Documented fact        | A named source owns the claim. The URL is present. |
| Source-backed tradeoff | Two sources disagree, or a source states a cost.   |
| Inference              | This file reasons from the facts.                  |
| UNVERIFIED             | The claim could not be confirmed.                  |

Quoted text stays verbatim. The style rules do not change a quote.

Two quote conventions follow. A dash inside a quote appears as an ASCII hyphen.
A quote with an ellipsis, or a quote that joins a bullet list into a sentence,
keeps the original words and drops only the punctuation of the layout.

## Method and tool record

The task follows `docs/agents/tool-and-research-doctrine.md`.

**Step 0 answers.**

| Question                              | Answer                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes. The research tool is the design system of the vendor. The browser tool is `playwright`.                    |
| Is it installed here?                 | `playwright` 1.x is installed in the repo `node_modules/.bin`. Chromium builds are in `~/.cache/ms-playwright`. |
| Can an agent drive it with no prompt? | Yes. `playwright-cli` runs headless.                                                                            |
| What does adoption cost?              | None for this task. This task reads sources only.                                                               |
| What is the fallback?                 | `curl` plus `r.jina.ai` for a JavaScript shell, then the GitHub raw file.                                       |

**Routes that worked.**

| Route                                     | Result                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `r.jina.ai/<url>`                         | Rendered `nngroup.com`, `m3.material.io`, `carbondesignsystem.com`, `interaction-design.org`, `practicaltypography.com`, `spec.fm`, `w3.org`. |
| GitHub raw `.mdx`                         | Polaris design guidance. The live `polaris.shopify.com` path returns 404. The archive repo holds the source.                                  |
| Apple HIG JSON                            | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json`. The HTML page hides the tables behind tabs.   |
| Google `sitemap.xml`                      | NN/g article URLs. Direct URL guesses returned 404.                                                                                           |
| `pdftotext`                               | Williams, Miller, Sweller, Iyengar and Lepper, and Wagemans et al.                                                                            |
| `duckduckgo.com/html` through `r.jina.ai` | Search for a primary PDF. The `lite.duckduckgo.com` endpoint failed.                                                                          |

**Routes that failed.**

| Route                                                                   | Result                                     |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| `curl` on `m3.material.io`                                              | Angular shell with no content.             |
| `curl` on `polaris.shopify.com/design/typography`                       | 404. The docs moved.                       |
| `api.github.com/search/code`                                            | 401. The endpoint needs a token.           |
| `developer.apple.com/design/human-interface-guidelines/typography.json` | 404. The `/tutorials/data/` path works.    |
| Cambridge Core PDF for Cowan 2001                                       | Not a PDF. The file is a login page.       |
| `lite.duckduckgo.com`                                                   | Returned a W3C DTD link. No search result. |

---

## 1. Gestalt, in full

Gestalt is the base layer. A dense screen fails first at grouping. Nine principles
apply to a console. The list holds all nine.

**Primary source.** Wertheimer published the grouping paper in 1923. Koffka stated
the motto. The modern review is Wagemans et al. (2012), _A Century of Gestalt
Psychology in Visual Perception: I. Perceptual Grouping and Figure-Ground
Organization_, Psychological Bulletin 138(6), 1172-1217. NN/g owns the applied
articles and videos.

**Documented fact.** Wagemans et al. (2012), p. 1173:

> The most general principle was the so-called law of Prägnanz, stating, in its
> most general sense, that the perceptual field and objects within it will take on
> the simplest and most encompassing (ausgezeichnet) structure permitted by the
> given conditions.

**Documented fact.** Koffka, quoted by the Interaction Design Foundation
(<https://www.interaction-design.org/literature/topics/gestalt-principles>):

> The whole is other than the sum of the parts.

**Documented fact.** NN/g gives the general definition and the list
(<https://www.nngroup.com/articles/principles-visual-design/>):

> Gestalt principles: Principles that explain how humans simplify and organize
> complex images that consist of many elements, by subconsciously arranging the
> parts into an organized system that creates a whole, rather than interpreting
> them as a series of disparate elements. In other words, Gestalt principles
> capture our tendency to perceive the whole as opposed to the individual elements.

> There are several Gestalt principles, including similarity, continuation,
> closure, proximity, common region, figure/ground, and symmetry and order.

### The nine principles

| Principle                    | One-line definition                         | Source and quote                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | What it means in a dense console                                                                  | Test on a screenshot                                                                               |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Proximity                    | Near items read as one group.               | NN/g, <https://www.nngroup.com/articles/gestalt-proximity/>: "Items close together are likely to be perceived as part of the same group — sharing similar functionality or traits."                                                                                                                                                                                                                                                                                                                                                                                                      | The gap between groups must exceed the gap inside a group.                                        | Measure the two gaps. The group gap must be at least 2x the inner gap.                             |
| Similarity                   | Alike items read as one group.              | NN/g, <https://www.nngroup.com/articles/gestalt-similarity/>: "Items which share a visual characteristic are perceived as more related than items that are dissimilar."                                                                                                                                                                                                                                                                                                                                                                                                                  | One visual encoding must mean one thing. One link colour, one status colour, one row height.      | List every colour and weight on the screen. Each one must map to one meaning.                      |
| Common region                | A boundary makes a group.                   | NN/g, <https://www.nngroup.com/articles/common-region/>: "items within a boundary are perceived as a group and assumed to share some common characteristic or functionality."                                                                                                                                                                                                                                                                                                                                                                                                            | A panel or a card needs a real reason. A boundary is stronger than a gap.                         | Count the boundaries. Each boundary must hold one job.                                             |
| Uniform connectedness        | A connecting line or shape makes a group.   | Wagemans et al. (2012), p. 1191: "Uniform connectedness (UC) ... is the principle by which the visual system initially partitions an image into a set of mutually exclusive connected regions having uniform (or smoothly changing) properties, such as luminance, color, texture, motion, and depth." NN/g states the same rule for UI: "Visual design elements that are connected (for example, by a line) are seen as belonging together. This principle is strong enough to overrule small differences between the items." (<https://www.nngroup.com/videos/connectedness-gestalt/>) | A shared surface with no gap beats a row of boxes with gaps.                                      | Find a group that uses a border where a shared surface would work. This is a candidate for change. |
| Continuity                   | The eye follows a line or a curve.          | NN/g, <https://www.nngroup.com/videos/continuation-gestalt/>: "The eye automatically follows lines and curves, continuing them. Employ continuation to guide users along desired paths in the UI."                                                                                                                                                                                                                                                                                                                                                                                       | Column alignment is a continuity device. A broken edge stops the scan.                            | Follow the left edge of the content. Count the x-positions. A count above three is a defect.       |
| Closure                      | The eye fills a gap.                        | NN/g, <https://www.nngroup.com/videos/closure-gestalt/>: "People often fill in the gaps between visual elements, using closure to perceive them as a whole instead of being separate UI items."                                                                                                                                                                                                                                                                                                                                                                                          | An incomplete row or a truncated label invites a wrong guess.                                     | Find a truncated value with no tooltip and no full form. This is a defect.                         |
| Figure-ground                | A foreground separates from a background.   | NN/g, <https://www.nngroup.com/videos/figure-ground-gestalt/>: "Users perceive interface design elements that differentiate the foreground (figure) from the background (ground) as something to focus on or interact with."                                                                                                                                                                                                                                                                                                                                                             | A modal, a popover, and a drawer must separate from the page.                                     | Look at the overlay. The page behind it must recede.                                               |
| Common fate                  | Items that move together read as one group. | NN/g, <https://www.nngroup.com/videos/common-fate-gestalt/>: "Things that move in synch are perceived as belonging to the same group and being different than other screen elements that stay put or move differently."                                                                                                                                                                                                                                                                                                                                                                  | A bulk action and its selection must move as one unit. An animation must not separate two fields. | Trigger the motion. The selected rows and the bulk bar must act as one object.                     |
| Prägnanz (law of simplicity) | The eye prefers the simplest reading.       | Wagemans et al. (2012), p. 1173, quoted above. IxDF gives the plain form: "Pragnanz describes the human tendency to simplify complexity." (<https://www.interaction-design.org/literature/topics/gestalt-principles>)                                                                                                                                                                                                                                                                                                                                                                    | The default reading of the screen must be the intended reading. Ambiguity loses.                  | Look at the screen for 5 seconds. Write the reading. Compare it to the task order.                 |

**Documented fact.** NN/g adds a separate principle, symmetry and order. IxDF
(<https://www.interaction-design.org/literature/topics/gestalt-principles>):

> Humans tend to see visual elements as grouped when they are arranged
> symmetrically.

**Inference.** A console does not need symmetry for its own sake. A console needs a
predictable edge. The left edge carries the scan. Symmetry matters most inside a
single row or a single control group.

**Test for the whole section.** Take the screen in greyscale, at 30 per cent
blur. The groups must survive. If the groups disappear, the layout depends on
colour alone. That is a defect.

---

## 2. The four design laws for a page (CRAP)

Robin Williams gives four laws. The memory word is CRAP: Contrast, Repetition,
Alignment, Proximity. The book is _The Non-Designer's Design Book_, 4th edition,
Peachpit, 2014. The quotes below come from the book text.

**Documented fact.** The four laws follow.

**Contrast.** Williams, chapter 6:

> The Principle of Contrast states: Contrast various elements of the piece to
> draw a reader's eye into the page. If two items are not exactly the same, then
> make them different. Really different.

> For contrast to be effective, however, it must be strong.

**Test.** Find the two most important items on the screen. Their visual weight must
differ by a clear step. A 2-pixel difference in font size fails this test.

**Repetition.** Williams, chapter 4:

> The Principle of Repetition states: Repeat some aspect of the design throughout
> the entire piece. The repetitive element may be a bold font, a thick rule
> (line), a certain bullet, design element, color, format, spatial relationships,
> etc. It can be anything that a reader will visually recognize.

**Test.** Count the button styles. A screen may show one primary style, one
secondary style, and one destructive style. A fourth style is a defect.

**Alignment.** Williams, chapter 5:

> The Principle of Alignment states: Nothing should be placed on the page
> arbitrarily. Every item should have a visual connection with something else on
> the page.

> When items are aligned on the page, the result is a stronger cohesive unit.

**Test.** Draw the vertical lines through every left edge, and the horizontal lines
through every baseline. Each line must touch two or more items. An item with its
own private edge is a defect.

**Proximity.** Williams, chapter 3:

> The Principle of Proximity states: Group related items together. Move them
> physically close to each other so the related items are seen as one cohesive
> group rather than a bunch of unrelated bits.

> Items or groups of information that are not related to each other should not be
> in close proximity (nearness) to the other elements, which gives the reader an
> instant visual clue to the organization and content of the page.

**Test.** Measure the smallest gap between two different groups. It must be larger
than the largest gap inside one group.

**Source-backed tradeoff.** Contrast and density pull in opposite directions. A
dense console needs many items. Contrast needs strong differences between items.
The resolution is to spend contrast on the few items that carry a decision, and to
hold the rest quiet. Polaris states the same balance for density
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/layout/density.mdx>):

> Information-rich interfaces, like index pages or data tables, require
> high-density layouts for efficiency.

---

## 3. Hierarchy

Text size is the strongest hierarchy signal after position. Four design systems
give four scales. The scales agree on the mechanism and disagree on the count.

### The scales, with numbers

**Material 3 baseline type scale.** Documented fact
(<https://m3.material.io/styles/typography/type-scale-tokens>):

> Material 3 has one type scale containing two sets of type styles: 15 baseline
> and 15 emphasized.

> No single product will use all the styles. Instead, select styles from the scale
> that are most appropriate.

The values come from the Android implementation of the same tokens,
`TypeScaleTokens.kt` in the `androidx` repository
(<https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/TypeScaleTokens.kt>).

| Style           | Size (sp) | Line height (sp) |
| --------------- | --------- | ---------------- |
| Display Large   | 57        | 64               |
| Display Medium  | 45        | 52               |
| Display Small   | 36        | 44               |
| Headline Large  | 32        | 40               |
| Headline Medium | 28        | 36               |
| Headline Small  | 24        | 32               |
| Title Large     | 22        | 28               |
| Title Medium    | 16        | 24               |
| Title Small     | 14        | 20               |
| Body Large      | 16        | 24               |
| Body Medium     | 14        | 20               |
| Body Small      | 12        | 16               |
| Label Large     | 14        | 20               |
| Label Medium    | 12        | 16               |
| Label Small     | 11        | 16               |

**Apple iOS text styles.** Documented fact
(<https://developer.apple.com/design/human-interface-guidelines/typography>).
The table is the Large (default) Dynamic Type size. Route: the page JSON at
`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json`.

| Style       | Size (pt) | Leading (pt) |
| ----------- | --------- | ------------ |
| Large Title | 34        | 41           |
| Title 1     | 28        | 34           |
| Title 2     | 22        | 28           |
| Title 3     | 20        | 25           |
| Headline    | 17        | 22           |
| Body        | 17        | 22           |
| Callout     | 16        | 21           |
| Subhead     | 15        | 20           |
| Footnote    | 13        | 18           |
| Caption 1   | 12        | 16           |
| Caption 2   | 11        | 13           |

Apple pairs the table with two rules. Documented fact:

> Minimize the number of typefaces you use, even in a highly customized
> interface. Mixing too many different typefaces can obscure your information
> hierarchy and hinder readability, in addition to making an interface feel
> internally inconsistent or poorly designed.

> Adjust font weight, size, and color as needed to emphasize important
> information and help people visualize hierarchy.

Apple also sets a floor. Documented fact:

| Platform    | Default size | Minimum size |
| ----------- | ------------ | ------------ |
| iOS, iPadOS | 17 pt        | 11 pt        |
| macOS       | 13 pt        | 10 pt        |

**Carbon type set.** Documented fact
(<https://carbondesignsystem.com/elements/typography/type-sets/>):

> The productive type set uses a base type size of 14px, while the expressive type
> set uses a base type size of 16px.

| Productive style                            | Size (px) | Line height (px) |
| ------------------------------------------- | --------- | ---------------- |
| legal-01, label-01, helper-text-01, code-01 | 12        | 16               |
| body-compact-01                             | 14        | 18               |
| body-01, heading-01                         | 14        | 20               |
| heading-02                                  | 16        | 24               |
| heading-03                                  | 20        | 28               |
| heading-04                                  | 28        | 36               |
| heading-05                                  | 32        | 40               |
| heading-06                                  | 42        | 50               |
| heading-07                                  | 54        | 64               |

Carbon separates the two sets by use. Documented fact:

> The productive type set uses fixed headings. Product pages have a higher density
> of information housed inside containers for space efficiency, and in these
> situations fixed type styles are a must.

**Polaris type scale.** Documented fact
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/typography/font-and-typescale.mdx>):

> Polaris offers two typescales: heading and body. These typescales are used to
> create visual pairings in the UI and all line heights are aligned with the 4px
> grid.

> Designed with software in mind first and foremost, it's optimized for use in
> high density layouts with intricate details and complex features.

Polaris gives no public pixel table in text. The values live in an image and in the
token package. **UNVERIFIED:** the exact Polaris font size values.

### How many sizes may one screen carry?

**Documented fact.** NN/g gives a number. The article _5 Principles of Visual
Design in UX_ (<https://www.nngroup.com/articles/principles-visual-design/>) states:

> A visually pleasing design generally uses no more than 3 different sizes.

> To create a clear visual hierarchy, use 2-3 typeface sizes to indicate to users
> what pieces of content are most important or at the highest level in the page's
> mini information architecture.

**Documented fact.** NN/g also gives the same number for scale as a principle:
"Using relative size to signal importance and rank in a composition."

**No source found** that states a maximum count for the number of type styles in a
dense professional console. Material 3 refuses the question on purpose: "No single
product will use all the styles." Carbon ships 12 productive styles. Apple ships
11 text styles. The count of the system is not the count of the screen.

**Inference.** The usable rule for a console is a count of roles, not a count of
sizes. A console needs five roles at most: page title, section title, row title,
body value, and label. NN/g's number three applies to the _sizes_ on one screen at
one time. Five roles may still use three sizes, with weight and colour for the
rest.

### The test for hierarchy

1. Blur the screenshot by 6 pixels. The page title, the section titles, and the row
   titles must still separate.
2. List every font size in the computed style. The count must be 3 or fewer.
3. List every font family. The count must be 1, or 2 with one mono family for
   code.
4. Read the screen in greyscale. The hierarchy must survive with no colour.

---

## 4. Proportion and the scale

A scale turns arbitrary numbers into a system. Four sources give four scales.

### The modular scale

**Documented fact.** Robert Bringhurst, quoted by Tim Brown in _More Meaningful
Typography_, A List Apart, 2011
(<https://alistapart.com/article/more-meaningful-typography/>):

> A modular scale, like a musical scale, is a prearranged set of harmonious
> proportions.

**Documented fact.** Brown states the rule and the reason:

> A modular scale is a sequence of numbers that relate to one another in a
> meaningful way. Using the golden ratio, for example, we can produce values for a
> modular scale by multiplying by 1.618 to arrive at the next highest number, or
> dividing by 1.618 to arrive at the next number down.

> By using culturally relevant, historically pleasing ratios to create modular
> scales and basing the measurements in our compositions on values from those
> scales, we can achieve a visual harmony not found in layouts that use arbitrary,
> conventional, or easily divisible numbers.

### The ratio between steps

**Documented fact.** Brown describes a single ratio, plus a second "important"
number. Two strands give a double-stranded scale:

> It has options for creating double-stranded modular scales like the one below,
> which require at least two starting ratios or two starting numbers to generate
> what amounts to two separate modular scales mashed together in sequence.
> Double-stranded scales tend to provide more measurement options.

**Source-backed tradeoff.** The systems disagree with the pure modular scale.
Material 3 and Carbon use irregular steps with many small stops. Carbon adds 20,
28, 42, and 54 to the sequence. A single ratio of 1.125 gives 14, 16, 18, 20, 23.
A single ratio of 1.25 gives 12, 15, 19, 23, 29. Neither matches the Carbon
productive set. The systems tune the scale for a UI job. Brown tunes the scale for
harmony.

**Inference.** For a console, use one ratio for the type steps and one small-step
scale for space. Do not mix three ratios. A second strand is allowed when the type
and the space need different bases. Record the base and the ratio in the token
file.

### The spacing scale

**Material 3.** Documented fact (<https://m3.material.io/m3/pages/spacing/overview>):

> The spacing system is measured on an 8dp scale, where space100 = 8dp.

> Spacing units follow an 8dp scale. Rather than defining every value, Material
> only defines the most recommended spacing unit values on the scale.

The page shows the working range 2, 4, 6, 8 at the small end and 48, 56, 64, 72 at
the large end.

**Carbon.** Documented fact
(<https://carbondesignsystem.com/elements/spacing/overview/>):

> The Carbon spacing scale complements the 2x Grid and typography scale by using
> multiples of two, four, and eight.

| Token         | px  | Token         | px  |
| ------------- | --- | ------------- | --- |
| `$spacing-01` | 2   | `$spacing-07` | 32  |
| `$spacing-02` | 4   | `$spacing-08` | 40  |
| `$spacing-03` | 8   | `$spacing-09` | 48  |
| `$spacing-04` | 12  | `$spacing-10` | 64  |
| `$spacing-05` | 16  | `$spacing-11` | 80  |
| `$spacing-06` | 24  | `$spacing-12` | 96  |

Carbon adds the enforcement rule:

> There are always exceptions to the rule, but deviating from the spacing scales
> should be avoided whenever possible.

**Polaris.** Documented fact
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/layout/layout-tokens.mdx>):

> Each is simply named by declaring the token group and then the percentage
> multiplier of our base value of 4px. Therefore, space-100 is equal to 4px while
> space-400 equals 16px.

**The 8-point grid.** Documented fact (<https://spec.fm/specifics/8-pt-grid>):

> Use multiples of 8 to define dimensions, padding, and margin of both block and
> inline elements.

**Line length.** Documented fact. Butterick's _Practical Typography_
(<https://practicaltypography.com/line-length.html>):

> Aim for an average line length of 45-90 characters, including spaces.

> The major flaw in many responsive web layouts? Insufficient attention to line
> length.

**Tool record.** `typescale.com` is a calculator for a modular scale
(<https://typescale.com/>). It is a tool, not a law. Use it to test a ratio. Do not
copy its output without a review.

### The tests for proportion

1. List every gap in the computed style. Each gap must be a member of the spacing
   scale. A value of 13px, 18px, or 22px fails.
2. Check the ratios between adjacent type steps. The ratio must be stable inside
   one role group.
3. Measure a text block. The line must hold 45 to 90 characters.
4. Count the scales. One type scale and one space scale per surface. A third scale
   is a defect.

---

## 5. Balance, symmetry, and visual weight

**Documented fact.** NN/g, _5 Principles of Visual Design in UX_
(<https://www.nngroup.com/articles/principles-visual-design/>):

> The principle of balance: A satisfying arrangement or proportion of design
> elements. Balance occurs when there is an equally distributed (but not
> necessarily symmetrical) amount of visual signal on both sides of an imaginary
> axis going through the middle of the screen.

> Asymmetry is dynamic and engaging. It creates a sense of energy and movement.
> Symmetry is quiet and static. Radial balance will always lead the eye to the
> center of the composition.

> In a balanced design, no one area draws your eye so much that you can't see the
> other areas (even though some elements might carry more visual weight and be
> focal points).

**Documented fact.** A layout can also fail by balance. NN/g: "The area taken by
the design element matters when creating balance, not just the number of
elements."

**Documented fact.** Polaris ties vertical alignment to the same feeling
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/typography/using-type.mdx>):

> Top aligning elements that are presented in-line, but have varying bounding box
> sizes, can create a feeling of a broken UI.

**Documented fact.** NN/g on symmetry and order, through IxDF
(<https://www.interaction-design.org/literature/topics/gestalt-principles>):

> Humans tend to see visual elements as grouped when they are arranged
> symmetrically.

**UNVERIFIED.** Josef Müller-Brockmann, _Grid Systems in Graphic Design_. The book
states that the grid is an aid and not a guarantee. This file could not reach a
primary copy. Do not cite this quote without a check of the book.

**Inference.** A work tool is not a poster. Asymmetric balance is correct for a
console, because the work happens in one main region. The rule for a console is
simple: the left edge holds a stable rail, and the main region holds the work.
Symmetry applies inside a row and inside a control group.

**Source-backed tradeoff.** A single narrow content column looks calm and wastes
space on a wide screen. A full-width layout uses the screen and loses the reading
line. The resolution is a maximum measure for text, with full-width data regions.
Butterick's 45-to-90 character rule sets the text measure. The data region is not
text.

### The tests for balance

1. Draw a vertical line at the centre. The two halves must not differ by more than
   a factor of two in visual weight, unless one half is the work area.
2. Blur the screen. The work area must be the heaviest region.
3. Find every inline pair of icon and text. The pair must sit on a shared centre
   line, or on a shared baseline. A mixed pair fails.
4. Check the empty state and the full state. The screen must stay balanced when the
   content count changes.

---

## 6. Rhythm and the vertical grid

Rhythm is the repeat of the space steps. A screen feels "aligned" when the space
steps repeat. A screen feels "off" when one value sits outside the scale.

**Documented fact.** Polaris
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/typography/using-type.mdx>):

> Type in the admin is aligned on the 4px grid. For this reason, all line heights
> are multiples of the 4px base unit.

**Documented fact.** The 8-point grid guide pairs a coarse grid with a fine grid
(<https://spec.fm/specifics/8-pt-grid>):

> I like to combine my 8pt UI grid with a 4pt baseline grid. This pairing keeps the
> math simple and clean while providing sufficient options to fit a variety of text
> styles.

> By positioning the baseline of each line of text onto evenly-spaced lines, you
> can easily bring all of your UI elements into a harmonious vertical rhythm.

**Documented fact.** Material 3 uses 8dp as the base unit, with small values at 2,
4, 6, and 8 (<https://m3.material.io/m3/pages/spacing/overview>).

**Documented fact.** Carbon uses multiples of two, four, and eight, and forbids
values outside the scale
(<https://carbondesignsystem.com/elements/spacing/overview/>):

> Every part of a UI should be intentional including the empty space between
> elements. The amount of space between items creates relationships and
> hierarchy.

> Elements that have more spacing around them tend to be perceived as higher in
> importance than elements that have less space around them.

> Sections of a UI are allowed to be dense, but the whole page should not be
> crowded; there should be white space to let the user's eye rest.

**Inference.** A 4px base grid with 8px as the normal step fits a console. The 4px
step handles the inside of a control. The 8px step handles the space between
controls. The 24px and 32px steps separate the sections.

### The tests for rhythm

1. Set the browser zoom to 100 per cent. Inspect every margin, padding, and gap.
   Each value must divide by 4.
2. Check every line-height. Each value must divide by 4.
3. Draw a horizontal line every 8 pixels across the screenshot. The rows of the
   list must repeat on the same offsets.
4. Look at the space above a heading and below it. The space above must be larger,
   or equal. A heading that sits closer to the previous block fails.
5. Resize the window from 1440 to 1024 to 390 pixels. The rhythm must hold at each
   step.

---

## 7. Colour harmony and restraint

Colour is the most expensive signal on a screen. It costs attention and it carries
meaning. A console needs a small role set and a strict status rule.

### The role model

**Documented fact.** Carbon uses a layering model with a fixed count. The base
layer is the page. Three more layers stack above it
(<https://carbondesignsystem.com/elements/color/usage/>):

> There are four layers within a theme: base layer, layer 01, layer 02, and layer 03. Layers stack one on top of the other in a set order.

> Each step in UI color (excluding interaction colors) is another layer and will
> require the use of a different set of layering tokens.

**Documented fact.** Polaris separates background from surface, and gives surface a
hierarchy
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/colors/using-color.mdx>):

> Background colors are used as the baseline of all UI in the admin.

> Surface colors are the most versatile in the color system. Surface is the
> background color for elements with the highest level of prominence, like a card
> or a banner. Many elements can sit on top of a surface to create complex
> components and patterns.

> Surface colors also come with various hierarchical levels and can be used to
> increase or decrease emphasis on specific areas of the UI.

Polaris also forbids a mix. Documented fact: "Avoid jarring color combinations when
nesting components."

**UNVERIFIED.** Material 3 colour roles. The page
<https://m3.material.io/styles/color/roles> is an Angular shell. Three routes
failed: a plain `curl`, `r.jina.ai`, and the token page. The Material 3 role names
(`primary`, `on-primary`, `primary-container`, `surface`, `surface-container`) are
well known, but this file could not verify the text. Do not cite Material 3 for
this rule until a render succeeds.

**Source-backed tradeoff.** More layers give more separation and more risk. Carbon
stops at four layers and warns that a fifth is out of the model. Polaris warns
against mixing surface roles inside one component. The console rule follows from
both: one background, one surface, one raised surface. A fourth surface needs a
reason.

### The 60-30-10 rule

**Documented fact.** ColourFYI states the rule and its origin
(<https://colorfyi.com/blog/color-proportion-rule/>):

> Interior designers have followed a simple ratio for decades: 60% dominant color,
> 30% secondary color, 10% accent color.

> Three colors at 60-30-10 create a clear hierarchy where the eye moves naturally
> from dominant to secondary to accent.

**Source-backed tradeoff.** No primary standard owns the 60-30-10 rule. It is
practitioner knowledge, not a specification. The measured part is smaller than the
rule suggests. The source itself states that the proportions describe "approximate
visual weight, which is a function of both area and intensity." A small saturated
accent can balance a large muted field.

**Inference.** Use 60-30-10 as a check, not as a measurement. In a console, the
neutral field takes about 90 per cent, because a status colour must not compete
with the work.

### The status-colour rule

**Documented fact.** W3C, WCAG 2.2, Success Criterion 1.4.1
(<https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html>):

> Color is not used as the only visual means of conveying information, indicating
> an action, prompting a response, or distinguishing a visual element.

The W3C intent note adds: "This should not in any way discourage the use of color
on a page, or even color coding if it is complemented by other visual indication."

**Documented fact.** Apple, Human Interface Guidelines, Colour
(<https://developer.apple.com/design/human-interface-guidelines/color>):

> Avoid relying solely on color to differentiate between objects, indicate
> interactivity, or communicate essential information. When you use color to
> convey information, be sure to provide the same information in alternative ways
> so people with color blindness or other visual disabilities can understand it.

> Avoid using the same color to mean different things. Use color consistently
> throughout your interface, especially when you use it to help communicate
> information like status or interactivity.

> Avoid using similar colors in control labels if your app has a colorful
> background. ... too much color can be overwhelming and make control labels more
> difficult to read.

**Documented fact.** Material 3 gives the same rule for interaction states
(<https://m3.material.io/foundations/interaction/states>):

> States have two visual indicators to ensure accessibility

**Documented fact.** Polaris limits the palette of an illustration
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/illustrations.mdx>):

> The palette is limited: individual illustrations use whites, grays, and two or
> three colors each. Colors are also less saturated than the surrounding UI, so
> they don't distract from core interactions.

**Documented fact.** NN/g gives the general rule for a surface
(<https://www.nngroup.com/articles/aesthetic-minimalist-design/>):

> Avoid multipurpose visual cues (e.g., the same visual treatment for links and
> unclickable text) and don't overdo font/color variation to ensure that your
> information is communicated clearly. Defer to standards and conventions, and
> communicate; don't decorate.

**Inference.** How much status colour may a screen carry? Nil at rest. A healthy
row shows no status colour. Status colour appears only on the item that needs
action. A screen with five coloured badges in a list of five rows has no status
signal at all.

### The tests for colour

1. Read the screen in greyscale. Every status must still read from the shape or the
   text.
2. List every saturated colour. Each one must map to one status or to the single
   primary action.
3. Find a screen where the same colour means two things. That is a defect.
4. Count the coloured elements in the viewport. The primary action is one. Status
   items are one per item that needs attention.
5. Check a status chip. It must contain a word or a shape, not only a colour.
6. Check the token count. One background, one surface, one raised surface, and the
   status set.

---

## 8. The reasons a screen feels overwhelming

Five sources explain the feeling. Each one gives a number or a limit. Then four
other sources say the opposite for a professional tool. Both groups are right. The
task is to pick the group for each screen.

### The limits

**Hick's law.** Documented fact. Hick and Hyman measured the link in 1952. IxDF
states the law and the formula
(<https://www.interaction-design.org/literature/article/hick-s-law-making-the-choice-easier-for-users>):

> Hick's Law is a simple idea that says that the more choices you present your
> users with, the longer it will take them to reach a decision.

> **RT = a + b log2 (n)**

The reaction time grows with the logarithm of the number of choices. The number
grows fast at the start and slows down. IxDF also states the boundary: "The
objective of Hick's Law is to try and simplify the decision-making process, not
eliminate that process entirely."

**Untrusted source note.** The IxDF article is a secondary source. The primary
paper is Hick, W. E. (1952), "On the rate of gain of information", Quarterly
Journal of Experimental Psychology 4(1), 11-26. **UNVERIFIED:** this file could not
read the primary paper.

**Miller's law.** Documented fact. Miller, _The Magical Number Seven, Plus or Minus
Two_, Psychological Review 63, 81-97, 1956
(<https://psychclassics.yorku.ca/Miller/>):

> On the basis of the present evidence it seems safe to say that we possess a
> finite and rather small capacity for making such unidimensional judgments and
> that this capacity does not vary a great deal from one simple sensory attribute
> to another.

**The criticism of Miller.** Documented fact. Miller's number does not apply to a
menu. NN/g states the correction
(<https://www.nngroup.com/articles/short-term-memory-and-web-usability/>):

> It's a common misconception that limited short-term memory implies that menus
> should be similarly limited to 7 items. It's fine to have longer menus (if
> needed), because users don't have to memorize the full list of menu items.

> Short-term memory famously holds only about 7 chunks of information, and these
> fade from your brain in about 20 seconds.

**UNVERIFIED.** Cowan, N. (2001), "The magical number 4 in short-term memory",
Behavioral and Brain Sciences 24(1), 87-114. The PDF route returned a login page.
The commonly quoted figure is about four chunks. Do not cite the number without a
fresh check.

**Cognitive load theory.** Documented fact. Sweller, _Cognitive Load During Problem
Solving: Effects on Learning_, Cognitive Science 12(2), 257-285, 1988
(<https://andymatuschak.org/files/papers/Sweller%20-%201988%20-%20Cognitive%20load%20during%20problem%20solving.pdf>):

> There are two related mechanisms which may be particularly important when
> considering learning and problem solving: selective attention and limited
> cognitive processing capacity.

> One price paid for this efficiency may be a heavy use of limited
> cognitive-processing capacity.

**Choice overload.** Documented fact. Iyengar and Lepper, _When Choice is
Demotivating_, Journal of Personality and Social Psychology 79(6), 995-1006, 2000
(<https://faculty.washington.edu/jdb/345/345%20Articles/Iyengar%20%26%20Lepper%20(2000).pdf>):

> 30% (31) of the consumers in the limited-choice condition subsequently purchased
> a jar of Wilkin & Sons jam; in contrast, only 3% (4) of the consumers in the
> extensive-choice condition did so.

The limited condition showed 6 jams. The extensive condition showed 24 jams. More
choice gave less purchase.

**NN/g on too many choices.** Documented fact
(<https://www.nngroup.com/articles/simplicity-vs-choice/>):

> As the number of choices increases, so does the effort required to collect
> information and make good decisions.

> In the soda machine example, time on task bloated by over 500%.

**Progressive disclosure.** Documented fact. NN/g, 2006
(<https://www.nngroup.com/articles/progressive-disclosure/>):

> Initially, show users only a few of the most important options.

> Offer a larger set of specialized options upon request.

> In practice, designs that go beyond 2 disclosure levels typically have low
> usability because users often get lost when moving between the levels.

**Inference.** Two disclosure levels is the practical ceiling. A console uses the
list as level one and the detail panel as level two. A third level must be a full
page, not another layer.

### The counter-position: dense tools are correct

**Documented fact.** NN/g, _8 Design Guidelines for Complex Applications_
(<https://www.nngroup.com/articles/complex-application-design/>). Guideline 6 is
named "Reduce Clutter Without Reducing Capability":

> Additionally, complex applications must often support both novice and expert
> users at the same time, and expert users may need advanced features that
> infrequent or novice users rarely access.

> Help users manage the choice, feature and function overload prevalent within
> complex applications by minimizing the appearance of clutter within the interface
> without reducing the capability of the application.

NN/g also states that these applications serve "highly trained users in
specialized domains" and hold "large underlying data sets".

**Documented fact.** NN/g, _Novice vs. Expert Users_
(<https://www.nngroup.com/articles/novice-vs-expert-users/>):

> It is time to take expert user performance more seriously.

> Traditional tricks from the GUI world may be revised on the Web: for example,
> shortcuts for the experienced user that are invisible or downplayed for the
> novice user.

**Documented fact.** Tufte, _The Visual Display of Quantitative Information_, 1983,
through InfoVis:Wiki (<https://infovis-wiki.net/wiki/Data-Ink_Ratio>):

> Above all else show the data.

> A large share of ink on a graphic should present data-information, the ink
> changing as the data change. Data-ink is the non-erasable core of a graphic, the
> non-redundant ink arranged in response to variation in the numbers represented.

**Documented fact.** NN/g, _Aesthetic and Minimalist Design_
(<https://www.nngroup.com/articles/aesthetic-minimalist-design/>):

> Minimalist visual design ... does not always satisfy this heuristic by default
> (and is often guilty of removing necessary elements).

> Having too few elements would inhibit utility and usability with the absence of
> necessary elements, while too many elements will obscure those necessary
> elements.

**Documented fact.** Polaris sets density as the default, not the exception
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/layout/density.mdx>):

> The admin is high density by default, but the level of density can range
> depending on the merchant's task.

**Documented fact.** Material 3 states the purpose of density
(<https://m3.material.io/foundations/layout/grids-spacing>):

> Density helps people see and compare more information in data-heavy views.

**Source-backed tradeoff.** Hick, Miller, and the jam study measure a _choice_.
The counter-position measures a _task_. A professional tool shows many facts and
few decisions. The resolution is to count decisions, not pixels. A dense screen
with one clear next action is easy. A sparse screen with six equal buttons is hard.

**Inference.** The console rule: density is allowed in the _list_, because the list
serves comparison. The list carries few verbs. The screen carries one primary
verb. Progressive disclosure moves the configuration, not the work.

### The tests for the feeling of overload

1. Count the decisions on the first screen. The count must be one primary action.
2. Count the buttons of equal weight. The count must be one.
3. Count the disclosure levels from the first screen to the deepest task. The count
   must be 2, or the third level must be a full page.
4. Ask five users to name the next action in 5 seconds. Four or more must agree.
5. Check the list row. The row must offer one main action, and no more than one
   secondary action.

---

## 9. What makes an interface feel FINISHED

Finished is not decoration. Finished is the presence of the states that a
prototype omits.

**Documented fact.** NN/g, _The Aesthetic-Usability Effect_
(<https://www.nngroup.com/articles/aesthetic-usability-effect/>):

> The aesthetic-usability effect refers to users' tendency to perceive attractive
> products as more usable. People tend to believe that things that look better
> will work better — even if they aren't actually more effective or efficient.

> When users have a positive emotional response to visual design, it makes them
> more tolerant of minor usability issues.

The effect has a limit. NN/g states: "A pretty design can make users forgiving of
minor usability problems, but not of large ones."

**Documented fact.** NN/g, heuristic 4, consistency and standards
(<https://www.nngroup.com/articles/consistency-and-standards/>):

> Users should not have to wonder whether different words, situations, or actions
> mean the same thing. Follow platform and industry conventions.

> Internal consistency relates to consistency within a product or a family of
> products.

**Documented fact.** NN/g, _Designing Empty States in Complex Applications_
(<https://www.nngroup.com/articles/empty-state-interface-design/>):

> Totally empty states cause confusion about how and whether the system is
> working.

> Empty states that are intentionally designed — not left as an afterthought — can
> be used to: Communicate system status to the user. Help users discover unused
> features and increase learnability of the application. Provide direct pathways
> for getting started with key tasks.

NN/g also names the worst case: a state that says "No records" before the data
loads. Documented fact: "Inaccurate system-status messages for empty states are
particularly harmful."

**Documented fact.** Polaris, interaction states
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/interaction-states.mdx>):

> Successful interaction feedback is informative, not decorative. Avoid elaborate
> transitions that create visual noise or intense color changes.

> Consistent treatments for interaction feedback create recognizable patterns.

**Documented fact.** Material 3, states
(<https://m3.material.io/foundations/interaction/states>):

> States show the interaction status of a component or UI element.

> States can be combined, such as selection and hover.

> Apply states consistently across components.

**UNVERIFIED.** The "last 10 per cent" idea is common in practitioner writing. This
file found no primary source that defines it. Treat it as a phrase, not a law.

### What a finished product UI has that a prototype does not

Each line is a checkable item. A prototype normally misses most of them.

1. **A default state.** The screen works with no filter, no selection, and no data.
2. **An empty state.** The screen explains the cause and gives one action.
3. **A loading state.** The screen shows progress in the shape of the coming
   content. It does not show "No records".
4. **An error state.** The screen names the failure and gives a retry.
5. **A partial state.** The screen handles a missing balance, a missing policy, and
   a stale value.
6. **A hover state, a focus state, an active state, a selected state, and a
   disabled state.** Each one looks deliberate. None relies on colour alone.
7. **A keyboard path.** Tab order follows the reading order. Enter and Escape work
   on every dialog.
8. **A long-string case.** The longest real name does not break the row.
9. **A large-number case.** 1,250 items do not break the layout.
10. **A small-window case.** The screen holds at 1024 and at 390 pixels.
11. **A consistent word set.** The product uses one word for one meaning.
12. **A consistent control set.** One primary button style, one secondary style,
    one destructive style.
13. **A documented token set.** The type, space, and colour values come from
    tokens, not from a literal.
14. **A stated consequence.** A destructive action names the result.
15. **A false promise is absent.** A toast never offers a reversal that the system
    cannot perform.

### The tests for a finished screen

1. Force the empty state. The screen must explain the cause and offer one action.
2. Force the loading state. The screen must not claim a fact before the data
   arrives.
3. Force the error state. The screen must name the failure.
4. Tab through the screen. Focus must be visible at each stop.
5. Type the longest name in the data set. The row must hold.
6. Check the disabled state. It must read as disabled, not as a missing control.

---

## 10. "Inviting but practical"

A tool can feel warm. Warmth comes from the words, the empty states, and the
illustration policy. Warmth must not displace information.

### The sources for warmth

**Documented fact.** Shopify Polaris, content fundamentals
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/content/fundamentals.mdx>):

> Too much content makes a tool feel cheap and that it's hard to use. Not enough
> leads to confusion and frustration. Great design means finding that sweet spot.

> Write like merchants talk. Don't worry too much about voice and tone, just focus
> on sounding human. Use plain language. Use contractions. Aim for a 7th grade
> reading level.

> Inspire action. Don't overwhelm people with too many choices or too much info
> upfront. Focus on the one thing merchants need to know or do next. Start
> sentences with verbs so they feel like actionable instructions.

Polaris adds a rule for restraint. Documented fact:

> Words are an essential part of the design. Very few interfaces make sense
> without content. But each word and every period adds noise to the experience. So
> weigh every word.

**Documented fact.** NN/g, _The Four Dimensions of Tone of Voice_
(<https://www.nngroup.com/articles/tone-of-voice-dimensions/>):

> There are four primary tone-of-voice dimensions. ... Formal vs. casual ...
> Serious vs. funny ... Respectful vs. irreverent ... Matter-of-fact vs.
> enthusiastic.

> Tone of voice is the way we tell our users how we feel about our message, and it
> will influence how they'll feel about our message, too.

**Documented fact.** NN/g states that tone must hold still. The section "Users
Notice Variations in Tone-of-Voice Dimensions" measures the response to a change
of only one dimension.

**Documented fact.** Polaris, illustrations
(<https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/illustrations.mdx>):

> Illustration adds information. It provides context, adds clarity, or leads to
> the next step.

> Each illustration conveys one thing. The story is easy to understand.

> Inconsistencies lower the overall quality of the experience, and can distract
> merchants or make them feel like they're in the wrong place.

### The counter-position: when warmth hurts

**Documented fact.** NN/g, _Aesthetic and Minimalist Design_
(<https://www.nngroup.com/articles/aesthetic-minimalist-design/>):

> Minimize the "noise" — elements with low informational value such as
> low-resolution, cluttered images, irrelevant information, technical terms with no
> explanation, and anything meant for "decoration" only.

> Every piece of content should have a purpose, including negative space.

**Documented fact.** NN/g, _The Aesthetic-Usability Effect_
(<https://www.nngroup.com/articles/aesthetic-usability-effect/>), gives the cost of
decoration. A study participant first praised a large image, then said:

> I feel like the whole screen being taken by this is pretty awesome once... And
> probably annoying the second time.

NN/g concludes: "Form and function should work together. When products suffer from
severe usability issues, or when functionality is sacrificed for aesthetics, users
tend to lose patience."

**Source-backed tradeoff.** Warmth helps the first impression and costs space on
every repeat visit. The evidence is direct: the same large image pleased a user
once and annoyed the same user later. A console is a repeat-visit tool. Warmth must
live in the words and in the states, not in the layout.

**Inference.** The console rule for warmth: plain words, one illustration per empty
state, no illustration in the work area, and no decorative image above the fold.

### The tests for inviting but practical

1. Read every heading and every button label. Each one must use a plain verb.
2. Find every decoration. Each one must carry information, or it is a defect.
3. Check the tone on an error message and on a success message. The tone must stay
   the same.
4. Check the empty state. It must hold one sentence and one action.
5. Check the reading level of the user-facing copy. The target is grade 7.

## Source list

| Source                                   | URL                                                                                                                                                                        | Route that worked            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| NN/g, Proximity                          | <https://www.nngroup.com/articles/gestalt-proximity/>                                                                                                                      | `r.jina.ai`                  |
| NN/g, Similarity                         | <https://www.nngroup.com/articles/gestalt-similarity/>                                                                                                                     | `r.jina.ai`                  |
| NN/g, Common Region                      | <https://www.nngroup.com/articles/common-region/>                                                                                                                          | `r.jina.ai`                  |
| NN/g, Closure                            | <https://www.nngroup.com/videos/closure-gestalt/>                                                                                                                          | `curl` plus `og:description` |
| NN/g, Figure/Ground                      | <https://www.nngroup.com/videos/figure-ground-gestalt/>                                                                                                                    | `curl` plus `og:description` |
| NN/g, Common Fate                        | <https://www.nngroup.com/videos/common-fate-gestalt/>                                                                                                                      | `curl` plus `og:description` |
| NN/g, Connectedness                      | <https://www.nngroup.com/videos/connectedness-gestalt/>                                                                                                                    | `curl` plus `og:description` |
| NN/g, Continuation                       | <https://www.nngroup.com/videos/continuation-gestalt/>                                                                                                                     | `curl` plus `og:description` |
| NN/g, 5 Principles of Visual Design      | <https://www.nngroup.com/articles/principles-visual-design/>                                                                                                               | `r.jina.ai`                  |
| Wagemans et al. 2012                     | <https://dev.ipol.im/~blusseau/biblio/psychophysics/2012-wagemans--A-century-of-Gestalt-I.pdf>                                                                             | `curl -k` plus `pdftotext`   |
| IxDF, Gestalt Principles                 | <https://www.interaction-design.org/literature/topics/gestalt-principles>                                                                                                  | `r.jina.ai`                  |
| Williams, Non-Designer's Design Book     | <https://www.gossettphd.org/library/ux/williams_nondesignersdesignbook.pdf>                                                                                                | `curl -k` plus `pdftotext`   |
| Material 3, type scale                   | <https://m3.material.io/styles/typography/type-scale-tokens>                                                                                                               | `r.jina.ai`                  |
| AndroidX type tokens                     | <https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/TypeScaleTokens.kt> | GitHub raw                   |
| Apple HIG, typography                    | <https://developer.apple.com/design/human-interface-guidelines/typography>                                                                                                 | HIG JSON                     |
| Carbon, type sets                        | <https://carbondesignsystem.com/elements/typography/type-sets/>                                                                                                            | `r.jina.ai`                  |
| Polaris, font and typescale              | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/typography/font-and-typescale.mdx>                                          | GitHub raw                   |
| A List Apart, More Meaningful Typography | <https://alistapart.com/article/more-meaningful-typography/>                                                                                                               | `r.jina.ai`                  |
| Material 3, spacing                      | <https://m3.material.io/m3/pages/spacing/overview>                                                                                                                         | `r.jina.ai`                  |
| Carbon, spacing                          | <https://carbondesignsystem.com/elements/spacing/overview/>                                                                                                                | `r.jina.ai`                  |
| Polaris, layout tokens                   | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/layout/layout-tokens.mdx>                                                   | GitHub raw                   |
| 8-Point Grid                             | <https://spec.fm/specifics/8-pt-grid>                                                                                                                                      | `r.jina.ai`                  |
| Butterick, line length                   | <https://practicaltypography.com/line-length.html>                                                                                                                         | `r.jina.ai`                  |
| Carbon, colour usage                     | <https://carbondesignsystem.com/elements/color/usage/>                                                                                                                     | `r.jina.ai`                  |
| Polaris, using colour                    | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/colors/using-color.mdx>                                                     | GitHub raw                   |
| Apple HIG, colour                        | <https://developer.apple.com/design/human-interface-guidelines/color>                                                                                                      | `r.jina.ai`                  |
| W3C, WCAG 1.4.1                          | <https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html>                                                                                                            | `r.jina.ai`                  |
| Material 3, states                       | <https://m3.material.io/foundations/interaction/states>                                                                                                                    | `r.jina.ai`                  |
| 60-30-10 rule                            | <https://colorfyi.com/blog/color-proportion-rule/>                                                                                                                         | `r.jina.ai`                  |
| IxDF, Hick's law                         | <https://www.interaction-design.org/literature/article/hick-s-law-making-the-choice-easier-for-users>                                                                      | `r.jina.ai`                  |
| Laws of UX, Hick's law                   | <https://lawsofux.com/hicks-law/>                                                                                                                                          | `r.jina.ai`                  |
| Miller 1956                              | <https://psychclassics.yorku.ca/Miller/>                                                                                                                                   | `r.jina.ai`                  |
| NN/g, short-term memory                  | <https://www.nngroup.com/articles/short-term-memory-and-web-usability/>                                                                                                    | `r.jina.ai`                  |
| Sweller 1988                             | <https://andymatuschak.org/files/papers/Sweller%20-%201988%20-%20Cognitive%20load%20during%20problem%20solving.pdf>                                                        | `curl -k` plus `pdftotext`   |
| Iyengar and Lepper 2000                  | <https://faculty.washington.edu/jdb/345/345%20Articles/Iyengar%20%26%20Lepper%20(2000).pdf>                                                                                | `curl -k` plus `pdftotext`   |
| NN/g, simplicity vs choice               | <https://www.nngroup.com/articles/simplicity-vs-choice/>                                                                                                                   | `r.jina.ai`                  |
| NN/g, progressive disclosure             | <https://www.nngroup.com/articles/progressive-disclosure/>                                                                                                                 | `r.jina.ai`                  |
| NN/g, complex applications               | <https://www.nngroup.com/articles/complex-application-design/>                                                                                                             | `r.jina.ai`                  |
| NN/g, novice vs expert                   | <https://www.nngroup.com/articles/novice-vs-expert-users/>                                                                                                                 | `r.jina.ai`                  |
| Tufte, data-ink                          | <https://infovis-wiki.net/wiki/Data-Ink_Ratio>                                                                                                                             | `r.jina.ai`                  |
| NN/g, aesthetic and minimalist design    | <https://www.nngroup.com/articles/aesthetic-minimalist-design/>                                                                                                            | `r.jina.ai`                  |
| Polaris, density                         | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/layout/density.mdx>                                                         | GitHub raw                   |
| NN/g, aesthetic-usability effect         | <https://www.nngroup.com/articles/aesthetic-usability-effect/>                                                                                                             | `r.jina.ai`                  |
| NN/g, consistency and standards          | <https://www.nngroup.com/articles/consistency-and-standards/>                                                                                                              | `r.jina.ai`                  |
| NN/g, empty states                       | <https://www.nngroup.com/articles/empty-state-interface-design/>                                                                                                           | `r.jina.ai`                  |
| Polaris, interaction states              | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/interaction-states.mdx>                                                     | GitHub raw                   |
| Polaris, illustrations                   | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/design/illustrations.mdx>                                                          | GitHub raw                   |
| Polaris, content fundamentals            | <https://github.com/Shopify/polaris-react-archive/blob/main/polaris.shopify.com/content/content/fundamentals.mdx>                                                          | GitHub raw                   |
| NN/g, tone of voice                      | <https://www.nngroup.com/articles/tone-of-voice-dimensions/>                                                                                                               | `r.jina.ai`                  |

**Blocked sources.**

| Source                         | Attempts                        | Result                            |
| ------------------------------ | ------------------------------- | --------------------------------- |
| Material 3 colour roles        | `curl`, `r.jina.ai`, token page | Angular shell, no content.        |
| Polaris live design site       | `curl`, `r.jina.ai`             | 404, docs moved.                  |
| Cowan 2001                     | `curl -k`, Cambridge Core       | Login page, not a PDF.            |
| Müller-Brockmann, Grid Systems | Search plus PDF                 | No primary copy reached.          |
| Hick 1952 primary paper        | Search                          | No open copy reached.             |
| G2 and Capterra                | Not attempted in this task      | Known IP block, per the doctrine. |

---

## The laws, as a checklist

Apply these tests to a screenshot or to a computed style sheet. Each test has a
pass condition. Each test names the law behind it.

1. **Group gap.** Measure the smallest gap between two groups and the largest gap
   inside one group. The group gap must be at least 2x. (Proximity)
2. **One encoding, one meaning.** List every colour, weight, and shape. Each one
   must map to exactly one meaning. (Similarity)
3. **Boundary reason.** Count the panels and the cards. Each boundary must hold one
   job. (Common region)
4. **Connected group.** Find one group that uses separate borders. A shared
   surface must serve that group. (Uniform connectedness)
5. **Edge count.** Count the distinct left-edge x-positions in the content area.
   The count must be 3 or fewer. (Continuity, Alignment)
6. **Truncation.** Find every truncated value. Each one must have a full form on
   hover, on focus, or in the detail panel. (Closure)
7. **Overlay depth.** Open each overlay. The page behind it must recede.
   (Figure-ground)
8. **Bulk motion.** Select the rows and trigger the bulk action. The selection and
   the action bar must act as one object. (Common fate)
9. **Five-second reading.** Look for 5 seconds. Write the reading. It must match
   the task order. (Prägnanz)
10. **Blur test.** Blur the screenshot by 6 pixels. The groups and the hierarchy
    must survive. (Gestalt, hierarchy)
11. **Two-item contrast.** The two most important items must differ by a clear
    visual step. (Contrast)
12. **Button styles.** Count the button styles. The maximum is 3. (Repetition)
13. **Alignment lines.** Draw the vertical and horizontal lines. Each line must
    touch 2 or more items. (Alignment)
14. **Type count.** Count the distinct font sizes on the screen. The maximum is 3.
    Count the font families. The maximum is 2, with 1 for code. (Hierarchy)
15. **Gap values.** Inspect every margin, padding, and gap. Each value must divide
    by 4. (Proportion, rhythm)
16. **Type steps.** The ratio between adjacent type steps must stay stable inside a
    role group. (Proportion)
17. **Line length.** Measure a text block. The line must hold 45 to 90 characters.
    (Proportion)
18. **Baseline grid.** Draw a line every 4 pixels. Every line of text must sit on
    the grid. (Rhythm)
19. **Vertical rhythm.** Compare the space above a heading and below it. The space
    above must be larger, or equal. (Rhythm)
20. **Balance.** Blur the screen. The work area must be the heaviest region. Find
    every icon-and-text pair. The pair must share a centre line or a baseline.
    (Balance, symmetry)
21. **Greyscale status.** Read the screen in greyscale. Every status must stay
    readable. (Colour, WCAG 1.4.1)
22. **Saturated colour count.** Count the saturated colours. Each one must be one
    status or the single primary action. (Colour restraint)
23. **Surface count.** Count the surfaces. One background, one surface, one raised
    surface. A fourth needs a reason. (Colour roles)
24. **Decision count and depth.** Count the decisions on the first screen. The
    primary action must be one. Count the levels from the first screen to the
    deepest task. The maximum is 2, or the third level is a full page. (Hick's law,
    progressive disclosure)
25. **Density check.** The list may be dense. The row must hold one main action and
    at most one secondary action. (Dense-tool counter-position)
26. **Empty state.** Force the empty state. It must give the cause and one action.
    (Finished state)
27. **Loading truth.** Force the loading state. It must not claim "No records"
    before the data arrives. (Finished state)
28. **Keyboard path.** Tab through the screen. Focus must be visible at each stop.
    (Finished state)
29. **Tone hold.** Compare an error message and a success message. The tone must
    stay the same. (Tone of voice)
30. **Decoration count.** Find every decorative element. Each one must carry
    information, or it is a defect. (Warmth counter-position)
