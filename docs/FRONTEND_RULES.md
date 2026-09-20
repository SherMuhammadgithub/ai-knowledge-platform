# Frontend rules

Applies to everything in `apps/web`. These rules are binding for Claude and for the user. If a rule is wrong for a screen, change the rule here first, then build.

## 1. What the UI is for

The UI has three jobs in a client demo, in this order:

1. **Ask a question and trust the answer.** Answer text, numbered citations, and a source panel that shows the exact passage the answer came from.
2. **Show documents moving through the pipeline.** Upload, processing, ready or failed, with a clear reason when it fails.
3. **Show measured quality.** Eval runs and their numbers, from stored runs only.

Anything that does not serve one of these does not get built. Polish comes from the design system (tokens, components, these rules), not from tweaking individual screens. UI time is part of each milestone's hour estimate, not extra.

## 2. Stack rules

- shadcn/ui, style `radix-nova`, Lucide icons, Tailwind 4. Config is `apps/web/components.json`.
- Add components with the CLI: `bunx --bun shadcn@latest add <name>` from `apps/web`. Add only what a screen needs today.
- Generated components in `src/components/ui/` may be restyled through tokens and variants. Do not change their behavior or accessibility wiring.
- Next.js here is a new major version. Before writing routing, data fetching or caching code, read the matching guide in `apps/web/node_modules/next/dist/docs/`.
- Server components by default. Add `"use client"` only for state, effects, browser APIs or event handlers, and keep those components small.
- Never render a `<script>` element from a client component (React 19 logs a warning on every page load). Inline scripts go in the server layout through `next/script`. The theme uses `src/lib/theme-script.ts` and `src/components/theme-provider.tsx` for this reason, not `next-themes`.
- Use `cn()` from `@/lib/utils` to merge classes. No CSS-in-JS, no second component library, no icon packs besides Lucide.
- **Colors, fonts and radii are defined only in `src/app/globals.css`.** Components use token classes (`bg-card`, `text-muted-foreground`, `border-border`, `bg-cite`). No hex, rgb or oklch values inside components. No arbitrary values like `w-[437px]` unless a comment explains why.

## 3. Design direction: quiet reference desk

The product is a research tool people use to check facts. It should feel calm, exact and readable, like a good reference desk, not like a chat toy or a marketing page.

**Palette** (values live in `globals.css`, all text pairs pass WCAG AA):

| Role | Token | Description |
|---|---|---|
| Page | `background` | Cool blue-grey off-white, not cream, not pure white |
| Surfaces | `card`, `popover` | White, separated by borders more than shadows |
| Text | `foreground`, `muted-foreground` | Ink blue-black and a mid slate |
| Brand | `primary` | Deep petrol teal. Buttons, links, focus, active nav |
| Citation | `cite`, `cite-foreground` | Highlighter yellow. **Only** for text a citation points to |
| Status | `success`, `warning`, `info`, `destructive` | Document states and eval outcomes |
| Charts | `chart-1` to `chart-5` | Categorical series for eval charts |

Dark mode is a first-class theme (deep blue-grey, not black), switched with the `.dark` class. Every screen must work in both.

**Type roles:**

- **Public Sans** (`font-sans`): all interface text.
- **Newsreader** (`font-serif`): prose that people read closely, meaning generated answers and source passages. This is what makes answers feel like documents, not chat bubbles.
- **JetBrains Mono** (`font-mono`): scores, token counts, latency, ids, code. Always with `tabular-nums` so columns of numbers align.

**The one memorable thing:** the citation highlight. When a user opens a citation, the source panel scrolls to the passage and marks it with `bg-cite`. Everything else stays quiet. Do not add a second accent, gradients, glows or decorative illustrations.

**What we deliberately avoid** (the common tells of generated UI):

- Cream background with a serif display face and a terracotta accent.
- Near-black background with one neon accent.
- Content chopped into identical rounded cards with the same soft shadow.
- Gradient washes, glassmorphism, blurred blobs.
- Small all-caps tracked labels above every heading. Tiny "eyebrow" text.
- One word of a headline in a different color or italic.
- A `→` on every link and button. Middle-dot strings like `A · B · C`.
- Numbered markers (01, 02, 03) unless the content really is a sequence. Citation numbers are a real sequence and are fine.
- Fade-and-slide-up entrances on every section. Hover lift on every card.
- A colored bar down the left edge of the active tab, a card or an alert.
- A split-screen sign-in page with a gradient, a testimonial or customer logos. The sign-in page shows the real mechanism instead (an answer, its citation, the cited sentence highlighted).

