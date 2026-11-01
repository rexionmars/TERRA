/** The runs the map has moved on from, still in hand for Compare and Workflows. */
import { useCallback, useEffect, useRef, useState } from "react"

import type { PredictResult } from "@/lib/types"

export function useRetainedRuns() {
  /**
   * Results the map has finished with, kept so the board can still show them.
   *
   * There is ONE live result, and starting a run empties it before the request
   * is even built. Everything the map was showing therefore ceased to exist at
   * the moment the next run began -- not when it finished, and not because of
   * anything the board did. A studio whose whole purpose is placing analyses
   * side by side could hold exactly one at a time, and the previous one went
   * without a word.
   *
   * Archived here rather than in the board because it has to outlive the map
   * screen unmounting, which is what took the rasters away on a trip to the
   * analyses list and back.
   *
   * Bounded at three by recency: each result carries several megabytes of data
   * URIs. A run that was saved is evicted before one that was not, since a
   * saved run can be brought back through the run picker and an unsaved one is
   * gone for good.
   */
  const [retainedRuns, setRetainedRuns] = useState<
    readonly { id: string; result: PredictResult }[]
  >([])
  /*
    Forgotten, when what they are a memory OF is no longer the subject.

    Retention is the map's affordance: the run it has moved on from stays in
    hand so the board can still show it beside the new one. Nothing ever
    dropped them, so they accumulated for the session and were injected into
    every board that opened -- a run from one project, or from before a stored
    board was opened, appearing as an area of that board. `assetRuns` adds them
    to whatever is on screen, which is right for the live board and wrong for a
    board whose membership was saved.
  */
  const clearRetainedRuns = useCallback(() => setRetainedRuns([]), [])
  /**
   * What identifies a run's WORK, independently of what it is filed under.
   *
   * The recorded row first, since that is the run itself. A standalone product
   * the store did not record leaves none, and then the raster it produced is
   * the only thing that distinguishes it -- two runs cannot share an overlay,
   * so its uri serves as an id for this purpose.
   */
  const runWorkKey = useCallback((r: PredictResult | null): string | null => {
    if (!r) return null
    return (
      r.run_id ||
      r.water?.run_id ||
      r.mineral?.run_id ||
      r.fields?.run_id ||
      r.overlay_uri ||
      null
    )
  }, [])

  const retainRun = useCallback(
    (
      outgoing: PredictResult | null,
      /**
       * The board's own id for the ground this run was over.
       *
       * THREE IDENTITIES HAD TO BE MADE ONE. The board keys its live area by the
       * GROUND, the area id whenever it is known, while
       * `runId` reaching it is `result.run_id || "current"`, which every product
       * but the classification then left on the sentinel, and this function
       * keyed what it kept by the run. Three names for one area, so the retained
       * entry and the area it came from could never find each other: the entry appeared in the data
       * tree as a run to add by hand, and the planes that had been on the board
       * were not carried over to it.
       *
       * Given rather than derived, because only the caller knows which ground is
       * being left. Falls back to the run row, then to an unsaved counter.
       */
      areaId?: string | null
    ) => {
      /*
      ANY PRODUCT IS WORTH KEEPING, not only a classification.

      This used to read: "a result with no classification is a standalone
      payload the board reads from its own fields; nothing of it belongs to a
      scene." That was true of the LIVE area and of nothing else. The board
      reads the standalone products from its own props only while the map is
      still on that ground; the moment the AOI moves, the aoiSignature effects
      clear them and the props go empty. Such a run left the board the instant
      a new area was drawn, and there was nothing to bring it back because it
      had never been retained.

      The board was already able to draw one: `legendByArea` in BoardSurface
      builds a retained area's legends from `result.water` -- a field that
      exists on every result. What was missing was a result reaching it.

      So the test is whether the outgoing run produced ANYTHING. A result with
      none of these is an empty shell from a run that never finished, and that
      is the only case worth dropping.
    */
      const carries =
        !!outgoing &&
        (!!outgoing.class_stats?.length ||
          !!outgoing.overlay_uri ||
          !!outgoing.water ||
          !!outgoing.mineral ||
          !!outgoing.fields)
      if (!outgoing || !carries) {
        return
      }
      const work = runWorkKey(outgoing)
      setRetainedRuns((prev) => {
        /*
        THE RECORDED ROW, WHEREVER IT WAS RECORDED.

        `run_id` on the result is the classification's. A run that produced
        only a standalone product leaves it empty, and the board then keys the
        area as `unsaved:` -- which costs it the run record, so it is titled
        "Previous run" and outlined as its raster's rectangle instead of its
        real shape.

        Water records its row on its own payload and says why: "the Go side
        withdraws its claim to have saved by returning nothing". Reading it
        here gives a retained water run its name and its outline back.
      */
        const id =
          areaId?.trim() ||
          outgoing.run_id ||
          outgoing.water?.run_id ||
          outgoing.mineral?.run_id ||
          outgoing.fields?.run_id ||
          `unsaved:${prev.length + 1}`
        /*
        ONE ENTRY PER RUN, WHATEVER IT WAS FILED UNDER.

        Retention happens from the effect that watches the ground and from
        three older call sites that name none, so one run could arrive twice
        with two identities -- once under its recorded row, once under the area
        it was over. Both were kept, and the board drew one raster as two areas
        over one field: "drawn" beside "run-untitled", identical vertex count,
        identical hectares.

        THE GROUND WINS when it is offered. It is what the board files areas
        under, so an entry keyed by the run
        is re-keyed rather than left to shadow the one that can be found.
      */
        const same = work ? prev.findIndex((r) => runWorkKey(r.result) === work) : -1
        if (same >= 0) {
          if (prev[same].id === id || !areaId?.trim()) return prev
          const rekeyed = [...prev]
          rekeyed[same] = { id, result: outgoing }
          return rekeyed
        }
        if (prev.some((r) => r.id === id)) return prev
        const next = [{ id, result: outgoing }, ...prev]
        if (next.length <= 3) return next
        // Drop the oldest RECOVERABLE one; an unsaved run has nowhere to return
        // from, so it outlives a saved neighbour.
        for (let i = next.length - 1; i >= 0; i--) {
          if (!next[i].id.startsWith("unsaved:")) return next.filter((_, j) => j !== i)
        }
        return next.slice(0, 3)
      })
    },
    [runWorkKey]
  )
  /**
   * Let go of a retained run, which the board could list and not remove.
   *
   * The studio's X drops a run from the board and leaves it on disk. It did
   * that for runs added from the picker and could not for retained ones,
   * because those live here and the board only receives them -- so a retained
   * entry had no way off the board at all. It became visible when retention
   * stopped being tied to two gestures: a reader now accumulates them by
   * working, and an entry that cannot be dismissed accumulates forever.
   */
  const dropRetainedRun = useCallback((id: string) => {
    setRetainedRuns((prev) => prev.filter((r) => r.id !== id))
  }, [])

  return { retainedRuns, retainRun, dropRetainedRun, clearRetainedRuns }
}

