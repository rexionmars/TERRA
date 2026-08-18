# TERRA design system

Cool near-black surfaces where the neutrals carry the accent's hue rather than
leaving it to the accent, one blue accent, monospace telemetry, and a density
chosen on purpose.

The family replaces the Mars sand it began as. The rotation was done at constant
luminance -- WCAG contrast is a function of relative luminance alone, so every
neutral kept the ratio it had been measured at while its hue moved to the
accent's 214 degrees.

The implementation is the source of truth. This file describes it; where the two
disagree, the code is right and this file is stale.

| What | Where |
| --- | --- |
| Tokens, type scale, base layer | [`frontend/src/index.css`](../frontend/src/index.css) |
| Contrast rules, re-derived from the tokens | [`frontend/src/lib/contrast.ts`](../frontend/src/lib/contrast.ts) |
| The check that fails a build-time regression | [`frontend/scripts/check-contrast.ts`](../frontend/scripts/check-contrast.ts) |
| Page chassis | [`frontend/src/components/ui/PageShell.tsx`](../frontend/src/components/ui/PageShell.tsx) |
| Dialog chassis | [`frontend/src/components/ui/ModalShell.tsx`](../frontend/src/components/ui/ModalShell.tsx) |
| Button primitives | [`frontend/src/components/ui/buttons.ts`](../frontend/src/components/ui/buttons.ts) |

Run `npm run check:contrast` in `frontend/`. It fails if a pair drops below its
floor **and** if the channels in `contrast.ts` stop matching `index.css`, so the
table below cannot quietly drift from the palette.

---

## Where channels live

Channels are stored **only** on `--p-*`, as space-separated `R G B`, so alpha can
be applied: `rgb(var(--p-line) / 0.28)`.

Never store channels on `--color-*`. Tailwind v4's `@theme inline` block owns
that namespace and will overwrite them, turning `rgb(var(--color-line) / …)`
into invalid CSS — which paints white or falls back, depending on the property.

Semantic tokens (`--border`, `--panel`, `--primary`, `--ring`, …) are composed
from `--p-*` in a plain `:root` block, and `@theme inline` maps those to
`--color-*` for Tailwind. Three levels, one direction.

---

## Palette

### Dark

| Token | RGB | Hex | Role |
| --- | --- | --- | --- |
| `--p-ink` | `23 23 23` | `#171717` | App background |
| `--p-surface` | `29 34 39` | `#1D2227` | Panel |
| `--p-surface-raised` | `41 48 56` | `#293038` | Card, field |
| `--p-line` | `66 76 90` | `#424C5A` | Divider |
| `--p-line-strong` | `105 122 145` | `#697A91` | Component boundary |
| `--p-text` | `216 221 229` | `#D8DDE5` | Text |
| `--p-muted` | `150 162 177` | `#96A2B1` | Secondary text |
| `--p-accent` | `53 120 207` | `#3578CF` | Fill, focus, active state |
| `--p-accent-quiet` | `106 155 219` | `#6A9BDB` | The accent **as text** |
| `--p-accent-dim` | `22 45 74` | `#162D4A` | The plate a chosen value lights on |

The brand value is `#3376CE`. This theme lightens it by two levels per channel,
because the exact value measures **2.96** against the raised surface where the
boundary floor is 3.0, and darkening only lowers it further. The nudged value
measures 3.01.

### Light

The light theme derives on its own path and inherits nothing from the dark
block, so every ratio is measured there too. Here the accent is the brand value
unchanged: `#3376CE` measures 4.34 on the light surface and 3.52 on the raised
one, so it needs no darkening for this ground.

| Token | RGB | Hex |
| --- | --- | --- |
| `--p-ink` | `236 241 247` | `#ECF1F7` |
| `--p-surface` | `247 250 253` | `#F7FAFD` |
| `--p-surface-raised` | `220 227 237` | `#DCE3ED` |
| `--p-line` | `165 179 196` | `#A5B3C4` |
| `--p-line-strong` | `105 123 147` | `#697B93` |
| `--p-text` | `26 32 40` | `#1A2028` |
| `--p-muted` | `81 93 110` | `#515D6E` |
| `--p-accent` | `51 118 206` | `#3376CE` |
| `--p-accent-quiet` | `40 94 166` | `#285EA6` |
| `--p-accent-dim` | `204 220 242` | `#CCDCF2` |

