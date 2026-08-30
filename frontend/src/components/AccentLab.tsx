/**
 * A throwaway panel for choosing the accent, with the palette derived live.
 *
 * NOT PART OF THE PRODUCT. It exists because picking a brand colour by editing
 * index.css, reloading, and squinting is a slow loop, and because a colour
 * cannot be judged from a swatch -- it has to be judged on the surfaces it
 * lands on, at the sizes it lands at.
 *
 * What it does is what was done by hand for the blue: takes one colour, rotates
 * the neutral family onto its hue at CONSTANT luminance so every measured
 * ratio survives the change, searches for the quiet and dim variants that clear
 * their floors, writes the lot onto :root, and reports what each pair measures.
 *
 * Delete the file and the one line in App.tsx when the colour is chosen.
 */
import { useEffect, useMemo, useState } from "react"
import { useTheme } from "next-themes"

import { TOKENS, contrast, type Channels, type ThemeName } from "@/lib/contrast"
import {
  setViewportPaletteOverride,
  type ViewportPalette,
} from "@/lib/paletteWatch"

/* ---------------------------------------------------------------- colour */

function hexToRgb(hex: string): Channels | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (c: Channels) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")

function rgbToHsl([r, g, b]: Channels): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === R ? ((G - B) / d + (G < B ? 6 : 0))
    : max === G ? (B - R) / d + 2
    : (R - G) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): Channels {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) =>
    Math.round(v * 255)
  ) as unknown as Channels
}

const luminance = (c: Channels) => {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}

/** The same hue and saturation, at a lightness giving this luminance. */
function atLuminance(target: number, hue: number, sat: number): Channels {
  let lo = 0, hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (luminance(hslToRgb(hue, sat, mid)) < target) lo = mid
    else hi = mid
  }
  return hslToRgb(hue, sat, (lo + hi) / 2)
}

/** The lightest or darkest value on this hue that clears `floor` on `grounds`. */
function searchVariant(
  hue: number,
  sat: number,
  grounds: Channels[],
  floor: number,
  lighter: boolean
): Channels {
  const steps = Array.from({ length: 201 }, (_, i) => i / 200)
  const order = lighter ? steps : steps.slice().reverse()
  for (const l of order) {
    const c = hslToRgb(hue, sat, l)
    if (grounds.every((g) => contrast(c, g) >= floor)) return c
  }
  return hslToRgb(hue, sat, lighter ? 0.75 : 0.25)
}

/**
 * The haze, per theme, as index.css serves it.
 *
 * It lives here and not in TOKENS because it takes part in no contrast rule,
 * so the check has nothing to say about it. Keep it in step with index.css by
 * hand -- there is no guard on this pair, which is how it came to be two
 * retired Mars sand values long after the chassis went neutral.
 */
export const SHIPPED_HAZE: Record<ThemeName, Channels> = {
  dark: [144, 144, 144],
  light: [176, 176, 176],
}

const sameChannels = (a: Channels, b: Channels) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

export interface Derived {
  tokens: Record<string, Channels>
  checks: { label: string; ratio: number; floor: number; ok: boolean }[]
}

/**
 * The neutral family's own three axes, independent of the accent.
 *
 * The first version locked all three: the neutrals took the accent's hue and
 * kept the shipped luminance exactly, which is right for porting a palette to
 * a new accent and useless for deciding how dark the dark theme should be.
 *
 * `hue` is which way the greys lean, `chroma` how far, and `depth` scales the
 * luminance of the three SURFACES only -- ink, surface, raised. Text and lines
 * keep theirs, because moving both ends at once moves no ratio and would feel
 * like nothing is happening while every measurement changes underneath.
 */
export interface Neutrals {
  hue: number | null
  chroma: number
  depth: number
}

