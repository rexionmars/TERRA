/**
 * The three products a stored panel selection can name.
 *
 * They were a vertical tab rail floating over the map, then children of the
 * navigation column; both are gone and the run band names them now. The table
 * stays because a label that exists twice is a label that can disagree with
 * itself -- the failure this codebase has already had with a palette and with
 * a set of table columns.
 */

import type { StudioGroup } from "@/lib/studioEditors"

/**
 * The three ids a stored panel selection can name, as values.
 *
 * IDS AND NOT A TABLE, which is the change that let BOARD_TOOLS below become
 * the only place a product's label is written. This list used to carry the
 * labels too and BOARD_TOOLS spread it, so the two agreed by construction --
 * until the board's row had to be ORDERED by subject, which a spread cannot
 * do. Keeping the labels here as well would have been the failure this file's
 * own header names: a label that exists twice is a label that can disagree
 * with itself.
 *
 * What is left here is the thing MAP_TOOLS was actually for -- constraining
 * what a stored selection may be -- and it is the narrower of the two lists,
 * so it is the one that has to be stated.
 */
const MAP_TOOL_IDS = ["classify", "compose", "water"] as const

export type MapToolId = (typeof MAP_TOOL_IDS)[number]

export interface MapTool {
  id: MapToolId
  label: string
}

/**
 * Every product the studio's band can start.
 *
 * A separate table from MAP_TOOLS, and the distinction still means something
 * with both the map screen and the navigation column gone: `MapToolId` is what
 * a stored panel selection can be, and widening it would make a value the
 * store has never written suddenly representable.
 *
 * Solar, wind and flood joined by being ported rather than by being wrapped.
 * Each had a screen of its own -- Energy carried solar and wind, Flood carried
 * the envelope -- and each screen was a fixed answer to "what do you want to
 * see" for a product whose parameters are a handful of numbers. They are cards
 * on the graph now, beside the area and the period they read.
 */
export type BoardToolId =
  | MapToolId
  | "energy"
  | "flood"

/**
 * Every product the band can start, and the subject each one answers about.
 *
 * The groups are the studio's own -- the same four the workspace bar and the
 * editor menu use, from the same table in studioEditors -- so a reader who has
 * learnt "Water" on either of those has learnt it here. What they buy in a row
 * this short is not navigation but a statement: Surface water and Flood
 * envelope are two readings of one subject and sit together, and Energy is not
 * a third of them.
 *
 * COMPOSITIONS IS `board` AND NOT `crop`, which is the one call here worth
 * disagreeing with. Classification answers what the ground IS; a composition
 * is a way of LOOKING at the imagery, in whatever bands the question wants,
 * and is as useful over a reservoir as over a field. It sits with the
 * arrangement rather than with the subject.
 */
export interface BoardTool {
  id: BoardToolId
  label: string
  group: StudioGroup
}

export const BOARD_TOOLS: readonly BoardTool[] = [
  { id: "compose", label: "Compositions", group: "board" },
  { id: "classify", label: "Classification", group: "crop" },
  { id: "water", label: "Surface water", group: "water" },
  { id: "flood", label: "Flood envelope", group: "water" },
  { id: "energy", label: "Energy", group: "energy" },
]

/*
  ONE BAND ENTRY, BECAUSE ONE QUESTION.

  Solar, Wind and Grid record were three entries, and the split was the
  sidecar's rather than a reader's: they are three slices in terra/ and three
  tabs on screen, and choosing between them asked the reader to already know
  that the irradiation over their AOI and the curtailment at the plants inside
  it are answered by different modules. Standing on one piece of ground, both
  are the same question -- what is this site worth -- and only one of the two
  halves means anything alone. terra/grid/__init__.py says as much in its own
  header: the resource half describes a plant with unlimited offtake, which is
  not the plant that exists.

  FAMILY IS KEPT AND IS NOT A TOOL. Which module answers is still a real fact
  -- it decides the parameters, the payload and whether an area is required --
  so it stays, one level down, as the product's family. What is gone is the
  reader having to choose it first.
*/

