/**
 * Turns the vendored Breeze sources into the icon components in
 * src/components/icons.tsx. Run with:
 *
 *   cd frontend && npx tsx scripts/build-icons.ts
 *
 * The output is committed, for the reason build-cursors.ts gives: a string
 * holding a path is not something to edit in place.
 *
 * WHY A GENERATOR AND NOT A PACKAGE. Breeze is published as a desktop icon
 * theme, not as a JavaScript library, and nothing on npm carries it. So the
 * SVGs the interface uses are vendored and this file is what a package would
 * otherwise have been.
 *
 * THE NAMES ARE THE APPLICATION'S, NOT BREEZE'S. A freedesktop name says what
 * an icon is for in a desktop -- edit-delete, view-refresh -- and a good part
 * of the set is reached through aliases. The call sites keep the names they
 * already had, which describe the drawing, and the table below is the one
 * place that says which Breeze icon answers to each. Changing a glyph is one
 * line here.
 *
 * COLOUR IS DISCARDED, ON PURPOSE. A Breeze icon carries a stylesheet that
 * paints it from the desktop's colour scheme -- red for delete, orange for a
 * warning. Here colour belongs to the call site, which sets it with a text
 * class, so every source is flattened to currentColor. The few literal colours
 * are named in RECOLOUR per icon; one this file has not been told about throws,
 * because guessing would ship a glyph with a patch that ignores the theme.
 *
 * The parser is deliberately narrow, as the cursor one is. Anything outside the
 * corner of SVG these files use throws instead of being quietly dropped.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(here, "..", "vendor", "breeze-icons", "icons")
const OUT = join(here, "..", "src", "components", "icons.tsx")

/**
 * Component name to Breeze source, as context/size/name under vendor/.
 *
 * 16 IS THE GRID, because the interface draws icons at 10 to 20px and a 16px
 * drawing holds its one-unit lines there. The 22px sources are the exceptions,
 * taken only where Breeze has no 16px drawing of the subject; their lines come
 * out a little finer at the same rendered size.
 */
