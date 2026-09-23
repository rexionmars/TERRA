/**
 * What an area of the studio can be, named once.
 *
 * The studio's surfaces used to be four components that each knew where they
 * belonged. Naming them here instead makes them interchangeable: an area holds
 * one of these, and which one is a choice rather than a fact about the file.
 *
 * One table, for the reason `lib/mapTools.ts` already gives for its own -- a
 * label that exists twice is a label that can disagree with itself. The type
 * selector, the workspace presets and the area headers all read this.
 *
 * METADATA ONLY, no render functions. Each editor needs different props from
 * the studio's state, and a registry that carried renderers would have to
 * carry one context object wide enough for all of them -- which is how a
 * registry becomes a second copy of the component tree. The switch lives where
 * the props are.
 */
import type { Icon } from "@phosphor-icons/react"
import {
  Books,
  ChartLine,
  Crosshair,
  Cube,
  Diamond,
  FlowArrow,
  GitDiff,
  Globe,
  Ruler,
  SlidersHorizontal,
  Table,
  TreeStructure,
  TreeView,
  Waves,
} from "@phosphor-icons/react"

export type EditorId =
  | "viewport"
  | "outliner"
  | "properties"
  | "compare"
  | "domainShift"
  | "spectra"
  | "separability"
  | "libraryLimit"
  | "brush"
  | "table"
  | "runParams"
  | "globe"
  | "mineralReading"
  | "browser"

/**
 * What kind of work a thing is FOR, named once for the whole studio.
 *
 * The type menu listed twenty-three editors in one column and the workspace
 * bar listed seven presets in a row, and neither said what separated them.
 * They are the same three subjects: the board itself, land cover and water. A
 * reader who has learnt the bar has learnt the menu.
 *
 * DECLARED HERE, IN THE LOWER MODULE, for the reason this file already gives
 * for the editor table: a label that exists twice is a label that can disagree
 * with itself. `studioWorkspaces` imports EditorId from here, so here is the
 * only place both can read one list from.
 *
 * "crop" rather than "landCover" as the id because that is the word the work
 * is asked for by; the label is what a reader sees, and it can change without
 * a rename running through two files.
 */
export type StudioGroup = "board" | "crop" | "water"

/** The groups in the order every menu lists them, and what each is called. */
export const STUDIO_GROUPS: readonly {
  id: StudioGroup
  label: string
}[] = [
  { id: "board", label: "Board" },
  { id: "crop", label: "Land cover" },
  { id: "water", label: "Water" },
]

export interface StudioEditorMeta {
  id: EditorId
  /**
   * What kind of work it is for. See StudioGroup.
   *
   * `board` is the editors any task needs -- the scene, the tree, the run's
   * own settings and tables -- and the other two are the subjects this studio
   * is asked about. An editor's group is a property of the editor
   * rather than its position in the array below, so the array's order still
   * decides where it sits INSIDE its group.
   */
  group: StudioGroup
  /** Shown in the area header and in the type selector. */
  label: string
  icon: Icon
  /**
   * The width below which this editor stops being able to say anything.
   *
   * Not caution. `BoardCompareModal` records that the domain-shift histogram
   * and projection cannot be read at 15rem and were moved to a 72rem dialog
   * for that reason -- they were "present in the code, invisible in use". An
   * area below this floor says what it needs instead of drawing something
   * that cannot be read.
   */
  minRem: number
  /** The height below which the same is true. */
  minRowRem: number
  /**
   * Whether more than one area may hold it.
   *
   * The viewport owns the single WebGL context and the single scene, so a
   * second one would need a second renderer. Nothing else here is exclusive.
   */
  unique?: boolean
  /**
   * Whether this editor builds a WebGL context of its own.
   *
   * Recorded because the webview caps live contexts and the studio's budget is
   * not obvious from any one file. The viewport's context lives outside the
   * area tree and is never disposed on a workspace switch, so it is always
   * spent; an editor marked here spends a second one for as long as its area
   * is on screen. Two is comfortable, and this is what makes the count
   * countable rather than a thing to rediscover.
   */
  gl?: boolean
  /** One line in the type selector, saying what the editor is for. */
  hint: string
}

