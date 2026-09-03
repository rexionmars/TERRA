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
  Database,
  Lightning,
  ChartLine,
  Crosshair,
  Cube,
  Fan,
  FlowArrow,
  GitDiff,
  Globe,
  Plant,
  Ruler,
  SlidersHorizontal,
  Sun,
  Table,
  Tree,
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
  | "canopy"
  | "canopyParams"
  | "globe"
  | "solarReading"
  | "windReading"
  | "floodReading"
  | "gridRecord"
  | "gridCurtailment"
  | "gridFigure"
  | "browser"

export interface StudioEditorMeta {
  id: EditorId
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
    label: "Outliner",
    icon: TreeView,
    minRem: 11,
    minRowRem: 8,
    hint: "What is in the scene, what data there is, which areas exist",
  },
  {
    id: "properties",
    label: "Properties",
    icon: SlidersHorizontal,
    minRem: 11,
    minRowRem: 6,
    hint: "The selected plane: its legend, its classes, its accuracy",
  },
  {
    id: "compare",
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
      area would be a second set of controls over the same one, which is the
      duplication that moving the canopy's controls out of its panels removed.
    */
    unique: true,
    hint: "Point at a predicted pixel: its class, where it is, and what it reflects",
  },
  {
    id: "table",
    label: "Data table",
    icon: Table,
    minRem: 24,
    minRowRem: 8,
    hint: "The run's own tables, sortable, as the research pack exports them",
  },
  {
    id: "runParams",
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
    id: "canopy",
    label: "Canopy",
    icon: Tree,
    /*
      A volume ray-march has to be large enough to read a gap between two
      crowns, and the shading a reader is looking for lives in the last third
      of the depth. Below roughly this the crowns are a few pixels across and
      the question the editor answers cannot be asked of it.
    */
    /*
      Wider than the stand alone needed. This editor carries four readings now
      -- the stand, the season an AOI implies, the light that canopy makes of
      the sun, and whether the plant model applies to the sowing at all -- and
      the three that are charts do not fit the 18rem a 3D view could live in.
    */
    minRem: 22,
    minRowRem: 14,
    /*
      Only the stand pane builds a context, and it builds it on entering that
      pane rather than on mounting the area. An area parked on Season spends
      nothing, which is what makes four panes affordable in a budget of two.
    */
    gl: true,
    /*
      NOT unique. Two canopies is a comparison -- the same leaf area at two
      spacings, or a young stand against a grown one -- and each builds its own
      small scene, so the cost is one more context rather than a contested
      singleton. The viewport is exclusive because there is one board; there is
      no one stand.
    */
    // Was "An orchard module, shaded by marching its leaf-area density", which
    // described the voxel view this editor replaced. A hint that outlives the
    // thing it describes sends a reader to the wrong area.
    hint: "A stand: specified and drawn, or the one an AOI's season implies",
  },
  {
    id: "globe",
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
      A context, and unlike the canopy's it is spent on mounting the area
      rather than on entering a pane. With the viewport always holding one,
      an area on this is the second of the two this file calls comfortable,
      and a board carrying this AND a canopy on its stand pane is at three.
    */
    gl: true,
    // Was "Every drawn area on the planet, from the world down into the
    // imagery", which described a surface that could only be read. It draws
    // now, and the type menu is where someone looking for a way to make an
    // area will be looking.
    hint: "Draw an area on the planet, over the catalog already on it",
  },
  {
    id: "canopyParams",
    label: "Canopy run",
    icon: Plant,
    /*
      The canopy's half of what `runParams` is for the classification products,
      and the same floor for the same reason: the parameters scroll sideways
      below it, which is what a band should do rather than reflow into a shape
      a reader has to re-learn. Wider than the run band by two groups' worth --
      it carries a sowing of four numbers where that one carries a period of
      two.
    */
    minRem: 32,
    minRowRem: 3,
    /*
      Unique. It is not a view of anything: it holds the species, the age, the
      sowing and which analysed area is read, once for the board. A second one
      would be a second set of controls over one stand, which is the exact
      duplication that moving these out of the canopy panels removed.
    */
    unique: true,
    hint: "Species, age and sowing for the stand, and which area is read",
  },
  {
    id: "solarReading",
    label: "Solar result",
    icon: Sun,
    minRem: 20,
    minRowRem: 16,
    hint: "The resource, the terrain, the siting and the energy model, as each was measured",
  },
  {
    id: "windReading",
    label: "Wind screening",
    icon: Fan,
    /*
      The two products whose result is a reading and not a raster.

      Every other editor here draws something the viewport could also draw, or
      controls something that changes it. These two do not: a wind screening
      resolves an AOI to one reanalysis cell and reports figures over it, and
      the flood envelope reports how far its products disagree. There is no
      plane to select, so the reading is the editor rather than a band that
      fills when a plane is picked.

      Wide because the figures sit two to a row under a chip strip that names
      the blocks, and a column narrower than this wraps a labelled figure onto
      three lines. Tall for the same reason the reading scrolls at all: the
      shear table alone is five rows.
    */
    minRem: 20,
    minRowRem: 16,
    hint: "Hub-height wind over the area, and how far the estimate moves with roughness",
  },
  {
    id: "floodReading",
    label: "Flood envelope",
    icon: Waves,
    minRem: 20,
    minRowRem: 16,
    hint: "How far the elevation products disagree about what the area floods",
  },
  {
    id: "gridRecord",
    label: "Grid record",
    icon: Database,
    /*
      What the local store holds, and whether it can be reached at all.

      NOT A SETTINGS PANE, and the difference decides where it lives. Which
      database to open is configuration and sits with the interpreter in
      Settings; WHAT IS IN IT is a reading, and one that has to be at hand
      while a result is on screen -- the record is revised in batches, so
      "which revision is this figure about" is a question asked of a result,
      not of a preferences screen.

      Wide enough for the coverage table's five columns, which carry a dataset
      name of about 22 characters beside four numbers. Narrower than this and
      the row count wraps under its own heading. Short, because the whole
      reading is that table plus a connection line and a defects line: a floor
      taller than its content only makes an empty area harder to place.
    */
    minRem: 26,
    minRowRem: 12,
    hint: "Which operational record this installation holds, and of which revision",
  },
  {
    id: "gridCurtailment",
    label: "Curtailment",
    icon: Lightning,
    /*
      A reading and not a raster, in the family windReading names: the record
      resolves an area to the metered plants inside it and reports figures over
      them. Nothing here draws on the map, so there is no plane to select and
      the reading is the editor.

      Wider than the record's 26 because the per-plant rows carry a plant name
      beside two figures, and taller than any other reading because the hourly
      profile is the shape the product exists to show -- twenty-four labelled
      bars under three stacked blocks. Squeezed under about 22 rem the bars
      stop being readable as a shape, which is the whole of what they say.
    */
    minRem: 28,
    minRowRem: 22,
    hint: "What the operator withheld at the metered plants inside the area, and why",
  },
  {
    id: "gridFigure",
    label: "Series figure",
    icon: ChartLine,
    /*
      One analysis of the published research series, drawn here rather than
      shown as the published image.

      The paper figure is 183 mm at 7 pt. lib/figure.ts measures what that
      becomes on a screen -- about 7.3 px in a 540 px panel, under the 9 px
      floor this interface holds in twenty-one places -- and states that the
      discipline is borrowed while the measurements are not. So Python returns
      the tables and this draws them at the interface's own scale.

      Wide because the published layout is 183 mm of double column and its
      panels do not survive being stacked into a narrow strip. Tall because a
      figure is four panels plus what retires it: four of the twelve correct an
      earlier one, and that line is drawn above the figure rather than as a
      footnote.
    */
    minRem: 30,
    minRowRem: 26,
    hint: "One analysis of the published series, computed here and drawn at this scale",
  },
  {
    id: "browser",
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
