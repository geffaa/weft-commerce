# Weft design system v1: "workshop ledger"

Written from the finished mockups in `mockups/` (exceptions, reconciliation, assistant, components). Mode: Operate. Anti-slop rules: `~/Project/portfolio-roadmap/ANTI-SLOP.md`.

## Direction
An operations console for a small team who must trust that two systems agree. Quiet, dense, cool-grey ground with white work surfaces and one pine accent. Colour carries status only. The one remembered element is the **24-hour tape**: 48 ticks, one per 30 minutes, green / amber / red / grey, at the top of Exceptions (and reusable on Runs and Overview).

## Tokens
| Token | Value | Use |
|---|---|---|
| bg / surface / surface-2 / hover | #F1F4F3 / #FFFFFF / #F7F9F8 / #EBF0EE | ground, panels, table header, hover |
| line / line-strong | #DCE3E0 / #C3CDC9 | dividers, control borders |
| ink / ink-2 / ink-3 / ink-4 | #10181B / #2F3B3D / #4F5C5E / #58666A | text (ink-4 is the weakest, AA on bg) |
| pine / pine-strong / pine-soft | #1B6B4A / #14543A / #E2F1E9 | primary, success, selection |
| amber / amber-soft | #865509 / #FBF0D8 | retrying, needs a decision |
| red / red-soft | #B1281D / #FCEBE8 | failed, Live environment |
Dark mode: not in v1 mockups; derive by inverting surfaces (ground #0E1416, surface #151D20) and keeping status hues, then re-check contrast.

## Type
Albert Sans (400/500/600/650/700) for UI; Spline Sans Mono for ids, SKUs, payloads, keys. Scale: 12.5 / 13 / 14 (body) / 15 (panel title) / 24 (page title). Tabular numerals for all figures. No uppercase eyebrows.

## Layout and density
Top bar 48px, ink-black, holds brand, **Sandbox/Live selector (always visible, Live turns red)** and search. Left rail 232px, grouped with text labels (Overview, Commerce, Channels, Finance, Assistant, Operations, Admin); Exceptions shows a red count. Under 1180px the rail collapses to icons; under 760px it hides. Page max 1240px, 24px gutters. Master-detail (table + 400px detail panel) is the default pattern for work queues. Rows 10px vertical padding, grouped by cause with a one-line hint on the group header.

## Components
Custom only, with ARIA: segmented control (`aria-pressed`), select trigger + listbox, date range dialog, checkbox (`role=checkbox`), switch (`role=switch`), badges (dot + word, never colour alone), channel chip (neutral letter, no brand colours), callout (amber advice, pine confirmation), code block (dark, for payloads), kbd hint. Icons: Lucide via kit.py, 16px, 1.75 stroke.

## Patterns
- Every failure has a plain-language cause, a suggested fix, the raw response, and Retry / Ignore with reason.
- Assistant answers always show sources, tool calls and a "numbers match tool results" check; "Mark wrong" turns a conversation into an eval case.
- Empty/loading/error: empty states name what would appear and why it is empty ("No exceptions. Last run 14:30"); loading uses row skeletons; errors give cause + action.
- Motion: 120ms colour/background only; respect prefers-reduced-motion.

## Do not
Brand colours for channels, gradients, card grids with icon circles, emoji icons, native selects/dates/checkboxes, colour-only status, decorative charts. Demo data is synthetic and labelled.

## Review notes
Mobile (390px) shows the page without horizontal scroll but dense tables are scroll-compressed; a stacked-card row for Exceptions is a build-time task (M3). Detector: only the intentional flush table panels and heading order flagged; heading order fixed.

## Storefront theme v3: "calm catalogue" (merchant-facing)
Identity: *weft* is the crosswise thread that holds a weave together, which is what Weft does for shop, Shopify, Xero and assistant. The storefront therefore shares the console's family (Albert Sans, Spline Sans Mono, soft corners) and stays calm and trustworthy. First tries (warm serif, then sharp industrial uppercase with safety orange) were rejected by the owner as off-brand or too harsh.
Demo merchant: Halden Moto Parts (fictional, motorcycle parts), chosen because aftermarket parts with fitment is the one product theme with market data and gives the assistant a checkable job.
- **Signature: fitment.** "My garage" pill in the header (2019 Honda CB500F); every part shows Fits / Check fitment / Does not fit as a pill. The same data drives filters, search suggestions, PDP verdict and the assistant (`check_fitment` tool). Spec strip: one mono line per part.
- Tokens: ground #F6F7F5, surface #FFF, ink #121A1C, line #E1E5E3, accent petrol #0E5A6B (hover #0A4856, soft #E3F0F3), fit green #1B6B4A, no-fit red #B1281D, amber #B45309 for low stock. Status colours only for fitment and stock.
- Type: Albert Sans 400-700, sentence case headings (32/700 page, 15.5/650 part names), Spline Sans Mono for part numbers and specs.
- Shape: radius 8 (controls), 14 (panels, table container), full pill for search, garage, chips and fitment. One soft shadow, only on popovers and the compare bar. Hairline 1px rules.
- Collection default is a table inside a rounded container (compare, sort, part numbers); grid is secondary. On mobile rows become stacked cards.
- Screens: `storefront-collection.html`, `storefront-pdp.html`, `storefront-search.html`. Cart, checkout and order status (S14-S16) are not mocked.
- Photos: Wikimedia Commons, licences in `mockups/img/credits.json` (CC BY-SA entries need attribution on a public site).
- Replaceable per client through tokens; alternates considered: editorial magazine (fashion), earthy local shop (food), dark garage.

## Brand mark
Two threads, one light and one white, interlacing once: systems woven together. Pine tile (#1B6B4A), light thread #A8DBC0, white thread over, with a small gap at the crossing. Wordmark: Albert Sans 700, tracking -0.035em. Files in `brand/`: `weft-mark.svg`, `weft-mark-dark.svg`, `weft-mark-mono.svg`, `weft-mark-512.png`, `weft-logo.png`, `weft-logo-dark.png`. Minimum size 16px. The merchant demo (Halden Moto) has its own placeholder "H" mark; merchant logos never use the Weft mark.

## Halden Moto logo (storefront)

The mark is the letter **H inside a sprocket** (12 teeth), white on petrol `#0E5A6B`, in a rounded square. It was chosen to read as "motorcycle parts" at a glance and to survive at 16 to 32 px, where the teeth become texture and the sprocket silhouette stays. Two earlier ideas were rejected: an H whose crossbar is a brake rotor (it merged into a blob at small sizes) and the same idea with a thin axle (it looked like a TIE fighter). Source: `brand/halden-mark.svg`; inverse for dark backgrounds: `brand/halden-mark-inverse.svg`; PNG lockups: `brand/halden-logo.png`, `brand/halden-logo-dark.png`. The storefront renders it inline from `apps/storefront/src/components/Logo.tsx`.
