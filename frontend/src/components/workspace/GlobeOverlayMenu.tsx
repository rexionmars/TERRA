/**
 * What a right-click on the map offers: the place's coordinates to copy,
 * wherever it lands, and over a raster what can be done to it -- its legend
 * beside it, framing it, and taking it off.
 *
 * A PRESS CAN LAND ON A STACK. The globe resolves a right-click to the ground
 * (GlobeSurface, onOverlayContext), and every raster of one area covers the
 * same ground. Where there is more than one, each gets its own group, top of
 * the stack first, rather than the menu guessing which one was meant.
 */
import { Copy, CornersOut, EyeSlash } from "@/components/icons"
import { LineLegend } from "@/components/lineIcons"
import { formatLatLon } from "@/lib/coordinates"
import { notifyError, notifySuccess } from "@/lib/notify"
import { ClipboardSetText } from "../../../wailsjs/runtime/runtime"

import { ContextMenu, MenuGroup, MenuItem } from "@/components/workspace/MenuPopover"

export interface GlobeOverlayEntry {
  /** The overlay's key on the globe. */
  key: string
  title: string
  /**
   * Whether it has a legend the map can draw beside it. Every legend can be;
   * a ramp's is drawn by default and the others when asked for here
   * (lib/legendChoice.ts). A photograph has none.
   */
  hasLegend: boolean
  /** Whether that legend is drawn on the map now. */
  legendOnMap: boolean
  /** Frame it on the globe. */
  fit: () => void
}

export interface GlobeOverlayTarget {
  at: { x: number; y: number }
  /** Top of the stack first; empty where no raster is under the press. */
  entries: GlobeOverlayEntry[]
  /** The ground under the press, in degrees on WGS 84. */
  ground: { lon: number; lat: number }
}

/*
  Through the application's clipboard rather than the page's: the system one is
  what a paste in another program reads, and it does not depend on the webview
  granting the page clipboard access.
*/
async function copyCoordinates(text: string) {
  try {
    const ok = await ClipboardSetText(text)
    if (!ok) throw new Error("the system clipboard refused the text")
    notifySuccess("Coordinates copied", text)
  } catch (e) {
    notifyError("Could not copy the coordinates", e)
  }
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
        icon={LineLegend}
        label={
          entry.legendOnMap
            ? "Hide the legend on the map"
            : "Show the legend on the map"
        }
        title={
          !entry.hasLegend
            ? "This raster has no legend to draw: its colours are a photograph, or its reading is in Result"
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
        icon={EyeSlash}
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
  const place = target ? formatLatLon(target.ground.lat, target.ground.lon) : ""
  return (
    <ContextMenu
      at={target?.at ?? null}
      surface={surface}
      title={
        !target || target.entries.length === 0
          ? place
          : one
            ? one.title
            : `${target.entries.length} rasters here`
      }
      onClose={onClose}
    >
      {target && (
        <MenuItem
          icon={Copy}
          label="Copy coordinates"
          title={`Latitude, longitude in decimal degrees on WGS 84: ${place}`}
          onSelect={() => {
            void copyCoordinates(place)
            onClose()
          }}
        />
      )}
      {target &&
        target.entries.length > 0 &&
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
