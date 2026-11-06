# BoardUI motion reference

The micro-animation language of BoardUI: every duration, easing, and effect below is lifted from the shipped components, tuned by hand for feel. When adding motion to a BoardUI project, reuse these exact recipes instead of inventing new timings. If two elements do the same kind of thing, they must move the same way.

## Principles

- **Fast and subtle.** Interface transitions live between 100ms and 300ms. Data entrances may take 360ms to 400ms. Nothing else is slow; the one deliberate exception is the decorative hero chart reveal (1800ms).
- **Entrances are fade + slight scale + small blur.** The signature BoardUI feel: elements do not slide in from a distance, they condense into place from `opacity-0 scale-95 blur-[2px]`.
- **Exits are faster than entrances.** A row grows in over 400ms but collapses out in 225ms. Leaving UI gets out of the way.
- **Press feedback is a color step, not a scale.** Buttons and rows darken one token step on `active:` (e.g. `active:bg-background-primary-active`, `active:border-border-button-active`); colorful surfaces use `active:brightness-95`. BoardUI buttons never shrink on press.
- **ease-out by default.** Almost everything decelerates into its final state. `ease-in` only on exits. Springs (motion/react) are reserved for layout reflow, and they are tight, never bouncy.
- **Reduced motion is honored everywhere.** Every keyframe animation carries an `@media (prefers-reduced-motion: reduce) { animation: none; }` guard. Add one for any animation you create.

## Duration scale

| Duration | Used for |
| --- | --- |
| 100ms | Micro state flips (icon swaps, tab underlines) |
| 150ms | The default: hover color transitions, popover/dropdown/select appear |
| 200ms | Tooltips, switch thumb travel, checkbox tick draw |
| 220ms to 230ms | Label swaps, secondary text motion, exits |
| 300ms | Modal open/close, backdrop fade |
| 360ms to 400ms | Chart bars rising, rows growing in, cell pops |
| 1800ms | The hero chart reveal only; never for interactive UI |

Signature custom easings, in order of frequency:

- `cubic-bezier(0.22, 1, 0.36, 1)`: the BoardUI ease-out for movement with presence (chart bars, larger travels). Strong deceleration, no overshoot.
- `cubic-bezier(0.32, 0.72, 0, 1)`: modal open/close.
- `cubic-bezier(0.65, 0, 0.35, 1)`: the checkbox tick draw.
- Paired asymmetric: `cubic-bezier(0.55, 0, 0.9, 0.35)` for a fast fall out, then `cubic-bezier(0.25, 0.7, 0.35, 1)` for the soft rise in (text flap swap).

## Recipes

### Popovers, dropdowns, selects (the soft blur-in)

React Aria stamps `data-entering` on mount and holds the element during `data-exiting`, so one transition plays both ways:

```tsx
"origin-top rounded-3xl bg-background-secondary-default shadow-dropdown",
"transition duration-150 ease-out",
"data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
"data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
// transform-origin follows placement so the panel grows out of its trigger:
"data-[placement=bottom]:origin-top-left data-[placement=top]:origin-bottom-left",
```

The bare `transition` utility is the right one here: it covers opacity, transform, and filter (blur) together.

### Tooltips

Smaller element, deeper compression: 200ms, `scale-90`, `blur-[4px]`, same entering/exiting pattern as popovers.

### Modals

300ms with `cubic-bezier(0.32, 0.72, 0, 1)`; the panel condenses from `scale-[0.85] opacity-0 blur-[4px]`, the backdrop (`bg-black/70`) cross-fades over the same 300ms with `ease-out`, and the component unmounts only after the exit transition finishes.

```tsx
"transform-gpu transition-[opacity,transform,filter] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-[opacity,transform,filter]",
visible ? "scale-100 opacity-100 blur-0" : "scale-[0.85] opacity-0 blur-[4px]",
```

Performance rule that ships with this recipe: keep blur at 4px or less on large surfaces and add `transform-gpu` + `will-change`. An 8px blur re-filtering a full panel every frame of a scale-down stutters.

### Hover and press

- Hover colors transition at `duration-150 ease` via `transition-colors`; the press state is instant enough at the same duration.
- Press = one token darker: `active:bg-background-primary-active`, `active:border-border-button-active`, ghost buttons `active:bg-button-ghost-active`, colorful brand surfaces `hover:brightness-[1.06] active:brightness-95`.
- Link-style actions keep their resting color on hover (the underline is the hover cue) and only darken on press.

### Toggles and checks

- Switch: thumb `transition-transform duration-200 ease`, track `transition-colors duration-200 ease`.
- Checkbox: the tick is an SVG stroke drawn with a dash animation, `check-draw 200ms cubic-bezier(0.65, 0, 0.35, 1) forwards` (stroke-dashoffset to 0), not a fade.

### Rows and stacked lists

- A row entering grows its height while fading and sliding in: 400ms ease-out. A row leaving collapses in 225ms ease-in. Enter slow, exit fast.
- Reflow of a stack (notifications, task lists) uses motion/react layout springs, tight and non-bouncy:
  - Notification stack: `{ type: "spring", stiffness: 520, damping: 42, mass: 0.7 }` (snappy).
  - Agent progress: `{ type: "spring", stiffness: 260, damping: 30 }` (calmer).

### Swapping text in place

- Label crossfade: outgoing `label-out 220ms ease-out forwards`, incoming `label-in 220ms ease-out` (slide + fade in opposite directions).
- Split-flap swap (agent status lines): outgoing character falls with `flap-fall 150ms cubic-bezier(0.55, 0, 0.9, 0.35) forwards`, incoming rises with `flap-rise 230ms cubic-bezier(0.25, 0.7, 0.35, 1) 150ms both`; the 150ms delay chains them.

### Charts and data

- A changing headline number crossfades with `number-fade 220ms ease-out`, it never counts oddly or jumps.
- Bars rise from the baseline: `bar-rise 360ms cubic-bezier(0.22, 1, 0.36, 1) both`, staggered per bar.
- Grid cells (contributions heatmap) pop in: `cell-pop 380ms ease-out both`, staggered.
- The one long animation: `chart-reveal 1800ms cubic-bezier(0.33, 0, 0.15, 1)` sweeping a chart into view on first paint. Decorative only.

## Checklist before shipping motion

1. Duration on the scale above, easing from the signature set.
2. Entrance = fade + scale + small blur; exit faster than entrance.
3. Press feedback via `active:` color tokens, no scaling.
4. `prefers-reduced-motion` guard on every keyframe animation.
5. Blur capped at 4px on large surfaces, `transform-gpu` when transitioning filter.
6. Same interaction, same motion: reuse an existing recipe before writing a new one.
