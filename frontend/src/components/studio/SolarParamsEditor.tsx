/**
 * Every parameter of the selected photovoltaic product, and only those.
 *
 * ONE SURFACE OWNS SOLAR CONFIGURATION, which is the canopy's arrangement
 * applied to the other product that has more settings than a band can carry.
 * The run band picks the product and runs it; this holds what the run is made
 * of. Split between the two, `radiation` and `plant` would have had to become
 * cards -- and `plant` alone is a reporting basis, an analysis period, a
 * degradation rate, two ground-cover ratios, a tracker limit, a density basis,
 * a buildable fraction, a UTC offset, a shading switch and two tables of loss
 * terms. A card that wide is a panel with a card's chrome.
 *
 * WHICH GROUPS APPEAR IS READ FROM THE PRODUCT TABLE, so this cannot show a
 * control the selected product does not send. The groups are named after what
 * they configure rather than after a product, because two of them are consumed
 * by more than one: SolarParams holds one climatology period and one pair of
 * slope limits for the whole axis, so the resource card and the energy model
 * cannot report a yield at ratios that differ, and the siting map and the
 * energy model cannot classify the AOI on different slopes.
 *
 * THE CONSEQUENCE IS THAT EDITING A SHARED GROUP INVALIDATES A RESULT HELD BY
 * A PRODUCT THAT IS NOT SELECTED. The marks below are what makes that visible.
 * They are held here rather than derived, because what makes a result stale is
 * an EDIT, and a result is only stale relative to the values it was computed
 * on -- which nothing on the payload records. A mark is set when a group is
 * written and cleared when that product is re-run.
 */
import { useCallback, useState } from "react"

import { SolarParameterSections } from "@/components/energy/SolarParameterSections"
import {
  productsUsingGroup,
  solarProduct,
  type SolarParamGroup,
} from "@/components/energy/solarProducts"
import type { SolarParams, SolarProductId, SolarResults } from "@/lib/energyState"

export function SolarParamsEditor({
  product,
  params,
  results,
  onSet,
  onLossSet,
}: {
  /** The band's choice. One product is selected for the studio, not for a panel. */
  product: SolarProductId
  params: SolarParams
  /** What each product holds, for the marks. */
  results: SolarResults
  onSet: (patch: Partial<SolarParams>) => void
  onLossSet: (group: "declared" | "optional", key: string, pct: number) => void
}) {
  /**
   * The result each product held when a group it reads was last written.
   *
   * Compared by identity against what the store holds now: a re-run replaces
   * the object, so the mark stops matching and the note goes without anything
   * having to clear it.
   */
  const [staleMarks, setStaleMarks] = useState<
    Partial<Record<SolarProductId, unknown>>
  >({})

  const setParams = useCallback(
    (patch: Partial<SolarParams>, group: SolarParamGroup) => {
      onSet(patch)
      // Every product reading this group, the selected one included. Its own
      // held result is left on the previous value by this edit exactly as the
      // others are, and excluding it meant a product's own edit never marked
      // its own result.
      setStaleMarks((prev) => {
        const next = { ...prev }
        for (const p of productsUsingGroup(group)) {
          const held = results[p.id]
          if (held) next[p.id] = held
        }
        return next
      })
    },
    [onSet, results]
  )

  const sharedNote = useCallback(
    (group: SolarParamGroup): string | null => {
      // Including the selected product. Suppressed there, the note vanished at
      // the moment the reader turned to the very result it describes.
      const affected = productsUsingGroup(group).filter((p) => {
        const held = results[p.id]
        return !!held && staleMarks[p.id] === held
      })
      if (!affected.length) return null
      const names = affected.map((p) => p.label).join(" and ")
      const plural = affected.length > 1
      return `${names} ${plural ? "hold results" : "holds a result"} computed before this edit. Re-run to report ${plural ? "them" : "it"} on the current setting.`
    },
    [results, staleMarks]
  )

  return (
    <div className="panel-scroll flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-col gap-0.5">
        <p className="eyebrow !text-foreground">
          {solarProduct(product).label}
        </p>
        <p className="text-micro leading-relaxed text-muted-foreground">
          Chosen in the run band. What is below is what this product sends.
        </p>
      </div>
      <SolarParameterSections
        product={solarProduct(product)}
        params={params}
        onSet={setParams}
        onLossSet={onLossSet}
        sharedNote={sharedNote}
        /* The AOI-mean share of beam blocked, which only a terrain run
           measures. Null without one, and the shading control says so. */
        shadingMeanPct={results.terrain?.shading_mean_pct ?? null}
      />
    </div>
  )
}
