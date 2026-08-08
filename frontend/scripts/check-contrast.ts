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

for (const theme of ["dark", "light"] as const) {
  console.log(`\n${theme}`)
  for (const r of results.filter((x) => x.theme === theme)) {
    const label = `${r.fg} on ${r.bg}`.padEnd(width)
    const verdict = r.passes ? "ok  " : "FAIL"
    console.log(`  ${verdict} ${label}  ${r.ratio.toFixed(2)}  (min ${r.min})`)
    if (!r.passes) failed++
  }
}

if (failed) {
  console.error(`\n${failed} problem(s).`)
  process.exit(1)
}
console.log("\nEvery token pair clears its floor, and the channels match index.css.")
