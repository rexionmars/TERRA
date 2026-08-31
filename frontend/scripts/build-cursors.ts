/**
 * Turns the vendored AOSP pointer sources into the cursor rules in
 * src/cursors.css. Run with:
 *
 *   cd frontend && npx tsx scripts/build-cursors.ts
 *
 * The output is committed. This exists so the CSS can be re-derived rather than
 * hand-maintained -- a data URI holding a path is not something to edit in
 * place, and the hotspots are the kind of number that goes wrong silently.
 *
 * WHY SVG AND NOT PNG. A cursor image is normally rasterised, because engines
 * have historically refused SVG in `cursor:`. This one was measured rather than
 * assumed: the converted asset was applied in WebKit, which is the engine the
 * webview runs on darwin, and it painted. So the cursors stay vector, which
 * removes the rasteriser from the build and makes the result resolution
 * independent instead of correct at one scale factor.
 *
 * The parser below is deliberately narrow. VectorDrawable is a large format and
 * these 24 files use a small, regular corner of it, so anything outside that
 * corner throws instead of being quietly dropped -- a silently skipped path
 * would render as a cursor with a hole in it.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(here, "..", "vendor", "aosp-pointers")
const OUT = join(here, "..", "src", "cursors.css")

/**
 * Rendered edge, in CSS px, and the viewport the sources are drawn against.
 *
 * The sources are 24dp on a 24 unit viewport, so at SIZE 24 a hotspot in dp is
 * already a hotspot in px. Changing SIZE scales the hotspots with it; it is not
 * a free knob, since an engine will refuse a cursor past 32px on some platforms
 * and fall through to the keyword after the comma.
 */
const SIZE = 24
const VIEWPORT = 24

/**
 * The four theme attributes the drawables name, resolved per variant.
 *
 * AOSP draws a pointer as a body under a one unit outline. `normal` is its
 * black-body pair and `inverse` reverses it. Which one a theme takes is a
 * contrast question and is decided in the emitted CSS, not here.
 */
const PALETTES = {
  normal: {
    pointerIconVectorFill: "#000000",
    pointerIconVectorStroke: "#ffffff",
    pointerIconVectorFillInverse: "#ffffff",
    pointerIconVectorStrokeInverse: "#000000",
  },
  inverse: {
    pointerIconVectorFill: "#ffffff",
    pointerIconVectorStroke: "#000000",
    pointerIconVectorFillInverse: "#000000",
    pointerIconVectorStrokeInverse: "#ffffff",
  },
} as const

type Variant = keyof typeof PALETTES

/** Reads one `android:*` attribute off a tag body, or null when absent. */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`android:${name}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

function required(tag: string, name: string, file: string): string {
  const v = attr(tag, name)
  if (v === null) throw new Error(`${file}: <path> without android:${name}`)
  return v
}

/**
 * Android writes eight digit colours as #AARRGGBB. CSS reads #RRGGBBAA. Five of
 * the drawables carry literal colours in that form, and read straight through
 * they would come out with the alpha as the red channel.
 */
function resolveColor(value: string, palette: Record<string, string>, file: string): string {
  if (value.startsWith("?attr/")) {
    const key = value.slice("?attr/".length)
    const hit = palette[key]
    if (!hit) throw new Error(`${file}: unmapped theme attribute ${value}`)
    return hit
  }
  if (/^#[0-9a-fA-F]{8}$/.test(value)) {
    return `#${value.slice(3)}${value.slice(1, 3)}`
  }
  if (/^#[0-9a-fA-F]{3,6}$/.test(value)) return value
  throw new Error(`${file}: unreadable colour ${value}`)
}

/**
 * Pulls the paths out of a drawable, in document order.
 *
 * <group> appears in eight of the files and none of them carries a transform,
 * so groups flatten. A group that grew one would move its paths, so that case
 * throws rather than emitting a pointer with a limb in the wrong place.
 */
function paths(xml: string, file: string): string[] {
  for (const g of xml.match(/<group\b[^>]*>/g) ?? []) {
    const attrs = g.replace(/^<group\s*/, "").replace(/\/?>$/, "").trim()
    const meaningful = attrs.replace(/android:name\s*=\s*"[^"]*"/g, "").trim()
    if (meaningful) throw new Error(`${file}: <group> carries ${meaningful}`)
  }
  return xml.match(/<path\b[\s\S]*?\/>/g) ?? []
}

