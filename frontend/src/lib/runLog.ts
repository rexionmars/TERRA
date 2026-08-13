/**
 * What a run said while it ran, kept.
 *
 * The progress message already existed and was spent on a tooltip, with the
 * reason written beside it: a line that rewrites itself several times a second
 * costs more attention than it returns. That is true of ONE LINE. It is not
 * true of a log -- a line that stays is read once, and the stack of them is the
 * only account of what a run actually did.
 *
 * The sidecar's stages carry their own detail: "querying STAC catalog
 * (Planetary Computer)", "extracting Prithvi embeddings (pixel)", "12 scenes".
 * Those are answers to "why is this taking so long" and to "what did it choose",
 * and they were being thrown away at a rate of several a second.
 *
 * Kept after the run ends, deliberately. The questions a log answers are mostly
 * asked afterwards -- how many scenes it found, which model path it took -- and
 * clearing on completion would drop the record exactly when it becomes readable.
 */
import { useEffect, useRef, useState } from "react"

export interface RunLogEntry {
  /** Progress when the stage was reported, 0 to 100. */
  at: number
  text: string
}

/**
 * The most a run keeps.
 *
 * Generous enough that no real run reaches it and bounded so a pathological
 * one cannot grow without limit. The oldest go first: a run that emitted two
 * hundred stages is one whose recent ones are the interesting ones.
 */
const LIMIT = 60

export function useRunLog(run: {
  running: boolean
  progress: number
  message: string
}): RunLogEntry[] {
  const [entries, setEntries] = useState<RunLogEntry[]>([])
  const wasRunning = useRef(false)
  const lastText = useRef("")

  useEffect(() => {
    /*
      A run STARTING clears the log, and a run ending does not. The transition
      is what matters rather than the flag: reading `running` alone would clear
      on every render while it is true, and never on the one that begins it.
    */
    if (run.running && !wasRunning.current) {
      setEntries([])
      lastText.current = ""
    }
    wasRunning.current = run.running

    const text = run.message.trim()
    // Nothing to add for a repeat: the sidecar reports progress far more often
    // than it changes stage, and a log of one line said forty times is not one.
    if (!run.running || !text || text === lastText.current) return
    lastText.current = text
    setEntries((prev) =>
      [...prev, { at: run.progress, text }].slice(-LIMIT)
    )
  }, [run.running, run.progress, run.message])

  return entries
}
