# Data-dense UI patterns for an inventory screen

Date: 2026-09-18
Owner: inventory workspace research
Scope: component and interaction detail for a record set of stock items, stock
levels, count sessions, waste, purchase orders, and vendors.

This file owns the component and interaction rules. The sibling file
`2026-09-18-inventory-ux-principles-and-rbac.md` owns the surface split and the
RBAC rules. Do not duplicate that material here.

---

## Step 0: tool and method

| Question                              | Answer                                                                |
| ------------------------------------- | --------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes. I read the primary design systems. I did not invent rules.       |
| Is it installed here?                 | Yes. `curl` 8.5.0, Node 22.23.2, Python 3.12.3, Playwright 1.63.0.    |
| Can an agent drive it with no prompt? | Yes. `curl` and a headless Chromium run work with no prompt.          |
| What does adoption cost?              | Zero for the research. The rules cost a CSS and component pass.       |
| What is the fallback?                 | `r.jina.ai` text extraction, then the GitHub source of the docs site. |

Tool record:

- **curl 8.5.0** for sites that answer plain HTTP. Source: preinstalled.
- **r.jina.ai** for a JavaScript shell. Source: `docs/agents/tool-and-research-doctrine.md`.
- **Playwright 1.63.0** with Chrome for Testing 152.0.7977.8 for a site that
  needs a real render. Source: same doctrine, section 8.
- **Apple HIG JSON API** at `/tutorials/data/design/human-interface-guidelines/<page>.json`.
  Source: found by inspecting the page. This is rung 1, the vendor API.
- **GitHub raw files** for the Shopify Polaris docs. Source: rung 3, the
  vendor source repository.

### Routes that failed, and the route that worked

| Source                  | Route 1                                                               | Route 2                                                | Route 3 (worked)                                           |
| ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `m3.material.io`        | plain `curl` returned an Angular shell, 62 KB, no content             | `r.jina.ai` hit a Cloudflare challenge on 4 of 5 calls | Playwright headless render of `document.body.innerText`    |
| `developer.apple.com`   | plain `curl` returned a JavaScript shell                              | `r.jina.ai` hit the same Cloudflare challenge          | the vendor JSON API                                        |
| `polaris.shopify.com`   | every URL returned the same 336 KB shell, including a fake `.md` path | `r.jina.ai` refused                                    | `raw.githubusercontent.com/Shopify/polaris/main/.../*.mdx` |
| `atlassian.design`      | `/components/table/usage` returned 404                                | `curl` returned a JavaScript shell                     | Playwright headless render                                 |
| `nngroup.com/articles/` | the index page lists only 26 articles                                 | site search returned nothing                           | `nngroup.com/sitemap.xml`, 1,733 article slugs             |
| `w3.org/WAI/ARIA/apg`   | the first `curl` returned a Cloudflare notice                         | a second `curl` returned the full page                 | `curl` retry                                               |

---

## 1. Table, list, or card, and when to change

**Finding.** A table is the right tool for comparison and analysis. A table is
the wrong tool for a set of records that a person must open and act on. Every
design system that states a rule states that split.

### Material Design 3

Material Design 3 does not publish a data table component. The component list
holds 151 URLs. None of them is a data table. A request for
`components/data-tables/overview` returns "This page cannot be found".

- **Documented fact.** The M3 component index has no data table entry.
  <https://m3.material.io/components>
- **Documented fact.** The M3 selection page lists data tables as a component
  that inherits selection. That is an acknowledgement, not a specification.
  <https://m3.material.io/foundations/interaction/selection>
- **UNVERIFIED.** No M3 row count, column count, or pagination rule exists,
  because no M3 data table page exists.

The density guidance applies to a table all the same. M3 puts that guidance
under layout, not under components:

> "High density layouts are useful when people need to scan, view, or compare a
> lot of information, such as in a data table. Increasing the layout density of
> lists, tables, and long forms makes more content available on-screen."

- **Documented fact.** <https://m3.material.io/foundations/layout/grids-spacing/density>

M3 also gives the two limits that matter for an inventory screen:

> "Don't apply component scaling by default if it would result in a target
> below 48x48 CSS pixels."

> "Don't increase density in UIs that involve focused tasks, such as selecting
> from a menu. It reduces usability by limiting selectable space."

> "Density shouldn't automatically change across breakpoints or orientation
> unless a person changes it."

> "Text size shouldn't change as the container size scales."

- **Documented fact.** Same URL. The component density scale starts at 0 and
  moves to -1, -2, and -3. Each step removes about 4 dp of top and bottom
  padding.
- **Source-backed tradeoff.** M3 wants a dense table and an untouched text
  field. A density switch must therefore act on the row container only. It
  must not act on the type scale.

### Apple Human Interface Guidelines

> "Lists and tables present data in one or more columns of rows."

> "Apps that offer productivity tasks often use a table to represent various
> characteristics or attributes of the data in separate, sortable columns."

- **Documented fact.** <https://developer.apple.com/design/human-interface-guidelines/lists-and-tables>

Apple gives the change rule that a generic table hides:

> "If you have items that vary widely in size, or you need to display a large
> number of images, consider using a collection instead."

