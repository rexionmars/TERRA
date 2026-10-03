/**
 * What can be done to a raster on the globe, offered on the raster.
 *
 * The plane menu (PlaneContextMenu) answers this in the studio's viewport. The
 * same raster drawn on the globe had no menu at all, so its legend could be
 * shown from the viewport and not from the place it is drawn over. These are
 * the entries that mean something on the globe: its legend beside it, taking
 * it off, and framing it. Hiding, solo and the drop to base level act on the
 * viewport's planes and stay in that menu.
 *
 * A PRESS CAN LAND ON A STACK. The globe resolves a right-click to the ground
 * (GlobeSurface, onOverlayContext), and every raster of one area covers the
 * same ground. Where there is more than one, each gets its own group, top of
 * the stack first, rather than the menu guessing which one was meant.
 */
import { CornersOut, MapTrifold as MapIcon, Note } from "@phosphor-icons/react"

import { StudioContextMenu, StudioMenuGroup, StudioMenuItem } from "@/components/studio/StudioPopover"

export interface GlobeOverlayEntry {
  /** The overlay's key on the globe. */
  key: string
  title: string
  /** Whether anything published what its colours mean. */
  hasLegend: boolean
  /** Whether its legend is drawn on the globe beside it. */
  propertyOnMap: boolean
  /** Frame it on the globe. */
  fit: () => void
}

export interface GlobeOverlayTarget {
  at: { x: number; y: number }
  /** Top of the stack first. */
  entries: GlobeOverlayEntry[]
}

function Entries({
  entry,
  onClose,
  onToggleProperty,
  onTakeOff,
}: {
  entry: GlobeOverlayEntry
  onClose: () => void
  onToggleProperty: (key: string) => void
  onTakeOff: (key: string) => void
}) {
  return (
    <>
      <StudioMenuItem
        icon={Note}
        label={entry.propertyOnMap ? "Hide the property on the map" : "Show the property on the map"}
        title={
          !entry.hasLegend
            ? "Nothing published what this raster's colours mean"
            : entry.propertyOnMap
              ? "The globe keeps the raster and stops drawing its legend"
              : "Its legend, tied to the ground it measures"
        }
        checked={entry.propertyOnMap}
        disabled={!entry.hasLegend}
        onSelect={() => {
          onToggleProperty(entry.key)
          onClose()
        }}
      />
      <StudioMenuItem
        icon={CornersOut}
        label="Zoom to fit this raster"
        onSelect={() => {
          entry.fit()
          onClose()
        }}
      />
      <StudioMenuItem
        icon={MapIcon}
        label="Take off the globe"
        title="The globe stops drawing it; the studio keeps it"
        onSelect={() => {
          onTakeOff(entry.key)
          onClose()
        }}
      />
    </>
  )
}

export function GlobeOverlayMenu({
  target,
  surface,
  onClose,
  onToggleProperty,
  onTakeOff,
}: {
  target: GlobeOverlayTarget | null
  /** Portalled here and clamped inside it, as every studio panel is. */
  surface: HTMLElement | null
  onClose: () => void
  onToggleProperty: (key: string) => void
  onTakeOff: (key: string) => void
}) {
  const one = target?.entries.length === 1 ? target.entries[0] : null
  return (
    <StudioContextMenu
      at={target?.at ?? null}
      surface={surface}
      title={one ? one.title : `${target?.entries.length ?? 0} rasters here`}
      onClose={onClose}
    >
      {target &&
        (one ? (
          <Entries entry={one} onClose={onClose} onToggleProperty={onToggleProperty} onTakeOff={onTakeOff} />
        ) : (
          target.entries.map((e) => (
            <StudioMenuGroup key={e.key} label={e.title}>
              <Entries entry={e} onClose={onClose} onToggleProperty={onToggleProperty} onTakeOff={onTakeOff} />
            </StudioMenuGroup>
          ))
        ))}
    </StudioContextMenu>
  )
}
