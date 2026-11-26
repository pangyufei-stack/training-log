# DESIGN.md

> A quiet, precise instrument panel: the numbers and the photos are the only things that glow.

## 1. Visual Theme & Atmosphere

**Style**: Minimal dark (Linear / Vercel lineage)
**Keywords**: near-black, hairline borders, tabular numerals, one accent, dense, calm, exact
**Tone**: a coach's clipboard, serious and legible. NOT a marketing page, NOT neon, NOT gamified
**Feel**: a training log read under gym lighting; nothing competes with the data

**Scene**: Dashboard / data panel (sidebar on desktop, tab row on phones)
**Interaction Tier**: L1 refined static
**Dependencies**: CSS only for motion. Chart.js (vendored) for charts. No scroll libraries.
**Theme**: one fixed dark look for every viewer; no light variant.

## 2. Color Palette & Roles

```css
:root {
  /* Backgrounds */
  --bg: #08090a;              /* page */
  --surface: #0f1011;         /* cards, sidebar, dialogs; also the chart surface */
  --surface-alt: #141516;     /* inputs, inset areas, segmented control track */
  --surface-hover: #191a1b;   /* hovered rows, buttons */

  /* Borders */
  --border: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.16);

  /* Text */
  --text: #f7f8f8;            /* values, headings */
  --text-secondary: #d0d6e0;  /* body */
  --text-tertiary: #8a8f98;   /* labels, metadata, axes */

  /* Accent: interactive things only */
  --accent: #7170ff;
  --accent-hover: #828fff;
  --accent-solid: #5e6ad2;    /* filled primary button */
  --on-accent: #ffffff;

  /* RGB helpers */
  --bg-rgb: 8, 9, 10;
  --accent-rgb: 113, 112, 255;
  --white-rgb: 255, 255, 255;

  /* Semantic (status only, always with an icon and words) */
  --success: #4cc38a;
  --warning: #e3b24a;
  --error: #f08a84;

  /* Data series: fixed order, validated on --surface for colour-blind separation */
  --series-1: #338ced;        /* blue */
  --series-2: #e76624;        /* orange */
  --series-3: #00a888;        /* aqua */
  --series-4: #d28e05;        /* yellow */
  --mark-muted: #62666d;      /* reference marks: goal line, raw daily points */
  --grid: rgba(255, 255, 255, 0.06);
}
```

**Color Rules:**
- Every colour in CSS and in chart code comes from these variables. No hex outside `:root`.
- The accent marks things you can press or the current selection. It never encodes data.
- Data series keep their slot: a filter or missing data never repaints a series.
- Status colours are never used as a series colour, and never appear without a label.

## 3. Typography Rules

**Font Stack:** Inter Variable, self-hosted at `/vendor/inter-latin.woff2` (instead of a Google Fonts
`@import`, so a private health page makes no third-party requests).

```css
font-family: "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
font-feature-settings: "cv01", "ss03";
```

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Page title | Inter | 1.375rem | 590 | 1.25 | -0.02em |
| Card / section title | Inter | 0.9375rem | 590 | 1.3 | -0.01em |
| KPI number | Inter | 2rem | 650 | 1.1 | -0.03em |
| Body | Inter | 0.875rem | 400 | 1.5 | 0 |
| Label / table head | Inter | 0.6875rem | 550 | 1.3 | 0.06em, uppercase |
| Mono (pasted tokens) | ui-monospace | 0.75rem | 400 | 1.4 | 0 |

**Typography Rules:**
- All numbers use `font-variant-numeric: tabular-nums` so columns and counters do not jitter.
- Weight carries hierarchy; size steps stay small (this is a dense panel, not a poster).
- No gradient text, no text shadow (per the text-decoration decision table: dashboard headings stay plain).
- Forbidden: serif display faces, condensed faces, more than one family.

## 4. Component Stylings

All interactive components define default / hover / active / focus-visible / disabled.
Focus is always `outline: 2px solid var(--accent); outline-offset: 2px`.

- **Button (secondary)**: `--surface-alt` fill, `--border`, radius 8px, 590 weight.
  hover: `--surface-hover` + `--border-hover`. active: translateY(1px). disabled: 45% opacity, no pointer.
- **Button (primary)**: `--accent-solid` fill, `--on-accent` text. hover: `--accent`. Same active/disabled.
- **Button (danger)**: secondary shape with `--error` text; hover adds an `--error` border.
- **Nav item**: `--text-tertiary`; hover `--text` on `--surface-hover`; current: `--text`, `--surface-hover`
  fill and a 2px accent marker (left edge in the sidebar, bottom edge in the phone tab row).