/** Which slice answers a product, which decides its parameters and payload. */
export type EnergyFamily = "solar" | "wind" | "grid"

export interface EnergyProduct {
  id: EnergyProductId
  family: EnergyFamily
  label: string
  /** What the run answers, for the card that names it. */
  hint: string
  /** Whether the question is about a piece of ground. */
  needsArea: boolean
}

/*
  Prefixed ids, and the prefix is load-bearing rather than decorative.

  "resource" and "record" are both plausible names in more than one family, and
  a flat union would make the product state a value whose family has to be
  recovered by a lookup that can fail. Carried in the id, the family is
  readable from the value itself and a switch over it is exhaustive.
*/
export type EnergyProductId =
  | "solar:resource"
  | "solar:terrain"
  | "solar:siting"
  | "solar:energy"
  | "wind:resource"
  | "grid:curtailment"
  | "grid:connection"
  | "grid:figure"
  | "grid:record"

export const ENERGY_PRODUCTS: readonly EnergyProduct[] = [
  {
    id: "solar:resource",
    family: "solar",
    label: "Solar resource",
    hint: "Irradiance and yield at the area's centroid",
    needsArea: true,
  },
  {
    id: "solar:terrain",
    family: "solar",
    label: "Irradiation over terrain",
    hint: "Irradiation mapped over the ground it falls on",
    needsArea: true,
  },
  {
    id: "solar:siting",
    family: "solar",
    label: "Photovoltaic siting",
    hint: "Where a plant could stand, by slope and land cover",
    needsArea: true,
  },
  {
    id: "solar:energy",
    family: "solar",
    label: "Energy model",
    hint: "The loss waterfall from resource to delivered energy",
    needsArea: true,
  },
  {
    id: "wind:resource",
    family: "wind",
    label: "Wind resource",
    hint: "Wind speed and power density over the area",
    needsArea: true,
  },
  {
    id: "grid:curtailment",
    family: "grid",
    label: "Curtailment",
    hint: "What the operator withheld at the metered plants inside an area",
    needsArea: true,
  },
  {
    id: "grid:connection",
    family: "grid",
    label: "Connection",
    hint: "The network this ground could reach, and what its plants are joined to",
    needsArea: true,
  },
  {
    id: "grid:figure",
    family: "grid",
    label: "Series",
    hint: "One analysis of the published research series, over the whole record",
    needsArea: false,
  },
  {
    id: "grid:record",
    family: "grid",
    label: "Record",
    hint: "Which operational record this installation holds, and of which revision",
    needsArea: false,
  },
]

/** The family a product belongs to, read from the id rather than looked up. */
export function energyFamily(id: EnergyProductId): EnergyFamily {
  return id.slice(0, id.indexOf(":")) as EnergyFamily
}

/** The part after the family, which is the id the family's own table uses. */
export function energyMember(id: EnergyProductId): string {
  return id.slice(id.indexOf(":") + 1)
}

/**
 * Whether a board tool is one the stored panel selection can hold.
 *
 * AN ALLOWLIST, AND IT HAS TO BE. This was written as the complement -- `id
 * !== "solar" && id !== "wind" && id !== "flood"` -- which is a denylist
 * wearing a type predicate. A predicate is ASSERTED, not checked: adding a
 * fourth board tool made this return true for it, TypeScript said nothing, and
 * the stored panel selection could then hold a value MapToolId has never
 * contained. That is exactly what the header above says the two tables exist to
 * prevent, so the check now reads the table it is about.
 */
export function isMapTool(id: BoardToolId): id is MapToolId {
  return (MAP_TOOL_IDS as readonly string[]).includes(id)
}

/**
 * The three, derived rather than declared, so they cannot fall out of step
 * with the board's row or carry a second copy of a label.
 */
export const MAP_TOOLS: readonly MapTool[] = BOARD_TOOLS.filter(
  (t): t is BoardTool & { id: MapToolId } => isMapTool(t.id)
)
