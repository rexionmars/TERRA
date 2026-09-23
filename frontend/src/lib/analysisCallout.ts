/**
 * A reading, as something that can be put on the map.
 *
 * WHY A PANEL IS NOT ENOUGH, and it is a counting argument rather than a taste
 * one. Every product this application gains arrives with a reading, and a
 * reading that can only be seen in a panel needs a panel of its own: the board
 * divides into a fixed number of regions, and the fourth analysis is the one
 * there is no room for. The tree beside it has no such limit -- it lists
 * rasters in the dozens already -- so a reading that can be an entry there is a
 * reading the board does not have to make room for.
 *
 * THE SAME FORM THE RASTERS ALREADY USE. lib/layerLegend.ts turns a raster into
 * a legend and components/globe/OverlayCallout.tsx ties that legend to the
 * ground it measures. A reading over an AOI is the same shape of thing --
 * figures about a piece of ground -- so it becomes the same `stats` legend and
 * hangs off the same leader. Nothing new is invented for it, which is also what
 * keeps the two from drifting apart on screen.
 *
 * FIGURES, NOT PROSE. A callout is small and a reading's panel is not; what
 * survives the cut is the numbers the reading leads with, and the sentences
 * that qualify them stay in the panel where there is room to read them. The one
 * exception is a caveat that changes what a number MEANS, which travels as the
 * legend's note -- a figure whose qualification was left behind is worse on a
 * map than in a table, because a map invites being read at a glance.
 */
/*
  UPWARD, AND DELIBERATELY.

  headlineFigures declares what each product's reading LEADS with -- the four
  figures, formatted, with the assumption they were read under. This module
  needs exactly that list, and the alternative is to write it out a second time
  here: two declarations of one reading, drifting apart the first time a label
  is edited on one side. That is the failure this file's own docblock is about,
  so it is the one worth an import that runs the wrong way.

  The module is pure TypeScript and imports only from lib, so nothing but its
  address is out of place. Moving it into lib would settle that and is a
  rename, not a change.
*/
import {
  solarFigures,
  windFigures,
  type Headline,
} from "@/components/energy/headlineFigures"
import type { LayerLegend } from "@/lib/layerLegend"
import type { SolarResults } from "@/lib/energyState"
import type { WindAnalysis } from "@/lib/types"

/** One reading that can be listed, and put on the map. */
export interface AnalysisEntry {
  /** Stable across renders and unique within an area: the tree keys on it. */
  id: string
  title: string
  /** The one line under the title in the tree: what it read and over what. */
  params: string
  legend: NonNullable<LayerLegend>
}

/** A reading's headline, as the rows of a callout. */
const headlineRows = (h: Headline) =>
  h.figures.map((f) => ({ label: f.label, value: f.value }))

/**
 * The wind screening as an entry, or null where there is nothing to show.
 *
 * THE PRODUCT THIS FILE WAS WRITTEN FOR, AND ONE IT DID NOT AT FIRST COVER.
 * The argument at the top of this module is a counting one: every product
 * arrives with a reading, the board has a fixed number of regions, and a
 * reading that can be an entry in the tree is one the board does not have to
 * make room for. Wind produces figures and no raster at all, and before this
 * entry existed it appeared in the Data tab, which lists rasters, in no way;
 * and in the Analyses tab, which lists readings, in no way either. A finished
 * run reported nothing anywhere and the empty-state text went on saying no
 * reading had been made.
 *
 * TAKEN FROM windFigures RATHER THAN CHOSEN AGAIN. The panel and the callout
 * are two views of one reading, and a callout leading with a different four --
 * or with the same four under different labels -- is a second summary that
 * drifts from the first. The first draft of this function did exactly that,
 * down to calling the panel's "Mean speed" a "Hub speed".
 *
 * A RECORD THAT FAILED ITS CHECKS SAYS SO FIRST, before the qualifier the
 * figures were read under. The panel has room to list every flag; a callout
 * has room for the fact that there are some, which is what decides whether
 * the figures above should be read at all.
 */
export function windEntry(
  result: WindAnalysis | null | undefined
): AnalysisEntry | null {
  if (!result) return null
  const q = result.data_quality
  const failed = q && !q.all_checks_passed ? q.flags.length : 0
  const h = windFigures(result)
  return {
    id: "wind:screening",
    title: "Wind screening",
    params: `${result.hub_height_m.toFixed(0)} m hub · ${result.record_window}`,
    legend: {
      kind: "stats",
      subject: "Wind screening",
      rows: headlineRows(h),
      note:
        (failed
          ? `The record did not pass every check (${failed} flag${
              failed === 1 ? "" : "s"
            }); the panel lists them. `
          : "") + h.note,
    },
  }
}

/**
 * The solar resource as an entry, or null where there is nothing to show.
 *
 * The same gap wind was in, and for the same reason: the resource is figures
 * at a point with no raster anywhere, so nothing listed it. Its headline and
 * its note are solarFigures', including the grid note -- which the payload's
 * own field comment says is "always shown beside them", and a callout is a
 * beside.
 */
export function solarResourceEntry(
  results: SolarResults | null | undefined
): AnalysisEntry | null {
  if (!results?.resource) return null
  const h = solarFigures("resource", results)
  if (!h) return null
  const r = results.resource
  return {
    id: "solar:resource",
    title: "Solar resource",
    params: `${r.resource.n_years} years · ${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`,
    legend: {
      kind: "stats",
      subject: "Solar resource",
      rows: headlineRows(h),
      note: h.note,
    },
  }
}

/**
 * The energy model as an entry, or null where there is nothing to show.
 *
 * The third of the three that produce no raster. Its headline leads with the
 * ratio APPLIED beside the one the chain derives, which is the pair a reader
 * has to see together -- the derived one runs high because soiling, shading,
 * degradation, availability and cabling are not modelled -- so both travel or
 * neither does. solarFigures already decides that; this takes its answer.
 */
export function energyModelEntry(
  results: SolarResults | null | undefined
): AnalysisEntry | null {
  if (!results?.energy) return null
  const h = solarFigures("energy", results)
  if (!h) return null
  return {
    id: "solar:energy",
    title: "Energy model",
    params: "modelled over the area",
    legend: {
      kind: "stats",
      subject: "Energy model",
      rows: headlineRows(h),
      note: h.note,
    },
  }
}

/** Every reading held for one area, in the order the tree lists them. */
export function analysisEntries(sources: {
  wind?: WindAnalysis | null
  solar?: SolarResults | null
}): AnalysisEntry[] {
  return [
    windEntry(sources.wind),
    solarResourceEntry(sources.solar),
    energyModelEntry(sources.solar),
  ].filter((e): e is AnalysisEntry => e !== null)
}
