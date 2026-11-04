/** Where the reader is: which destination, which panel, and how they got there. */
import { useState } from "react"

import { readRailOpen } from "@/components/shell/ShellChrome"

/** Which panel is held up over the map. One value, so there is only ever one. */
export type ShellPanelId =
  "areas" | "products" | "visualization" | "result" | "points" | "layers" | "activity"

export function useShellNavigation() {
  // Over the map at launch, and gone as soon as the reader begins something.
  const [startOpen, setStartOpen] = useState(false)
  const [destination, setDestination] = useState<
    "explore" | "analyses" | "compare" | "workflows"
  >("explore")
  /*
    Each stays mounted once opened, hidden behind the map. The grid's choices survive
    a look at the ground that way, and a graph's Globe nodes go on drawing on it.
  */
  const [compareOpened, setCompareOpened] = useState(false)
  const [workflowsOpened, setWorkflowsOpened] = useState(false)
  const [analysesOpened, setAnalysesOpened] = useState(false)
  const goAnalyses = () => {
    setStartOpen(false)
    setAnalysesOpened(true)
    setDestination("analyses")
  }
  const goCompare = () => {
    setStartOpen(false)
    setCompareOpened(true)
    setDestination("compare")
  }
  const goWorkflows = () => {
    setStartOpen(false)
    setWorkflowsOpened(true)
    setDestination("workflows")
  }
  const [railOpen, setRailOpen] = useState(readRailOpen)

  const [panel, setPanel] = useState<ShellPanelId | null>(null)

  const togglePanel = (id: ShellPanelId) => {
    setStartOpen(false)
    setPanel((p) => (p === id ? null : id))
  }

  return {
    startOpen,
    setStartOpen,
    destination,
    setDestination,
    compareOpened,
    workflowsOpened,
    analysesOpened,
    goAnalyses,
    goCompare,
    goWorkflows,
    railOpen,
    setRailOpen,
    panel,
    setPanel,
    togglePanel,
  }
}
