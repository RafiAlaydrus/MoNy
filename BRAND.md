# MoNy — brand and design spec

Single source of truth for MoNy's visual identity and copy voice. Applies to
`index.html`, `style.css`, and `app.js`. Nothing here touches the money logic
in `money.js` — this is presentation only.

Personality target: **calm, minimal, quiet confidence.** Precise, not
decorative. The app already behaves this way in its maths — it states an
overspend plainly instead of softening it — and the visuals exist to match
that honesty rather than paper over it.

---

## 1. Naming

The name is MoNy, capital N in the middle, always styled `mo` + `N` + `y`.
Never "Mony", never "MONY", never re-cased.

Tagline (optional, sparing use — splash screen only):
`one month. everything accounted for.`

---

## 2. Color

Two palettes: dark (default and primary) and light (secondary, for users with
system light mode).

### Dark (default)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0E0E10` | Page background |
| `--card` | `#18181B` | Cards, modals, inputs |
| `--card-raised` | `#1F1F22` | Nested cards, hover states |
| `--border` | `#2A2A28` | Hairline dividers, card borders |
| `--text-primary` | `#EDEDEC` | Primary text, numbers |
| `--text-secondary` | `#8A8A86` | Labels, captions, helper text |
| `--text-muted` | `#6B6B67` | Placeholders, disabled, timestamps |
| `--signal` | `#C9A876` | The ONE accent. Remaining figure only |
| `--danger` | `#D9776B` | Overspend states only — muted terracotta |
| success | unused | No "good job" green. This app doesn't cheerlead. |

### Light (secondary)

| Token | Hex |
|---|---|
| `--bg` | `#FAFAF8` |
| `--card` | `#FFFFFF` |
| `--card-raised` | `#F2F2EF` |
| `--border` | `#E5E5E1` |
| `--text-primary` | `#1C1C1A` |
| `--text-secondary` | `#75756F` |
| `--text-muted` | `#A3A39C` |
| `--signal` | `#A8823F` |
| `--danger` | `#B84A3C` |

### Rules

- **One signal color, one job.** `--signal` marks the Remaining figure and the
  bar directly beneath it. It appears nowhere else — not buttons, links,
  active states, or icons. If everything is highlighted, nothing is.
- **No green/red pass-fail coloring.** Chart hues are *data encoding*, not
  mood: they separate one category from another and carry no good/bad meaning.
  Keep saturation low, no neon.
- **Overspend uses `--danger`** — "pay attention", not "alarm".
- **Never hardcode hex in markup or CSS.** Everything resolves to a custom
  property so dark and light stay in sync.

---

## 3. Logo and icon

Out of scope. Do not touch `icons/*.png`, splash art, or the manifest's icon
references. A wordmark, if one is ever needed in-app, stays plain text in
`--text-primary` with no special glyph treatment until this section is
revisited.

---

## 4. Typography

- System font stack. No webfont — the app must work fully offline.
- **Two weights only**: 400 regular, 500 medium. Never 600 or 700.
- **Sentence case everywhere. No ALL CAPS labels.**
- No letter-spacing tricks to fake emphasis. Emphasis comes from size and
  weight only.

Type scale:

| Role | Size | Weight | Color |
|---|---|---|---|
| Hero figure (Remaining) | 32px | 500 | `--signal` |
| Large figure (Total income) | 28px | 500 | `--text-primary` |
| Section label above a figure | 13px | 400 | `--text-secondary` |
| Body / list rows | 15px | 400 | `--text-primary` |
| Captions / timestamps | 12–13px | 400 | `--text-muted` |

---

## 5. Voice and copy

Plain, declarative. No exclamation points, no encouragement theater, no
apology. State facts.

- No exclamation marks anywhere in UI copy.
- No "Oops", "Yay", "Great job", "Uh oh".
- Empty states are neutral information, not a pitch:
  "No bills logged this month." not "No bills yet! Add one to get started."
- Errors state the number and the fact: "Overspent by 40."
- Confirmations are short and past-tense, no first person: "Saved", "Deleted".
- Buttons are verb-first, sentence case, no terminal punctuation:
  "Add bill", "Save priority", "Copy last priority".
- Never hardcode a currency symbol in copy — the app supports eight.

---

## 6. Layout and components

- Cards: `--card` background, 1px `--border`, 12–14px radius, 16–20px padding.
- Remaining is the hero of the main screen: largest figure, `--signal`.
- Progress bar: neutral track, `--signal` fill on the main bar only. Wallet
  bars stay neutral.
- **Buttons are outline by default.** A button opts in to being filled, and
  exactly one per form does — that form's primary action. Fill carries the
  emphasis, never color.
- Destructive actions are outlined in `--danger`, not filled.

---

## 7. What NOT to do

- No gradients, drop shadows, glow, or neon.
- No second accent color "for variety".
- No mascot, emoji, or illustrated character.
- No gamification — streaks, badges, celebratory animation. The
  invariant-driven honesty is the personality; don't paper over it with
  delight-engineering.
- Never change `money.js` or the accounting invariant for presentation.

---

## 8. Implementation notes

Decisions made while applying this spec, recorded so they aren't relitigated.

**Signal scope.** §2 reserves `--signal` for the Remaining figure; §6 asks for
a signal-colored progress bar. Resolved as: the figure *and the bar directly
beneath it*, which are one component. The bar is scoped by id (`#spend-bar-fill`)
rather than class, because wallet sections reuse `.spend-bar-fill` and would
otherwise repeat the accent down the whole screen.

**Buttons.** "One primary per screen" is applied per *form region*. The main
screen has a Priority form, a Second choice form, and one form per wallet; each
keeps a single filled primary against outlined siblings.

**Naming.** MoNy appears in metadata only — `<title>`, manifest name, iOS
home-screen title. The in-app header stays "Monthly spent" per the §5 rewrite
table.

**Category names are data, not copy.** `Bills`, `Subscription`, `Food / Drink`,
`Transport`, `Others`, and `Transfer` are written into every saved entry and
every archived month, and `Transfer` is load-bearing for the legacy transfer
fallback in `money.js`. They are never recased. The same applies to the legacy
`Second Wallet` migration name.

**Charts read the theme at draw time.** A canvas cannot resolve `var()`, so
`themeColor()` samples the resolved custom properties off `:root` on every
draw. A `matchMedia` listener repaints on scheme change, because a canvas keeps
its pixels until something repaints it — without that, flipping to light mode
leaves the donut's centre figure near-white on white.

**Chart hue assignments** are chosen for separation, not meaning.
`--chart-5` is reserved for "Others" and excluded from the wallet ramp, since a
wallet slice sits next to Others most often. "In wallets" is deliberately
neutral — it is money set aside, not a spending category.

---

## 9. Release

A visual change follows the same checklist as any other release: bump
`CACHE_NAME` in `service-worker.js`, `.setting-version` in `index.html`, and
`version` in `package.json`. See PROGRESS.md § "Release checklist".
