/**
 * What can be done to a plane, offered on the plane.
 *
 * WHY THIS EXISTS NOW. Blender's navigation moved orbit, pan and zoom onto the
 * middle button, which freed the right one -- and a context menu on the object
 * is what it was freed for. Until this, "drop to base level" lived in the
 * outliner's footer, under the Scene pane: a reader who wanted to lay one
 * raster on another had to select it in a tree, find the pane, and press a
 * button three surfaces from the thing it acts on.
 *
 * An action on a plane belongs on the plane. That is the whole argument, and
 * it is the same one that moved the view controls into the viewport's header
 * and the plane's opacity into the properties editor: each control beside the
 * thing it changes.
 *
 * WHAT IS AND IS NOT HERE. Only what acts on this one plane. Its opacity is
 * not -- that is a value to be read against the legend beside it, which is the
 * properties editor's job, and a number field in a menu that closes on the
 * first click is a control that cannot be adjusted. Selecting is not either:
 * the left button already does it, and a menu entry for a gesture the reader
 * has just performed is a row that says nothing.
 */
import {
  AlignBottom,
  CornersOut,
  Eye,
  EyeSlash,
  MapTrifold as MapIcon,
  Note,
  Stack,
  Trash,
} from "@phosphor-icons/react"
import {
  StudioContextMenu,
  StudioMenuItem,
  StudioMenuRule,
} from "@/components/studio/StudioPopover"

export interface PlaneContextTarget {
  areaId: string
  layerId: string
  title: string
  /** Window coordinates of the press, which is where the menu opens. */
  at: { x: number; y: number }
  visible: boolean
  /** The base layer has no level below it to descend to. */
  isBase: boolean
  flat: boolean
  removable: boolean
  /**
   * Whether every other plane on the board is already hidden.
   *
   * Solo is a toggle rather than a one-way action: hiding eleven planes to
   * look at one, and then restoring them by hand, is eleven gestures to undo
   * one. The label says which way the entry goes.
   */
  soloed: boolean
  /**
   * Whether this plane is the one the globe is currently drawing.
   *
   * A toggle, like solo beside it and for the same reason: putting eleven
   * planes on the globe and taking them back one at a time is not the shape of
   * the gesture. The label says which way the entry goes.
   */
  onMap: boolean
  /** Whether its legend is drawn on the globe beside it. */
  propertyOnMap: boolean
  /**
   * Whether anything published what its colours mean.
   *
   * A raster can have none -- see lib/layerLegend.ts, which returns null
   * rather than composing a description of a mapping nobody stated.
   */
  hasLegend: boolean
}

export function PlaneContextMenu({
  target,
  surface,
  onClose,
  onToggleFlat,
  onToggleVisible,
  onSolo,
  onFit,
  onSendToMap,
  onToggleProperty,
  onRemove,
}: {
  target: PlaneContextTarget | null
  /** Portalled here and clamped inside it, as every studio panel is. */
  surface: HTMLElement | null
  onClose: () => void
  onToggleFlat: () => void
  onToggleVisible: () => void
  /** Hide every other plane on the board, or bring them all back. */
  onSolo: () => void
  /** Put the camera on this plane. */
  onFit: () => void
  /**
   * Draw this raster on the studio's globe, over the ground it measures.
   *
   * The viewport lifts rasters off their coordinates so two grounds hundreds
   * of kilometres apart can be read side by side. That is what it is for, and
   * it is also what it costs: a plane here answers "how do these compare" and
   * cannot answer "where on the ground is this". The globe beside it is the
   * second question, asked of the plane the reader is already pointing at.
   *
   * THE GLOBE, NOT THE WORK MAP. This drew on the map of the home screen at
   * first -- the one surface the reader is not on while they are here, so the
   * result appeared somewhere they had to leave the studio to find.
   */
  onSendToMap: () => void
  /** Draw this raster's legend on the globe, tied to the ground it measures. */
  onToggleProperty: () => void
  onRemove: () => void
}) {
  return (
    <StudioContextMenu
      at={target?.at ?? null}
      surface={surface}
      title={target?.title ?? ""}
      onClose={onClose}
    >
      {target && (
        <>

      {/*
        Offered only where there is a level below to descend to.

        The stack separates layers along Y so orbiting pulls them apart, which
        is what makes the draw order visible. That separation is in the way
        when the question is not "what is the order" but "does this line up
        with that": from overhead a layer one step up reads as floating over
        the base rather than lying on it. The base layer IS the level, so it is
        offered nothing.
      */}
      {!target.isBase && (
        <StudioMenuItem
          icon={AlignBottom}
          label={target.flat ? "Return to its own height" : "Drop to base level"}
          checked={target.flat}
          onSelect={() => {
            onToggleFlat()
            onClose()
          }}
        />
      )}
      <StudioMenuItem
        icon={target.visible ? EyeSlash : Eye}
        label={target.visible ? "Hide this plane" : "Show this plane"}
        onSelect={() => {
          onToggleVisible()
          onClose()
        }}
      />
      {/*
        Solo, which the outliner can only do a row at a time. A board of four
        areas carries a dozen planes, and reading one against the ground meant
        eleven presses in a tree.
      */}
      <StudioMenuItem
        icon={Stack}
        label={target.soloed ? "Show every plane" : "Hide every other plane"}
        title={
          target.soloed
            ? "Bring the rest of the studio back"
            : "Leave this one visible and hide the rest"
        }
        onSelect={() => {
          onSolo()
          onClose()
        }}
      />
      {/*
        Zoom to fit, on the plane rather than on the stack. The viewport header
        frames everything; this frames what the reader pointed at, from the
        direction they are already looking.
      */}
      <StudioMenuItem
        icon={CornersOut}
        label="Zoom to fit this plane"
        onSelect={() => {
          onFit()
          onClose()
        }}
      />
      <StudioMenuItem
        icon={MapIcon}
        label={target.onMap ? "Take off the globe" : "Show on the globe"}
        title={
          target.onMap
            ? "The globe stops drawing it; the viewport keeps it"
            : "Draw it on the globe, over the ground it measures"
        }
        checked={target.onMap}
        onSelect={() => {
          onSendToMap()
          onClose()
        }}
      />
      {/*
        The legend, on the ground rather than in the panel at the edge.

        DISABLED RATHER THAN HIDDEN where the plane is not on the globe. The
        entry is what says the legend is drawn beside the raster, and one that
        appeared only once the raster was already there would never teach that.
        Its title says what is missing.

        Also disabled where the layer HAS no legend: lib/layerLegend.ts returns
        none for a raster whose colours nothing published, and an entry that
        drew an empty box would be a control that appears to fail.
      */}
      <StudioMenuItem
        icon={Note}
        label={
          target.propertyOnMap
            ? "Hide the property on the map"
            : "Show the property on the map"
        }
        title={
          !target.hasLegend
            ? "Nothing published what this raster's colours mean"
            : !target.onMap
              ? "Show it on the globe first; the legend is drawn beside it"
              : target.propertyOnMap
                ? "The globe keeps the raster and stops drawing its legend"
                : "Its legend, tied to the ground it measures"
        }
        checked={target.propertyOnMap}
        disabled={!target.onMap || !target.hasLegend}
        onSelect={() => {
          onToggleProperty()
          onClose()
        }}
      />
      {target.removable && (
        <>
          <StudioMenuRule />
          <StudioMenuItem
            icon={Trash}
            label="Remove from the studio"
            title="The run keeps it; the studio stops drawing it"
            onSelect={() => {
              onRemove()
              onClose()
            }}
          />
        </>
      )}
        </>
      )}
    </StudioContextMenu>
  )
}