## 4. Typography

- Scale: 12 (captions), 14 (default UI), 16 (reading text), 18 (answer text), 20, 24, 30 (page titles). Nothing else.
- Page title is the largest text on screen. One `h1` per page.
- Reading text (answers, passages): serif, 17 to 18px, line-height 1.6 to 1.7, max width 68ch. UI text: line-height 1.4 to 1.5.
- Sentence case everywhere. No all-caps labels.
- Numbers in tables, metrics and eval results: `font-mono tabular-nums`, right-aligned.
- Weights: 400 body, 500 labels and buttons, 600 headings. No 800 or 900.

## 5. Layout and spacing

- Spacing uses the Tailwind 4px scale only. Page margin at least 24px. Space between major sections 32 to 48px. Card padding 20 to 24px. Field gap 16 to 20px.
- App shell: 240px sidebar (collapses to a sheet below `lg`), slim top bar, content area. The active nav item is a filled tint (`bg-sidebar-accent`) with a teal icon. No colored side stripes on nav items, cards, alerts or rows: they are a template tell (user decision, 2026-09-19).
- Content max widths: reading views 68ch, forms 560px, tables and dashboards full width.
- Structure order on every page: header (title and primary action), summary row, main content, secondary content. Tables and lists are full width.
- Never nest a 3+ column grid inside a container narrower than 70% of the viewport. No card narrower than 240px. Use 50/50 or 60/40 splits only for two things of equal weight.
- **Do not wrap everything in a card.** A border, divider or background should mean something: a group, a boundary, a selection. Use plain spacing where nothing needs grouping.
- Radius by role: inputs and buttons `rounded-md`, panels and cards `rounded-lg`, chips and badges `rounded-full`. Do not use one radius everywhere.
- Alignment: left-aligned by default. Center only empty states and auth forms.
- One primary action per screen. Secondary actions are outline or ghost. Destructive actions are red and kept apart from safe ones.
- Tables: sticky header, row height 44 to 52px, visible result count ("Showing 1 to 25 of 142"), row actions on hover and on keyboard focus.

## 5a. Responsive

- Must be usable at 390px wide and correct at 1280px. Desktop-first: this is a work tool.
- Below `lg` the sidebar becomes a sheet, tables scroll inside their own container (the page itself never scrolls sideways), and the source panel becomes a full-screen sheet.

## 6. States and interaction

Every screen and component ships with all its states. A screen is not done without them.

- **Loading:** skeletons shaped like the content, not spinners over a blank page.
- **Empty:** says what belongs here and offers the one action that fills it ("Upload your first document").
- **Filtered empty:** "No documents match these filters" with a "Clear filters" button.
- **Backend unavailable:** layouts must never throw when the API is unreachable. Use `getSession()` (returns `signed-in`, `signed-out` or `unavailable`) and render `<ServiceUnavailable />` for the last one. Being signed out and the API being down are different states and must never look the same.
- **In-progress items:** a document that is being read shows the status text plus a small spinner, and the screen checks again every few seconds until nothing is waiting. Every status has a second line that says what it means or why it failed, in plain words. A failed item offers the action that can fix it (Retry) next to it, always visible, never only on hover. A stuck state says so ("Taking longer than usual") instead of looking normal forever.
- **Error:** what went wrong in plain words, what to do next, a retry button. No apologies, no vague "Something went wrong". Error codes small and muted.
- **Success feedback:** toast (sonner) for background results, inline text for form saves. Never `alert()`, `confirm()` or `prompt()`.
- No dead elements. Every button, tab, toggle and menu item does something, or is not rendered, or is disabled with a tooltip that says why.
- Destructive actions ask for confirmation in a dialog that names what will be deleted. The confirm button is `<AlertDialogAction variant="destructive">`. Never override its colors with classes: the override silently lost to the button's own background and the button showed as brand teal instead of red.
- Tables on a phone: keep the name, the status and the row action. Drop type, size and date columns below `md` or `sm` (`hidden md:table-cell`). Status and actions must never scroll out of view.
- File uploads: check type and size in the browser before sending (fast, clear message), show each file's result in a list that keeps failures until dismissed, and let people drop files on the page. The API checks everything again.
- Forms: labels above inputs, validate on blur, disable the submit button while pending, show the server error next to the field it belongs to.
- Button and toast wording: the same verb from click to result. "Upload documents" leads to "Documents uploaded". Never "Submit", "OK" or "Yes".
- Keep filter, sort and selected-tab state in the URL where a user would want to share or reload it.

