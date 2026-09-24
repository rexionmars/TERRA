/**
 * That every preset draws every one of its editors at the smallest window.
 *
 * The presets carried this check as arithmetic in a comment, and the comment
 * drifted: the Layout preset still said its run strip was 85px "against a 3rem
 * floor" after the run editor became a node canvas with a floor of 14rem, so
 * the preset shipped an area that could only say what it needed instead of
 * the editor. Computed here from the same functions the studio lays itself
 * out with, a change to a floor or to a fraction that breaks a preset fails.
 */
import { describe, expect, it } from "vitest"

import { areaRects } from "./boardAreas"
import { editorFits, studioEditor } from "./studioEditors"
import { STUDIO_WORKSPACES } from "./studioWorkspaces"

/*
  The area tree's rectangle at the 1000x700 minimum main.go sets on reveal:
  the window less the 44px title bar, the 28px workspace bar and the 22px
  status bar. The gap is the default one, 5px, and a rem is 16px.
*/
const MIN = { x: 0, y: 0, w: 1000, h: 700 - 44 - 28 - 22 }
const GUTTER_PX = 5
const ROOT_PX = 16

describe("the workspace presets at the minimum window", () => {
  for (const w of STUDIO_WORKSPACES) {
    it(`${w.label} draws every editor it holds`, () => {
      const { leaves } = areaRects(w.build(), MIN, GUTTER_PX)
      for (const leaf of leaves) {
        const e = studioEditor(leaf.editor)
        const size = `${(leaf.w / ROOT_PX).toFixed(1)}x${(leaf.h / ROOT_PX).toFixed(1)}rem`
        expect(
          editorFits(leaf.editor, leaf, ROOT_PX),
          `${e.label} needs ${e.minRem}x${e.minRowRem}rem, gets ${size}`
        ).toBe(true)
      }
    })
  }
})