The word "collection" is a link in the source. It points to the Apple
collections page: <https://developer.apple.com/design/human-interface-guidelines/collections>

> "If each item consists of a large amount of text, consider alternatives that
> help you avoid displaying over-large table rows. For example, you could list
> item titles only, letting people choose an item to reveal its content in a
> detail view."

> "Alternating colors can help people track row values across columns,
> especially in a wide table."

- **Documented fact.** Same URL, macOS section.

### Shopify Polaris

Polaris gives the clearest split of all the systems. It ships two components
for two jobs.

> "Data tables are used to organize and display all information from a data
> set."

> "Data tables should: ... Minimize clutter by only including values that
> supports the data's purpose. ... Wrap instead of truncate content."

> "Not to be used for an actionable list of items that link to details pages.
> For this functionality, use the resource list component."

- **Documented fact.** <https://polaris.shopify.com/components/tables/data-table>

> "An index table displays a collection of objects of the same type, like
> orders or products. The main job of an index table is to help merchants get
> an at-a-glance of the objects to perform actions or navigate to a full-page
> representation of it."

> "Index tables should: ... Have items that perform an action when clicked.
> ... Paginate when the current list contains more than 50 items."

- **Documented fact.** <https://polaris.shopify.com/components/tables/index-table>

> "A resource list isn't a data table. ... A data table is a form of data
> visualization. It works best to present highly structured data for
> comparison and analysis. If your use case is more about visualizing or
> analyzing data, use the data table component. If your use case is more about
> finding and taking action on objects, use a resource list."

> "Paginate when the current list contains more than 50 items."

- **Documented fact.** <https://polaris.shopify.com/components/lists/resource-list>

### IBM Carbon

> "When not to use: When a more complex display of the data or interactions are
> required. As a replacement for a spreadsheet application."

> "Avoid placing data tables inside data tables or smaller containers where the
> information can feel cramped or needs truncation."

> "Consider giving your data table the most width on the page to help your user
> view dense data."

> "The data table is available in five different row sizes: extra large, large,
> medium, small, extra small."

> "Extra large row heights are only recommended if your data is expected to
> have 2 lines of content in a single row."

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/usage/>

Carbon gives measured row heights. These are the only public numbers in the
finding:

| Size        | Height |
| ----------- | ------ |
| Extra small | 24 px  |
| Small       | 32 px  |
| Medium      | 40 px  |
| Large       | 48 px  |
| Extra large | 64 px  |

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/style/>

### Atlassian Design System

Atlassian retired its Table package. The docs say so on the component page.

> "This package was an experiment, and is currently deprioritized. It is not
> recommended for use in production, and we are not providing support for it at
> this time. Consider using @atlaskit/dynamic-table instead."

- **Documented fact.** <https://atlassian.design/components/table/examples>

> "Use dynamic tables when you need to display data in rows and columns, with
> additional features like drag and drop and loading states that go beyond
> what's available in native HTML tables."

> "Dynamic tables are best used if there is a large volume of information so
> that people can scan, sort and analyse data."

> "Pagination: If there's more than the maximum number of rows for one page,
> the pagination component appears at the end of the table, enabling people to
> navigate between pages."

- **Documented fact.** <https://atlassian.design/components/dynamic-table/usage>

### Nielsen Norman Group

NN/g names the four tasks a table must support. These tasks are the test for
any replacement design.

> "Table design should support four common user tasks: find records that fit
> specific criteria, compare data, view/edit/add a single row's data, and take
> actions on records."

- **Documented fact.** <https://www.nngroup.com/articles/data-tables/>

NN/g also gives the reason a card grid loses on comparison:

> "A card-based presentation of multivariate data requires users to spatially
> reorient each time they move their eyes from one card to another, making
> comparison tasks cognitively effortful and slow."

- **Documented fact.** Same URL.

### Section 1 conclusion

- **Inference.** The inventory record set is an _actionable_ set. A person
  opens a stock item, counts it, wastes it, or orders it. Polaris and NN/g both
  point away from a static table and toward an index or resource list.
- **Inference.** A single generic table cannot serve all six inventory record
  types. Stock levels are a comparison task. Count sessions are a task list.
  Vendors are a directory. The component must follow the task.

---

## 2. Progressive disclosure for a record set

### Master list and detail pane

> "Use the list-detail layout for quickly accessing details of an item from a
> long list of content."

- **Documented fact.** <https://m3.material.io/foundations/layout/canonical-examples/list-detail>

M3 gives an exact breakpoint table. This is the rule to copy:

| Breakpoint  | Width           | Visible panes                   |
| ----------- | --------------- | ------------------------------- |
| Compact     | 0 to 599 dp     | 1 pane                          |
| Medium      | 600 to 839 dp   | 1 pane (recommended) or 2 panes |
| Expanded    | 840+ dp         | 2 panes                         |
| Large       | 1200 to 1599 dp | 2 panes                         |
| Extra-large | 1600+ dp        | 2 panes                         |

- **Documented fact.** Same URL.
- **Inference.** A desktop dashboard sits at Expanded or larger. A second pane
  is therefore the documented default, not an enhancement.

### Detail drawer versus full page

