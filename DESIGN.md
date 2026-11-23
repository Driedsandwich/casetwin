# CaseTwin C3 design

This specification is transcribed from the two supplied C3 images and the existing prototype before implementation. No browser or external visual references were used.

## Composition

The evidence screen has a deep indigo header and footer on a cool pale canvas. A large left-aligned headline introduces three columns: private original CSV on the left, dominant failure fingerprint in the center, shareable synthetic CSV on the right. Supporting cards sit beneath the side panels. One action strip sits below the fingerprint workspace. The green reproduction result is a non-interactive status, never a button.

The review screen retains the three-column evidence layout. It adds a draft report and a two-column disclosure of what would leave the device and what stays private. The progression is “Review what will be shared” then “Export share bundle”. Export downloads a local JSON file; it never sends automatically. Cloud draft generation and optional authenticated storage are separate explicit actions with their payload disclosed first.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Indigo | #30266B | Brand header and footer |
| Primary | #34218C | Primary actions |
| Ink | #202239 | Headings and body |
| Muted | #586077 | Secondary text |
| Canvas | #EDF0F6 | Page background |
| Surface | #FFFFFF | Cards |
| Border | #BDC5D8 | Card and table outlines |
| Error | #B70817 | Error labels |
| Error tint | #FBE2E4 | Failure backgrounds |
| Success | #176B30 | Reproduction text |
| Success tint | #E7F5E6 | Result background |
| Neutral tint | #F0F2F7 | Notes and badges |

## Typography

Use locally available system sans-serif fonts with Japanese fallbacks; no external fonts. Brand 27px/750. Main heading 38–44px/800. Fingerprint error 34–46px/800 with wrapping for long identifiers. Card headings 21–25px/750. Secondary headings 17px/700. Body 15px/1.5; metadata 12–13px/1.5. Code uses the system monospace stack. h1–h3 and title contain no commas or Japanese enumeration commas.

## Spacing and grid

Base spacing: 4, 8, 12, 16, 20, 24, 32px. Header and footer horizontal padding 24px. Main max width 1560px with 20–28px gutters. Desktop grid: minmax(250px, 1fr) minmax(380px, 1.55fr) minmax(250px, 1fr), gap 16px. Panels: 12px radius, 1px borders, restrained shadows, 18–22px padding. At 1100px stack the central panel across two side columns; below 760px use a single reading-order column and full-width actions. The sharing disclosure remains two columns until 760px.

## Components

- Header with CaseTwin wordmark, C3 context, LOCAL/CLOUD boundaries, EN / 日本語 and Settings.
- Always visible Demo mode banner when configuration is absent; Japanese-only prototype guidance banner.
- Original card with Private and On device badges, local file input, 64-row sample action, focused failing rows and source filename.
- Local AI candidates card with actual SDK inference source, preparing/pending/manual/error states and a condition selector.
- Central fingerprint with error, field, condition, validator, two match cards, connecting lines and status result.
- Synthetic card with Shareable badge, fictional values and encoding note.
- Deterministic generator explanation and four validation results.
- Action strip with same-validator label, run again, create reproduction and review action.
- Review report with draft/source label, rewrite control and clear hypothesis disclaimer.
- Two sharing-boundary cards, human review checkbox, local export action, separate optional Firestore save.
- Settings dialog with configuration state, Google authentication and For AI agents tool descriptions.
- Accessible live status, error alerts, focusable controls, visible focus rings, dialog labels and table captions.

## Fragile areas and acceptance checks

Long filenames, custom CSV headers and hostile text must be escaped and wrapped. Tables scroll within cards and must not widen the grid. Never infer “pass” from a check marked not_run. Error kinds must remain legible on narrow screens. Busy local inference must show preparation guidance on first call (user observed about 11 seconds) and serialize calls. Loading a new file or changing a condition invalidates prior reproduction and approval. A mismatch blocks review/export. No original values or original row numbers appear in cloud payloads, exports or MCP responses. Report text is rendered as plain text. Disabled controls retain readable contrast. Keyboard focus returns after dialogs and transitions. Browser layout and assistive technology behavior remain unverified in this environment; no screenshots are produced.
