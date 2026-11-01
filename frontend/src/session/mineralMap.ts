/** The mineral map: its result, its run, and its own progress channel. */
import { useCallback, useEffect, useRef, useState } from "react"

import { useAuth } from "@/lib/auth"
import {
  DEFAULT_MINERAL_RUN_OPTIONS,
  mineralPassesUsed,
  type MineralRunOptions,
} from "@/lib/mineral"
import { notifyError, notifySuccess } from "@/lib/notify"
import type { GeoJSONGeometry, MineralAnalysis } from "@/lib/types"
import { AnalyzeMinerals, GetEarthdataStatus } from "../../wailsjs/go/main/App"
import { useRunChannel } from "./runProgress"
import { mineralRequest, type RequestContext, type RunGround } from "./runRequests"

export interface MineralMapProps {
  /**
   * The mineral map: its result, its run and its progress. The runner is
   * absent where the product cannot be started, and the band then does not
   * offer it.
   */
  mineral?: MineralAnalysis | null
  onRunMinerals?: () => void
  /** The mineral map's passes compared and uncertainty draws; see the Passes card. */
  mineralOptions?: MineralRunOptions
  onMineralOptionsChange?: (o: MineralRunOptions) => void
  mineralBusy?: boolean
  mineralProgress?: number
  mineralProgressMsg?: string
  onClearMineral?: () => void
}

export function useMineralMap({
  context,
  inHand,
  customPolygon,
  aoiSignature,
  setCurrentRunId,
}: {
  context: RequestContext
  inHand: RunGround | null
  customPolygon: GeoJSONGeometry | null
  aoiSignature: string
  setCurrentRunId: (id: string | null) => void
}) {
  const { refreshRuns, refreshProjects } = useAuth()
  const { start, end } = context
  /*
    The mineral map and its run status, held here rather than in the screen,
    which unmounts on every navigation away. Plain state rather than a
    reducer: one product with one result, so there is no second consumer to
    keep in step. Its progress has a channel of its own below, so a mineral
    run's messages do not land under the classification's button.
  */
  const [mineral, setMineral] = useState<MineralAnalysis | null>(null)
  const channel = useRunChannel()
  // The Passes card's two counts, sent with the next run.
  const [mineralOptions, setMineralOptions] = useState<MineralRunOptions>(
    DEFAULT_MINERAL_RUN_OPTIONS
  )

  /** The AOI the mineral map on screen was identified over. */
  const mineralAoiRef = useRef<string>("")

  /*
    The same for the mineral map: its class rasters are placed on the extent
    of the area they were identified over, and every figure in its reading is
    over that area, so once the AOI moves both describe other ground.
  */
  useEffect(() => {
    if (!mineral) return
    if (aoiSignature === mineralAoiRef.current) return
    setMineral(null)
  }, [aoiSignature, mineral])

  /*
    The mineral map over the drawn area and the period.

    THE TOKEN IS ASKED FOR BEFORE THE RUN, not discovered by it. Every EMIT
    read goes through NASA Earthdata, and without a token the sidecar is
    refused on its first read -- after a CMR search it has already waited for.
    Asking the Go side here costs a file read and turns that failure into a
    sentence naming where the token is set. The status is read on each run
    rather than cached, so a token saved in Settings a moment ago applies.

    The passes compared and the uncertainty draws are the Passes card's; see
    lib/mineral.ts DEFAULT_MINERAL_RUN_OPTIONS for what each costs.
  */
  const handleRunMinerals = async () => {
    if (!customPolygon) {
      notifyError("Draw an area on the map first.")
      return
    }
    if (!start || !end) {
      notifyError("Set the acquisition period.")
      return
    }
    try {
      const status = await GetEarthdataStatus()
      if (!status.configured) {
        notifyError(
          "No Earthdata token is set. Add one in Settings > System (Earthdata token) to read EMIT reflectance."
        )
        return
      }
    } catch (e) {
      notifyError("Could not read the Earthdata token status", e)
      return
    }
    channel.begin()
    const runAoi = aoiSignature
    try {
      const req = mineralRequest(inHand!, context, mineralOptions)
      const res = (await AnalyzeMinerals(req as never)) as unknown as MineralAnalysis
      // Recorded before the result, so the invalidation effect above compares
      // against the AOI this run was made on rather than dropping the map it
      // has just been handed.
      mineralAoiRef.current = runAoi
      setCurrentRunId(res.run_id || null)
      setMineral(res)
      /*
        No reveal, for the reason a delineation has none: the map's figures are
        compositor cards, placed by the board (withMineralNodes), and the Mineral
        map preset shows the compositor beside the viewport. The notification
        says where.
      */
      // The observed area travels with the identified one: over vegetated
      // ground most of an area has no mineral answer.
      const identified = res.groups
        .map((g) => `group ${g.group} ${g.detected_area_ha.toFixed(1)} ha`)
        .join(", ")
      const used = mineralPassesUsed(res)
      notifySuccess(
        `Mineral map: ${identified || "no group reported"} identified over ` +
          `${res.observed_area_ha.toFixed(1)} of ${res.aoi_area_ha.toFixed(1)} ha observed, ` +
          `${used} EMIT ${used === 1 ? "pass" : "passes"}` +
          `${res.run_id ? " (saved)" : ""}. Its figures are cards in the Compositor.`
      )
      void refreshRuns()
      void refreshProjects()
    } catch (e) {
      notifyError("Mineral map error", e)
    } finally {
      channel.end()
    }
  }

  /** A saved run's map, placed on the extent of the area it was identified over. */
  const restore = useCallback(
    (saved: MineralAnalysis | null | undefined, aoi: string) => {
      if (saved) {
        mineralAoiRef.current = aoi
        setMineral(saved)
      } else {
        setMineral(null)
      }
    },
    []
  )

  const props: MineralMapProps = {
    mineral,
    onRunMinerals: () => void handleRunMinerals(),
    mineralOptions,
    onMineralOptionsChange: setMineralOptions,
    mineralBusy: channel.run.active,
    mineralProgress: channel.run.progress,
    mineralProgressMsg: channel.run.message,
    onClearMineral: () => setMineral(null),
  }

  return { props, mineral, setMineral, mineralOptions, channel, restore }
}