## 7. Rules specific to this product

**Answers and streaming**

- An answer has explicit states: waiting, streaming, done, refused ("not in your documents"), failed. Each is designed.
- "I don't know" is a correct outcome, not an error. Show it in normal text color with a link to what was searched, never in red.
- Streaming has a Stop button and a visible cursor or progress cue. The stream container uses `aria-live="polite"`.
- Never show a fake confidence percentage. If we show a retrieval score, label it as a similarity score and show it in the details drawer, in mono.

**Citations**

- Every claim-level citation is a numbered chip that opens the source panel.
- The source panel shows document name, page or heading when known, the passage, and the highlight (`bg-cite`) on the exact text the answer used.
- If a citation cannot be verified against a stored chunk, the UI shows it as unverified. It is never silently dropped and never shown as valid.

**Untrusted content (prompt-injection and data-exfiltration safety)**

- Model output and document text are untrusted. Render as text or sanitized markdown. `dangerouslySetInnerHTML` is banned.
- **Do not render images from model output or documents.** An image URL with data in its query string is a known way to leak data. Show a placeholder link instead.
- External links from model output open with `rel="noopener noreferrer"` and show their domain next to the link text.
- When the security milestone flags injected content, show that plainly in the UI (what was flagged, from which document), because that is part of the demo.

**Numbers and evaluation**

- The UI shows eval numbers only from stored runs. Every number shows its run id or date, and the model versions used. No hard-coded metrics, no placeholder numbers that look real.
- Every AI response can show details: model, latency, input and output tokens. Hidden by default, one click away, in mono.

**Tenancy**

- The current workspace is always visible in the shell. Workspace ids never appear in client-controlled request bodies or query strings for authorization, the server decides from the session.

## 8. Accessibility floor

- Text contrast at least 4.5:1 (3:1 for large text and UI borders). Run `bun run --cwd apps/web check:contrast` after changing any color token. It reads `globals.css` and fails if a text pair drops below 4.5:1.
- Visible keyboard focus on everything interactive. Do not remove outlines. Full keyboard operation, including opening a citation and closing the source panel with Escape.
- Icon-only buttons have an `aria-label`. Inputs have real `<label>` elements.
- Color is never the only signal: status badges show text or an icon as well as color.
- Touch targets at least 24px, 44px on touch layouts.
- Respect `prefers-reduced-motion` (already global in `globals.css`).

## 9. Motion

- Motion answers a person's action: a panel opens, a row is added, a citation is highlighted. Keep it under 200ms.
- The only decorative motion allowed is the citation highlight: settling when the source panel opens, and sweeping in once on the sign-in example (`.cite-mark` in `globals.css`).
- No page-load stagger, no scroll reveals, no looping animations. One exception: a small spinner may mark an item that is actually in progress (a document being read). It stops when the state changes, and it stops for people who ask for reduced motion.

## 10. Charts (M10 onward)

- Load the `dataviz` skill before writing any chart code.
- Use `--chart-1` to `--chart-5` only. Label lines and bars directly where possible, and always provide the same data as a table.
- Axes start at zero for bars. State the sample size ("50 questions") next to every rate.

## 11. Definition of done for a screen

- [ ] Loading, empty, error and (where relevant) filtered-empty states exist.
- [ ] Every interactive element works. Keyboard-only run-through done.
- [ ] Checked at 1280px and 390px, in light and dark.
- [ ] No hex values, arbitrary sizes or new fonts in components.
- [ ] Copy is sentence case, active voice, same verb from action to result.
- [ ] Nothing from the "deliberately avoid" list crept in.
- [ ] `bun run --cwd apps/web build` and lint pass. `check:contrast` passes if a color changed.

## 12. Process for Claude before building a screen

1. Load the `frontend-design` skill. For app shells, tables and settings pages also load `saas-ux-design`. For charts load `dataviz`.
2. State the screen's job, its layout (a short paragraph or ASCII sketch) and its states.
3. Check the plan against section 3, "deliberately avoid". Change anything that reads like a default.
4. Build with real code in `apps/web`. The `saas-ux-design` skill's "artifact only" rule is for standalone design requests. In this repo, screens are real Next.js code, not artifacts.
5. Review against section 11 before reporting done. Take a screenshot at both widths when a browser is available.