export function useRetainOnLeaving({
  activeAreaId,
  resultWithWater,
  retainRun,
}: {
  activeAreaId?: string
  resultWithWater: PredictResult | null
  retainRun: (outgoing: PredictResult | null, areaId?: string | null) => void
}) {
  /*
    The ground the map is leaving, and what was on it. See handleOpenStudio for what
    goes wrong when a studio switch reaches the effect below with this still full.
  */
  const leavingRef = useRef<{
    id: string | undefined
    result: PredictResult | null
  }>({ id: undefined, result: null })

  /*
    THE GROUND LEAVING IS WHAT TRIGGERS RETENTION, not any one gesture.

    Retaining was bolted to `startNewClassification` and `backToAnalysesList`,
    so every OTHER way of changing the active area lost the work on it: drawing
    a new one, pressing one in the catalog, adopting a run's geometry, opening
    a project. A reader clicking between two areas watched each one's rasters
    disappear as they arrived at the other, with only the outlines alternating.

    One effect instead of five call sites, and it catches the paths nobody has
    enumerated yet: what matters is that the active area STOPPED being what it
    was, not how.

    THE PAIR IS HELD IN A REF, which is what makes the capture correct. The
    products are cleared by the aoiSignature effects of their own hooks, which App
    calls before this one, and effects run in declaration order across renders -- so reading state
    here would be a race against them. The ref is written during render, so it
    always holds the result as it was while the previous area was still the
    active one.
  */
  useEffect(() => {
    const leaving = leavingRef.current
    leavingRef.current = { id: activeAreaId, result: resultWithWater }
    if (!leaving.id || leaving.id === activeAreaId) return
    retainRun(leaving.result, leaving.id)
  }, [activeAreaId, resultWithWater, retainRun])

  /** Not a move from one ground to another, so the run being left is not kept. */
  const forgetLeaving = useCallback(() => {
    leavingRef.current = { id: undefined, result: null }
  }, [])

  return forgetLeaving
}
