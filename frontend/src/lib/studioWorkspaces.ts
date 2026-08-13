/**
 * Named arrangements, one per task.
 *
 * The studio had one arrangement and every reading had to fit it: the same
 * outliner, the same readout column, the same foot bands, whether the work in
 * front of the reader was classifying one area or measuring how far four of
 * them sit from the domain a model was fitted on. Density complaints followed
 * from that, and no better set of widths answers them, because the arrangement
 * that suits one task is the wrong one for the next.
 *
 * Blender's answer is not a better default. It ships eleven workspaces --
 * Layout, Modeling, Sculpting, UV Editing, Shading, Animation, Compositing and
 * the rest -- each a saved arrangement bound to a kind of work, switched by a
 * tab. Tools for sculpting are not on screen while animating, and their
 * absence is the design rather than a limitation.
 *
 * These are presets, not user data. A reader who moves a division or retypes
 * an area changes the live tree, which `boardMemory` keeps for as long as the
 * session lasts -- the position that module states for itself: it survives a
 * close and not a restart, because saving is a thing someone asks for by name.
 *
 * The fractions are chosen against the application's minimum window of
 * 1000x700, so no preset is born with an area under its editor's own floor.
 */
import type { AreaNode } from "@/lib/boardAreas"
import type { EditorId } from "@/lib/studioEditors"

export type StudioTree = AreaNode<EditorId>

export interface StudioWorkspace {
  id: string
  /** The tab's label. */
  label: string
  /** One line, for the tab's title attribute. */
  hint: string
  /** Built fresh per call: a shared tree would be mutated across workspaces. */
  build: () => StudioTree
}

const leaf = (id: string, editor: EditorId): StudioTree => ({
  kind: "leaf",
  id,
  editor,
})

const row = (id: string, at: number, a: StudioTree, b: StudioTree): StudioTree => ({
  kind: "split",
  id,
  dir: "row",
  at,
  a,
  b,
})

const col = (id: string, at: number, a: StudioTree, b: StudioTree): StudioTree => ({
  kind: "split",
  id,
  dir: "col",
  at,
  a,
  b,
})

export const STUDIO_WORKSPACES: readonly StudioWorkspace[] = [
  {
    id: "layout",
    label: "Layout",
    hint: "The general arrangement: the board, what is in it, and what is selected",
    /*
      Blender's own Layout, which is not two full-height columns.

      There the viewport is dominant and the right column is DIVIDED: the
      outliner on top, the properties under it, sharing one strip. The left
      edge carries no panel at all. Reproducing the studio's previous
      arrangement here was a mistake -- it made the whole area system arrive
      invisible, since a reader opening the studio landed on the same three
      bars in the same places and could reasonably conclude nothing had
      changed.

      Fractions checked at the 1000x700 minimum: the right column is 220px
      against an 11rem floor, its two halves 167px and 354px against an 8rem
      and a 6rem floor, and the run strip 85px against a 3rem one.
    */
    build: () =>
      col(
        "w-layout-foot",
        0.86,
        row(
          "w-layout-right",
          0.78,
          leaf("a-viewport", "viewport"),
          col(
            "w-layout-stack",
            0.32,
            leaf("a-outliner", "outliner"),
            leaf("a-properties", "properties")
          )
        ),
        leaf("a-run", "runParams")
      ),
  },
  {
    id: "compare",
    label: "Compare",
    hint: "Two planes read against each other, without a dialog over the board",
    /*
      The comparison takes the lower half at full width, which is the width the
      relation needs -- two identity blocks, a transition matrix and a delta
      list set beside one another. It is the arrangement that retires the modal:
      what is being compared stays visible above what the comparison says.
    */
    build: () =>
      col(
        "w-compare-split",
        0.56,
        row(
          "w-compare-top",
          0.18,
          leaf("a-outliner", "outliner"),
          row(
            "w-compare-topright",
            0.78,
            leaf("a-viewport", "viewport"),
            leaf("a-properties", "properties")
          )
        ),
        leaf("a-compare", "compare")
      ),
  },
  {
    id: "diagnose",
    label: "Diagnose",
    hint: "How far the domains are apart, and where the difference sits",
    /*
      Domain shift at full detail rather than under `compact`, which is what it
      never got: the histogram and the projection want height as well as width,
      so the board yields the left half and keeps only enough to say which
      rasters are being measured.
    */
    build: () =>
      row(
        "w-diagnose-split",
        0.42,
        col(
          "w-diagnose-left",
          0.62,
          leaf("a-viewport", "viewport"),
          leaf("a-outliner", "outliner")
        ),
        leaf("a-domainshift", "domainShift")
      ),
  },
  {
    id: "data",
    label: "Data",
    hint: "The run's own tables, at the width a table needs",
    /*
      Tables first. They are the surface the studio never offered, though the
      components have existed all along -- DataTableView and the builders in
      analysisTables, which the research pack already writes to disk. Reading
      them required exporting them.
    */
    build: () =>
      row(
        "w-data-split",
        0.34,
        col(
          "w-data-left",
          0.55,
          leaf("a-viewport", "viewport"),
          leaf("a-outliner", "outliner")
        ),
        leaf("a-table", "table")
      ),
  },
]

export const DEFAULT_WORKSPACE = STUDIO_WORKSPACES[0].id

export function studioWorkspace(id: string): StudioWorkspace {
  return STUDIO_WORKSPACES.find((w) => w.id === id) ?? STUDIO_WORKSPACES[0]
}