M3 defines the side sheet as a _supplementary_ surface, not a detail page.

> "Standard side sheets are supplementary surfaces used mostly in medium to
> expanded breakpoints, like tablet and desktop. They provide a consistent and
> predictable surface for contextual actions and information."

> "Standard side sheets display content that complements the screen's primary
> content. They remain visible while people interact with primary content."

> "Modal side sheets are preferred in compact breakpoints, like mobile, due to
> limited screen size."

- **Documented fact.** <https://m3.material.io/components/side-sheets/guidelines>

M3 separates the two secondary-pane layouts by data shape:

> "Use the supporting pane layout when the secondary content is only meaningful
> in relation to the primary content. For content with a parent-child
> relationship, use a list-detail layout instead."

> Fixed pane width at Expanded: 360 dp. Below the focus pane at Compact and
> Medium.

- **Documented fact.** <https://m3.material.io/foundations/layout/canonical-examples/supporting-pane>

### When the detail must be a page

Atlassian states the rule for edit content inside a table:

> "For more complex tables where there are multiple types of editable content,
> add an edit link to the more actions button. Use a modal dialog or dedicated
> page for entering content instead of input fields that are directly part of
> the dynamic table."

- **Documented fact.** <https://atlassian.design/components/dynamic-table/usage>

NN/g recommends the nonmodal panel for a single record and names the drawer
failure modes:

> "A nonmodal side panel allows for the full display (and editing) of a single
> record while still allowing the user to view the rest of the table's data."

> "Opening the row as an accordion. ... a downside is that users don't tend to
> clean up after themselves (i.e., close accordions when they are done with
> them) and they may end up with cluttered displays unsuited for the other core
> table tasks."

- **Documented fact.** <https://www.nngroup.com/articles/data-tables/>

NN/g also limits the drawer. A partial screen and a separate window "will cover
some of the table, but still allow users access to the table data".

- **Documented fact.** Same URL.

### Preview without a navigation step

Linear documents a third pattern. The preview opens in place, and the list
stays put.

> "Preview issue or project details without opening them."

> "Press Space to open peek, then use the up and down arrows to move through
> adjacent issues or projects while updating the preview."

> "Press Esc to close peek."

- **Documented fact.** <https://linear.app/docs/peek>
- **Inference.** Peek is the answer to the cost of a detail open and close on
  every record. A count session list is a good candidate.

### Modals

> "Dialogs are purposefully interruptive, so they should be used sparingly. A
> less disruptive alternative is to use a dropdown menu, which provides options
> without interrupting a user's experience."

> "Don't use dialogs for low- or medium-priority information. Instead use a
> snackbar, which can be dismissed or disappear automatically."

- **Documented fact.** <https://m3.material.io/components/dialogs/guidelines>

> "Modal dialog: A dialog that appears on top of the main content and moves the
> system into a special mode requiring user interaction. This dialog disables
> the main content until the user explicitly interacts with the modal dialog."

- **Documented fact.** <https://www.nngroup.com/articles/modal-nonmodal-dialog/>

### Section 2 rule

- **Source-backed tradeoff.** M3 places a side sheet on the _context_ pane.
  Atlassian places multi-field editing on a page or a modal. Both are right for
  different content. The deciding question is the amount of typed input, not
  the importance of the record.
- **Inference.** Use a side sheet for a read or a single action. Use a full page
  for a multi-field form, such as a purchase order or a new vendor.

---

## 3. Filtering, saved views, and search

### Filter chips versus a filter panel

M3 defines the chip variants and the boundary between a chip and a button:

> "Chips help people enter information, make selections, filter content, or
> trigger actions. They're best used to help people accomplish their current
> task faster and easier."

> "Don't display a single chip by itself. Chips should appear in a set."

> "Chip sets can be scrolled horizontally."

> "Use buttons for the final step in a task."

> "Avoid replacing major actions with chips. Actions that progress people to
> the next or previous step should always be displayed as buttons."

- **Documented fact.** <https://m3.material.io/components/chips/guidelines>

Polaris limits the promoted filters and keeps a text field:

> "The filters component should: help reduce merchant effort by promoting the
> filtering categories that are most commonly used; include no more than 2 or 3
> promoted filters; consider small screen sizes...; use children only for
> content that's related or relevant to filtering."

> "The text field should be clearly labeled so it's obvious to merchants what
> they should enter into the field."

> "If all tag pills selected: truncate in the middle."

- **Documented fact.** <https://polaris.shopify.com/components/selection-and-input/filters>

### Filters versus facets

> "Filter means anything that analyzes a set of content and excludes some
> items. Faceted navigation is composed of multiple filters that
> comprehensively describe a set of content."

> "Faceted navigation is thus more flexible and more useful than systems which
> provide only one or two different types of filters, especially for extremely
> large content sets."

- **Documented fact.** <https://www.nngroup.com/articles/filters-vs-facets/>

> "A truly usable faceted search provides filter categories and filter values
> that are appropriate, predictable, free of jargon, and prioritized."

> "If your site is missing a critical filter, your users are likely to notice
> and complain."

- **Documented fact.** <https://www.nngroup.com/articles/filter-categories-values/>

NN/g also states when to apply a filter group and when to apply one value:

