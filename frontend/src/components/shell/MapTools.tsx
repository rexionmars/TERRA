import {
  ChartLine,
  Crosshair,
  Image as ImageGlyph,
  Sparkle,
  Stack,
} from "@/components/icons"
import { MapButton } from "@/components/globe/MapChrome"
import type { ShellPanelId } from "@/components/shell/shellNavigation"

/** The tool column's own panels, above what the map itself offers. */
export function MapTools({
  panel,
  togglePanel,
}: {
  panel: ShellPanelId | null
  togglePanel: (id: ShellPanelId) => void
}) {
  return (
    <>
      <MapButton
        label="Products"
        active={panel === "products"}
        onClick={() => togglePanel("products")}
      >
        <Sparkle className="size-4" />
      </MapButton>
      <MapButton
        label="Visualization"
        active={panel === "visualization"}
        onClick={() => togglePanel("visualization")}
      >
        <ImageGlyph className="size-4" />
      </MapButton>
      <MapButton
        label="Result"
        active={panel === "result"}
        onClick={() => togglePanel("result")}
      >
        <ChartLine className="size-4" />
      </MapButton>
      <MapButton
        label="Points"
        active={panel === "points"}
        onClick={() => togglePanel("points")}
      >
        <Crosshair className="size-4" />
      </MapButton>
      <MapButton
        label="Layers"
        active={panel === "layers"}
        onClick={() => togglePanel("layers")}
      >
        <Stack className="size-4" />
      </MapButton>
    </>
  )
}
