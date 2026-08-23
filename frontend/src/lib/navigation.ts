/**
 * Where the application can go, named once.
 *
 * This is the same argument lib/mapTools.ts makes and the same failure it
 * avoids: a label that exists twice is a label that can disagree with itself.
 * The navigation column had the three destinations and their children written
 * inline, and the dock layout's bar needed the same list to let a user leave
 * the screen they are on -- a second copy that would have drifted the first
 * time a resource or a tool was renamed.
 *
 * The table is the structure only. What a selection DOES stays with the caller,
 * because navigating means setting a screen and a sub-tab that live in App, and
 * a table that reached into those would be a table that owns them.
 */
import {
  ChartColumn,
  Map as MapIcon,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { MAP_TOOLS } from "@/lib/mapTools"
import type { AppScreen } from "@/lib/auth"

export interface NavItem {
  id: string
  label: string
}

export interface NavGroup {
  /** The screen this group is, so the active one is found by comparison. */
  id: Extract<AppScreen, "map" | "energy" | "flood" | "analysis">
  label: string
  icon: LucideIcon
  /**
   * What is under it. Empty for a destination that is a single place: the
   * project hub is one screen, not a set of them.
   */
  items: readonly NavItem[]
}

/**
 * The two energy resources.
 *
 * Kept beside the map tools rather than in the energy screen: the navigation
 * column names them, the dock bar names them, and the screen itself names them,
 * which is three readers and was two copies.
 */
export const ENERGY_TABS: readonly NavItem[] = [
  { id: "solar", label: "Solar" },
  { id: "wind", label: "Wind" },
]

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: "map", label: "Map", icon: MapIcon, items: MAP_TOOLS },
  {
    // Zap rather than Sun or Wind: the screen holds both resources, and either
    // weather glyph would name one of them and read as a forecast rather than
    // as generation.
    id: "energy",
    label: "Energy",
    icon: Zap,
    items: ENERGY_TABS,
  },
  {
    // Waves rather than CloudRain or Droplets: this analysis reads terrain
    // only -- no rainfall, no discharge, no routing -- and a precipitation
    // glyph would name the one input it does not have and read as a forecast.
    // That is the argument the energy Zap makes above, applied to water.
    //
    // No children. The screen is one measurement: the products, the
    // thresholds and the agreement raster are parameters and outputs of a
    // single run, not places to go.
    id: "flood",
    label: "Flood envelope",
    icon: Waves,
    items: [],
  },
  {
    // The destination is the list of projects, their saved runs and their
    // overlays. A single analysis is one thing opened from inside it.
    id: "analysis",
    label: "Project hub",
    icon: ChartColumn,
    items: [],
  },
]