const ICONS: Record<string, string> = {
  ArrowClockwise: "actions/16/view-refresh",
  ArrowCounterClockwise: "actions/16/edit-reset",
  ArrowDown: "actions/16/arrow-down",
  ArrowLeft: "actions/16/go-previous",
  ArrowSquareOut: "actions/16/window-new",
  ArrowUp: "actions/16/arrow-up",
  ArrowsClockwise: "actions/16/view-refresh",
  ArrowsOut: "actions/16/view-fullscreen",
  ArrowsOutCardinal: "actions/16/transform-move",
  Bell: "actions/16/notifications",
  Book: "actions/16/documentation",
  BracketsCurly: "actions/16/code-context",
  Broadcast: "devices/16/network-wireless", // radar
  Camera: "devices/16/camera-photo",
  CaretDown: "actions/16/go-down",
  CaretLeft: "actions/16/go-previous",
  CaretRight: "actions/16/go-next",
  ChartLine: "actions/16/office-chart-line",
  ChatCentered: "actions/16/dialog-messages",
  Check: "actions/16/checkmark",
  CheckCircle: "status/16/task-complete",
  CircleNotch: "status/16/process-working-symbolic", // the spinner: Breeze's busy glyph is a cog, and it turns under animate-spin
  Clock: "actions/16/clock",
  Columns: "actions/16/view-split-left-right",
  Compass: "actions/16/compass",
  CompassTool: "actions/16/compass",
  Copy: "actions/16/edit-copy",
  CornersOut: "actions/16/zoom-fit-best",
  Crosshair: "actions/16/crosshairs",
  Diamond: "actions/16/choice-rhomb", // mineral
  Download: "actions/16/download",
  DownloadSimple: "actions/16/download",
  Drop: "actions/22/raindrop",
  Eye: "actions/16/view-visible",
  EyeSlash: "actions/16/view-hidden",
  File: "mimetypes/16/unknown",
  FileArrowDown: "actions/16/document-save-as",
  FilePdf: "actions/16/viewpdf",
  FloppyDisk: "actions/16/document-save",
  Folder: "places/16/folder",
  FolderOpen: "actions/16/document-open-folder",
  FolderSimpleUser: "places/16/user-home",
  Folders: "actions/16/folder-stash",
  Gear: "actions/16/configure", // Breeze draws settings as sliders, and its only cog is the spinner
  Globe: "actions/16/globe",
  Graph: "actions/22/distribute-graph-directed",
  HardDrive: "devices/16/drive-harddisk",
  Heart: "actions/16/love",
  House: "actions/16/go-home",
  Image: "actions/16/viewimage",
  ImageSquare: "actions/16/insert-image",
  Info: "actions/16/help-about",
  Keyboard: "devices/16/input-keyboard",
  Lifebuoy: "actions/16/help-contents",
  List: "actions/16/view-list-details",
  MagnifyingGlass: "actions/16/search",
  MapPin: "actions/16/mark-location",
  MapTrifold: "actions/22/map-flat",
  Minus: "actions/16/value-decrease", // list-remove is drawn as a cross in Breeze, so the minus comes from here
  Mountains: "actions/16/office-chart-area", // terrain; the nearest silhouette Breeze has
  Note: "actions/16/view-pim-notes",
  Package: "actions/16/package",
  Path: "actions/16/draw-path",
  Pencil: "actions/16/document-edit",
  PencilSimple: "actions/16/edit-rename",
  Planet: "actions/22/map-globe",
  Plant: "actions/22/flower-shape", // vegetation; Breeze draws no leaf at either size
  Play: "actions/16/media-playback-start",
  Plus: "actions/16/list-add",
  Polygon: "actions/16/draw-polyline",
  Prohibit: "actions/16/dialog-cancel",
  RoadHorizon: "actions/16/routeplanning",
  Shapes: "actions/16/shapes",
  SidebarCollapse: "actions/16/sidebar-collapse-left",
  SidebarSimple: "actions/16/sidebar-expand-left",
  SignIn: "actions/16/system-switch-user", // Breeze has system-log-out and no system-log-in
  SignOut: "actions/16/system-log-out",
  SlidersHorizontal: "actions/22/adjustlevels",
  Sparkle: "actions/16/tools-wizard",
  Square: "actions/16/draw-rectangle",
  SquareSplitHorizontal: "actions/16/view-split-left-right",
  SquaresFour: "actions/16/view-list-icons",
  Stack: "actions/16/dialog-layers",
  Star: "status/16/rating-unrated",
  Table: "actions/16/table",
  Terminal: "actions/16/dialog-scripts",
  Trash: "actions/16/edit-delete",
  Tray: "places/16/mail-folder-inbox",
  TreeStructure: "actions/16/view-list-tree",
  Upload: "actions/16/cloud-upload", // Breeze has no mirror of download
  UploadSimple: "actions/16/document-import",
  User: "actions/16/user",
  UserPlus: "actions/16/list-add-user",
  Warning: "status/16/dialog-warning",
  WarningOctagon: "status/16/dialog-error",
  Waves: "actions/16/waveform",
  X: "actions/16/window-close",
}

/**
 * Literal colours, per source, and what each becomes.
 *
 * "currentColor" joins the rest of the glyph. "cut" is for a mark drawn in
 * white over a filled shape: painted in currentColor it would vanish into the
 * shape, so it is cut out of it with a mask and the background shows through.
 */
const RECOLOUR: Record<string, Record<string, "currentColor" | "cut">> = {
  "status/16/dialog-warning": { "#fff": "cut" },
  "status/16/dialog-error": { "#fff": "cut" },
  "actions/16/table": { "#1d99f3": "currentColor" },
  "actions/16/routeplanning": { "#2ecc71": "currentColor" },
  "actions/16/viewpdf": { "#d24d57": "currentColor" },
  "mimetypes/16/unknown": { "#6c7a89": "currentColor" },
}

type El = { tag: string; attrs: Record<string, string>; children: El[] }