---

## Three rules the measurements impose

These are not style preferences. Each one is a ratio that fails.

**1. The accent is not a text colour.** Full accent measures **3.01** on the
raised surface, below the 4.5 WCAG 1.4.3 asks. It is a fill, a focus ring and an
active state. Text that has to read as the accent uses `--p-accent-quiet`, which
clears 4.5 on every surface (6.25 / 5.59 / 4.65 dark).

**2. A filled accent button takes white, and does not fully clear the floor.**
`--primary-foreground` is white: **4.43** dark, 4.54 light. The near-black ink it
replaced measures 4.05 and 4.00, so white is the better of the two and the dark
theme still sits 0.07 under 4.5. That shortfall is a stated exception, not an
oversight: no colour at this hue clears both floors at once, because a fill dark
enough to carry white at 4.5 is too dark to clear 3.0 against the raised surface
behind it. It is the one pair `contrast.ts` deliberately does not encode as a
rule. For a separate reason no filled button carries a whole-element hover fade —
`hover:opacity-90` drops the label further still.

**3. Adjacent surfaces need a border.** Surface separation is 1.12 and 1.20, low
by construction because the family is dark. Two panels are told apart by their
border, not by luminance, which is why `--p-line-strong` exists and why it has to
clear 3.0 against *both* surfaces: 3.66 on surface, 3.04 on the raised one. An
earlier value cleared it against surface alone.

### Destructive splits the same way

One value cannot be both a fill and a text colour, and the single value that used
to be both failed in both jobs at once: **3.12** as a label on its own fill,
**4.22** as text on the background.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--destructive` | `#A02C2C` | `#B33A1A` | The fill |
| `--destructive-foreground` | `--p-text` | `--p-surface` | Its label — a *different* palette token per theme |
| `--destructive-quiet` | `#E08A78` | `#9E2B25` | Error text, a delete row, a hover state |

The foreground being a different token per theme is why the contrast check
resolves it rather than assuming one: a rule that assumed `--p-text` passed in
dark and failed in light by 2.76.

### Warning stopped following the accent

`--warning` was `--p-accent-quiet`, which held while the accent was orange: the
warning mark and the accent were the same hue by accident, and no other hue
competed for the meaning. A blue accent would have drawn the warning toast in
the colour the interface uses for the selected thing, so warning is now an amber
of its own per theme — `#D9A441` dark, `#8A5A10` light — and it joins the check,
because a literal that derives from nothing is unchecked by default.

Three call sites ask for `var(--p-warning)`, which is not a declared token and
resolves to nothing; they inherit their parent's colour and always have. Fixing
them is a separate change, since it turns text amber that has never been amber.

### Focus

`--ring` is the **full** accent, not a wash of it. At 0.55 alpha the composited
ring fell under the 3.0 WCAG 1.4.11 asks of a focus indicator, and under the
figure the check reported, because the check read the token and the token was
not what got painted. At full strength the two agree: 4.05 on ink, 3.62 on a
panel, 3.01 on a raised surface.

Every control gets a ring from one rule in `@layer base` covering `button`,
`summary` and the `button`, `slider` and `tab` roles. It uses `outline` rather
than `box-shadow`, so it follows the border radius and does not fight the shadow
a floating panel needs. A site wanting its own treatment pairs
`focus-visible:outline-none` with its own ring; utilities outrank base.

---

## Scientific ramps are out of scope

`inferno`, `viridis`, `rdbu_r`, `blues` and `rdylgn` do not take part in the
palette. They are perceptually uniform sequences painted by the Python renderer,
guarded byte for byte by `sidecar/tests/test_palette_sync.py`, and they answer to
the data rather than to the chassis.

The same holds for the AOI outline colours in `frontend/src/lib/aoiStyle.ts`:
they are drawn over satellite imagery and chosen to contrast with terrain, not
with the interface.

**The map area stays out of the chassis hue.** The viewport and any chrome
touching a raster stay low-chroma and answer to the terrain, or the frame
competes with the data for the reading. The rubber band leaflet-draw paints
while a polygon is being drawn is part of that: it stays `#d8944a` over imagery
rather than following the accent to blue.

---

## Type scale

Five steps, each named for its role. Declared in `@theme inline`, so they are
real Tailwind utilities.

