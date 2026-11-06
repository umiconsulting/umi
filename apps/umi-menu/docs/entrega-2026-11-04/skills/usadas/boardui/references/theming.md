# BoardUI theming reference

How BoardUI's tokens work, what the semantic families are, and how to rebrand. Everything here lives in the project after `npx boardui@latest init`: tokens in `styles/theme.css`, the type scale in `styles/typography.css`, the Tailwind entry in `styles/globals.css`.

## Architecture

BoardUI is Tailwind CSS v4, CSS-first: there is no `tailwind.config.js`. Tokens are CSS custom properties declared inside `@theme` blocks in `styles/theme.css`, which makes each one a Tailwind utility automatically (`--color-text-primary` becomes `text-text-primary`, `bg-text-primary`, and so on).

Two layers:

1. **Primitives**: raw color ramps (`--color-neutral-50` through `--color-neutral-950`, `--color-blue-*`, `--color-red-*`, ...). Components never reference these directly.
2. **Semantic tokens**: role-named tokens that map onto primitives (`--color-text-primary: var(--color-neutral-950)`). Components use only these. Dark mode re-binds the semantic layer under `.dark { ... }`, so every component flips automatically with zero `dark:` prefixes.

The composite type styles work the same way: each `--text-<style>` in `styles/typography.css` carries size, line-height, letter-spacing, and font-weight together, surfacing as one utility (`text-body-medium`).

## Semantic color families

Use these utilities and nothing else. Never raw palette classes, hex, or oklch literals in component code.

| Family | Utilities | Use for |
| --- | --- | --- |
| Text | `text-text-primary`, `-secondary`, `-tertiary`, `-placeholder`, `-disabled`, `text-text-error-primary`, `text-text-white` | All copy. Primary for headings/labels, secondary for supporting copy, tertiary for hints. |
| Surfaces | `bg-background-full` (page ground), `bg-background-primary-default` / `-hover` / `-active`, `bg-background-secondary-default` / `-hover`, `bg-background-tertiary-default` / `-hover`, `bg-background-quaternary-default` | Page, cards, wells, hover states. Secondary is the subtle gray tray; tertiary/quaternary step darker. |
| Borders | `border-border-button-default` / `-hover` / `-active`, `border-separator-border` (hairlines), `border-border-table`, `border-border-checkbox-*`, `border-border-error-default`, `ring-border-focus-ring` | Card and control outlines, dividers, focus rings. |
| Icons | `text-foreground-icon-primary` through `-quaternary`, `text-foreground-icon-error`, `-disabled` | Icon color steps, strongest to faintest. |
| Charts | `chart-1` through `chart-5` (each with a `-active` variant), `chart-track`, `chart-cursor`, `chart-neutral` | Series colors in chart cards. Recolor a chart by re-mapping these tokens, not by editing chart code. |
| Accent | `accent-50` through `accent-950` | CTAs, selection states, links, focus. The brand ramp. |

## Type scale

Composite utilities, one per style-weight pair. Weights: `-regular`, `-medium`, `-semibold`, `-bold`.

| Style | Size | Role |
| --- | --- | --- |
| `text-display-1` ... `text-display-4` | 56px down to 40px | Marketing hero type |
| `text-large-title-*` | 64px | Oversized landing headers |
| `text-title-1-*` | 24px | Page titles |
| `text-title-2-*` | 20px | Section headings |
| `text-title-3-*` | 18px | Card titles |
| `text-headline-*` | 16px | Emphasized body, lead paragraphs |
| `text-body-*` | 14px | Default UI text, buttons, inputs |
| `text-body-2-*` | 13px | Dense UI text |
| `text-caption-1-*` | 12px | Labels, meta text |
| `text-caption-2-*` | 11px | Smallest annotations |

Typical pairings: `text-title-2-medium text-text-primary` for a section heading, `text-body-regular text-text-secondary` for supporting copy, `text-caption-1-semibold` for small labels. If a style seems missing, check `styles/typography.css` before stacking `text-sm font-medium` by hand: that combination is never correct in a BoardUI project.

## Dark mode

Light is `:root`; dark activates when `.dark` is on `<html>` (declared via `@custom-variant dark` in `styles/globals.css`). Because components only use semantic tokens, they need no `dark:` styling. Wiring a toggle is the consumer's choice (`next-themes` works; the `theme-toggle` component ships ready). Rule of thumb: if you are typing `dark:` followed by a color, stop and pick a better token.

## Rebranding

- **Accent color**: the `--color-accent-*` ramp in `styles/theme.css` aliases a primitive ramp (blue by default). Point the eleven accent steps at another ramp, or paste literal values, and every CTA, link, focus ring, and selection state follows. An exact brand color belongs on `--color-accent-500`: primary buttons start their gradient there (500 to 600), focus rings use it, and the docs' custom color generator puts the picked hex on that stop and builds the other ten around it.
- **Runtime theme switching gotcha**: if you generate accent ramps at runtime (user-picked brand colors), write literal `oklch(...)` values into the CSS custom properties. Do not point them at `var()` references of other tokens; Tailwind's build only preserves what it can see statically.
- **Neutrals and semantics**: adjust the semantic layer, not component code. Example: to soften every card border, change `--color-border-button-default`, and both modes stay consistent if you update the `.dark` binding too.
- **Charts**: re-map `--color-chart-1` through `--color-chart-5` (and `-active`) to restyle every chart card at once.

For the full current token values, read `styles/theme.css` in the project, or ask the BoardUI MCP server's `get_theme` tool for the live stylesheet contents.
