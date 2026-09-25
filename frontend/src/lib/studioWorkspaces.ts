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
import { Cube, Diamond, GitDiff, Graph, Polygon, Table, Waves } from "@phosphor-icons/react"

import type { AreaNode } from "@/lib/boardAreas"
import { type EditorId, type StudioGroup } from "@/lib/studioEditors"

export type StudioTree = AreaNode<EditorId>

/**
 * The groups an arrangement can belong to are the STUDIO's groups, not a set
 * of this file's own.
 *
 * They were declared here first and that was one list too many: the type menu
 * groups its editors by the same subjects, and two tables of group names is
 * two tables that can disagree. `studioEditors` is the lower
 * module -- this file already imports EditorId from it -- so the vocabulary
 * lives there and both read it.
 */
export type { StudioGroup } from "@/lib/studioEditors"

export interface StudioWorkspace {
  id: string
  /** The tab's label. */
  label: string
  /** What kind of work it is for. See StudioGroup. */
  group: StudioGroup
  /** One line, for the tab's title attribute. */
  hint: string
  /**
   * The tab's glyph, taken from the editor the arrangement is built around.
   *
   * Not a fifth vocabulary. Every one of these presets exists to give one
   * reading the room it needs -- the comparison the lower half, the tables
   * their width, the domain-shift figures their height -- and it is already
   * listed in the type menu under that editor's own glyph. Wearing the same one makes the
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
    group: "board",
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

      THE FOOT IS A FIELD NOW, NOT A STRIP. It was 14% of the height, sized
      for the run editor's old 3rem floor; the editor became a node canvas
      with a 14rem one, and at a 1440x900 window the preset opened on an area
      that could only say what it needed. The foot is 40%, which is the least
      that clears 14rem at the 1000x700 minimum, and the stack above it moves
      its division down to keep the outliner over its 8rem floor.

      Reports shares the foot, as it does in Solara's Layout: the log of what
      the application said beside the run that is most of what it says about.

      Checked by studioWorkspaces.test.ts rather than written here, since the
      figures written here were the ones that went stale: at 1000x700 the run
      area is 42x14.7rem and Reports 19.6x14.7rem.
    */
    build: () =>
      col(
        "w-layout-foot",
        0.6,
        row(
          "w-layout-right",
          0.78,
          leaf("a-viewport", "viewport"),
          col(
            "w-layout-stack",
            0.42,
            leaf("a-outliner", "outliner"),
            leaf("a-properties", "properties")
          )
        ),
        row(
          "w-layout-foot-row",
          0.68,
          leaf("a-run", "runParams"),
          leaf("a-reports", "reports")
        )
      ),
  },
  {
    id: "compositing",
    group: "board",
    icon: Graph,
    label: "Compositing",
    hint: "The board's rasters worked as nodes, from filter to reading",
    /*
      Blender's Compositing workspace gives the node editor most of the screen,
      and so does this one: the compositor takes the lower two thirds at full
      width, where its readings and Viewer cards have room, and the viewport
      and outliner stay above it to say which rasters are on the board.
      Checked against the editors' floors by studioWorkspaces.test.ts.
    */
    build: () =>
      col(
        "w-compositing-split",
        0.36,
        row(
          "w-compositing-top",
          0.72,
          leaf("a-viewport", "viewport"),
          leaf("a-outliner", "outliner")
        ),
        leaf("a-compositor", "compositor")
      ),
  },
  {
    id: "compare",
    group: "crop",
    icon: GitDiff,
    label: "Compare",
    hint: "Two planes read against each other, without a dialog over the board",
    /*
      The comparison takes the lower half at full width, which is the width the
      relation needs -- two identity blocks, a transition matrix and a delta
      list set beside one another. It is the arrangement that retires the modal:
      what is being compared stays visible above what the comparison says.

      The outliner at a fifth rather than 0.18, and the viewport's share of
      the rest at 0.75 rather than 0.78: at the 1000x700 minimum the old
      fractions left the outliner 10.9rem wide against its 11rem floor.
    */
    build: () =>
      col(
        "w-compare-split",
        0.56,
        row(
          "w-compare-top",
          0.2,
          leaf("a-outliner", "outliner"),
          row(
            "w-compare-topright",
            0.75,
            leaf("a-viewport", "viewport"),
            leaf("a-properties", "properties")
          )
        ),
        leaf("a-compare", "compare")
      ),
  },
  {
    id: "diagnose",
    group: "crop",
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
    group: "crop",
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
    id: "minerals",
    group: "crop",
    icon: Diamond,
    label: "Mineral map",
    hint: "What the exposed surface is made of, and how much of the area was observed",
    /*
      The class maps and the derived rasters are planes of the ground, so the
      viewport keeps the left with the outliner under it, where they are
      listed and switched. The figures are cards in the compositor beside it
      rather than a column of tables: a finished map's cards are placed there
      (withMineralNodes). The short reading column is still in the type menu.
      Half, as the field boundaries' preset: the compositor's floor is 28 rem,
      448 px of the 1000 px minimum.
    */
    build: () =>
      row(
        "w-minerals-split",
        0.5,
        col(
          "w-minerals-left",
          0.68,
          leaf("a-viewport", "viewport"),
          leaf("a-outliner", "outliner")
        ),
        leaf("a-compositor", "compositor")
      ),
  },
  {
    id: "fields",
    group: "crop",
    icon: Polygon,
    label: "Field boundaries",
    hint: "Where one field ends and the next begins, and the fields of an area",
    /*
      The polygons are vector and drawn on the globe, so the globe takes the
      width where the other presets put the viewport, with the outliner under
      it, where the fields are listed under their area and chosen. What is done
      with a delineation -- filtering its fields, making them areas, saving
      them -- is nodes in the compositor beside it rather than a panel of
      figures: the delineation's own nodes are placed there when it finishes.

      The jobs under the compositor, because what follows a delineation is the
      same question asked of every field: the fields are shift-selected on the
      globe, the band's product is queued over them, and this is where the
      queue is followed.
    */
    build: () =>
      row(
        "w-fields-split",
        // Half: the compositor's floor is 28 rem, 448 px of the 1000 px minimum.
        0.5,
        col(
          "w-fields-left",
          0.68,
          leaf("a-globe", "globe"),
          leaf("a-outliner", "outliner")
        ),
        col(
          "w-fields-right",
          0.7,
          leaf("a-compositor", "compositor"),
          leaf("a-jobs", "jobs")
        )
      ),
  },
]

export const DEFAULT_WORKSPACE = STUDIO_WORKSPACES[0].id

export function studioWorkspace(id: string): StudioWorkspace {
  return STUDIO_WORKSPACES.find((w) => w.id === id) ?? STUDIO_WORKSPACES[0]
}
