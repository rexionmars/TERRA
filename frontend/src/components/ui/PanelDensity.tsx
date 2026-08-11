/**
 * How tightly a panel should draw itself, decided by its container.
 *
 * The three product panels were written for a floating column 19rem wide with
 * nothing else in it. Placed inside the whiteboard's outliner -- 15rem, beside
 * a tree of ten-pixel rows -- they kept that scale and read as a window
 * dropped into a column rather than as part of it.
 *
 * A context rather than a prop threaded through every panel: density is a fact
 * about the CONTAINER, and the pieces that need it are section headings and
 * paragraphs several levels down. Passing it by hand would mean every panel
 * forwarding a value it does not itself use.
 *
 * Only two states, and deliberately so. A scale that can take any value is a
 * scale someone has to choose a number for at every call site, and the two
 * containers this application has are a panel and a column.
 */
import { createContext, useContext } from "react"

export type PanelDensity = "comfortable" | "compact"

const Ctx = createContext<PanelDensity>("comfortable")

export const PanelDensityProvider = Ctx.Provider

export function usePanelDensity(): PanelDensity {
  return useContext(Ctx)
}

/** True where the container asked for the tighter of the two. */
export function useCompactPanel(): boolean {
  return useContext(Ctx) === "compact"
}
