/**
 * That every option the pie menus show has its picture on disk, and a credit.
 */
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { READINGS } from "./compareBoard"
import { CATEGORIES, NODE_KINDS } from "./compositorGraph"
import { categoryPicture, kindPicture, readingPicture } from "./piePictures"
import type { PiePicture } from "./piePictures"

const PUBLIC = resolve(__dirname, "../../public")

const shown: [string, PiePicture][] = [
  ...CATEGORIES.map((c): [string, PiePicture] => [c.id, categoryPicture(c.id)]),
  ...NODE_KINDS.map((k): [string, PiePicture] => [k.kind, kindPicture(k.kind)]),
  ...READINGS.map((r): [string, PiePicture] => [r.kind, readingPicture(r.kind)]),
]

describe("pie pictures", () => {
  it("has every picture on disk", () => {
    for (const [id, p] of shown) {
      expect(existsSync(resolve(PUBLIC, p.path.slice(1))), id).toBe(true)
    }
  })

  it("credits every picture", () => {
    for (const [id, p] of shown) {
      expect(p.credit, id).toMatch(/^(Picture: |Sentinel-2|Landsat)/)
      expect(p.credit, id).not.toMatch(/; $|^ · /)
    }
  })
})
