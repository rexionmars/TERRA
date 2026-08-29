/**
 * Drawing an area without leaving the board.
 *
 * The band's AREA group could import a polygon and clear one, but not make one:
 * the only place to draw was the map, and reaching it meant closing the board
 * that the area was being drawn FOR. That is a round trip through the surface
 * you are trying to add to.
 *
 * A MAP OF ITS OWN, not the map screen's. MapSurface answers twenty-five props
 * -- overlays, swipe, confidence, contour scheme -- because it draws an
 * analysis. This draws a shape: a basemap, pan and zoom, and the polygon tool.
 * Threading the other twenty through the board to reach the one that matters
 * would put every one of them somewhere they have nothing to do.
 *
 * The drawing itself is shared, through `useAreaDrawing`: the single-polygon
 * rule, when a shape is reported and the sync with the copy held outside all
 * live there, so this map and the work map cannot come to mean different things
 * by an area.
 *
 * The basemap credit is in the header beside the basemap buttons rather than in
 * a corner control over the ground being drawn on.
 */
import { useState } from "react"
import { ModalHeader, ModalShell } from "@/components/ui/ModalShell"
import { DrawMap } from "@/components/map/DrawMap"
import { SearchBar } from "@/components/SearchBar"
import { Credit } from "@/components/TitleBar"
import {
  BASEMAPS,
  MAPLIBRE_CREDIT,
  basemapByKind,
  type BasemapKind,
} from "@/lib/basemaps"
import { Check } from "lucide-react"
import { geometryAreaHectares, polygonOuterRing } from "@/lib/geometry"
import { cn } from "@/lib/utils"
import type { GeoJSONGeometry } from "@/lib/types"

export function BoardAreaModal({
  view,
  polygon,
  onPolygonDrawn,
  onClose,
}: {
  /** Where to open, so the drawing starts where the work is. */
  view: { lat: number; lon: number; zoom: number }
  polygon: GeoJSONGeometry | null
  onPolygonDrawn: (geom: GeoJSONGeometry | null) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<BasemapKind>("esri")
  const basemap = basemapByKind(kind)
  /*
    A nonce with the coordinates, because searching the same place twice has to
    fly there twice: a plain pair would be equal on the second search and the
    effect that moves the map would not run.
  */
  const [flyTo, setFlyTo] = useState<{
    lat: number
    lon: number
    key: number
  } | null>(null)
  /**
   * The shape being drawn, held here rather than committed as it is made.
   *
   * Every stroke used to go straight to the application: finishing a polygon
   * replaced the area with no way back, and the modal had no state of its own
   * to cancel. A draft makes drawing reversible -- redraw it, or leave and keep
   * what was there -- and gives the footer something to report before it is
   * taken.
   *
   * Fed back to DrawControl as its `customPolygon`, which is what puts the
   * shape on the map: it renders whatever it is given, guarded by a compare so
   * it does not fight a stroke in progress.
   */
  const [draft, setDraft] = useState<GeoJSONGeometry | null>(polygon)
  // What the footer reports, from the same helpers the rest of the application
  // measures an AOI with rather than a second arithmetic for one readout.
  const ring = draft ? polygonOuterRing(draft) : null
  const hectares = draft ? geometryAreaHectares(draft) : 0

  return (
    <ModalShell
      onDismiss={onClose}
      label="Draw an area"
      className="w-[min(72rem,92vw)]"
    >
      <ModalHeader
        eyebrow="Area"
        title="Draw the ground to analyse"
        subtitle="The polygon tool is at the bottom right. Each finished shape is kept in Areas as drawn, drawn 2, … — rename any of them later."
        onClose={onClose}
        actions={
          <div className="flex items-center gap-1">
            {BASEMAPS.map((b) => (
              <button
                key={b.kind}
                type="button"
                onClick={() => setKind(b.kind)}
                className={cn(
                  "rounded-sm px-2 py-1 text-meta transition-colors",
                  b.kind === kind
                    ? "bg-accent-dim text-foreground inset-ring-1 inset-ring-accent"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                )}
              >
                {b.name}
              </button>
            ))}
            <span
              className="hairline mx-1 h-4 w-px self-center border-l"
              aria-hidden
            />
            {/*
              The credit here rather than in Leaflet's own corner control, where
              it floated over the ground being drawn on. Beside the basemap
              buttons it sits with the choice it belongs to.

              Through Credit, which is a button calling BrowserOpenURL: this is
              a WKWebView, and a blank-target anchor is silently ignored -- on a
              link a licence requires to be reachable, silently nothing is the
              one outcome that cannot be shipped.
            */}
            <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
              <Credit part={MAPLIBRE_CREDIT} />
              {basemap.credit.map((c) => (
                <Credit key={c.label} part={c} />
              ))}
            </span>
          </div>
        }
      />

      <div className="p-4">
        {/*
          An explicit height. ModalShell sizes to its content and Leaflet sizes
          to its container, so a map asking for a share of the leftover space
          gets none and renders nothing -- the same zero-height collapse the
          compare modal opened with.
        */}
        <div className="relative h-[min(60vh,36rem)] overflow-hidden rounded-md">
          {/*
            The map screen's own search, positioned by itself at the top centre
            -- which is where it sits there, so the two surfaces put it in the
            same place. Drawing a boundary means finding the ground first, and
            panning to it from a continent away is not finding it.
          */}
          <SearchBar
            onSelectLocation={(lat, lon) =>
              setFlyTo({ lat, lon, key: Date.now() })
            }
          />
          <DrawMap
            className="size-full"
            view={view}
            basemap={basemap}
            polygon={draft}
            onPolygonDrawn={setDraft}
            flyTo={flyTo}
          />
        </div>

        {/*
          The commit, said once and named for what it does. Drawing is a gesture
          that can be got wrong on the last vertex, so it is separated from
          taking the result -- and until it is pressed the area the board is
          working on is untouched.
        */}
        <div className="mt-3 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-meta text-muted-foreground">
            {ring
              ? `${ring.length - 1} vertices · ${hectares.toFixed(1)} ha`
              : "Draw a polygon with the tool at the bottom right, or leave to keep the current area."}
          </p>
          {draft && (
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-sm px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Discard shape
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm px-2 py-1 text-meta text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!draft}
            onClick={() => {
              onPolygonDrawn(draft)
              onClose()
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-meta transition-colors",
              draft
                ? "bg-accent text-accent-foreground hover:opacity-90"
                : "cursor-not-allowed bg-surface-raised/40 text-muted-foreground"
            )}
          >
            <Check className="size-3.5" />
            Use this area
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