/** The whole family for one theme, from one accent and the neutral axes. */
export function derive(accent: Channels, theme: ThemeName, n: Neutrals): Derived {
  const base = TOKENS[theme]
  const [accentHue, sat] = rgbToHsl(accent)
  const hue = n.hue === null ? accentHue : n.hue / 360
  const dark = theme === "dark"

  /**
   * Hue and chroma applied, luminance held.
   *
   * THE IDENTITY IS EXACT, and is a correctness fix rather than a shortcut.
   * `atLuminance` bisects lightness and rounds to a channel, so it cannot
   * reproduce the value it was given: asking it for a token's own luminance at
   * a token's own saturation returned #1a1a1a as #181818. Small, and it applied
   * to every surface at once, so the panel at rest painted a chassis that was
   * not the one the stylesheet serves.
   *
   * When nothing is being asked of a token -- the saturation it would be
   * rebuilt at is the one it already has, and the luminance is its own -- the
   * answer is the token.
   */
  function tint(target: Channels, original: Channels): Channels {
    const [, s0] = rgbToHsl(original)
    const sat = Math.min(1, s0 * n.chroma)
    if (target === original && sat === s0) return original
    return atLuminance(luminance(target), hue, sat)
  }

  /** The same, for a value that is its own original. */
  const tintOf = (c: Channels) => tint(c, c)

  /*
    Depth moves a surface's luminance and the hue rotation preserves whatever
    it is moved to, so the two axes compose without fighting. Clamped away from
    zero: a surface at luminance zero is pure black, on which the separation
    between surfaces cannot exist at all.
  */
  const deepen = (c: Channels) =>
    n.depth === 1
      ? tintOf(c)
      : tint(atLuminance(Math.max(0.002, luminance(c) * n.depth), hue, 0), c)

  const t: Record<string, Channels> = {
    ink: deepen(base.ink),
    surface: deepen(base.surface),
    surfaceRaised: deepen(base.surfaceRaised),
    line: tintOf(base.line),
    lineStrong: tintOf(base.lineStrong),
    text: tintOf(base.text),
    muted: tintOf(base.muted),
    accent,
  }

  const grounds = [t.ink, t.surface, t.surfaceRaised]

  // The accent has to clear 3.0 as a boundary; nudge it toward the readable
  // side if the chosen value does not.
  if (!grounds.every((g) => contrast(t.accent, g) >= 3)) {
    t.accent = searchVariant(hue, sat, grounds, 3, dark)
  }
  /*
    KEPT WHILE THEY STILL PASS, rather than re-derived on every change.

    Both were computed unconditionally, and neither computation can land on the
    value the stylesheet serves: the quiet variant is the first of 201 lightness
    steps to clear 4.5, and the dim plate carried a hardcoded 0.86 in the dark
    theme. So the panel at rest reported #ec7d35 and #45220a where index.css
    serves #ec8039 and #4b250b -- it disagreed with the running application
    about a palette nobody had asked it to change.

    Conditioned on the accent being untouched, because these two exist to read
    AS the accent. Once it moves, a variant held over from the old hue is not a
    conservative choice, it is the wrong colour.
  */
  const accentHeld = sameChannels(t.accent, base.accent)
  const clears = (c: Channels, floor: number) =>
    grounds.every((g) => contrast(c, g) >= floor)

  t.accentQuiet =
    accentHeld && clears(base.accentQuiet, 4.5)
      ? base.accentQuiet
      : searchVariant(hue, sat, grounds, 4.5, dark)

  // The plate: dark enough (or light enough) for the accent to sit on it.
  const shippedDimHolds =
    accentHeld &&
    n.depth === 1 &&
    contrast(t.accent, base.accentDim) >= 3 &&
    contrast(t.accentQuiet, base.accentDim) >= 4.5
  t.accentDim = shippedDimHolds
    ? base.accentDim
    : atLuminance(
        dark
          ? luminance(base.accentDim) * 0.86 * n.depth
          : luminance(base.accentDim),
        hue,
        Math.min(1, sat * 0.9)
      )
  /*
    The haze takes part in no contrast rule, so TOKENS has no reason to carry
    it and its channels live here. They are the ones index.css serves.

    They used to be [196 128 84] and [196 150 118], which is the Mars sand haze
    -- warm, from the family that put the accent's hue in the surfaces. The
    chassis went neutral and this literal did not follow, so the panel emitted
    #c57f52 where the stylesheet serves #909090: the one token where the lab
    disagreed with the product by a whole hue rather than by rounding.
  */
  t.haze = tintOf(dark ? SHIPPED_HAZE.dark : SHIPPED_HAZE.light)

  const rule = (label: string, fg: Channels, bg: Channels, floor: number) => {
    const ratio = contrast(fg, bg)
    return { label, ratio, floor, ok: ratio >= floor }
  }
  const checks = [
    /*
      The surface separations first, because the depth axis is what moves them
      and they have no floor to clear -- 1.12 and 1.20 as shipped, low by
      construction, which is why --p-line-strong exists to tell panels apart.
      Listed at 1.0 so they read as measurements rather than as tests.
    */
    rule("ink → surface", t.surface, t.ink, 1),
    rule("surface → raised", t.surfaceRaised, t.surface, 1),
    rule("text on raised", t.text, t.surfaceRaised, 4.5),
    rule("muted on raised", t.muted, t.surfaceRaised, 4.5),
    rule("quiet on raised", t.accentQuiet, t.surfaceRaised, 4.5),
    rule("quiet on dim", t.accentQuiet, t.accentDim, 4.5),
    rule("accent on raised", t.accent, t.surfaceRaised, 3),
    rule("accent on dim", t.accent, t.accentDim, 3),
    rule("lineStrong on raised", t.lineStrong, t.surfaceRaised, 3),
    rule("white label on accent", [255, 255, 255], t.accent, 4.5),
    rule("ink label on accent", t.ink, t.accent, 4.5),
  ]
  return { tokens: t, checks }
}

