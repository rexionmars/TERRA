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
import type { LucideIcon } from "lucide-react"
import {
  Box,
  GitCompareArrows,
  ListTree,
  PanelBottom,
  SlidersHorizontal,
  Table2,
  Waves,
} from "lucide-react"

export type EditorId =
  | "viewport"
  | "outliner"
  | "properties"
  | "compare"
  | "domainShift"
  | "table"
  | "runParams"

export interface StudioEditorMeta {
  id: EditorId
  /** Shown in the area header and in the type selector. */
  label: string
  icon: LucideIcon
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
  /** One line in the type selector, saying what the editor is for. */
  hint: string
}

export const STUDIO_EDITORS: readonly StudioEditorMeta[] = [
  {
    id: "viewport",
    label: "Viewport",
    icon: Box,
    minRem: 12,
    minRowRem: 8,
    unique: true,
    hint: "The rasters themselves, lifted off their coordinates",
  },
  {
    id: "outliner",
    label: "Outliner",
    icon: ListTree,
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
    icon: GitCompareArrows,
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
    id: "table",
    label: "Data table",
    icon: Table2,
    minRem: 24,
    minRowRem: 8,
    hint: "The run's own tables, sortable, as the research pack exports them",
  },
  {
    id: "runParams",
    label: "Run",
    icon: PanelBottom,
    /*
      28rem, down from 36. The tool tabs and the mode moved to this editor's
      own header and the three model labels became one menu, so the body now
      carries area, period and model rather than nine controls across. It
      still scrolls sideways below that, which is what a run's parameters
      should do rather than reflow into a shape a reader has to re-learn.
    */
    minRem: 28,
    minRowRem: 3,
    hint: "Area, period and model for the next run",
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
