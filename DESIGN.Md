# Trainer design system — Nordic Minimal

Trainer uses a clean Nordic aesthetic: crisp typography, generous functional
whitespace and high-contrast readable states. Light is the reference surface;
dark is a cool slate counterpart.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| Primary | `#263BAA` | Primary actions, active navigation, focus |
| On primary | `#FFFFFF` | Text and icons on primary |
| Secondary | `#6E839A` | Supporting marks and muted icons |
| Surface | `#F7F8F9` | Canvas and app background |
| On surface | `#101418` | Primary text |
| Surface variant | `#E2E7ED` | Quiet fills, icon plates, hover |
| Border | `#D1D8DE` | Dividers and control outlines |
| Accent | `#8FA8BE` | Atmosphere and secondary emphasis |

Semantic tokens are added only where the product needs them: `--success`
(completed), `--warning` (plan pending), `--danger` (skipped/error) and `--rest`
(rest days). Status is never conveyed by colour alone.

## Typography

- Headline: Inter, `1.75rem`, weight 600.
- Body: Inter, `1rem`, weight 400.
- Weights, reps, volume and PRs use tabular numerals.

## Shape and spacing

- Radii: `4px` small, `8px` medium, `12px` large.
- Spacing: `8px` small, `16px` medium, `32px` large.

## Shell

- Desktop: left rail with Today, Routine, Progress, History and Settings. The
  rail collapses to icons below `1100px`.
- Mobile: bottom tab bar with Today, Routine, Progress and More. More opens a
  bottom sheet containing History, Settings and About.
- One primary action per state. No floating action button.
- Touch targets are at least `44×44px`; mobile chrome respects safe areas.
- Charts are pure accessible SVG with a table fallback.
- `prefers-reduced-motion` is respected throughout.
