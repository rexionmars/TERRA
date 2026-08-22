/**
 * The run's reading, as ordered groups of sections.
 *
 * ONE PLACE THAT DECIDES WHAT A READING CONTAINS. It was decided inside the
 * status panel, in a fragment that rendered four sections one after another
 * whenever their payloads were present. Held there it could not be counted or
 * indexed, which is what a column with a section index needs -- and what let
 * the panel show every product's figures under a header naming only one.
 *
 * A GROUP IS A PRODUCT, A SECTION IS A BLOCK. The distinction is the one the
 * previous shape lacked: the product's name, the provenance of its run and its
 * four headline figures belong to the group and are stated once at its head;
 * the blocks below carry their own names. Stated per block instead, the same
 * heading and the same provenance line were printed six times over the energy
 * model and six more over the wind screening, and the block's own subject
 * appeared nowhere a reader could see it.
 *
 * THE ORDER IS THE ORDER THE PRODUCTS RUN IN, not the order they finished.
 * Resource before terrain before siting before the model: the model is sized
 * for the area siting found, over the irradiation terrain modified, from the
 * resource at the centroid. A reading sorted by completion time would put the
 * consequence before its cause whenever a fast product finished last.
 */
import type { ReactNode } from "react"

import { energyModelSections } from "@/components/EnergyModelSection"
import {
  SolarResourceSection,
  SolarSitingSection,
  SolarTerrainSection,
} from "@/components/SolarSections"
import { windScreeningSections } from "@/components/WindScreening"
import { solarFigures, windFigures } from "@/components/energy/headlineFigures"
import type { Headline } from "@/components/energy/headlineFigures"
import { solarProduct } from "@/components/energy/solarProducts"
import { recordYears } from "@/lib/energyFormat"
import type { SolarProductId, SolarResults } from "@/lib/energyState"
import type { WindAnalysis } from "@/lib/types"

/** One block of a reading. The title names the block, never the product. */
export interface ReadingSection {
  /** Stable across renders: it is the scroll anchor and the index entry's key. */
  id: string
  title: string
  /**
   * The same block, named for a band 19rem wide.
   *
   * The index is one line of chips a reader scans, and a chip reading
   * "Delivered yield and loss waterfall" is 200 of the 272 pixels the column
   * has: nine of them turn an index into a second scroll. The full title still
   * heads the block itself and travels on the chip's tooltip, so nothing is
   * only ever short.
   */
  short: string
  node: ReactNode
}

/** One product's result: what produced it, what it is read by, and its blocks. */
export interface ReadingGroup {
  /** Which result this holds. The Clear control is named from it. */
  key: SolarProductId | "wind"
  label: string
  /** The window and the place the figures were computed over. Stated once. */
  meta?: string
  /** Qualifiers that must travel with every figure in the group. */
  chips?: string[]
  headline: Headline | null
  sections: ReadingSection[]
}

export function solarReadingGroups(results: SolarResults): ReadingGroup[] {
  const groups: ReadingGroup[] = []

  if (results.resource) {
    const r = results.resource
    groups.push({
      key: "resource",
      label: solarProduct("resource").label,
      meta: `${r.resource.n_years} years · ${r.lat.toFixed(2)}, ${r.lon.toFixed(2)}`,
      headline: solarFigures("resource", results),
      sections: [
        {
          id: "resource-main",
          title: solarProduct("resource").label,
          short: "Resource",
          node: <SolarResourceSection solar={r} />,
        },
      ],
    })
  }

  if (results.terrain) {
    const t = results.terrain
    groups.push({
      key: "terrain",
      label: solarProduct("terrain").label,
      meta: `${t.season} · ${t.dem_source} · ${t.hourly_years} years`,
      headline: solarFigures("terrain", results),
      sections: [
        {
          id: "terrain-main",
          title: solarProduct("terrain").label,
          short: "Terrain",
          node: <SolarTerrainSection terrain={t} />,
        },
      ],
    })
  }

  if (results.siting) {
    groups.push({
      key: "siting",
      label: solarProduct("siting").label,
      headline: solarFigures("siting", results),
      sections: [
        {
          id: "siting-main",
          title: solarProduct("siting").label,
          short: "Siting",
          node: <SolarSitingSection siting={results.siting} />,
        },
      ],
    })
  }

  if (results.energy) {
    const e = results.energy
    groups.push({
      key: "energy",
      label: solarProduct("energy").label,
      meta: `${e.hourly_window} · ${e.climatology_window} · ${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}`,
      headline: solarFigures("energy", results),
      sections: energyModelSections(e),
    })
  }

  return groups
}

export function windReadingGroups(wind: WindAnalysis | null): ReadingGroup[] {
  if (!wind) return []
  return [
    {
      key: "wind",
      label: "Wind screening",
      meta: `${wind.record_window} · ${recordYears(wind.record_years)} · one 0.5×0.625° cell at ${wind.grid_cell_centre[1]?.toFixed(3)}, ${wind.grid_cell_centre[0]?.toFixed(3)}`,
      /*
        Wind is alone on its own tab by design: the gross wind capacity factor
        carries no external benchmark while the photovoltaic one is bracketed
        by the Global Solar Atlas, so the two are never drawn as one
        comparison. These three words are what says so on the result.
      */
      chips: ["separate product", "gross", "unvalidated"],
      headline: windFigures(wind),
      sections: windScreeningSections(wind),
    },
  ]
}

/** Every section of a reading, flattened, in the order the column draws them. */
export function readingIndex(
  groups: ReadingGroup[]
): { id: string; title: string; short: string }[] {
  return groups.flatMap((g) =>
    g.sections.map((s) => ({ id: s.id, title: s.title, short: s.short }))
  )
}
