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
import type { Icon } from "@phosphor-icons/react"
import { Cube, Database, GitDiff, Table, Tree, Waves } from "@phosphor-icons/react"

import type { AreaNode } from "@/lib/boardAreas"
import type { EditorId } from "@/lib/studioEditors"

export type StudioTree = AreaNode<EditorId>

export interface StudioWorkspace {
  id: string
  /** The tab's label. */
  label: string
  /** One line, for the tab's title attribute. */
  hint: string
  /**
   * The tab's glyph, taken from the editor the arrangement is built around.
   *
   * Not a fifth vocabulary. Every one of these presets exists to give one
   * reading the room it needs -- the comparison the lower half, the tables
   * their width, the canopy the whole board -- and it is already listed in the
   * type menu under that editor's own glyph. Wearing the same one makes the
   * tab and the area it leads to legible as one subject, which is the argument
   * `BoardRunGraph` makes for reusing the board tree's glyphs on its tools.
   */
  icon: Icon
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
    icon: Cube,
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
    icon: GitDiff,
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
    icon: Waves,
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
    icon: Table,
    label: "Data",
    hint: "The run's own tables, at the width a table needs",
    /*
      Tables first. They are the surface the studio never offered, though the
      components have existed all along -- DataTableView and the builders in
      analysisTables, which the research pack already writes to disk. Reading
      them required exporting them.

      The browser under them, where the store is: this workspace is where a run
      is read rather than made, and what a reader does before reading one is
      find it. It replaced the project hub, which was a screen you left the
      work to visit -- so the arrangement that answers "which run" puts it
      beside the tables that answer "what does it say".
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
        col("w-data-right", 0.55, leaf("a-table", "table"), leaf("a-browser", "browser"))
      ),
  },
  {
    id: "simulation",
    icon: Tree,
    label: "Simulation",
    hint: "An orchard module and the light that reaches through it",
    /*
      The canopy takes the width because the question is spatial: where the
      light falls between the crowns is not readable in a column, and the
      outliner beside it says which ground is on the board.

      THE STRIP ALONG THE FOOT IS THE CANOPY'S OWN, not the classification's.
      It was the run band, on the argument that the orchard is the same ground
      a classification is about -- which is true and was not enough: the
      canopy's own parameters then had nowhere to live but inside the panels,
      so every canopy area carried the species, the sowing, an area picker and
      a commit, and two areas asking two questions about ONE stand offered two
      sets of controls over it. A workspace is an arrangement for a kind of
      work; the band that belongs at the foot of this one is the band that sets
      what is grown. Classifying is a gesture away, in Layout, where its band
      has always been.

      No viewport in this preset. Not to save the second WebGL context -- the
      board's is never released on a workspace switch, so it is spent either
      way -- but because a stack of rasters and a shaded orchard are two
      answers to two different questions, and putting them side by side invites
      reading one as an overlay of the other.

      Fractions measured at the 1000x700 minimum, after the 28px workspace bar,
      the 22px status bar and each area's own 26px header: the canopy body is
      720x533 against a 288x224 floor, the outliner 280x533 against 176x128,
      and the canopy band 1000x65 against 512x48.
    */
    build: () =>
      col(
        "w-sim-foot",
        0.86,
        row(
          "w-sim-split",
          0.72,
          leaf("a-canopy", "canopy"),
          leaf("a-outliner", "outliner")
        ),
        leaf("a-canopy-run", "canopyParams")
      ),
  },
  {
    id: "grid",
    icon: Database,
    label: "System",
    hint: "The operational record, and what the grid did to the plants on it",
    /*
      NO VIEWPORT, and here it is not a preference. The other presets spend
      their width on one because their products draw a raster; nothing in this
      family does -- there is no overlay, no extent, no plane to select. An
      editor that has nothing to show should not open holding half the screen.

      The globe takes its place because "where on the ground" is a real
      question here and has a real answer: the plants carry coordinates, which
      is the whole reason the store keeps geometry at all.

      THE RUN GRAPH IS ON SCREEN BESIDE THE READING, which no other preset
      does, and it is the reason this one exists. The record is revised in
      batches, so "which revision is this figure about" is asked OF a result --
      and the store card is where it is answered. Layout puts the graph in a
      foot at 0.86, which at the 1000x700 minimum is about 98 px against
      runParams' own 24 rem floor.

      Fractions against that minimum: the left column is 460 px, clearing the
      globe's 16 rem and runParams' 24; the right is 540, clearing
      gridCurtailment's 28 rem and gridRecord's 26. The left split at 0.58
      gives the globe about 341 px and the graph 247, which is where a
      three-column graph stops needing to be panned to be read.

      The right column is split at 0.66 rather than evenly: a series figure is
      four panels and what retires it, and the record is a connection line and
      a short table. Splitting them in half would give the shorter one room it
      does not use and take it from the one whose whole content is a shape.
    */
    build: () =>
      row(
        "w-grid-split",
        0.46,
        col(
          "w-grid-left",
          0.58,
          leaf("a-globe", "globe"),
          leaf("a-grid-run", "runParams")
        ),
        col(
          "w-grid-right",
          0.66,
          leaf("a-grid-figure", "gridFigure"),
          leaf("a-grid-record", "gridRecord")
        )
      ),
  },
]

export const DEFAULT_WORKSPACE = STUDIO_WORKSPACES[0].id

export function studioWorkspace(id: string): StudioWorkspace {
  return STUDIO_WORKSPACES.find((w) => w.id === id) ?? STUDIO_WORKSPACES[0]
}
