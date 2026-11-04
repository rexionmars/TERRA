/** What is running, and what opens when it finishes. */
import { useEffect, useRef } from "react"

import type { ResultProduct } from "@/components/shell/ResultPanel"
import { activeRuns } from "@/lib/productRun"
import { useRunLog } from "@/lib/runLog"
import type { MapShellProps } from "@/pages/MapShell"

export function useRunWatch(
  props: MapShellProps,
  openResult: (product: ResultProduct | null) => void
) {
  const running = activeRuns(props)
  const busy = running.length > 0
  const runLog = useRunLog({
    running: running[0]?.running ?? false,
    progress: running[0]?.progress ?? 0,
    message: running[0]?.progressMsg ?? "",
  })
  /*
    A run that finishes opens what it produced. Watched as an edge, so opening
    another panel while a result is on the map is not undone by the next render.
  */
  const wasBusy = useRef(false)
  const lastProduct = useRef<ResultProduct | null>(null)
  if (props.running) lastProduct.current = "classify"
  else if (props.waterRunning) lastProduct.current = "water"
  else if (props.mineralBusy) lastProduct.current = "mineral"
  else if (props.fieldsBusy) lastProduct.current = "fields"
  else if (props.lulcRunning) lastProduct.current = "classify"
  /*
    What was on the map when the run began. A run that fails has said why in its
    notification, and changing the panel under the reader would only hide the form
    they have to correct.
  */
  const before = useRef<readonly unknown[]>([])
  useEffect(() => {
    const now = [props.result, props.water, props.mineral, props.fields]
    if (!wasBusy.current && busy) before.current = now
    if (wasBusy.current && !busy && now.some((v, i) => v !== before.current[i])) {
      openResult(lastProduct.current)
    }
    wasBusy.current = busy
    // Read at the edge of the run; the results themselves say nothing about when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  return { running, busy, runLog, wasBusy }
}
