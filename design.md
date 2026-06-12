# StudioBlank Design System

Source of truth for all visual rules in Baskets. Source: https://designmd.ai/chef/studioblank-design-system (v1, MIT).

## Overview

StudioBlank is an ultra-minimal design system where whitespace is the primary design feature. Every UI element recedes so the work itself commands attention. No shadows, no border radius, monochromatic palette with weight contrast, pure geometry, strict grids, zero ornamentation.

## Color

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-fg` | `#0A0A0A` | Primary text, actions, inverse surfaces |
| `--color-bg` | `#FAFAFA` | Page background, surfaces |
| `--color-border-subtle` | `#D4D4D8` | Dividers, card borders, hairlines |
| `--color-surface-muted` | `#F4F4F5` | Hover fills, recessed panels |
| `--color-muted` / `--color-info` | `#71717A` | Secondary text, informational notes |
| `--color-success` | `#16A34A` | Success states |
| `--color-warning` | `#CA8A04` | Warnings |
| `--color-error` | `#DC2626` | Validation errors, destructive |

Monochrome only — never introduce additional accent colors.

## Typography

Single family (**Inter**), weight carries all contrast. Mono: **IBM Plex Mono**.

| Style | Size / Weight |
|-------|---------------|
| h1 | 40px Bold |
| h2 | 28px SemiBold |
| h3 | 20px SemiBold |
| h4 | 16px SemiBold |
| body | 16px Light (300) |
| body-sm | 14px Regular |
| caption / labels | 12px Regular-Medium, muted color |
| mono | IBM Plex Mono 13px |

Headings: no uppercase transform, tight tracking (`-0.02em`). No uppercase-letterspaced labels or buttons.

## Structure

- Border radius: 0. Shadows: none. Strictly flat geometry.
- Borders: 1px hairlines. Strong (`#0A0A0A`) only for interactive affordances (buttons, status controls); subtle (`#D4D4D8`) everywhere else.
- Spacing base unit 16px; generous margins (64px+ around primary content). Whitespace over chrome.

## Components

- **Buttons**: secondary = 1px outline; primary = solid `#0A0A0A`; hover inverts (monochrome flip); danger fills `#DC2626` on hover. No transforms, weight 500, sentence case.
- **Cards**: 1px subtle border, 32px padding, title + body.
- **Inputs**: 1px subtle border, focus → border turns `#0A0A0A`. Error → `#DC2626` border.
- **Chips/badges**: 11px mono, 1px subtle border; selected/filter-active = solid black inversion; status colors via text+border color only.
- **Tables**: muted 12px headers, 1px black rule under header, subtle row dividers. No filled header bars.
- **Nav**: quiet text links (muted → fg on hover, semibold when active). No boxes, no dividers between items.

## Motion

Animations ≤ 200ms, `ease`. No stepped/jagged transitions. Respect `prefers-reduced-motion`.

## Don'ts

- No gradients, patterns, or decorative backgrounds
- No additional accent colors
- No rounded corners or shadows
- No text overlaid on images
- No animations exceeding 200ms

## Implementation

All tokens live in `src/app.css` under `[data-theme='studioblank']`. Components consume tokens only — never hardcode colors, radii, or font properties. The legacy RawBlock theme block remains in `app.css` for reference (spec backup: `design.rawblock.md.bak`); switch themes via the `data-theme` attribute in `src/app.html`.
