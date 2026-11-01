/**
 * The sidecar's one progress channel, and the displays that read it.
 *
 * The sidecar emits on a single event and runs one action at a time, so the
 * run in progress decides which display receives it: a product's own channel
 * while one is running, the shared display otherwise. One display for both
 * would put a mineral run's messages under the classification's button.
 *
 * Read through refs so the subscription is registered once: re-registering on
 * every run state change would drop events emitted between the unsubscribe
 * and the resubscribe. A progress of -1 means "message only, percentage
 * unchanged", which is why the percentage is set only when it is not
 * negative. A channel's is mirrored in seenRef rather than read back from its
 * state, because several such lines can arrive in one React batch and a value
 * read from state would be from before the batch; begin() resets the mirror, so a
 * second run cannot open on the previous run's percentage.
 */
import { useEffect, useRef, useState } from "react"

import type { ProgressEvent } from "@/lib/types"
import { EventsOff, EventsOn } from "../../wailsjs/runtime/runtime"

const IDLE = { active: false, progress: 0, message: "" }

/** The display a product with its own channel reads. */
export function useRunChannel() {
  const [run, setRun] = useState(IDLE)
  const runRef = useRef(run)
  runRef.current = run
  const seenRef = useRef({ progress: 0, message: "" })
  return {
    run,
    runRef,
    seenRef,
    setRun,
    begin: () => {
      seenRef.current = { progress: 0, message: "starting" }
      setRun({ active: true, progress: 0, message: "starting" })
    },
    end: () => setRun(IDLE),
  }
}

export type RunChannel = ReturnType<typeof useRunChannel>

/** The display everything else shares. */
export function useSharedProgress() {
  const [progress, setProgress] = useState<number>(0)
  const [progressMsg, setProgressMsg] = useState<string>("")
  return { progress, progressMsg, setProgress, setProgressMsg }
}

/** Routes each event to the channel of the run in progress, or to the shared display. */
export function useSidecarProgress(
  channels: readonly RunChannel[],
  shared: ReturnType<typeof useSharedProgress>
) {
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const sharedRef = useRef(shared)
  sharedRef.current = shared

  useEffect(() => {
    EventsOn("predict:progress", (ev: ProgressEvent) => {
      for (const c of channelsRef.current) {
        if (!c.runRef.current.active) continue
        const seen = c.seenRef.current
        if (ev.progress >= 0) seen.progress = ev.progress
        if (ev.msg) seen.message = ev.msg
        c.setRun({ active: true, progress: seen.progress, message: seen.message })
        return
      }
      if (ev.progress >= 0) sharedRef.current.setProgress(ev.progress)
      if (ev.msg) sharedRef.current.setProgressMsg(ev.msg)
    })
    return () => EventsOff("predict:progress")
  }, [])
}