function toSvg(drawable: string, file: string, variant: Variant): string {
  const palette = PALETTES[variant] as unknown as Record<string, string>
  const vector = drawable.match(/<vector\b[\s\S]*?>/)
  if (!vector) throw new Error(`${file}: no <vector> root (animation lists are unsupported)`)
  const vw = attr(vector[0], "viewportWidth")
  const vh = attr(vector[0], "viewportHeight")
  if (vw !== String(VIEWPORT) || vh !== String(VIEWPORT)) {
    throw new Error(`${file}: viewport ${vw}x${vh}, expected ${VIEWPORT}`)
  }

  const body = paths(drawable, file).map((tag) => {
    const d = required(tag, "pathData", file)
    const fill = resolveColor(required(tag, "fillColor", file), palette, file)
    const rule = attr(tag, "fillType")
    return `<path fill="${fill}"${rule ? ` fill-rule="${rule.toLowerCase()}"` : ""} d="${d}"/>`
  })
  if (body.length === 0) throw new Error(`${file}: no paths`)

  // width and height are explicit. An SVG used as an image with only a viewBox
  // has no intrinsic size, and an engine left to guess one will not guess 24 --
  // which would put the hotspot somewhere other than the tip.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" ` +
    `viewBox="0 0 ${VIEWPORT} ${VIEWPORT}">${body.join("")}</svg>`
  )
}

/**
 * Minimal percent-encoding: the characters that would end the url() or open a
 * comment, and nothing else. Encoding the whole document is correct too, but
 * roughly doubles a file that is already going into a stylesheet by hand.
 */