> "Intelligent filtering mechanisms recognize when users are still thinking and
> do not refresh the page until the user is done making selections."

- **Documented fact.** <https://www.nngroup.com/articles/applying-filters/>
- **Source-backed tradeoff.** A live filter is faster on a small data set. A
  batch apply is better on a slow query. NN/g says to decide by user intent and
  by site speed.

### Saved views

Polaris is the strongest source here. The tabs are the views.

> "Merchants use the tabs in index tables to: Control which view is visible;
> Edit the applied filters and search terms of a view; Create, rename,
> duplicate, or delete views."

> "The primary action will always be either 'Save' or 'Save as' depending on
> whether the view is mutable, and the secondary action will always be
> 'Cancel'."

- **Documented fact.** <https://polaris.shopify.com/components/selection-and-input/index-filters>

Linear shows the same pattern with a URL as the sharing mechanism:

> "The applied filters are also reflected in the browser URL. You can copy the
> browser address to share the filtered view."

> "If you know the specific name of the property you want to filter, you can
> type that directly and the filter will show up as a choice."

- **Documented fact.** <https://linear.app/docs/filters>

### Search

> "Use search for products with many items to manage, such as files or
> messages."

> "Search bar: Use to search contents in a specific view... Search app bar: Use
> this app bar variant when search is the primary, global function. Search icon
> button: Use when search is a secondary action or not the main focus."

> "Filter chips to narrow down results."

- **Documented fact.** <https://m3.material.io/components/search/guidelines>

Carbon keeps search inside the table toolbar and closed by default:

> "The table toolbar is reserved for global table actions such as table
> settings, complex filters, exporting, or editing table data. Actions in the
> toolbar can use primary, ghost, or icon-only buttons. Include up to five
> actions within the table toolbar."

> "The search is closed by default, and placed below the table title."

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/usage/>

NN/g warns against search-only navigation:

> "In study after study, we see the same thing: most users reach for search,
> but they don't know how to use it."

- **Documented fact.** <https://www.nngroup.com/articles/search-navigation/>
- **Inference.** Search must support a filter path and a browse path. A search
  box alone will not carry an inventory screen.

### Section 3 rule

- **Inference.** Two layers of filtering fit the evidence. A small set of
  promoted filter chips sits on the surface. The full filter panel sits behind
  one button. Saved views turn a filter set into a named tab.

---

## 4. Bulk actions and selection

### The batch action bar

Carbon defines the pattern and the mode rules:

> "Batch actions: Users can perform batch actions on one or more items within a
> table. Once an item from the table is selected, the batch action bar appears
> at the top of the table, presenting a set of possible actions to apply to all
> select items."

> "When batch mode is active, single action icons and overflow menus on the row
> should be disabled."

> "To exit the batch action mode, the user can select the cancel button on the
> far right of the bar or deselect all items."

> "The user can select all rows at once by selecting the checkbox in the column
> header. Checkboxes in the rows have only two states, checked and unchecked.
> However, the check all checkbox in the column header has three states, check,
> unchecked, and indeterminate."

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/usage/>

Carbon measures the bar:

| Bar                     | Height | Paired row size            |
| ----------------------- | ------ | -------------------------- |
| Batch action bar, large | 48 px  | Extra large and large rows |
| Batch action bar, small | 32 px  | Other row sizes            |

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/style/>

### Row actions versus a menu

> "When the overflow menu contains fewer than three options, keep the actions
> inline as icon buttons instead. This approach reduces a click and makes
> available actions visible at a glance."

- **Documented fact.** Same usage URL.

### Selection model

M3 defines selection mode and its exit:

> "To select an item and enter selection mode, long press the item or use a
> shortcut, such as tapping the item's avatar. To select additional items, tap
> each of them."

> "To exit a selection mode, tap each selected item until they're unselected,
> or tap an action on the toolbar."

- **Documented fact.** <https://m3.material.io/foundations/interaction/selection>

Linear documents the keyboard model in full:

> "Once an issue is highlighted, press X shortcut."

> "Hold down Shift after selecting the first issue, then use the up and down
> keys to increase the selected range one issue at a time."

> "Press Esc to clear the selected issues on your list or board view."

> "Common bulk actions will show up at the bottom."

- **Documented fact.** <https://linear.app/docs/select-issues>

### Select all matching

Polaris supports selection across pages and grouped ranges:

> "Allows merchants to select items, perform the action on the selection and
> select resources across pages."

> "With subheaders: An index table with multiple table headers. Use to present
> merchants with resources grouped by a relevant data value to enable faster
> bulk selection."

- **Documented fact.** <https://polaris.shopify.com/components/tables/index-table>

NN/g states the shortcut:

> "If applying the same action to the full data set is a common need, it's a
> convenient shortcut to have a single-click option to Select All."

- **Documented fact.** <https://www.nngroup.com/articles/data-tables/>

### The cost of a destructive bulk action

> "Use a confirmation dialog before committing to actions with serious
> consequences, such as destroying users' work or costing large amounts of
> money. In particular, consider a confirmation dialog before actions that
> cannot be undone."

