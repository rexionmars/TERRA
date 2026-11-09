/**
 * That every listed product has its picture in public/, and that no picture
 * carries a licence asking for more than a credit: a share-alike one would pass
 * to the cropped file.
 */
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { BOARD_TOOLS, isProductId } from "./mapTools"
import { PRODUCT_PICTURES, pictureCredit } from "./productPictures"

const PUBLIC = resolve(__dirname, "../../public")
const CREDIT_ONLY = new Set(["Public domain", "CC BY 2.0", "CC BY 4.0"])

describe("PRODUCT_PICTURES", () => {
  const listed = BOARD_TOOLS.map((t) => t.id).filter(isProductId)

  it("has a picture for every listed product, on disk", () => {
    for (const id of listed) {
      expect(existsSync(resolve(PUBLIC, PRODUCT_PICTURES[id].path.slice(1))), id).toBe(
        true
      )
    }
  })

  it("uses only licences that ask for a credit and nothing more", () => {
    for (const id of listed) {
      expect(CREDIT_ONLY.has(PRODUCT_PICTURES[id].license), id).toBe(true)
      expect(PRODUCT_PICTURES[id].source).toMatch(
        /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/
      )
    }
  })

  it("puts the Copernicus notice after the author and licence", () => {
    expect(pictureCredit(PRODUCT_PICTURES.radar)).toBe(
      "Picture: Monja Šebela, Sentinel Hub · CC BY 2.0 · Contains modified Copernicus Sentinel data 2021"
    )
    expect(pictureCredit(PRODUCT_PICTURES.mineral)).toBe(
      "Picture: NASA Scientific Visualization Studio · Public domain"
    )
  })
})