function dataUri(svg: string): string {
  const escaped = svg
    .replace(/%/g, "%25")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E")
    .replace(/#/g, "%23")
    .replace(/"/g, "'")
  return `data:image/svg+xml,${escaped}`
}

type Pointer = { name: string; hotspot: [number, number]; svg: Record<Variant, string> }

function read(): Pointer[] {
  const icons = readdirSync(VENDOR).filter((f) => f.endsWith("_vector_icon.xml")).sort()
  return icons.map((iconFile) => {
    const icon = readFileSync(join(VENDOR, iconFile), "utf8")
    const tag = icon.match(/<pointer-icon\b[\s\S]*?\/>/)
    if (!tag) throw new Error(`${iconFile}: no <pointer-icon>`)
    const hx = Number(attr(tag[0], "hotSpotX")!.replace("dp", ""))
    const hy = Number(attr(tag[0], "hotSpotY")!.replace("dp", ""))
    if (!Number.isFinite(hx) || !Number.isFinite(hy)) throw new Error(`${iconFile}: bad hotspot`)

    const drawableName = attr(tag[0], "bitmap")!.split("/").pop()!
    const drawableFile = join(VENDOR, "drawable", `${drawableName}.xml`)
    const drawable = readFileSync(drawableFile, "utf8")

    const scale = SIZE / VIEWPORT
    return {
      name: iconFile.slice("pointer_".length, -"_vector_icon.xml".length).replace(/_/g, "-"),
      hotspot: [hx * scale, hy * scale],
      svg: {
        normal: toSvg(drawable, drawableName, "normal"),
        inverse: toSvg(drawable, drawableName, "inverse"),
      },
    }
  })
}

/**
 * Which AOSP pointer answers which CSS keyword, and the keyword each rule keeps
 * after the comma.
 *
 * The fallback is not decoration. If an engine refuses the image, or the image
 * exceeds what it will take, the rule still resolves -- to the platform cursor
 * that was there before any of this. `wait` and `progress` appear nowhere below
 * because AOSP draws them as an 88 frame animation and CSS takes one image.
 */
const KEYWORDS: Record<string, string[]> = {
  arrow: ["default"],
  hand: ["pointer"],
  text: ["text"],
  "vertical-text": ["vertical-text"],
  crosshair: ["crosshair"],
  cell: ["cell"],
  help: ["help"],
  copy: ["copy"],
  alias: ["alias"],
  "context-menu": ["context-menu"],
  nodrop: ["not-allowed", "no-drop"],
  grab: ["grab"],
  grabbing: ["grabbing"],
  "all-scroll": ["all-scroll", "move"],
  "zoom-in": ["zoom-in"],
  "zoom-out": ["zoom-out"],
  "horizontal-double-arrow": ["ew-resize", "col-resize"],
  "vertical-double-arrow": ["ns-resize", "row-resize"],
  "top-left-diagonal-double-arrow": ["nwse-resize"],
  "top-right-diagonal-double-arrow": ["nesw-resize"],
}

/** Two spaces onto every non-empty line, so nested rules read as nested. */
const indent = (block: string) =>
  block
    .split("\n")
    .map((l) => (l ? `  ${l}` : l))
    .join("\n")

function emit(pointers: Pointer[]): string {
  const byName = new Map(pointers.map((p) => [p.name, p]))
  const unmapped = pointers.filter((p) => !KEYWORDS[p.name]).map((p) => p.name)
  const missing = Object.keys(KEYWORDS).filter((n) => !byName.has(n))
  if (missing.length) throw new Error(`mapped but not vendored: ${missing.join(", ")}`)
  const unmappedNote = unmapped.length ? `, unmapped: ${unmapped.join(", ")}` : ""

  /** Every keyword this set answers, paired with the pointer that answers it. */
  const bindings: [string, Pointer][] = Object.entries(KEYWORDS).flatMap(
    ([name, keywords]) => keywords.map((k) => [k, byName.get(name)!] as [string, Pointer]),
  )

  /**
   * One custom property per keyword, holding the whole cursor value.
   *
   * This is the part that reaches the places a utility class cannot. The
   * interface sets cursors three ways -- the Tailwind utilities, bare
   * declarations in this stylesheet on things like `button, a, [role=button]`,
   * and inline style objects in the studio -- and only the first is a class.
   * A bare `cursor: pointer` on a button outranks anything :root says, and an
   * inline style outranks everything, so both keep the platform cursor unless
   * they can name this value. As a variable they can: `cursor:
   * var(--cursor-pointer)` reads the same in a rule, in an inline style, and
   * from JS setting canvas.style.cursor.
   */
  const properties = (variant: Variant) =>
    bindings
      .map(([keyword, p]) => {
        const [hx, hy] = p.hotspot
        return `--cursor-${keyword}: url("${dataUri(p.svg[variant])}") ${hx} ${hy}, ${keyword};`
      })
      .join("\n")

  /**
   * The utility overrides, now just reading the properties above.
   *
   * These stay unlayered so they outrank Tailwind's utilities layer without
   * needing the theme selector for weight.
   */
  const utilities = bindings
    .map(([keyword]) => `.cursor-${keyword} {\n  cursor: var(--cursor-${keyword});\n}`)
    .join("\n\n")

  return `/*
  GENERATED by scripts/build-cursors.ts -- edit that, not this.

  Android's pointer set, as CSS. The sources and their provenance are in
  vendor/aosp-pointers; they are AOSP's own work under Apache 2.0.

  HOW THIS APPLIES. Each keyword becomes a --cursor-* custom property holding a
  whole cursor value, image and fallback together. The Tailwind utilities are
  then re-declared to read those properties, so call sites using a class are
  untouched. Anything that cannot use a class -- a bare declaration on
  \`button, a, [role=button]\`, an inline style object, a canvas cursor set from
  JS -- says \`var(--cursor-pointer)\` instead of \`pointer\` and gets the same
  value. Specificity is why this matters rather than being a convenience: a bare
  declaration outranks :root and an inline style outranks every rule, so neither
  can be reached by a selector, only by naming the value.

  THE FALLBACK IS LOAD-BEARING. Every property ends in the keyword it replaces.
  An engine that refuses the image, or refuses it at this size, resolves to the
  platform cursor that was there before any of this.

  WHICH VARIANT A THEME TAKES. A pointer is a body under a one unit outline, so
  the body is what has to carry against the surface. Measured the way the rest
  of the system measures, a black body reads 1.30 to 2.13 against the dark
  surfaces and 16.36 to 19.97 against the light ones; a white body reverses
  that, 9.87 to 16.10 dark and 1.05 to 1.28 light. So light takes AOSP's normal
  pair and dark takes its inverse, and the worst body reading anywhere is 9.87.

  ORDER FOLLOWS index.css. Dark is written first as the unqualified :root and
  light overrides it, which is how the palette above it is already arranged.

  WHAT KEEPS THE PLATFORM CURSOR. wait and progress, because AOSP draws those as
  an 88 frame animation and a CSS cursor is one image. Any keyword with no
  property below is likewise untouched.

  ${SIZE}px, ${pointers.length} pointers, ${bindings.length} keywords${unmappedNote}.
*/

:root,
:root[data-theme="dark"] {
${indent(properties("inverse"))}
}

:root[data-theme="light"] {
${indent(properties("normal"))}
}

${utilities}

html,
body {
  cursor: var(--cursor-default);
}
`
}

/*
  --check regenerates into memory and compares, rather than writing.
 
  The generated file is committed, which means it can go stale against the
  sources or be edited in place, and neither shows up as a broken build -- a
  wrong hotspot is a cursor that clicks a few pixels off, which reads as a
  flaky interface rather than as a bug in a stylesheet. This is the same guard
  check-contrast.ts puts on the palette, for the same reason.
*/
const check = process.argv.includes("--check")
const pointers = read()
const generated = emit(pointers)

if (check) {
  const onDisk = readFileSync(OUT, "utf8")
  if (onDisk !== generated) {
    console.error(
      `src/cursors.css does not match what scripts/build-cursors.ts produces ` +
        `from vendor/aosp-pointers.\nRun: npx tsx scripts/build-cursors.ts`,
    )
    process.exit(1)
  }
  console.log(
    `cursors: ${pointers.length} pointers, 2 variants, ${SIZE}px -- ` +
      `src/cursors.css matches the vendored sources.`,
  )
} else {
  writeFileSync(OUT, generated)
  console.log(`cursors: ${pointers.length} pointers, 2 variants, ${SIZE}px`)
  console.log(`wrote ${OUT} (${(generated.length / 1024).toFixed(1)} KB)`)
}
