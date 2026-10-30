import { describe, expect, it, vi } from "vitest"
import { applyLayerPatch, mergeLayerPatch, type LayerSwitches } from "./layerPatch"

function switches(): LayerSwitches {
  return {
    setCompositionVisible: vi.fn(),
    setCompositionOpacity: vi.fn(),
    setWaterVisible: vi.fn(),
    setWaterOpacity: vi.fn(),
    setConfidenceVisible: vi.fn(),
    setPredictionVisible: vi.fn(),
    setOverlayOpacity: vi.fn(),
    patchFieldLayer: vi.fn(),
    patchMineralLayer: vi.fn(),
  }
}

describe("applyLayerPatch", () => {
  it("sends each row to the product that owns it", () => {
    const to = switches()
    applyLayerPatch("water", { visible: false, opacity: 0.5 }, to)
    expect(to.setWaterVisible).toHaveBeenCalledWith(false)
    expect(to.setWaterOpacity).toHaveBeenCalledWith(0.5)
    expect(to.setCompositionVisible).not.toHaveBeenCalled()
  })

  it("moves one opacity for prediction and confidence, and a switch for each", () => {
    const to = switches()
    applyLayerPatch("confidence", { opacity: 0.3 }, to)
    applyLayerPatch("prediction", { visible: true, opacity: 0.4 }, to)
    expect(to.setOverlayOpacity).toHaveBeenNthCalledWith(1, 0.3)
    expect(to.setOverlayOpacity).toHaveBeenNthCalledWith(2, 0.4)
    expect(to.setPredictionVisible).toHaveBeenCalledWith(true)
    expect(to.setConfidenceVisible).not.toHaveBeenCalled()
  })

  it("does nothing for a row it does not know", () => {
    const to = switches()
    applyLayerPatch("nothing-of-this-name", { visible: true }, to)
    for (const fn of Object.values(to)) expect(fn).not.toHaveBeenCalled()
  })
})

describe("mergeLayerPatch", () => {
  it("leaves the switch where it was when only the opacity moves", () => {
    const held = { a: { visible: false, opacity: 1 } }
    expect(mergeLayerPatch(held, "a", { opacity: 0.2 })).toEqual({
      a: { visible: false, opacity: 0.2 },
    })
    expect(held.a.opacity).toBe(1)
  })
})
