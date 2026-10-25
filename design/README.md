# Podium

Podium is a sports app for scores, standings, video and the stories around them. The brand is built on one image: three blocks of different heights and a single dot over the tallest — the top step. Everything in the system ranks something, and the eye always lands on the winner first.

> Everyone's chasing the top step.

## Principles

1. **Rank first.** Every screen has a clear first, second and third. Type, colour and weight follow the podium: one loud thing, a supporting thing, then quiet detail. In a final score the loser goes `ink-muted`; in a table the top three get medals; on a screen there is one primary button.
2. **One dot.** `podium` violet is the winner dot — used sparingly for the single thing that matters most in a region: the primary action, the active tab, the leading stat, the viewer's own team. If two things on a screen are violet, one of them is wrong.
3. **Square shoulders.** The mark is built from square blocks, so the UI is too: `radius-sm` (4px) on controls, `radius-md` (8px) on cards and nothing rounder. Only dots and avatars are round.
4. **Numbers are the hero.** Scores, clocks and points are set in the display face with tabular numerals so they never jitter as they change.
5. **Night game by default.** The primary theme is Arena (dark): sport is watched in the evening, on the sofa, next to a TV. Daylight (light) is a full peer theme for outdoor and print use.

## Colour

Colours are semantic tokens with two themes; Arena (dark) is first and is the fallback.

- **Grounds:** `ground` is the page, `surface` holds cards, tables and the nav bar, `surface-sunken` is a well inside a surface, `surface-hover` is the hover fill.
- **Ink:** `ink` for primary text and the logo's bars; `ink-muted` for metadata, headers and the losing side. Both pass 4.5:1 on every ground in both themes.
- **Lines:** `line` is a decorative hairline; `line-strong` is the 3:1 edge for controls.
- **Accent:** `podium` (+ `podium-strong` hover, `podium-soft` tint, `on-podium` label). `brand-violet` (#7C5CFF) is reserved for the logo and app icon — UI uses `podium`, which is tuned per theme for contrast.
- **Medals:** `gold`, `silver`, `bronze` are fills for ranks 1–3 only, always labelled with `on-medal`. Never use them as text or decoration.
- **Signals:** `live` means a match is in progress and nothing else. `win` marks wins and positive deltas. Losses are `ink-muted`, not red, so results never depend on telling red from green.
- **Team colours** are data supplied with each team (TeamCrest `color` / `ink`), never tokens.

## Type

Two families, both on Google Fonts:

- **Space Grotesk** (`--font-display`, 500/700) — the wordmark's face. Headlines, scores, overlines, table headers, numbers.
- **Inter** (`--font-sans`, 400–700) — everything people read: body copy, labels, buttons, team names.

Styles: `display-xl` 64, `display-l` 44, `headline` 28, `title` 20, `score` 40, `overline` 12 (uppercase, +1.5px), `body-l` 17, `body` 15, `label` 14 semibold, `caption` 12. Use at most one `display-*` per screen. Any number that changes live gets `font-variant-numeric: tabular-nums`.

## Space, shape and depth

- A 4px base: `space-1` 4 → `space-8` 64. Phone gutters `space-4`, between cards `space-3`, between sections `space-6`.
- Radii: `radius-none` for the mark, stat bars and the tab bar; `radius-sm` for controls; `radius-md` for cards; `radius-full` for dots only.
- Controls are `control-md` (44px) by default — the minimum touch target.
- Surfaces separate by colour and hairlines. The only shadow, `shadow-float`, is for sheets, menus and floating elements.

## Iconography

Line icons on a 24px grid with a 2px square-capped stroke and mitred joins — the same square shoulders as the mark. They inherit text colour (`ink-muted` at rest, `ink` when active) and are never violet on their own. `standings` is the podium silhouette. The set lives in Assets › Icons and in the `Icon` component.

## Motion

Quick and factual: 120ms colour transitions, no bounces. The live dot pulses at 1.6s; it and every other loop stop under `prefers-reduced-motion`. Score changes swap instantly — the number is the news.

## Accessibility

- Text meets 4.5:1 and controls, icons and focus rings 3:1 on their stated grounds in both themes (each token's note names them).
- Focus is a 2px `focus-ring` outline with a 2px offset on every interactive element.
- Status is never colour alone: LIVE, FT, W and L are always written.
- Silver on Daylight `surface` is under 3:1 as a shape; the numeral carries the meaning, so it is accepted for RankBadge only.

## Using this system

Load `tokens.css`, then `components/bundle.css` (which imports Inter and Space Grotesk from Google Fonts), React 18 and `components/bundle.js`; components are on `window.Podium`. Set `data-theme="dark"` or `data-theme="light"` on `<html>`. Read each component's guidelines before using it, and see the HomeScreen pattern for how they compose. Logo files for print and partners are in Assets › Logos; see the Logo section for usage rules and the Voice section for writing.