> "The problem with the multiple-file confirmation plagues many confirmation
> dialogs: lack of specificity. Saying these 2 items doesn't tell users which
> files will be deleted."

> "Ultimately, though, I think the most important usability considerations in
> confirmation dialogs is to not overuse them and to be sufficiently specific
> that users know what they're agreeing to."

> "Do go to great lengths to provide undo, because some user errors will remain
> despite the even the best of confirmation dialogs."

- **Documented fact.** <https://www.nngroup.com/articles/confirmation-dialog/>

Polaris limits the hiding of selection on a small screen:

> "Hiding bulk actions means a merchant can't select multiple items at once, so
> it should only be used when the bulk actions are not essential to the
> merchant's workflow."

- **Documented fact.** <https://polaris.shopify.com/components/tables/index-table>

### The mode signal

> "Vibrant: A high-emphasis color scheme that draws attention to the controls.
> It can also indicate a temporary change in the page behavior, such as
> entering edit mode."

- **Documented fact.** <https://m3.material.io/components/toolbars/guidelines>

### Section 4 rule

- **Source-backed tradeoff.** Carbon disables row actions during batch mode.
  Linear keeps a command bar available. The two agree on one point: one action
  surface is active at a time.
- **Inference.** A waste action on 40 stock items must show the count, the
  item names, and the total value. A generic "Are you sure?" fails the NN/g
  specificity test.

---

## 5. Numbers, money, and units in a UI

### Alignment

> "Column content types are built into the component props so the following
> alignment rules are followed: Numerical = Right aligned; Textual data = Left
> aligned; Align headers with their related data; Don't center align."

- **Documented fact.** <https://polaris.shopify.com/components/tables/data-table>

### Units and decimals

> "Headers should: ... Include units of measurement symbols so they aren't
> repeated throughout the columns."

> "Column content should: ... Not include units of measurement symbols (put
> those symbols in the headers)."

> "Decimals: Keep decimals consistent. For example, don't use 3 decimals in one
> row and 2 in others."

- **Documented fact.** Same URL.
- **Inference.** So the header reads "On hand (kg)". The cell reads "12.5".

### Tabular figures

> "Digits have different widths by default, so timers, counters and prices
> shift layout as they update. Apply `font-variant-numeric: tabular-nums` to any
> value that changes."