- **Segmented control**: `--surface-alt` track, 2px padding; pressed segment `--surface-hover` + `--text`.
- **Card**: `--surface`, 1px `--border`, radius 12px, 16px padding. KPI cards highlight their border on
  hover; they do not lift (lifting hurts scanning in a dense grid).
- **Table**: hairline row dividers, sticky first column, row hover `--surface-hover`, focusable rows.
- **Input / select / textarea**: `--surface-alt`, `--border`, radius 8px; hover `--border-hover`;
  focus accent border + ring `rgba(var(--accent-rgb), .25)`; disabled 45% opacity.
- **Status pill**: `--surface-alt` capsule with icon + words (Connected / Sign in again / Error / Not connected).
- **Tag**: small capsule for photo kind and pose; on photos it sits on `rgba(var(--bg-rgb), .72)`.
- **Photo tile**: 3:4, radius 10px; hover brightens and shows a `--border-hover` ring.
- **Dialog**: `--surface`, radius 14px, backdrop `rgba(var(--bg-rgb), .85)`; fades and scales in from 98%.
- **Toast**: capsule, `--text` on `--surface-hover`, slides up, auto-dismisses.
- **Icons**: inline SVG, 1.75px stroke, `currentColor`. No emoji.

## 5. Layout Principles

- Desktop (>= 960px): fixed 232px sidebar (title, navigation, sync state) + content column, max 1120px.
- Phone / tablet: sticky header with a horizontally scrolling tab row; content full width.
- Spacing scale: 4, 8, 12, 16, 24, 32. Card gap 12px, section gap 16-24px (compact, per dashboard baseline).
- Grids: KPI tiles `auto-fit minmax(160px, 1fr)`; charts `auto-fit minmax(440px, 1fr)`; photos `auto-fill minmax(140px, 1fr)`.

## 6. Depth & Elevation

Depth comes from luminance steps, not drop shadows: `--bg` < `--surface` < `--surface-alt` < `--surface-hover`.

| Level | Use | Treatment |
|-------|-----|-----------|
| 0 | page | `--bg` |
| 1 | cards, sidebar | `--surface` + 1px `--border` |
| 2 | hover, pressed segment | `--surface-hover` + `--border-hover` |
| 3 | dialog, toast | level 1 + `0 24px 64px rgba(var(--bg-rgb), .6)` |

## 7. Animation & Interaction

L1 only. Easing `cubic-bezier(0.16, 1, 0.3, 1)`.

- **Entrance**: each view fades in and rises 6px over 400ms; its cards stagger by 40ms (capped at 8).
- **KPI numbers**: count up from zero once per load, 600ms.
- **Hover / press**: 150ms colour and border transitions; buttons press 1px.
- **Dialog**: 180ms fade + scale from 0.98. **Toast**: 200ms slide up.
- **Charts**: crosshair tooltip on line charts, per-bar tooltip on bars; 300ms draw-in.
- **No scroll reveals, no parallax, no pinned sections**: data must be visible immediately.
- `prefers-reduced-motion: reduce` removes all of the above (durations forced to ~0, count-up skipped, chart animation off).

## 8. Do's and Don'ts

**Do**
- Put the latest value and its change first; charts second; the full table one tab away.
- Label every status with words and an icon.
- Keep a legend on every chart with two or more series.
- Use tabular numerals for every number.
- Keep touch targets at least 44px tall on phones.

**Don't**
- Don't hard-code a hex value outside `:root`.
- Don't use the accent colour for data, or a series colour for a button.
- Don't put two y-axes on one chart; different units get separate charts.
- Don't lift, tilt or glow cards; no gradients, glassmorphism or blur.
- Don't hide data behind scroll-triggered animation.
- Don't use emoji as icons.
- Don't show a photo without its date.
- Don't introduce a second typeface or a light theme.

## 9. Responsive Behavior

| Breakpoint | Layout |
|------------|--------|
| >= 960px | sidebar + content; charts in 2 columns; table fully visible |
| 600-959px | header + tab row; charts 1-2 columns |
| < 600px | single column; KPI tiles 2-up; table scrolls sideways with the date column pinned; dialogs near full width |

- Touch targets >= 44px under 960px (buttons, tabs, segmented control, table rows).
- No horizontal page scroll at 360px; only the table wrapper and the tab row scroll sideways.
- Safe-area insets respected on notched phones.