const CSS_NAME: Record<string, string> = {
  ink: "--p-ink",
  surface: "--p-surface",
  surfaceRaised: "--p-surface-raised",
  line: "--p-line",
  lineStrong: "--p-line-strong",
  text: "--p-text",
  muted: "--p-muted",
  accent: "--p-accent",
  accentQuiet: "--p-accent-quiet",
  accentDim: "--p-accent-dim",
  haze: "--p-haze",
}

/** The accent the stylesheet is currently serving, as hex. */
function shippedAccent(): string {
  if (typeof getComputedStyle !== "function") return "#ED8744"
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--p-accent")
    .trim()
  const parts = raw.split(/\s+/).map(Number)
  return parts.length === 3 && parts.every((n) => Number.isFinite(n))
    ? toHex(parts as unknown as Channels)
    : "#ED8744"
}

/**
 * The same colour at a multiple of its luminance.
 *
 * Its own hue and saturation are kept, so a neutral stays neutral and a tinted
 * chassis keeps its lean. Clamped away from zero because a surface at luminance
 * zero is pure black, on which no separation can exist.
 */
function scaleLuminance(c: Channels, k: number): Channels {
  if (k === 1) return c
  const [h, sat] = rgbToHsl(c)
  return atLuminance(Math.max(0.002, luminance(c) * k), h, sat)
}

/**
 * A colour re-placed so it keeps the contrast it had, against a ground that
 * moved.
 *
 * The ground grid is the case. Its colour is `--p-line`, fixed, while the room
 * behind it is being lifted -- so past a certain lift the background PASSES it
 * and the grid inverts, going darker than what it is drawn on. Raising its
 * alpha then only makes it more wrong: over a room at #5a5a5a the whole alpha
 * range moved the composited channel by eight, downward.
 *
 * Holding the WCAG ratio instead keeps the grid the same distance from the room
 * at every lift, in the one measure the rest of this file already argues in.
 * The luminance is clamped: a ratio that would ask for more than white returns
 * white, which is the honest end of the scale rather than an overflow.
 */
function atRatio(newGround: Channels, fg: Channels, ground: Channels): Channels {
  const ratio = (luminance(fg) + 0.05) / (luminance(ground) + 0.05)
  const wanted = ratio * (luminance(newGround) + 0.05) - 0.05
  const [h, sat] = rgbToHsl(fg)
  return atLuminance(Math.min(1, Math.max(0, wanted)), h, sat)
}

/**
 * Where a candidate palette is allowed to land while it is being judged.
 *
 * "off" is in here rather than beside it. There used to be a separate live/off
 * switch, which made two controls for one decision and disagreed with itself:
 * off and the scope then called "tokens" were the same state -- nothing
 * painted, the block and the measurements still on screen -- reached by two
 * different controls. Worse, the scope row was disabled while off, so the
 * control that says what the lab does read as broken until you found the other
 * one.
 */
