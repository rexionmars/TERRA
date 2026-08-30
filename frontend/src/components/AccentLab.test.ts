import { describe, expect, it } from "vitest"

import { SHIPPED_HAZE, derive } from "@/components/AccentLab"
import { TOKENS, type Channels, type ThemeName } from "@/lib/contrast"

/*
  The panel is a reference before it is an editor: it opens on the palette the
  application is running in, and every judgement made in it is a comparison
  against that. A panel that opens on something else is not a weaker tool, it is
  a wrong one -- the reader believes they are looking at the difference their
  change made.

  It was wrong in four ways at once, and this is what each of them was.

  - `atLuminance` bisects lightness and rounds to a channel, so it could not
    reproduce a value it was handed. Every surface came back off by one or two.
  - `accentQuiet` was searched over 201 lightness steps rather than kept, so it
    landed near the shipped value and not on it.
  - `accentDim` carried a hardcoded 0.86 in the dark theme, so it could never
    equal the shipped plate.
  - `haze` still held the Mars sand literals from the family that put the
    accent's hue in the surfaces. That one was off by a whole hue, #c57f52
    against the #909090 index.css serves, and it survived the move to a neutral
    chassis because nothing measured it -- the haze clears no contrast floor, so
    check-contrast has no opinion about it.
*/

const REST = { hue: null, chroma: 1, depth: 1 }
const KEYS = [
  "ink",
  "surface",
  "surfaceRaised",
  "line",
  "lineStrong",
  "text",
  "muted",
  "accent",
  "accentQuiet",
  "accentDim",
  "haze",
] as const

const hex = (c: Channels) =>
  "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")

describe("the accent lab at rest", () => {
  for (const theme of ["dark", "light"] as ThemeName[]) {
    it(`emits the ${theme} palette index.css serves, token for token`, () => {
      const base = TOKENS[theme]
      const shipped: Record<string, Channels> = {
        ...(base as unknown as Record<string, Channels>),
        haze: SHIPPED_HAZE[theme],
      }
      const { tokens } = derive(base.accent, theme, REST)

      for (const k of KEYS) {
        expect(hex(tokens[k]), k).toBe(hex(shipped[k]))
      }
    })
  }

  it("moves the accent family once the accent itself moves", () => {
    // The variants are kept only while the accent is the shipped one: they
    // exist to read AS it, so a variant held over from the old hue would be
    // the wrong colour rather than a conservative choice.
    const { tokens } = derive([46, 158, 107], "dark", REST)
    expect(hex(tokens.accentQuiet)).not.toBe(hex(TOKENS.dark.accentQuiet))
    expect(hex(tokens.accentDim)).not.toBe(hex(TOKENS.dark.accentDim))
  })

  it("leaves the chassis alone at chroma 1, since the chassis is neutral", () => {
    const { tokens } = derive([139, 92, 246], "dark", REST)
    expect(hex(tokens.surface)).toBe(hex(TOKENS.dark.surface))
    expect(hex(tokens.line)).toBe(hex(TOKENS.dark.line))
  })
})
