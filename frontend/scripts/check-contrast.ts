/**
 * Fails when a token pair the interface paints drops below its WCAG floor, or
 * when the channels in lib/contrast.ts stop matching index.css.
 *
 * The second check is the one that matters over time. A table of channels in a
 * TypeScript file is a copy of the stylesheet, and this repository has already
 * shipped a hand-copied palette that drifted on every stop while nothing failed,
 * because nothing compared them. Run with:
 *
 *   cd frontend && npx tsx scripts/check-contrast.ts
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  ACCEPTED,
  checkContrast,
  TOKENS,
  type Channels,
  type ThemeName,
} from "../src/lib/contrast"

const here = dirname(fileURLToPath(import.meta.url))
const CSS = join(here, "..", "src", "index.css")

/** index.css names, in the order lib/contrast.ts declares them. */
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
}

/**
 * Tokens declared as hex rather than as channels.
 *
 * The status colours are not part of the sand family and are written as hex, so
 * they are read separately rather than left unchecked -- which is how the
 * destructive pair shipped failing WCAG 1.4.3 in both of its roles at once.
 *
 * These live outside the two --p-* blocks, so each is searched for in the block
 * that governs its theme: the dark values sit in the bare `:root` that follows
 * the palette, the light ones in the second `[data-theme="light"]` block.
 */
const CSS_HEX: Record<string, string> = {
  destructive: "--destructive",
  destructiveQuiet: "--destructive-quiet",
  success: "--success",
  warning: "--warning",
}

function hexChannels(hex: string): Channels {
  return [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16)) as unknown as Channels
}

/**
 * The channels declared in one theme block.
 *
 * Read from the block rather than from the file as a whole: both themes declare
 * the same custom properties, so a whole-file search would return whichever
 * came first and silently check the dark values twice.
 */
function channelsFromCss(theme: ThemeName): Record<string, Channels> {
  const css = readFileSync(CSS, "utf8")
  const selector =
    theme === "dark"
      ? /:root,\s*\n:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/
      : /:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/
  const block = css.match(selector)
  if (!block) throw new Error(`no ${theme} token block found in index.css`)
  const out: Record<string, Channels> = {}
  for (const [key, name] of Object.entries(CSS_NAME)) {
    const m = block[1].match(
      new RegExp(`${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*;`)
    )
    if (!m) throw new Error(`${name} not declared in the ${theme} block`)
    out[key] = [Number(m[1]), Number(m[2]), Number(m[3])]
  }

  // The hex tokens are declared outside the palette blocks. The dark values are
  // the LAST declaration before the light block opens, because the bare :root
  // that carries them follows the palette; the light ones are inside it.
  const lightAt = css.indexOf(':root[data-theme="light"] {\n  --destructive')
  const scope = theme === "light" ? css.slice(lightAt) : css.slice(0, lightAt)
  for (const [key, name] of Object.entries(CSS_HEX)) {
    const m = scope.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))
    if (!m) throw new Error(`${name} not declared for the ${theme} theme`)
    out[key] = hexChannels(m[1])
  }

  // --destructive-foreground is a reference, not a literal, and it points at a
  // DIFFERENT palette token per theme: the light text in dark, the light
  // surface in light. Resolving it rather than assuming one of them is the
  // whole point -- the rule that assumed `text` passed in dark and failed in
  // light by 2.76, which is the theme nobody had walked.
  const fgRef = scope.match(
    /--destructive-foreground:\s*rgb\(var\((--p-[a-z-]+)\)\)\s*;/
  )
  if (!fgRef) throw new Error(`--destructive-foreground unresolved for ${theme}`)
  const refKey = Object.entries(CSS_NAME).find(([, n]) => n === fgRef[1])?.[0]
  if (!refKey) throw new Error(`${fgRef[1]} is not a checked palette token`)
  out.destructiveForeground = out[refKey]

  return out
}

let failed = 0

for (const theme of Object.keys(TOKENS) as ThemeName[]) {
  const css = channelsFromCss(theme)
  for (const [key, declared] of Object.entries(TOKENS[theme])) {
    const actual = css[key]
    if (actual.join() !== declared.join()) {
      console.error(
        `DRIFT  ${theme}.${key}: contrast.ts has ${declared.join(" ")}, ` +
          `index.css has ${actual.join(" ")}`
      )
      failed++
    }
  }
}

const results = checkContrast()
const width = Math.max(...results.map((r) => `${r.fg} on ${r.bg}`.length))
const accepted: string[] = []

for (const theme of ["dark", "light"] as const) {
  console.log(`\n${theme}`)
  for (const r of results.filter((x) => x.theme === theme)) {
    const key = `${r.theme}.${r.fg}.${r.bg}`
    const label = `${r.fg} on ${r.bg}`.padEnd(width)
    const excused = !r.passes && key in ACCEPTED
    const verdict = r.passes ? "ok  " : excused ? "KNOWN" : "FAIL"
    /*
      The Lc beside the ratio, and nothing gated on it. WCAG 2 is the gate;
      APCA is the second opinion, and it is worth printing because the two
      disagree exactly where this palette lives -- see lib/contrast.ts. A
      reader weighing a token now sees both without running anything else.
    */
    const lc = `${r.lc > 0 ? "+" : ""}${r.lc.toFixed(0)}`
    console.log(
      `  ${verdict} ${label}  ${r.ratio.toFixed(2).padStart(5)}  (min ${r.min})   Lc ${lc.padStart(4)}`
    )
    if (excused) {
      accepted.push(`  ${key}  ${r.ratio.toFixed(2)} / ${r.min} -- ${ACCEPTED[key]}`)
    } else if (!r.passes) {
      failed++
    }
  }
}

/*
  An entry that no longer describes a failure is itself a failure. Otherwise the
  list outlives the palette that needed it and quietly excuses a pair that has
  since regressed for a different reason.
*/
const stale = Object.keys(ACCEPTED).filter(
  (k) => !results.some((r) => `${r.theme}.${r.fg}.${r.bg}` === k && !r.passes)
)
for (const k of stale) {
  console.error(`STALE  ${k} is accepted but now passes; remove it from ACCEPTED`)
  failed++
}

if (accepted.length) {
  console.log(`\n${accepted.length} pair(s) accepted below floor:`)
  for (const line of accepted) console.log(line)
}

if (failed) {
  console.error(`\n${failed} problem(s).`)
  process.exit(1)
}
console.log(
  accepted.length
    ? "\nNo unaccepted failure, and the channels match index.css."
    : "\nEvery token pair clears its floor, and the channels match index.css."
)