export type Scope = "off" | "both" | "interface" | "viewport"

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  {
    id: "off",
    label: "off",
    hint: "nothing is painted; the block and the measurements still read",
  },
  { id: "both", label: "both", hint: "tokens drive the CSS and the 3D scenes" },
  {
    id: "interface",
    label: "interface",
    hint: "CSS moves; the 3D scenes stay on what ships",
  },
  {
    id: "viewport",
    label: "viewport",
    hint: "the 3D scenes move; the CSS stays on what ships",
  },
]

/** The three chassis colours a scene takes, from a set of channels. */
function viewportTriple(
  ink: Channels,
  line: Channels,
  accent: Channels,
  gridOpacity: number
): ViewportPalette {
  const css = (c: Channels) => `rgb(${c[0]},${c[1]},${c[2]})`
  return {
    background: css(ink),
    line: css(line),
    accent: css(accent),
    gridOpacity,
  }
}

/** The ground grid's alpha in both scenes, which the grid control scales. */
const GRID_OPACITY = 0.14

/** A readout that names the colour a slider produced, not the slider's input. */
const hexOf = (c: Channels) => toHex(c).toUpperCase()

/* ------------------------------------------------------------------ panel */

/** One labelled slider with its value, since there are three of them. */
function Axis({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  /** What the readout says, where the stored value is not it. */
  display?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-meta">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer accent-[var(--accent)]"
      />
      <span className="telemetry w-10 shrink-0 text-right">
        {display ? display(value) : `${step < 1 ? value.toFixed(2) : value}${suffix}`}
      </span>
    </label>
  )
}

