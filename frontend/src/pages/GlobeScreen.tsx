/**
 * Where the work is, on the planet it is about.
 *
 * A DESTINATION, NOT A MODE OF THE MAP. The two answer different questions:
 * the map is about one area in detail and this is about where every area IS,
 * and a toggle between them would have made them alternatives -- a reader who
 * wanted the second would have had to give up the first.
 *
 * IT NO LONGER HANDS OVER, AND THAT IS THE CHANGE. This screen was built on a
 * sphere drawn by hand from a single stitched world image, so it had a floor:
 * zooming past a country bought nothing, and pressing an area LEFT for the map
 * because the surface had nothing more to show. That floor was a property of
 * the implementation, not of the idea, and it is gone -- the globe reads the
 * same XYZ tiles the map does and sharpens all the way into them.
 *
 * So what remains between the two screens is tools, not detail. Drawing an
 * area, the overlays, the comparison, a run: those are the map's, and both
 * ways off this screen lead there for the tools rather than for the pixels.
 */
import { useMemo } from "react"

import { GlobeSurface } from "@/components/globe/GlobeSurface"
import { toGlobeArea, type GlobeArea } from "@/components/globe/globeArea"
import { Credit } from "@/components/TitleBar"
import { basemapByKind } from "@/lib/basemaps"
import type { SavedAoi } from "@/lib/savedAois"
import type { Area, Project } from "@/lib/types"
import { resolveProjectGeometry } from "@/lib/geometry"

export function GlobeScreen({
  savedAois,
  projects,
  areas,
  onOpenArea,
  onOpenPlace,
}: {
  savedAois: readonly SavedAoi[]
  projects: readonly Project[]
  /**
   * The embedded example areas, which a project may name instead of carrying.
   *
   * Mutable rather than readonly, because resolveProjectGeometry takes it that
   * way. Widening that signature is the better fix and is not this change's.
   */
  areas: Area[]
  /**
   * An area was pressed: take the map there and make it the active one.
   *
   * The screen does not navigate itself. What "open this area" means -- which
   * of activeExample, customPolygon and the label to set, and whether to fly --
   * is App's to decide, and it already decides it for the areas list.
   */
  onOpenArea: (kind: "aoi" | "project", id: string) => void
  /**
   * The reader asked for the map at a place rather than at an area.
   *
   * The second way off this screen. It is no longer about running out of
   * imagery -- the globe has the same tiles the map does -- but about the
   * tools, which are all on the map: this carries the place the reader
   * navigated to so they do not have to find it twice.
   */
  onOpenPlace: (at: { lon: number; lat: number }) => void
}) {
  /*
    Drawn from the catalog and the projects, and deliberately not from runs.

    A run is over an area that is already here, so drawing both would put two
    outlines on one field and the second would say nothing the first did not.
    The catalog is what a reader draws and names; the projects are what they
    organise. Runs are read on the map.

    A project with no geometry of its own is skipped rather than drawn at a
    guess: geometry.ts records that a hub-created project having none is the
    normal case, not a fault, and a marker at 0,0 would be a lie about where
    the work is.
  */
  const globeAreas = useMemo<GlobeArea[]>(() => {
    const out: GlobeArea[] = []
    for (const a of savedAois) {
      const area = toGlobeArea(`aoi:${a.id}`, a.name, a.geometry)
      if (area) out.push(area)
    }
    for (const p of projects) {
      const area = toGlobeArea(
        `project:${p.id}`,
        p.name,
        resolveProjectGeometry(p, areas)
      )
      if (area) out.push(area)
    }
    return out
  }, [savedAois, projects, areas])

  const imagery = basemapByKind("eox")

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <GlobeSurface
        className="flex-1"
        areas={globeAreas}
        onOpenMapHere={onOpenPlace}
        onPickArea={(id) => {
          const cut = id.indexOf(":")
          const kind = id.slice(0, cut)
          onOpenArea(kind === "project" ? "project" : "aoi", id.slice(cut + 1))
        }}
      />
      {/*
        The foot says what is here and credits what drew it.

        THE CREDIT IS RENDERED HERE RATHER THAN BY THE LIBRARY. MapLibre has an
        attribution control and it is switched off in the surface, because it
        renders anchors and this is a WKWebView with no createWebViewWith
        delegate -- an anchor opens nothing. The licence asks for a REACHABLE
        credit, so it goes through the same BrowserOpenURL path the title bar
        uses for the map's.
      */}
      <p className="shrink-0 px-3 py-2 text-meta text-muted-foreground">
        {globeAreas.length
          ? `${globeAreas.length} area${globeAreas.length === 1 ? "" : "s"} drawn. Press one to open it on the map.`
          : "Nothing drawn yet. Areas and projects appear here once they have a shape."}
        {" "}
        <span className="opacity-70">
          {imagery.credit.map((part, i) => (
            <span key={part.label}>
              {i > 0 && ", "}
              <Credit part={part} />
            </span>
          ))}
          {", MapLibre"}
        </span>
      </p>
    </div>
  )
}