| Utility | Size | Leading | Use for |
| --- | --- | --- | --- |
| `text-micro` | 9px | 1.35 | Label floor: uppercase mono with wide tracking, never prose |
| `text-meta` | 10px | 1.4 | Counts, timestamps, units |
| `text-body` | 11px | 1.5 | Body and control labels |
| `text-emphasis` | 12px | 1.5 | Row titles, field values |
| `text-heading` | 14px | 1.4 | Section and page headings |

`micro` is a floor, not a size to reach for. It is legible only because every use
of it is uppercase monospace with wide tracking.

**`tailwind-merge` has to be told about these.** `src/lib/utils.ts` extends it so
they classify as `font-size`; without that, `cn("text-body", "text-muted-foreground")`
deletes the size, because stock tailwind-merge reads `text-body` as a colour.

Fonts: Space Grotesk (display), Inter (sans), JetBrains Mono (telemetry).

## Radius

Two: `--radius-sm` 5px for a control or an inner card, `--radius-md` 9px for a
container. `lg` and `xl` are aliases of `md` so a stray utility cannot introduce
a third.

---

## Chassis

One chassis, not two. Everything floating over a raster is a `.panel`; every
full-window screen is panels laid on the ink at the same radius and the same
spring. A page has no raster underneath, so it cannot borrow the reason the glass
exists — but the surface, the border, the radius and the entry are the identity,
and none of those depend on there being a map.

| Primitive | For |
| --- | --- |
| `PageShell` | The window: ink ground, 12px padding, flex |
| `PageAside` | The section column. **16rem**, one width — the three that existed (15, 15.5, 16.5rem) were the same column written three times |
| `PageBody` | The scrolling panel |
| `ModalShell` | The scrim and the dialog, at `z-2000`, `fixed` |
| `ModalHeader` | Eyebrow, title, subtitle, and the way out |

A page does **not** carry its own title bar. The window title bar already names
the screen and the account; a header repeating them costs a row of height for
nothing.

### Buttons

Six primitives in `ui/buttons.ts`, derived from a sweep of all 196 button sites.
Each carries the focus ring and one shared `disabled` convention.

| Primitive | Height | For |
| --- | --- | --- |
| `btnPrimary` | 32px | The filled action. 32px is also what `.field-input` sets, so a button beside an input lines up |
| `btnPrimaryCommit` | 36px | The single committing action anchoring a panel or modal foot |
| `btnDestructive` | 32px | The filled destructive |
| `btnGhost` | 32px | The quiet action |
| `btnGhostDense` | 28px | Table toolbars, card action rows — bands that repeat per row |
| `btnIcon` | 28px | Icon-only, matching the dense height |

One site legitimately cannot adopt a primitive: the energy `RunButton` states
what its product returns and wraps to two lines, so `min-h-9` with its own
leading is structural. It carries every other part of the primitive.

---

## The cascade hazard

**Component classes in `index.css` are unlayered.** `.panel`, `.field-input`,
`.eyebrow`, `.telemetry` and `.nav-item` sit outside any cascade layer, while
Tailwind v4 emits utilities into `@layer utilities`. Unlayered rules therefore
**beat every utility**, regardless of source order.

Consequences that shipped before this was understood:

- `border-x-0` and `border-b-0` on a `.panel` were dead classes. Both foot bars
  drew a line down the window's own right edge.
- `.field-input` stacked with a second background class made the second one
  inert, and which border won depended on byte order in the compiled sheet.
- A `hover:border-destructive` on a ghost button never painted at all, and was
  only found by reading the compiled sheet.

Before writing a utility that overrides a property one of those classes sets,
check the compiled sheet in `dist/assets/*.css`. Inline style is the only
declaration that wins without relayering the stylesheet under every other call
site.

---

## Verification

```
cd frontend && npx tsc --noEmit
cd frontend && npm run check:contrast
cd frontend && npm run build
go build ./... && go test ./...
cd sidecar && python -m pytest tests -q
```

Go and the sidecar are **control** — a chassis change should not move them. If
`test_palette_sync.py` fails, the re-palette leaked into the scientific ramps.

The checks cannot see everything. Two things need eyes:

- **Both themes.** The light theme derives separately and inherits nothing.
- **The map area.** Open a terrain raster and a suitability raster and confirm
  the frame does not compete with the ramp.
