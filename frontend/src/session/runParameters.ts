/**
 * What a run is asked for, and how its result is drawn over the map.
 *
 * Held above the sign-in, in App, because stored preferences set the model and the
 * opacity as they arrive.
 */
import { useMemo, useState } from "react"

import type { ModelKind } from "@/lib/types"

function defaultPeriod(): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString().slice(0, 10)
  const past = new Date(now)
  past.setFullYear(past.getFullYear() - 1)
  const start = past.toISOString().slice(0, 10)
  return { start, end }
}

export interface RunParameterProps {
  start: string
  end: string
  maxCloud: number
  monthlyBest: boolean
  mode: "single" | "temporal"
  modelKind: ModelKind
  prithviMode: "pixel" | "patch"
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  onMaxCloudChange: (v: number) => void
  onMonthlyBestChange: (v: boolean) => void
  onModeChange: (m: "single" | "temporal") => void
  onModelKindChange: (m: ModelKind) => void
  onPrithviModeChange: (m: "pixel" | "patch") => void
}

export function useRunParameters(): RunParameterProps {
  const period = useMemo(defaultPeriod, [])
  const [start, setStart] = useState<string>(period.start)
  const [end, setEnd] = useState<string>(period.end)
  const [maxCloud, setMaxCloud] = useState<number>(40)
  const [monthlyBest, setMonthlyBest] = useState<boolean>(true)
  const [mode, setMode] = useState<"single" | "temporal">("single")
  const [modelKind, setModelKind] = useState<ModelKind>("spectral")
  const [prithviMode, setPrithviMode] = useState<"pixel" | "patch">("pixel")
  return {
    start,
    end,
    maxCloud,
    monthlyBest,
    mode,
    modelKind,
    prithviMode,
    onStartChange: setStart,
    onEndChange: setEnd,
    onMaxCloudChange: setMaxCloud,
    onMonthlyBestChange: setMonthlyBest,
    onModeChange: setMode,
    onModelKindChange: setModelKind,
    onPrithviModeChange: setPrithviMode,
  }
}

export interface OverlayDisplayProps {
  overlayOpacity: number
  showConfidence: boolean
  confidenceOnTop: boolean
  smoothOverlay: boolean
  showPredictionOverlay: boolean
  onOpacityChange: (v: number) => void
  onShowConfidenceChange: (v: boolean) => void
  onConfidenceOnTopChange: (v: boolean) => void
  onSmoothOverlayChange: (v: boolean) => void
  onShowPredictionOverlayChange: (v: boolean) => void
}

export function useOverlayDisplay(): OverlayDisplayProps {
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.75)
  const [showConfidence, setShowConfidence] = useState(false)
  const [confidenceOnTop, setConfidenceOnTop] = useState(true)
  const [smoothOverlay, setSmoothOverlay] = useState(false)
  const [showPredictionOverlay, setShowPredictionOverlay] = useState(true)
  return {
    overlayOpacity,
    showConfidence,
    confidenceOnTop,
    smoothOverlay,
    showPredictionOverlay,
    onOpacityChange: setOverlayOpacity,
    onShowConfidenceChange: setShowConfidence,
    onConfidenceOnTopChange: setConfidenceOnTop,
    onSmoothOverlayChange: setSmoothOverlay,
    onShowPredictionOverlayChange: setShowPredictionOverlay,
  }
}