> "`font-feature-settings: "tnum" 1"` is a listed common mistake; use
> `font-variant-numeric: tabular-nums`."

- **Documented fact.** The `better-typography` skill, principle 11 and the
  common-mistakes table. Path: `.agents/skills/design/better-typography/SKILL.md`.
- **UNVERIFIED.** Material 3 does not state a tabular figure rule. The
  `styles/typography/type-scale-tokens` page holds the scale only. A search of
  that page for "tabular" and "numeral" returns no result.

### Size and contrast floors

> "Body text `16px`... UI text can go smaller: `14px` for inputs and menus,
> `13px` for captions, rarely below `12px`. WCAG AA: `4.5:1` contrast for
> regular text, `3:1` for large text."

> "Inputs at 16px on Mobile... Keep input text at `16px` on mobile viewports."

- **Documented fact.** Same skill, principle 16 and principle 15.

### Type tokens inside a table

Carbon publishes the type per table element:

| Element       | Size  | Weight       | Token                 |
| ------------- | ----- | ------------ | --------------------- |
| Table header  | 20 px | Regular 400  | `$heading-03`         |
| Column header | 14 px | SemiBold 600 | `$heading-compact-01` |
| Row text      | 14 px | Regular 400  | `$body-compact-01`    |

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/style/>
- **Inference.** The column header and the cell share one size. Weight and
  color carry the difference. A denser row does not shrink the text.

### Column headers as labels

> "Use nouns or short noun phrases with [the Apple Style Guide], and don't add
> ending punctuation."

Apple links the noun-phrase rule to its own style guide:
<https://support.apple.com/guide/applestyleguide/c-apsgb744e4a3/web>

> "If you don't include a column heading in a single-column table view, use a
> label or a header to help people understand the context."

> "Sometimes an ellipsis in the middle of text can make an item easier to
> distinguish because it preserves both the beginning and the end of the
> content."

- **Documented fact.** <https://developer.apple.com/design/human-interface-guidelines/lists-and-tables>
- **Inference.** A stock item name truncates in the middle, so the size suffix
  stays visible.

### Section 5 rule

- **Inference.** Three number styles are needed, not one. A quantity uses
  `tabular-nums` and right alignment. Money uses `tabular-nums`, right
  alignment, and one currency format. A unit lives in the header, not in the
  cell.

---

## 6. Empty, loading, and error states

### Empty states

Carbon gives the anatomy and the tone rule:

> "Title: A short and concise explanation. Where possible, write this as a
> positive statement. In this example, 'Start by adding data assets' feels more
> positive than 'You don't have any data assets.'"

> "Body: Explain clearly the next action to populate the space. You may also
> explain why the space is empty and include the benefit of taking this step."

> "Primary action, button or link in copy (optional): The primary call to
> action referenced in the body copy above."

> "Empty states always appear in the otherwise empty space, in the context of
> the data that's missing."

> "In situations where there could be multiple empty states showing at once, we
> recommend using a tertiary button for the call to action. This avoids
> scenarios with multiple primary action buttons in the UI."

- **Documented fact.** <https://carbondesignsystem.com/patterns/empty-states-pattern/>

Carbon splits empty states into three types: "No data empty states", "User
action empty states" for no search results, and "Error management empty
states".

- **Documented fact.** Same URL.

NN/g states the purpose:

> "Empty states that are intentionally designed, not left as an afterthought,
> can be used to: Communicate system status to the user; Help users discover
> unused features and increase learnability of the application; Provide direct
> pathways for getting started with key tasks."

> "Totally empty states cause confusion about how and whether the system is
> working."

- **Documented fact.** <https://www.nngroup.com/articles/empty-state-interface-design/>
- **Source-backed tradeoff.** Carbon recommends an optional image in a small
  tile. NN/g warns that a full-page illustration can be skipped. Carbon also
  warns that "more content doesn't necessarily mean it's a better solution".

### Loading

The skeleton-versus-spinner position is documented, with time limits:

> "Spinners or wait animations... are best used when the page takes 2 to 10
> seconds to load. Similarly, skeleton screens should be used with a wait time
> that's under 10 seconds. On the other hand, progress bars are strongly
> recommended for any page that takes longer that 10 seconds to load."

> "A frame display is not recommended because, if users are forced to wait for
> too long, they will assume the page isn't working because the screen is
> mostly blank."

- **Documented fact.** <https://www.nngroup.com/articles/skeleton-screens/>

Polaris settles the default for a list:

> "Spinners are used to notify merchants that their action is being processed.
> For loading states, spinners should only be used for content that can't be
> represented with skeleton loading components, like for data charts."

- **Documented fact.** <https://polaris.shopify.com/components/feedback-indicators/spinner>

> "Skeleton page component should: Be used for pages where all content loads at
> the same time. Give merchants an indication of what the page layout will be
> once loaded."

> "Show page titles that never change for a page."

> "Secondary actions are always represented with skeleton content."

- **Documented fact.** <https://polaris.shopify.com/components/feedback-indicators/skeleton-page>

Carbon narrows the skeleton to containers and names the filter case:

> "Only use skeleton states on container-based components like tiles and
> structured lists or data-based components like data tables and cards."

> "Never represent toast notifications, overflow menus, dropdown items, modals,
> and loaders with skeleton states."

> "When to use progressive loading: A page view is slow to load... A user
> changes filters or facets in a table view."

- **Documented fact.** <https://carbondesignsystem.com/patterns/loading-pattern/>

M3 gives the limit for the small indicator:

> "The loading indicator is designed to show progress that loads in under five
> seconds."

- **Documented fact.** <https://m3.material.io/components/loading-indicator/overview>

### Error states

> "If an error occurs, highlight the affected row or text input with a
> supporting error icon, and help people know how to proceed to resolve the
> error."

- **Documented fact.** <https://atlassian.design/components/dynamic-table/usage>

> "For error states, exception lists should: Either tell merchants how to solve
> the problem or be attached to an item that lets merchants fix the problem."

> "Only surface noteworthy, actionable content, like a high risk order or out
> of stock item. Used sparingly, so that it has more impact and doesn't add
> clutter."

- **Documented fact.** <https://polaris.shopify.com/components/feedback-indicators/exception-list>

### Section 6 rule

- **Inference.** The three states map to three different questions. An empty
  state answers "what do I do next?". A loading state answers "is it working?".
  An error state answers "how do I fix it?".

---

## 7. Keyboard, command palette, and speed

### The command palette

> "VS Code is equally accessible from the keyboard. The most important key
> combination to know is Cmd-Shift-P (Windows, Linux Ctrl+Shift+P), which
> brings up the Command Palette. From here, you have access to all
> functionality within VS Code."

> "Type ? in the input field to get a list of available commands that you can
> run from the Command Palette."

- **Documented fact.** <https://code.visualstudio.com/docs/getstarted/userinterface>

> "The Action Panel is one of Raycast's most powerful features. It lets you
> discover and execute actions on any selected item with just a few keystrokes,
> no mouse needed."

> "Cmd K: Opens the full Action Panel, showing all available actions for the
> selected item. This is the best way to explore what you can do."

> "Raycast is built to be driven entirely from the keyboard."

- **Documented fact.** <https://manual.raycast.com/action-panel> and
  <https://manual.raycast.com/keyboard-shortcuts>

> "Once an issue or set of issues are selected, use Cmd/Ctrl K to open the
> command bar and select the preferred action."

- **Documented fact.** <https://linear.app/docs/select-issues>

### Discoverability of shortcuts

> "Typing ? on GitHub brings up a dialog box that lists the keyboard shortcuts
> available for that page."

> "You can disable character key shortcuts, while still allowing shortcuts that
> use modifier keys, in your accessibility settings."

- **Documented fact.** <https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts>

### Context-sensitive keys

> "VS Code gives you precise control over when your keyboard shortcuts are
> enabled through the optional when clause. If your keyboard shortcut doesn't
> have a when clause, the keyboard shortcut is globally available at all times."

> "Chords (two separate keypress actions) are described by separating the two
> keypresses with a space. For example, Ctrl+K Ctrl+C."

- **Documented fact.** <https://code.visualstudio.com/docs/getstarted/keybindings>
- **Inference.** A single-key shortcut such as Linear's `X` needs a focus
  condition. Without a condition, `X` breaks every text field on the screen.

### Grid navigation and the roving tabindex

> "When using roving tabindex to manage focus in a composite UI component, the
> element that is to be included in the tab sequence has tabindex='0' and all
> other focusable elements contained in the composite have tabindex='-1'."

> "One benefit of using roving tabindex rather than aria-activedescendant to
> manage focus is that the user agent will scroll the newly focused element
> into view."

- **Documented fact.** <https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>

> "A grid widget is a container that enables users to navigate the information
> or interactive elements it contains using directional navigation keys, such
> as arrow keys, Home, and End."

> "Because arrow keys are used to move focus inside of a grid, a grid is both
> easier to build and use if the components it contains do not require the
> arrow keys to operate."

- **Documented fact.** <https://www.w3.org/WAI/ARIA/apg/patterns/grid/>

### Focus visibility

> "Websites need to provide the same feedback for keyboard and mouse users."

> "Offering a Skip Navigation link provides some of that benefit to
> keyboard-only users."

> "This link only becomes available when users tab through the page, so it
> doesn't disturb the visual design for mouse users."

- **Documented fact.** <https://www.nngroup.com/articles/keyboard-accessibility/>

### Section 7 rule

- **Source-backed tradeoff.** A command palette hides features from a new user.
  GitHub answers that cost with the `?` dialog. M3 answers it with a visible
  toolbar. Ship both.

---

## 8. Density without clutter

### The density budget

Carbon builds its scale on multiples of two, four, and eight:

| Token         | px  |
| ------------- | --- |
| `$spacing-01` | 2   |
| `$spacing-02` | 4   |
| `$spacing-03` | 8   |
| `$spacing-04` | 12  |
| `$spacing-05` | 16  |
| `$spacing-06` | 24  |
| `$spacing-07` | 32  |

- **Documented fact.** <https://carbondesignsystem.com/elements/spacing/overview/>

> "The Carbon spacing scale complements the 2x Grid and typography scale by
> using multiples of two, four, and eight."

> "Spacing is the negative area between elements and components."

- **Documented fact.** Same URL.

### Dense versus crowded

> "Help users manage the choice, feature and function overload prevalent within
> complex applications by minimizing the appearance of clutter within the
> interface without reducing the capability of the application."

> "Staged disclosure, where options are shown to the user only when they are
> relevant to the task at hand or the item in focus, is one way to reduce
> clutter."

> "Ease the transition between primary and secondary information and help users
> contextualize primary information by allowing users to access and view
> supplemental information without leaving the primary screen or environment."

- **Documented fact.** <https://www.nngroup.com/articles/complex-application-design/>
- **Inference.** The test is capability, not pixel count. A dense screen keeps
  every capability and removes a step. A crowded screen keeps every element and
  removes a capability.

### Removing noise from a dense screen

Refactoring UI names the tactics that a dense table usually needs. The chapter
list itself is the citable artifact:

> "Start with too much white space."
> "Establish a spacing and sizing system."
> "You don't have to fill the whole screen."
> "Avoid ambiguous spacing."
> "De-emphasize to emphasize."
> "Labels are a last resort."
> "Use fewer borders."

- **Documented fact.** <https://www.refactoringui.com/>, table of contents.
  Chapter page numbers: 56, 60, 65, 83, 39, 41, and 206.
- **Source-backed tradeoff.** Refactoring UI says to start with too much white
  space. M3 says to raise density for a table. Both hold when the row is dense
  and the region around the row is generous.

> "Borders are a great way to distinguish two elements from one another, but
> using too many of them can make your design feel busy and cluttered. Instead,
> try adding a box shadow, using contrasting background colors, or simply
> adding more space between elements."

- **Documented fact.** Same URL.

### The action limit

> "Include up to five actions within the table toolbar. More actions can be
> made available through an overflow menu, combo button, or similar
> components."

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/usage/>

> "Multiple chips should appear together in a set, whereas there should be no
> more than 3 buttons in a single arrangement."

- **Documented fact.** <https://m3.material.io/components/chips/guidelines>

### Zebra striping

> "Alternating colors can help people track row values across columns,
> especially in a wide table."

- **Documented fact.** <https://developer.apple.com/design/human-interface-guidelines/lists-and-tables>

| Element | Property           | Color token     |
| ------- | ------------------ | --------------- |
| Zebra   | `background-color` | `$layer-accent` |

- **Documented fact.** <https://carbondesignsystem.com/components/data-table/style/>
- **Source-backed tradeoff.** Apple and Carbon both allow zebra striping.
  Carbon makes it a variant, not a default. Refactoring UI says to remove
  borders. Use zebra striping on a wide table only, and then remove the row
  divider.

### Section 8 conclusion

- **Inference.** "Dense" is a property of the row. "Calm" is a property of
  everything around the row. A dense table inside a cramped region reads as
  crowded. A dense table inside a generous region reads as professional.

---

## Rules we can implement

1. Give each inventory record type its own surface. Use a comparison table for
   stock levels and an index-style list for stock items, count sessions, waste,
   purchase orders, and vendors. Test: a stock level row is not used to open a
   detail page.
2. Paginate any list that reaches 50 records. Test: no inventory list renders
   more than 50 rows in one request.
3. Cap the saved view tabs at eight. Test: the tab row scrolls and never wraps.
4. Show a row count next to each view name, for example "Low stock (23)".
   Test: the count is present in the DOM.
5. Put a maximum of five actions in the list toolbar. Test: a sixth action
   moves into the overflow menu.
6. Promote no more than three filters as chips. Test: the chip row holds three
   chips or fewer.
7. Keep the full filter set behind one button that opens a side sheet at
   Expanded and a modal side sheet below 840 px. Test: one filter entry point
   exists per breakpoint.
8. Apply filters as a batch. Test: a filter change updates the result set once,
   after the person confirms or after a 300 ms pause.
9. Put the record detail in a second pane at 840 px and wider. Test: the
   breakpoint switches at 840 px, not at a device name.
10. Use a full page, not a drawer, for a purchase order form and a new vendor
    form. Test: the drawer route does not exist for a multi-field form.
11. Right-align every quantity and every money value. Test: computed
    `text-align` is `right` for those cells.
12. Put the unit in the column header. Test: no cell text contains a unit
    symbol.
13. Set `font-variant-numeric: tabular-nums` on every quantity, money value,
    and counter. Test: the CSS property is present on the value element.
14. Hold one decimal count per column. Test: a snapshot of the column shows one
    decimal format.
15. Show a batch action bar at the top of the list when one or more rows are
    selected. Disable the row menus in that state. Test: a snapshot with two
    rows selected hides the row overflow button.
16. Name the affected records and the count in every destructive confirmation.
    Test: the dialog text contains the count and at least one record name.
17. Offer undo for every destructive bulk action. Test: the action writes a
    reversal record that the undo control reads.
18. Give every list these four states, each with a primary action: loading,
    empty, filtered-empty, and error. Test: each state has one button or link,
    and the button text is a verb plus a noun.

---

## Sources reached

| Source               | Page                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Material 3           | density, list-detail, supporting pane, side sheets, dialogs, lists, chips, menus, search, toolbars, loading indicator, selection, breakpoints, structure, type scale                                                                                                                                                                                               |
| Apple HIG            | lists and tables, modality, loading, progress indicators, feedback, searching, layout                                                                                                                                                                                                                                                                              |
| Shopify Polaris      | data table, index table, resource list, filters, index filters, skeleton page, spinner, exception list                                                                                                                                                                                                                                                             |
| IBM Carbon           | data table usage, data table style, data table accessibility, empty-states pattern, loading pattern, spacing                                                                                                                                                                                                                                                       |
| Atlassian            | table, dynamic table, pagination, empty state                                                                                                                                                                                                                                                                                                                      |
| Nielsen Norman Group | data tables, mobile tables, comparison tables, filters vs facets, applying filters, filter categories and values, search vs navigation, progressive disclosure, confirmation dialog, modal and nonmodal dialog, empty states, skeleton screens, progress indicators, keyboard accessibility, complex application design, pagination alternatives, generic commands |
| Linear               | peek, select issues, filters, custom views, search, display options, delete and archive                                                                                                                                                                                                                                                                            |
| VS Code              | command palette in the user interface guide, keybindings                                                                                                                                                                                                                                                                                                           |
| Raycast              | action panel, keyboard shortcuts                                                                                                                                                                                                                                                                                                                                   |
| GitHub               | keyboard shortcuts                                                                                                                                                                                                                                                                                                                                                 |
| W3C                  | ARIA Authoring Practices grid pattern, keyboard interface                                                                                                                                                                                                                                                                                                          |
| Refactoring UI       | product page and chapter list                                                                                                                                                                                                                                                                                                                                      |
| Umi skill            | `better-typography`                                                                                                                                                                                                                                                                                                                                                |

## Sources blocked

| Source                                            | Result                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| `m3.material.io` over plain `curl`                | Angular shell, 62 KB, no content                         |
| `m3.material.io` over `r.jina.ai`                 | Cloudflare challenge on 4 of 5 calls                     |
| `developer.apple.com` over `curl` and `r.jina.ai` | JavaScript shell, then Cloudflare                        |
| `polaris.shopify.com`                             | one shell page for every URL, including fake `.md` paths |
| `atlassian.design/components/table/usage`         | 404                                                      |
| `nngroup.com` site search                         | returned no article links                                |
| `review sites G2 and Capterra`                    | not used in this task                                    |
| `Material 3 data table page`                      | does not exist                                           |
| `m3.material.io` typography, tabular figures      | no rule found                                            |

## Doctrine checklist

1. Tool named: curl, r.jina.ai, Playwright, and the Apple HIG JSON API.
2. Version and source recorded: section "Step 0".
3. Two or more routes tried for each blocked source: section "Routes that failed".
4. Unverified claims marked: yes, three places.
5. No hand-rolled tool where a tool exists: the HTML to text step uses
   `html2text` and the standard library.
6. The research is in a file: this file.