export const STUDIO_EDITORS: readonly StudioEditorMeta[] = [
  {
    id: "viewport",
    group: "board",
    label: "Viewport",
    icon: Cube,
    minRem: 12,
    minRowRem: 8,
    unique: true,
    gl: true,
    hint: "The rasters themselves, lifted off their coordinates",
  },
  {
    id: "outliner",
    group: "board",
    label: "Outliner",
    icon: TreeView,
    minRem: 11,
    minRowRem: 8,
    hint: "What is in the scene, what data there is, which areas exist",
  },
  {
    id: "properties",
    group: "board",
    label: "Properties",
    icon: SlidersHorizontal,
    minRem: 11,
    minRowRem: 6,
    hint: "The selected plane: its legend, its classes, its accuracy",
  },
  {
    id: "compare",
    group: "crop",
    label: "Comparison",
    icon: GitDiff,
    // Wider than the columns, because what it shows is a relation between two
    // planes set beside each other, and two of anything need room for both.
    minRem: 24,
    minRowRem: 6,
    hint: "Two planes against each other: delta, transitions, agreement",
  },
  {
    id: "domainShift",
    group: "crop",
    label: "Domain shift",
    icon: Waves,
    /*
      28rem, and the section runs at full detail rather than under `compact`.
      That flag existed to fit this content into a 15rem band and the result is
      recorded in BoardCompareModal: the histogram and the projection were
      "present in the code, invisible in use". An area large enough to show
      them is the point of giving it one.
    */
    minRem: 28,
    minRowRem: 14,
    hint: "How far the target domain sits from the one the model was fitted on",
  },
  {
    id: "spectra",
    group: "crop",
    label: "Spectral response",
    icon: ChartLine,
    /*
      The same floor the domain-shift editor sets, for the same reason and over
      related content: this is the other half of that diagnostic. Seven ticks
      across the axis, and the two SWIR bands sit in the last third of it --
      narrower than this the band labels collide and the reader loses which
      sample is which, which is the whole content of the figure.
    */
    minRem: 24,
    minRowRem: 14,
    hint: "What each predicted class reflects, band by band, on one acquisition",
  },
  {
    id: "separability",
    group: "crop",
    label: "Class separability",
    icon: Ruler,
    /*
      Wider than the spectral response it reads from, and for the reason the
      library check is wider too: the ranking above the figure carries a class
      name on each side of a pair, so its label gutter holds two of what that
      editor holds one of. Under this the pair names truncate to the point where
      a row no longer says which two classes it ranked.

      Taller as well. This is two readings stacked -- a ranking and the per-band
      figure for whichever row is selected -- and the figure has a 150 px floor
      of its own in plotHeightFor. Below 18 rem the ranking is squeezed to two
      rows and the panel stops being a ranking at all.
    */
    minRem: 26,
    minRowRem: 18,
    hint: "How far apart two classes are, band by band, and where that separation is lost",
  },
  {
    id: "libraryLimit",
    group: "crop",
    label: "Library check",
    icon: Books,
    /*
      Two panes rather than one body, so the floor is one figure and not three
      stacked. Still the widest reading in the studio: the ranking's own label
      gutter is a quarter of the width, because a class name is up to 26
      characters and compressing it is how a figure stops naming its own rows.
    */
    minRem: 26,
    minRowRem: 14,
    hint: "Each class against a spectral library, and why a small angle is not an identification",
  },
  {
    id: "brush",
    group: "crop",
    label: "Rover",
    icon: Crosshair,
    /*
      Narrower than the figures beside it: the readout is a class, a coordinate
      and a small spectrum in a column, so it fits where a properties panel
      fits. Taller than wide is the shape it wants, which is why the row floor
      is the higher of the two numbers.
    */
    minRem: 14,
    minRowRem: 12,
    /*
      Unique. There is one rover, one probe target and one sample; a second
      area would be a second set of controls over the same one.
    */
    unique: true,
    hint: "Point at a predicted pixel: its class, where it is, and what it reflects",
  },
  {
    id: "table",
    group: "board",
    label: "Data table",
    icon: Table,
    minRem: 24,
    minRowRem: 8,
    hint: "The run's own tables, sortable, as the research pack exports them",
  },
  {
    id: "runParams",
    group: "board",
    label: "Run",
    /*
      A graph rather than PanelBottom, which named the foot this editor used to
      be a band along. It is a field of cards now and the glyph should say so
      before the area is opened, not after.
    */
    icon: FlowArrow,
    /*
      24rem across and 14 down, where it was 28 and 3.

      The 3 was a band's floor: a strip of controls needs its own height and
      nothing more. A field needs room for a graph to be a graph -- two columns
      of cards is about 500px wide and the tallest column about 300 -- and
      below roughly this the canvas is fitting the cards down to where their
      own type stops being readable. Narrower than 24 it can still be panned,
      which is why the width floor moved DOWN while the height floor moved up.
    */
    minRem: 24,
    minRowRem: 14,
    hint: "The area, period and model the next run is made of",
  },
  {
    id: "globe",
    group: "board",
    label: "Globe",
    icon: Globe,
    /*
      A sphere has to be wide enough to be one: below roughly this the planet
      is smaller than the areas drawn on it, and the editor shows outlines
      floating on a curve rather than where work is. Square-ish floors, because
      unlike every figure here the subject is round and gains nothing from a
      band.
    */
    minRem: 16,
    minRowRem: 14,
    /*
      Unique. Two globes is two more contexts, not a comparison -- they would
      show the same catalog at two camera angles.
    */
    unique: true,
    /*
      A context, spent on mounting the area. With the viewport always holding
      one, an area on this is the second of the two this file calls
      comfortable.
    */
    gl: true,
    // Was "Every drawn area on the planet, from the world down into the
    // imagery", which described a surface that could only be read. It draws
    // now, and the type menu is where someone looking for a way to make an
    // area will be looking.
    hint: "Draw an area on the planet, over the catalog already on it",
  },
  {
    id: "mineralReading",
    group: "crop",
    label: "Mineral map",
    icon: Diamond,
    /*
      A reading beside planes it does not draw: the class maps are on the
      board, and this carries the passes, the observed area and each group's
      class and reference tables. Wide enough for the reference table's five
      columns, which carry a spectrum title of about thirty characters beside
      three figures; tall because two groups of tables stand under a coverage
      block.
    */
    minRem: 22,
    minRowRem: 16,
    hint: "What the exposed surface is made of, from EMIT and Tetracorder, over what was observed",
  },
  {
    id: "browser",
    group: "board",
    label: "Browser",
    icon: TreeStructure,
    /*
      Four regions across, in Unreal's shape: sources, toolbar, items, count.
      The sources tree alone is 11.5rem and a tile is 8.5, so anything under
      this draws one column of one tile -- which is a list with a sidebar
      taking half of it. Tall enough for the toolbar, a few rows of tiles and
      the status bar, which is what makes the count worth drawing.
    */
    minRem: 32,
    minRowRem: 14,
    /*
      Not unique. Two browsers is one project beside another, which is how a
      run is moved between them by reading both -- and neither holds a control
      the other could disagree with, since what they show is the store.
    */
    hint: "Every saved analysis, filed under its project",
  },
]

const BY_ID = new Map(STUDIO_EDITORS.map((e) => [e.id, e]))

export function studioEditor(id: EditorId): StudioEditorMeta {
  const found = BY_ID.get(id)
  // A tree carrying an id no longer in the table would otherwise render
  // nothing at all, silently; the viewport is the one that always exists.
  return found ?? STUDIO_EDITORS[0]
}

/** Whether a rectangle can carry this editor, both ways. */
export function editorFits(
  id: EditorId,
  rect: { w: number; h: number },
  rootPx: number
): boolean {
  const e = studioEditor(id)
  return rect.w >= e.minRem * rootPx && rect.h >= e.minRowRem * rootPx
}
