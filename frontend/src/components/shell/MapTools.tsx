import {
  LineCompositions,
  LineLayers,
  LinePoints,
  LineProducts,
  LineResult,
} from "@/components/lineIcons"
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
        <LineProducts className="size-4" />
      </MapButton>
      <MapButton
        label="Compositions"
        active={panel === "visualization"}
        onClick={() => togglePanel("visualization")}
      >
        <LineCompositions className="size-4" />
      </MapButton>
      <MapButton
        label="Result"
        active={panel === "result"}
        onClick={() => togglePanel("result")}
      >
        <LineResult className="size-4" />
      </MapButton>
      <MapButton
        label="Points"
        active={panel === "points"}
        onClick={() => togglePanel("points")}
      >
        <LinePoints className="size-4" />
      </MapButton>
      <MapButton
        label="Layers"
        active={panel === "layers"}
        onClick={() => togglePanel("layers")}
      >
        <LineLayers className="size-4" />
      </MapButton>
    </>
  )
}