export function AccentLab() {
  /*
    Seeded from the palette that ships.

    The first version opened on a hardcoded blue and painted it, so simply
    having the lab mounted repainted the application in a colour nobody had
    chosen. A tool for judging a palette must show the real one until it is told
    otherwise -- see Scope for the other half of that, which is opening on
    "off".

    Every token follows from this one at rest, exactly: AccentLab.test.ts holds
    the eleven of them against index.css in both themes.
  */
  const [hex, setHex] = useState(shippedAccent)
  const [open, setOpen] = useState(true)
  /*
    WHERE the derived palette is allowed to land.

    "both" is the product's own arrangement: the stylesheet and the studio's 3D
    scenes read the same `--p-*`, so moving a token moves them together. That is
    right for shipping and useless for judging, because there is no moment where
    one is the candidate and the other is the reference.

    The other three take them apart. "interface" writes the tokens and pins the
    scenes to what ships; "viewport" leaves the tokens alone and pins the scenes
    to the candidate; "tokens" paints nothing at all and leaves the block and
    the measurements, for reading a palette without living in it.
  */
  const [scope, setScope] = useState<Scope>("off")
  const [followAccent, setFollowAccent] = useState(true)
  const [hueDeg, setHueDeg] = useState(214)
  const [chroma, setChroma] = useState(1)
  const [depth, setDepth] = useState(1)
  /*
    The viewport's own two, applied ON TOP of whatever palette the scope hands
    the scenes.

    The studio is a dark room with rasters in it; the panels around it are a
    reading surface. They are painted from the same two tokens -- `--p-ink` is
    both the application background and the 3D background, `--p-line` is both a
    divider and the ground grid -- so the one thing that could not be said
    before was "this room, deeper than the panels around it" or "this grid,
    fainter". These say it, and nothing else in the application moves.

    Multiples of luminance rather than colours of their own, so whichever hue
    was decided above is kept and only the depth of the room changes.
  */
  const [roomStops, setRoomStops] = useState(0)
  const [gridStops, setGridStops] = useState(0)
  /*
    The grid's own tone, from black up through grey.

    Separate from its alpha because they are separate questions and only one of
    them was answerable. The alpha decides how much of the grid arrives; the
    tone decides what arrives -- and a grid darker than the room reads as
    scored-in graph paper while a lighter one reads as drawn on top of it. With
    the tone pinned to a derived value there was no way to ask for the first.

    Stops away from the derived tone, so 0 is whatever keeps the grid at the
    distance from the room that --p-line has from --p-ink. Down is toward black.
  */
  const [toneStops, setToneStops] = useState(0)
  const { resolvedTheme } = useTheme()
  const theme: ThemeName = resolvedTheme === "light" ? "light" : "dark"

  const rgb = hexToRgb(hex)
  const neutrals: Neutrals = {
    hue: followAccent ? null : hueDeg,
    chroma,
    depth,
  }
  const derived = useMemo(
    () => (rgb ? derive(rgb, theme, neutrals) : null),
    [hex, theme, followAccent, hueDeg, chroma, depth]
  )

  // Written onto :root, where an inline custom property beats the stylesheet's
  // without touching it. Removing them restores the shipped palette exactly.
  const paintsCss = scope === "both" || scope === "interface"
  const paintsViewport = scope === "both" || scope === "viewport"

  useEffect(() => {
    const root = document.documentElement
    if (!derived || !paintsCss) {
      for (const name of Object.values(CSS_NAME)) root.style.removeProperty(name)
      return
    }
    for (const [key, name] of Object.entries(CSS_NAME)) {
      const c = derived.tokens[key]
      if (c) root.style.setProperty(name, c.join(" "))
    }
  }, [derived, paintsCss])

  /*
    The scenes are pinned in two of the four scopes, and for opposite reasons.

    Under "viewport" they are pinned to the CANDIDATE, because the tokens are
    deliberately not being written and reading them would give the scenes the
    shipped palette. Under "interface" they are pinned to what SHIPS, because
    the tokens ARE being written and reading them would drag the scenes along --
    which is the thing that scope exists to prevent.

    TOKENS is the source for "what ships" rather than the computed style: by the
    time this runs the inline properties are already on the element, so the
    computed style is the candidate, not the reference.
  */
  /*
    STOPS, doubling per unit, because luminance is not linear near black.

    On an ink of 19 a plain multiplier spends most of its travel in a range
    nothing can be seen in: 2.5x reaches only #222222, and a room bright enough
    to judge a raster against needs something like 12x to 20x. A slider with
    that as its maximum would squeeze everything under 3x into the first eighth
    of the track. One doubling per unit gives the same resolution at both ends,
    which is what a control over luminance wants.
  */
  const roomDepth = 2 ** roomStops
  // Alpha has a hard ceiling of 1: past a fully opaque grid there is nothing
  // left to ask for, and the tone below is where the remaining range lives.
  const gridOpacity = Math.min(1, GRID_OPACITY * 2 ** gridStops)
  const roomIsOffset =
    roomStops !== 0 || gridStops !== 0 || toneStops !== 0

  /*
    The room and the grid as colours, in the render rather than only in the
    effect, so the two readouts can say what the sliders actually produced. A
    control over luminance whose readout is its own input tells the reader
    nothing they could not already see on the track.
  */
  const roomSource = paintsViewport
    ? derived?.tokens
    : (TOKENS[theme] as unknown as Record<string, Channels>)
  const roomColour = roomSource
    ? scaleLuminance(roomSource.ink, roomDepth)
    : null
  const gridColour =
    roomSource && roomColour
      ? atLuminance(
          Math.min(
            1,
            luminance(atRatio(roomColour, roomSource.line, roomSource.ink)) *
              2 ** toneStops
          ),
          ...(rgbToHsl(roomSource.line).slice(0, 2) as [number, number])
        )
      : null

  useEffect(() => {
    if (!derived) return
    /*
      Nothing to pin: the scope leaves the scenes to the tokens and the room has
      no offset of its own, so releasing them is both correct and cheaper than
      handing them a copy of what they would read anyway.
    */
    if (!paintsViewport && !paintsCss && !roomIsOffset) {
      setViewportPaletteOverride(null)
      return
    }
    /*
      Which palette the room is an offset FROM. Under "viewport" and "both" it
      is the candidate. Under "interface" and "off" it is what ships, so a room
      offset can be judged against the shipped chassis without the panels moving
      with it -- and, under "interface", so the scenes are held still while the
      panels move, which is what that scope is for.

      TOKENS is the source for "what ships" rather than the computed style: by
      the time this runs the inline properties are already on the element, so
      the computed style is the candidate, not the reference.
    */
    if (!roomColour || !gridColour || !roomSource) return
    setViewportPaletteOverride(
      viewportTriple(roomColour, gridColour, roomSource.accent, gridOpacity)
    )
    return () => setViewportPaletteOverride(null)
    // roomColour and gridColour are arrays rebuilt on every render, so they
    // cannot be dependencies without re-running this every time; the numbers
    // they are computed from can.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    derived,
    paintsCss,
    paintsViewport,
    roomIsOffset,
    roomDepth,
    gridOpacity,
    toneStops,
    theme,
  ])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-[9999] rounded-sm bg-accent px-2 py-1 text-meta text-accent-foreground shadow-lg"
      >
        accent lab
      </button>
    )
  }

  const block = derived
    ? Object.entries(CSS_NAME)
        .map(([k, name]) =>
          derived.tokens[k] ? `  ${name}: ${derived.tokens[k].join(" ")};` : ""
        )
        .filter(Boolean)
        .join("\n")
    : ""

  return (
    <div
      className="panel-scroll fixed bottom-3 right-3 z-[9999] flex max-h-[80vh] w-[21rem] flex-col gap-2 overflow-auto rounded-sm border p-2 shadow-xl"
      style={{
        borderColor: "rgb(var(--p-line) / 0.4)",
        background: "rgb(var(--p-surface))",
      }}
    >
      <div className="flex items-center gap-2">
        <p className="eyebrow flex-1">Accent lab · {theme}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-sm px-1.5 py-0.5 text-meta text-muted-foreground"
        >
          hide
        </button>
      </div>

      {/*
        The whole of the lab's effect on the application, in one row, always
        clickable. It opens on "off": having the panel mounted must not repaint
        anything, since inline custom properties beat the stylesheet and that is
        both what makes the lab work and what would make it lie.
      */}
      <div
        className="flex gap-1"
        role="group"
        aria-label="Where the candidate palette is painted"
      >
        {SCOPES.map((sc) => {
          const active = sc.id === scope
          return (
            <button
              key={sc.id}
              type="button"
              title={sc.hint}
              aria-pressed={active}
              onClick={() => setScope(sc.id)}
              className="flex-1 cursor-pointer rounded-sm px-1 py-0.5 text-meta"
              style={{
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? "var(--accent-quiet)" : "rgb(var(--p-muted))",
              }}
            >
              {sc.label}
            </button>
          )
        })}
      </div>
      <p className="text-[9px] leading-snug text-muted-foreground">
        {SCOPES.find((sc) => sc.id === scope)?.hint}
      </p>

      <div className="flex items-center gap-2">
        <input
          type="color"
          value={rgb ? hex : "#3376CE"}
          onChange={(e) => setHex(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded-sm border-0 bg-transparent p-0"
        />
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          spellCheck={false}
          className="field-input telemetry h-8 flex-1 px-1.5 text-meta"
        />
      </div>

      {/* A few starting points, including the two this project has worn. */}
      <div className="flex flex-wrap gap-1">
        {["#3376CE", "#ED8744", "#2E9E6B", "#8B5CF6", "#D64545", "#0EA5A5"].map(
          (p) => (
            <button
              key={p}
              type="button"
              onClick={() => setHex(p)}
              title={p}
              className="size-5 rounded-sm border"
              style={{ background: p, borderColor: "rgb(var(--p-line) / 0.5)" }}
            />
          )
        )}
      </div>

      {/*
        The neutral family's own axes. Separate from the accent because
        deciding how dark the dark theme is, and how far it leans, is a
        different question from which colour the brand is -- and locking the
        first to the second is what made the palette only portable and not
        adjustable.
      */}
      <div className="flex flex-col gap-1.5 border-t pt-2" style={{ borderColor: "rgb(var(--p-line) / 0.25)" }}>
        <label className="flex items-center gap-2 text-meta text-muted-foreground">
          <input
            type="checkbox"
            checked={followAccent}
            onChange={(e) => setFollowAccent(e.target.checked)}
          />
          neutrals follow the accent's hue
        </label>
        {!followAccent && (
          <Axis
            label="hue"
            value={hueDeg}
            min={0}
            max={359}
            step={1}
            suffix="°"
            onChange={setHueDeg}
          />
        )}
        {/* Zero is a pure grey chassis; one is what ships. */}
        <Axis
          label="chroma"
          value={chroma}
          min={0}
          max={2.5}
          step={0.05}
          onChange={setChroma}
        />
        {/* Below one the surfaces deepen, above one they lift. */}
        <Axis
          label="depth"
          value={depth}
          min={0.25}
          max={2.5}
          step={0.05}
          onChange={setDepth}
        />
        <button
          type="button"
          onClick={() => {
            setFollowAccent(true)
            setChroma(1)
            setDepth(1)
            setRoomStops(0)
            setGridStops(0)
            setToneStops(0)
            setHex(shippedAccent())
          }}
          className="self-start rounded-sm px-1.5 py-0.5 text-meta text-muted-foreground"
        >
          back to what ships
        </button>
      </div>

      {/*
        The studio's own two, which move the 3D surfaces AND NOTHING ELSE.

        Separate from the neutral axes above because they answer a separate
        question. Those decide what the palette is; these decide how far the
        room the rasters sit in departs from it -- and they apply whatever the
        scope is, including "off", which is what makes them the only controls
        here that can move the viewport while the interface stays exactly as it
        ships.
      */}
      <div
        className="flex flex-col gap-1.5 border-t pt-2"
        style={{ borderColor: "rgb(var(--p-line) / 0.25)" }}
      >
        <p className="eyebrow">viewport only · 3D</p>
        {/*
          The room: the luminance of what the scenes read for --p-ink, which is
          the background and the fog. Up to five doublings, because on an ink
          this deep it takes about four to reach a grey a raster can be judged
          against.
        */}
        <Axis
          label="room"
          value={roomStops}
          min={-3}
          max={5}
          step={0.1}
          display={() => (roomColour ? hexOf(roomColour) : "--")}
          onChange={setRoomStops}
        />
        {/*
          The grid: its ALPHA, not its colour. At 0.14 the grid is a seventh of
          the pixel, so a colour control over it arrives divided by seven.
        */}
        <Axis
          label="grid"
          value={gridStops}
          min={-4}
          max={2.85}
          step={0.05}
          display={(v) => Math.min(1, GRID_OPACITY * 2 ** v).toFixed(3)}
          onChange={setGridStops}
        />
        {/*
          The grid's tone. Down is toward black, up toward a light grey; 0 is
          the tone that keeps the grid the distance from the room that --p-line
          has from --p-ink.
        */}
        <Axis
          label="tone"
          value={toneStops}
          min={-7}
          max={3}
          step={0.1}
          display={() => (gridColour ? hexOf(gridColour) : "--")}
          onChange={setToneStops}
        />
        <p className="text-[9px] leading-snug text-muted-foreground">
          Doublings per unit. Room is the luminance the scenes read for
          `--p-ink`, and its readout is the colour that comes out; grid is the
          ground's alpha, whose own value is 0.14 and whose ceiling is 1; tone is
          the ground's own colour, black through grey. No CSS surface moves with
          any of them, at any scope.
        </p>
      </div>

      {derived && (
        <>
          <div className="flex flex-col gap-0.5">
            {derived.checks.map((c) => (
              <div
                key={c.label}
                className="flex items-baseline gap-2 text-meta"
                style={{ color: c.ok ? undefined : "var(--destructive-quiet)" }}
              >
                <span className="flex-1 truncate text-muted-foreground">
                  {c.label}
                </span>
                <span className="telemetry">{c.ratio.toFixed(2)}</span>
                <span className="telemetry text-muted-foreground">
                  /{c.floor}
                </span>
              </div>
            ))}
          </div>

          {/*
            The two label rows are the trade this project already hit: a mid
            tone carries neither black nor white at 4.5, so one of them failing
            is information rather than an error.
          */}
          <p className="text-[9px] leading-snug text-muted-foreground">
            A mid tone fails both label rows; a light one fails white and a dark
            one fails ink. Pick which label you want, not a colour that passes
            both.
          </p>

          <pre
            className="telemetry overflow-auto rounded-sm p-1.5 text-[9px] leading-relaxed"
            style={{ background: "rgb(var(--p-ink))" }}
          >
            {block}
          </pre>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(block)}
            className="rounded-sm bg-accent px-2 py-1 text-meta text-accent-foreground"
          >
            Copy the {theme} block
          </button>
        </>
      )}
    </div>
  )
}