const SHAPES = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
])
/** Carried by the sources and meaning nothing once the stylesheet is gone. */
const SKIPPED = new Set(["defs", "style", "metadata", "title", "desc"])
const PAINT = ["fill", "stroke"]
const KEPT = new Set([
  "d",
  "x",
  "y",
  "width",
  "height",
  "rx",
  "ry",
  "cx",
  "cy",
  "r",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "transform",
  "opacity",
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
])
/** A value that says what SVG already assumes. */
const DEFAULTS: Record<string, string[]> = {
  opacity: ["1"],
  "fill-opacity": ["1"],
  "stroke-opacity": ["1"],
  "fill-rule": ["nonzero"],
  "clip-rule": ["nonzero"],
}
/**
 * Editor residue, and properties that do nothing to a filled shape. Listed
 * rather than matched by pattern so that a property nobody has looked at is an
 * error and not a silent omission.
 */
const DROPPED = new Set(["id", "class", "version", "xmlns", "color", "paint-order"])

function parse(source: string, where: string): El {
  const text = source
    .replace(/<\?xml[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
  const root: El = { tag: "#root", attrs: {}, children: [] }
  const stack: El[] = [root]
  const tagRe =
    /<(\/)?([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g
  let last = 0
  for (let m = tagRe.exec(text); m; m = tagRe.exec(text)) {
    const between = text.slice(last, m.index)
    const top = stack[stack.length - 1]
    if (between.trim() && !SKIPPED.has(top.tag)) {
      throw new Error(
        `${where}: text outside an element: ${between.trim().slice(0, 40)}`
      )
    }
    last = m.index + m[0].length
    const [, closing, tag, rawAttrs, selfClosing] = m
    if (closing) {
      if (top.tag !== tag) throw new Error(`${where}: </${tag}> closes <${top.tag}>`)
      stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[a[1]] = a[2] ?? a[3]
    }
    const el: El = { tag, attrs, children: [] }
    top.children.push(el)
    if (!selfClosing) stack.push(el)
  }
  if (text.slice(last).trim()) throw new Error(`${where}: text after the last element`)
  if (stack.length !== 1) {
    throw new Error(`${where}: <${stack[stack.length - 1].tag}> is never closed`)
  }
  if (root.children.length !== 1 || root.children[0].tag !== "svg") {
    throw new Error(`${where}: not a single <svg>`)
  }
  return root.children[0]
}

/** One element's presentation, with `style` folded into attributes and the noise gone. */
function presentation(el: El, where: string): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(el.attrs)) if (k !== "style") merged[k] = v
  // A declaration outranks the attribute of the same name, as it does in a renderer.
  for (const decl of (el.attrs.style ?? "").split(";")) {
    const at = decl.indexOf(":")
    if (at > 0) merged[decl.slice(0, at).trim()] = decl.slice(at + 1).trim()
  }
  const out: Record<string, string> = {}
  for (const [k, raw] of Object.entries(merged)) {
    const v = raw.trim()
    // A namespaced attribute is the editor's (inkscape:, sodipodi:, xmlns:).
    if (k.includes(":") || DROPPED.has(k)) continue
    if (!KEPT.has(k)) {
      throw new Error(
        `${where}: <${el.tag}> carries ${k}="${v}", which this generator does not know`
      )
    }
    if (!DEFAULTS[k]?.includes(v)) out[k] = v
  }
  return out
}

type Glyph = { box: number; body: string }

function build(name: string, source: string): Glyph {
  const where = `${source}.svg`
  const svg = parse(readFileSync(join(VENDOR, where), "utf8"), where)
  const recolour = RECOLOUR[source] ?? {}
  const used = new Set<string>()

  const view = (svg.attrs.viewBox ?? `0 0 ${svg.attrs.width} ${svg.attrs.height}`)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const box = view[2]
  if (
    view.length !== 4 ||
    view[0] !== 0 ||
    view[1] !== 0 ||
    view[3] !== box ||
    (box !== 16 && box !== 22)
  ) {
    throw new Error(
      `${where}: viewBox ${svg.attrs.viewBox} is not a 16 or 22 square at the origin`
    )
  }
  if (source.split("/")[1] !== String(box)) {
    throw new Error(`${where}: drawn on ${box}, filed under ${source.split("/")[1]}`)
  }

  const cuts: string[] = []

  const paint = (value: string, prop: string): string => {
    if (value === "currentColor" || value === "none") return value
    const to = recolour[value.toLowerCase()]
    if (!to) {
      throw new Error(
        `${where}: ${prop} is the literal ${value}, and RECOLOUR does not say what it becomes`
      )
    }
    used.add(value.toLowerCase())
    return to
  }

  /**
   * `fill` and `stroke` are what the parent already resolves to. An attribute
   * that only repeats its parent is not written, which is most of them: the
   * root paints in currentColor and nearly every path asks for exactly that.
   */
  const write = (el: El, fill: string, stroke: string, depth: number): string => {
    if (SKIPPED.has(el.tag) || el.tag.includes(":")) {
      const live = el.children.filter(
        (c) => !SKIPPED.has(c.tag) && !c.tag.includes(":")
      )
      if (live.length) {
        throw new Error(
          `${where}: <${el.tag}> holds <${live[0].tag}>, which would be lost`
        )
      }
      return ""
    }
    if (el.tag !== "g" && !SHAPES.has(el.tag)) {
      throw new Error(`${where}: <${el.tag}> is not an element this generator draws`)
    }

    const attrs = presentation(el, where)
    for (const prop of PAINT) if (prop in attrs) attrs[prop] = paint(attrs[prop], prop)
    const ownFill = attrs.fill ?? fill
    const ownStroke = attrs.stroke ?? stroke
    if (attrs.fill === fill) delete attrs.fill
    if (attrs.stroke === stroke) delete attrs.stroke
    // Width, cap and join of a stroke that is never drawn.
    if (ownStroke === "none" && el.tag !== "g") {
      for (const k of Object.keys(attrs)) if (k.startsWith("stroke-")) delete attrs[k]
    }

    if (ownFill === "cut") {
      if (depth !== 0 || el.tag === "g") {
        throw new Error(`${where}: a cut mark must be a shape at the top level`)
      }
      cuts.push(tag(el.tag, { ...attrs, fill: "#000" }))
      return ""
    }

    if (el.tag === "g") {
      const inner = el.children
        .map((c) => write(c, ownFill, ownStroke, depth + 1))
        .join("")
      if (!inner) return ""
      return Object.keys(attrs).length ? `<g${attributes(attrs)}>${inner}</g>` : inner
    }
    if (el.children.some((c) => !SKIPPED.has(c.tag))) {
      throw new Error(`${where}: <${el.tag}> has children`)
    }
    if (ownFill === "none" && ownStroke === "none") return ""
    return tag(el.tag, attrs)
  }

  // The root is read as a group: a fill on <svg> is inherited like any other.
  const rootAttrs = presentation(
    { ...svg, attrs: without(svg.attrs, ["viewBox", "width", "height", "x", "y"]) },
    where
  )
  for (const k of Object.keys(rootAttrs)) {
    if (!PAINT.includes(k)) {
      throw new Error(
        `${where}: <svg> carries ${k}, which the component's own root would drop`
      )
    }
  }
  const rootFill = "fill" in rootAttrs ? paint(rootAttrs.fill, "fill") : "currentColor"
  if ("stroke" in rootAttrs && rootAttrs.stroke !== "none") {
    throw new Error(`${where}: a stroke on <svg>`)
  }
  let body = svg.children.map((c) => write(c, rootFill, "none", 0)).join("")
  if (rootFill !== "currentColor") body = `<g fill="${rootFill}">${body}</g>`

  if (!body) throw new Error(`${where}: nothing left to draw`)
  for (const literal of Object.keys(recolour)) {
    if (!used.has(literal)) {
      throw new Error(
        `${where}: RECOLOUR names ${literal}, which the source does not use`
      )
    }
  }
  if (cuts.length) {
    // One id per glyph, not per instance: every copy of a mask on the page is
    // the same mask, so which of them a reference resolves to does not matter.
    const id = `breeze-cut-${name}`
    body =
      `<mask id="${id}"><path fill="#fff" d="M0 0h${box}v${box}H0z"/>${cuts.join("")}</mask>` +
      `<g mask="url(#${id})">${body}</g>`
  }
  return { box, body }
}

function without(
  attrs: Record<string, string>,
  names: string[]
): Record<string, string> {
  const out = { ...attrs }
  for (const n of names) delete out[n]
  return out
}

function attributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(
      ([k, v]) =>
        ` ${k}="${(k === "d" || k === "points" ? v.replace(/\s+/g, " ") : v).trim()}"`
    )
    .join("")
}

function tag(name: string, attrs: Record<string, string>): string {
  return `<${name}${attributes(attrs)}/>`
}

function emit(): string {
  const names = Object.keys(ICONS)
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (names.join() !== sorted.join()) {
    const at = names.findIndex((n, i) => n !== sorted[i])
    throw new Error(`ICONS is not in alphabetical order at ${names[at]}`)
  }
  for (const source of Object.keys(RECOLOUR)) {
    if (!Object.values(ICONS).includes(source)) {
      throw new Error(`RECOLOUR names ${source}, which no icon uses`)
    }
  }

  // Several names can answer to one drawing; the string is written once.
  const first = new Map<string, string>()
  const lines: string[] = []
  for (const name of names) {
    const source = ICONS[name]
    if (!/^[A-Z][A-Za-z]*$/.test(name)) {
      throw new Error(`${name} is not a component name`)
    }
    if (!existsSync(join(VENDOR, `${source}.svg`))) {
      throw new Error(
        `${name}: vendor/breeze-icons/icons/${source}.svg is not vendored`
      )
    }
    const twin = first.get(source)
    if (twin) {
      lines.push(`/** ${source} */\nexport const ${name} = ${twin}`)
      continue
    }
    first.set(source, name)
    const { box, body } = build(name, source)
    lines.push(
      `/** ${source} */\nexport const ${name} = glyph(${box}, ${JSON.stringify(body)})`
    )
  }

  return `/*
  GENERATED by scripts/build-icons.ts from vendor/breeze-icons. Do not edit:
  change the table in the script and run \`npm run build:icons\`.

  The drawings are KDE's Breeze icons, LGPL-3.0-or-later. The licence and the
  provenance are in vendor/breeze-icons.
*/
import type { ComponentType, SVGProps } from "react"

export type Icon = ComponentType<SVGProps<SVGSVGElement>>

/*
  1em and currentColor, so a glyph follows the text it sits in until a class
  says otherwise -- every call site sizes with size-* and colours with text-*.

  The body is set as markup rather than written out as JSX because it is the
  generator's own output from files in this repository, and as a string each
  glyph costs its path data and nothing else.
*/
function glyph(box: 16 | 22, body: string): Icon {
  const viewBox = \`0 0 \${box} \${box}\`
  return function BreezeIcon(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
        {...props}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    )
  }
}

${lines.join("\n\n")}
`
}

/*
  --check regenerates into memory and compares, rather than writing, as
  build-cursors.ts does and for the same reason: the generated file is
  committed, so it can go stale against the table or be edited in place, and
  neither is a broken build.
*/
const check = process.argv.includes("--check")
const generated = emit()
const count = `${Object.keys(ICONS).length} names over ${new Set(Object.values(ICONS)).size} Breeze drawings`

if (check) {
  const onDisk = existsSync(OUT) ? readFileSync(OUT, "utf8") : ""
  if (onDisk !== generated) {
    console.error(
      `src/components/icons.tsx does not match what scripts/build-icons.ts ` +
        `produces from vendor/breeze-icons.\nRun: npx tsx scripts/build-icons.ts`
    )
    process.exit(1)
  }
  console.log(
    `icons: ${count} -- src/components/icons.tsx matches the vendored sources.`
  )
} else {
  writeFileSync(OUT, generated)
  console.log(`icons: ${count} -> src/components/icons.tsx`)
}
