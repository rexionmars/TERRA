# TERRA design system

Neutral near-black surfaces with the hue left to the accent, monospace
telemetry, and a density chosen on purpose.

Three families preceded this one: Mars sand under an orange accent, cool greys
under a blue one, and neutral greys under blue. This keeps the surfaces free of hue
and takes its accent and its warm paper from a reference, Tangerine Alloy, so the
accent is the only colour on screen that is not data.

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

The greys carry no hue at all. The reference's near-black, `#0B120E`, is tinted
green, which its hex code hides and a screen does not, so it was not taken.

| Token | RGB | Hex | Role |
| --- | --- | --- | --- |
| `--p-sunk` | `14 14 14` | `#0E0E0E` | Under everything |
| `--p-ink` | `20 20 20` | `#141414` | App background, rail and header |
| `--p-control` | `27 27 27` | `#1B1B1B` | Field, inset figure |
| `--p-surface` | `33 33 33` | `#212121` | Panel |
| `--p-head` | `39 39 39` | `#272727` | Header of a panel or a card |
| `--p-surface-raised` | `50 50 50` | `#323232` | Raised card, active plate |
| `--p-line` | `85 85 85` | `#555555` | Divider |
| `--p-line-strong` | `133 133 133` | `#858585` | Component boundary |
| `--p-muted` | `155 155 155` | `#9B9B9B` | Secondary text |
| `--p-text` | `217 211 209` | `#D9D3D1` | Text, the reference's warm paper |
| `--p-accent` | `236 102 45` | `#EC662D` | Fill, focus, active state |
| `--p-accent-quiet` | `250 115 60` | `#FA733C` | The accent **as text** |
| `--p-accent-dim` | `74 32 15` | `#4A200F` | The plate a chosen value lights on |

### Light

The light theme derives on its own path and inherits nothing from the dark block,
so every ratio is measured there too. Its base is the same warm paper. The accent
is darkened rather than reused, so the label on a filled button clears 4.5.

| Token | RGB | Hex |
| --- | --- | --- |
| `--p-sunk` | `217 211 209` | `#D9D3D1` |
| `--p-ink` | `228 223 222` | `#E4DFDE` |
| `--p-control` | `236 232 230` | `#ECE8E6` |
| `--p-surface` | `243 240 239` | `#F3F0EF` |
| `--p-head` | `249 247 245` | `#F9F7F5` |
| `--p-surface-raised` | `255 253 252` | `#FFFDFC` |
| `--p-line` | `176 174 172` | `#B0AEAC` |
| `--p-line-strong` | `118 116 115` | `#767473` |
| `--p-muted` | `82 80 79` | `#52504F` |
| `--p-text` | `20 20 20` | `#141414` |
| `--p-accent` | `171 65 16` | `#AB4110` |
| `--p-accent-quiet` | `154 57 11` | `#9A390B` |
| `--p-accent-dim` | `253 221 208` | `#FDDDD0` |

**Show an image of a palette before applying it.** Hex codes alone hid the green
tint above; a screenshot of the application in it did not.

---

## Rules the measurements impose

These are not style preferences. Each one is a ratio that fails.

**1. The accent is not a text colour.** It measures 3.97 on the raised surface, and
it is a fill, a focus ring and an active state. Text that has to read as the accent
uses `--p-accent-quiet`, which clears 4.5 on every surface (6.65 / 5.81 / 4.63 on
ink, panel and raised in the dark theme).

**2. A filled accent button takes the ink.** `--primary-foreground` is `--p-ink`:
**5.71** dark and 4.55 light. White on the dark fill is 3.23.

**3. Adjacent surfaces need a border.** Surface separation against the ink is 1.14
and 1.44, so two panels are told apart by their border rather than by luminance,
which is why `--p-line-strong` exists and why it clears 3.0 against both: 4.36 on a
panel and 3.47 on a raised surface.

**4. Over the map, orange needs a casing.** A line in the accent measures 2.44 on
red soil and 2.25 on grass, under the 3.0 a boundary needs. So an area's outline has
a dark line under it (`AREA_CASING` in `GlobeSurface.tsx`), and a pin carries a dark
ring. The accent marks controls; a raster's colours come from its legend.

### Destructive splits the same way

One value cannot be both a fill and a text colour, and the single value that used
to be both failed in both jobs at once: **3.12** as a label on its own fill,
**4.22** as text on the background.

| Token | Dark | Light | Role |
| --- | --- | --- | --- |
| `--destructive` | `#9F2B3A` | `#B23645` | The fill |
| `--destructive-foreground` | `--p-text` | `--p-surface` | Its label — a *different* palette token per theme |
| `--destructive-quiet` | `#F8989E` | `#A32B3B` | Error text, a delete row, a hover state |

The foreground being a different token per theme is why the contrast check
resolves it rather than assuming one: a rule that assumed `--p-text` passed in
dark and failed in light by 2.76.

### Warning is not the accent

A status colour derived from a brand colour breaks the moment the brand colour
moves, and an orange warning beside an orange accent would say nothing. It is a
yellow of its own per theme, `#F0CF4C` dark and `#6D5900` light, and it is in the
check, because a literal that derives from nothing is unchecked by default.

### Focus

`--ring` is the **full** accent, not a wash of it. At 0.55 alpha the composited
ring fell under the 3.0 WCAG 1.4.11 asks of a focus indicator, and under the
figure the check reported, because the check read the token and the token was
not what got painted. At full strength the two agree: 5.71 on ink, 4.99 on a
panel, 3.97 on a raised surface.

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

## The map repaints live

The map's outlines are painted from the palette, and MapLibre reads a colour once
into a paint property it then holds as its own number. So the globe subscribes
through `frontend/src/lib/paletteWatch.ts` and repaints in place, without rebuilding
the style, which would decode every raster again.

One attribute is watched: `data-theme`, which next-themes writes with the resolved
theme, so it covers a reader left on the system setting whose machine flips at dusk.

---

## Type scale

Each step is named for its role. Declared in `@theme inline`, so they are real
Tailwind utilities.

| Utility | Size | Leading | Use for |
| --- | --- | --- | --- |
| `text-micro` | 9px | 1.35 | Label floor: uppercase mono with wide tracking, never prose |
| `text-meta` | 10px | 1.4 | Counts, timestamps, units |
| `text-body` | 11px | 1.5 | Body and control labels |
| `text-emphasis` | 12px | 1.5 | Row titles, field values |
| `text-heading` | 14px | 1.4 | Section and page headings |
| `text-label` | 12px | 1.45 | A panel's labels and captions |
| `text-read` | 13px | 1.5 | What is read in a panel |
| `text-title` | 15px | 1.35 | A panel's title |

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
- **The map.** Open a spectral-index composition and a classification raster and
  confirm the chrome does not compete with the ramp.
