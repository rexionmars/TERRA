/**
 * What can be done to a raster on the map, offered on the raster: its legend
 * beside it, framing it, and taking it off.
 *
 * A PRESS CAN LAND ON A STACK. The globe resolves a right-click to the ground
 * (GlobeSurface, onOverlayContext), and every raster of one area covers the
 * same ground. Where there is more than one, each gets its own group, top of
 * the stack first, rather than the menu guessing which one was meant.
 */
import { CornersOut, MapTrifold as MapIcon, Note } from "@/components/icons"

import { ContextMenu, MenuGroup, MenuItem } from "@/components/workspace/MenuPopover"

export interface GlobeOverlayEntry {
  /** The overlay's key on the globe. */
  key: string
  title: string
  /**
   * Whether it has a legend the map can draw beside it. Only a ramp does: a
   * class legend runs long and is read in the Result panel.
   */
  hasLegend: boolean
  /** Whether that legend is drawn on the map now. */
  legendOnMap: boolean
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
  onToggleLegend,
  onTakeOff,
}: {
  entry: GlobeOverlayEntry
  onClose: () => void
  onToggleLegend: (key: string) => void
  onTakeOff: (key: string) => void
}) {
  return (
    <>
      <MenuItem
        icon={Note}
        label={
          entry.legendOnMap
            ? "Hide the legend on the map"
            : "Show the legend on the map"
        }
        title={
          !entry.hasLegend
            ? "Only a colour ramp is drawn beside its raster"
            : entry.legendOnMap
              ? "The map keeps the raster and stops drawing its legend"
              : "Its legend, tied to the ground it measures"
        }
        checked={entry.legendOnMap}
        disabled={!entry.hasLegend}
        onSelect={() => {
          onToggleLegend(entry.key)
          onClose()
        }}
      />
      <MenuItem
        icon={CornersOut}
        label="Zoom to fit this raster"
        onSelect={() => {
          entry.fit()
          onClose()
        }}
      />
      <MenuItem
        icon={MapIcon}
        label="Take off the globe"
        title="The map stops drawing it; Layers still lists it"
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
  onToggleLegend,
  onTakeOff,
}: {
  target: GlobeOverlayTarget | null
  /** Portalled here and clamped inside it, as every studio panel is. */
  surface: HTMLElement | null
  onClose: () => void
  onToggleLegend: (key: string) => void
  onTakeOff: (key: string) => void
}) {
  const one = target?.entries.length === 1 ? target.entries[0] : null
  return (
    <ContextMenu
      at={target?.at ?? null}
      surface={surface}
      title={one ? one.title : `${target?.entries.length ?? 0} rasters here`}
      onClose={onClose}
    >
      {target &&
        (one ? (
          <Entries
            entry={one}
            onClose={onClose}
            onToggleLegend={onToggleLegend}
            onTakeOff={onTakeOff}
          />
        ) : (
          target.entries.map((e) => (
            <MenuGroup key={e.key} label={e.title}>
              <Entries
                entry={e}
                onClose={onClose}
                onToggleLegend={onToggleLegend}
                onTakeOff={onTakeOff}
              />
            </MenuGroup>
          ))
        ))}
    </ContextMenu>
  )
}
