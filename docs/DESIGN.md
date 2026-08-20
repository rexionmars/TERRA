# TERRA design system

Neutral near-black surfaces with the hue left to the accent, monospace
telemetry, and a density chosen on purpose.

Two families preceded this one and both put the hue in the surfaces: Mars sand
under an orange accent, then cool greys under a blue one. This puts none there,
which makes the accent the only colour on screen that is not data -- and lets
the accent change again without the chassis being rebuilt.

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
| `--p-ink` | `26 26 26` | `#1A1A1A` | App background |
| `--p-surface` | `37 37 37` | `#252525` | Panel |
| `--p-surface-raised` | `53 53 53` | `#353535` | Card, field |
| `--p-line` | `75 75 75` | `#4B4B4B` | Divider |
| `--p-line-strong` | `126 126 126` | `#7E7E7E` | Component boundary |
| `--p-text` | `221 221 221` | `#DDDDDD` | Text |
| `--p-muted` | `161 161 161` | `#A1A1A1` | Secondary text |
| `--p-accent` | `237 135 68` | `#ED8744` | Fill, focus, active state |
| `--p-accent-quiet` | `236 128 57` | `#EC8039` | The accent **as text** |
| `--p-accent-dim` | `75 37 11` | `#4B250B` | The plate a chosen value lights on |

`--p-line-strong` is 126 and not the 120 the surfaces suggest. At 120 it
measured **2.78** against the raised surface, under the 3.0 floor: lifting a
surface does not lift the boundary that separates it, and this is the case the
check exists to catch.

### Light

The light theme derives on its own path and inherits nothing from the dark
block, so every ratio is measured there too. Neutral for the same reason, at the
luminances the sand family was measured at. The accent is darkened rather than
reused: `#ED8744` on a light surface reads as a highlight and carries no label
at all.

| Token | RGB | Hex |
| --- | --- | --- |
| `--p-ink` | `241 241 241` | `#F1F1F1` |
| `--p-surface` | `249 249 249` | `#F9F9F9` |
| `--p-surface-raised` | `227 227 227` | `#E3E3E3` |
| `--p-line` | `177 177 177` | `#B1B1B1` |
| `--p-line-strong` | `121 121 121` | `#797979` |
| `--p-text` | `31 31 31` | `#1F1F1F` |
| `--p-muted` | `92 92 92` | `#5C5C5C` |
| `--p-accent` | `186 58 18` | `#BA3A12` |
| `--p-accent-quiet` | `158 48 14` | `#9E300E` |
| `--p-accent-dim` | `240 214 198` | `#F0D6C6` |

---

## Three rules the measurements impose

These are not style preferences. Each one is a ratio that fails.

**1. The accent is not a text colour.** It happens to measure 4.76 on the raised
surface, which is a property of this accent being a light one rather than a rule
the token holds — the blue before it measured 3.01 there. It is a fill, a focus
ring and an active state, and text that has to read as the accent uses
`--p-accent-quiet` either way, which clears 4.5 on every surface
(6.39 / 5.63 / 4.51 dark).

**2. A filled accent button takes the ink.** `--primary-foreground` is
`--p-ink`, near-black in the dark theme and near-white in the light one: **6.75**
dark, 5.02 light. White on the dark fill is 2.58. The label is a consequence of
the fill and not a constant — under the blue accent, which was a mid tone, it was
white at 4.43 and that was a stated exception. There is no exception now.

**3. Adjacent surfaces need a border.** Surface separation is 1.14 and 1.25, low
by construction because the family is dark. Two panels are told apart by their
border, not by luminance, which is why `--p-line-strong` exists and why it has to
clear 3.0 against *both* surfaces: 3.78 on surface, 3.02 on the raised one. At
120 the raised surface measured 2.78, which is what raised it to 126.

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

`--warning` was `--p-accent-quiet`. That held only while the accent was orange —
the warning mark and the accent were the same hue by accident, and no other hue
competed for the meaning — and it broke the moment the accent moved, which is
the whole argument for not deriving a status colour from a brand one. It is an
amber of its own per theme now, `#D9A441` dark and `#8A5A10` light, and it joins
the check, because a literal that derives from nothing is unchecked by default.

It stays independent now that the accent is orange again, which is when the
separation is hardest to see and most worth keeping.

### Focus

`--ring` is the **full** accent, not a wash of it. At 0.55 alpha the composited
ring fell under the 3.0 WCAG 1.4.11 asks of a focus indicator, and under the
figure the check reported, because the check read the token and the token was
not what got painted. At full strength the two agree: 6.75 on ink, 5.95 on a
panel, 4.76 on a raised surface.

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
