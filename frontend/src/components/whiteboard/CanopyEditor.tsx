/**
 * The four readings of one canopy, and nothing else.
 *
 * WHAT IT IS FOR. To show the crop. A reader asking to see a canopy means the
 * plants -- stems, blades, the way rows close over as they grow -- and the
 * Stand panel draws the triangles Helios grew. The other three read the same
 * canopy from an observed index series: its season, the light it makes of the
 * sun its cell received, and whether the plant model applies to the sowing at
 * all.
 *
 * WHAT THIS EDITOR NO LONGER HOLDS, AND WHY. The species, the age, the sowing,
 * the sun, which analysed area is read and the two commits. Those are the
 * simulation workflow's, not a panel's: `canopyWorkflow` holds them once for
 * the board and `CanopyRunBar` sets them, exactly as the run band sets an area,
 * a period and a model that the viewport, the outliner and the tables then
 * answer from without carrying a second copy of the controls.
 *
 * They were here, in every canopy area, and two areas asking two questions
 * about ONE stand therefore offered two sets of controls over it with nothing
 * saying they were the same stand. A panel shows a reading; the thing being
 * read belongs to the workflow.
 *
 * WHAT THIS REPLACED. The earlier surface drew a leaf-area density on a voxel
 * grid: a translucent box with a ray-march in it. That is a correct picture of
 * a field of numbers and an unrecognisable one of a crop, and no amount of
 * shading fixes it, because the density has no leaf in it to draw. The march,
 * the field and the extinction coefficient still exist in
 * sidecar/canopy_field.py, where they answer the question they are good at: how
 * much light gets through. They are not a picture.
 */
import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"

import { CanopyAOIPanes } from "./CanopyAOIEditor"
import { useCanopyWorkflow } from "./canopyWorkflow"
import { createStandScene, type StandHandle } from "./standScene"

/**
 * Which of the four readings this area is showing.
 *
 * `stand` is the one that draws, and the only one that spends a WebGL context.
 * The other three are the same canopy read from an AOI's own season, and they
 * live here rather than in an editor of their own because the separation read
 * as arbitrary to anyone using it: both are a canopy, and they share the
 * species and the sowing the workflow holds.
 */
export type CanopyMode = "stand" | "season" | "light" | "ages"

/*
  WHICH READING IS CHOSEN IN THE TYPE MENU, and nowhere else.

  The four are listed under Canopy in the area's own type menu, beside the
  outliner's three and the domain shift's two, and choosing one there retypes
  the area and sets the pane in one gesture. A strip of tabs inside the body
  would be a second control for a decision that already has one -- the same
  duplication that took the parameters out of these panels -- and it would cost
  a row of the area's height to restate what the header already says.
*/
export function CanopyEditor({ mode = "stand" }: { mode?: CanopyMode } = {}) {
  const w = useCanopyWorkflow()

  /*
    The band's absence is the one thing a panel says about the arrangement
    rather than about a canopy: the parameters live there, and an arrangement
    without one -- a workspace saved before the canopy had a band, an area the
    reader closed -- has no way to set them. Said only where there is nothing to
    draw, since a stand already grown should not be replaced by an instruction.
  */
  if (!w) return <Missing />
  if (mode !== "stand") {
    return (
      <CanopyAOIPanes
        mode={mode}
        data={w.aoi}
        busy={w.reading}
        error={w.readError}
        source={w.source}
        stale={w.aoiStale}
        hasBand={w.hasBand}
      />
    )
  }
  if (!w.hasBand && !w.mesh && !w.growing) return <Missing />
  return <StandPanel />
}

function Missing() {
  return (
    <Empty>
      The stand and the area being read are set in a Canopy run band, and this
      arrangement has none. Retype an area to it from its header, or open the
      Simulation workspace, which carries one along its foot.
    </Empty>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex h-full items-center justify-center p-4 text-center text-[11px]"
      style={{ color: "var(--p-text-muted)" }}
    >
      <span className="max-w-[26rem] leading-relaxed">{children}</span>
    </div>
  )
}

/**
 * The grown stand, drawn.
 *
 * A component of its own so its scene's hooks are not run by the three panels
 * that have no scene: a Season panel holds no WebGL context, which is what
 * makes four panels affordable in a budget of two.
 */
function StandPanel() {
  const w = useCanopyWorkflow()
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StandHandle | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [sceneError, setSceneError] = useState<string | null>(null)
  // What this panel's own scene is carrying, which is not what the workflow
  // grew until it has been loaded: two Stand panels load the same URL
  // independently, and each takes its own moment over it.
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let scene: StandHandle | null = null
    try {
      // The workflow's sun reaches it on this same commit, from the effect
      // below; these two are the constructor's floor, never a painted frame.
      scene = createStandScene(host, { view: { elevation: 50, azimuth: 35 } })
    } catch {
      setSceneError(
        "This area could not open a WebGL context. Close another 3D area and reopen it."
      )
      return
    }
    sceneRef.current = scene
    loadedRef.current = null
    return () => {
      sceneRef.current = null
      loadedRef.current = null
      scene?.dispose()
    }
  }, [])

  const elevation = w?.sun.elevation
  const azimuth = w?.sun.azimuth
  /*
    The sky the read area actually stood under, when one has been read.

    Not decoration and not a mood: the diffuse share is a term the march weights
    by, and it moves 0.293 in June against 0.447 in February on one cell. Under
    the first the stand throws hard shadows from a low northern sun; under the
    second it is lit from most of the hemisphere and throws almost none. Both
    pictures are of the same plants, and only one of them describes the number
    printed beside it.

    Undefined until an area is read, and the scene keeps its studio lighting for
    exactly that case -- a drawn stand stands under no sky at all.
  */
  const diffuseShare = w?.aoi?.sun?.diffuse_share
  const clearness = w?.aoi?.sun?.clearness
  // What the simulated canopy covered, which decides how green the light
  // bouncing back up off the floor is.
  const cover = w?.aoi?.light?.cover
  useEffect(() => {
    if (elevation == null || azimuth == null) return
    sceneRef.current?.setView({
      elevation,
      azimuth,
      sky: { diffuseShare, clearness, cover },
    })
  }, [elevation, azimuth, diffuseShare, clearness, cover])

  /*
    The mesh the workflow last grew, loaded into this panel's scene.

    Fetching and drawing is its own step and its own failure: the bridge
    marshalling a reply, the fetch decoding a payload and the loader walking a
    scene can each throw "Maximum call stack size exceeded", and the message
    carries no stack that points anywhere useful. Naming the step turns the next
    report into a location instead of a symptom.
  */
  const url = w?.mesh?.url ?? null
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !url || loadedRef.current === url) return
    let cancelled = false
    setDrawing(true)
    void scene
      .setMesh(url)
      .then(() => {
        if (cancelled) return
        loadedRef.current = url
        setSceneError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const detail = e instanceof Error ? e.message : String(e)
        setSceneError(`while fetching and drawing the stand: ${detail}`)
      })
      .finally(() => {
        if (!cancelled) setDrawing(false)
      })
    return () => {
      cancelled = true
    }
  }, [url])

  /*
    Grown once, so an area opens with a canopy in it rather than an empty frame
    and an instruction. The workflow collapses concurrent calls, so two Stand
    panels mounting together still spend one sidecar process on one stand.
  */
  const grow = w?.grow
  const hasMesh = !!w?.mesh
  const growing = !!w?.growing
  const growError = w?.growError ?? null
  useEffect(() => {
    if (hasMesh || growing || growError || !grow) return
    void grow()
  }, [hasMesh, growing, growError, grow])

  const error = sceneError ?? growError
  const busyLabel = growing
    ? `growing ${w?.stand.species ?? "the stand"}`
    : drawing
      ? "drawing the stand"
      : null

  return (
    <div
      ref={hostRef}
      className="relative h-full min-h-0 w-full"
      style={{ background: "rgb(var(--p-ink))" }}
    >
      {busyLabel ? (
        <div
          className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded px-2 py-1 text-[11px]"
          style={{
            background: "var(--p-surface-raised)",
            color: "var(--p-text-muted)",
          }}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {busyLabel}
        </div>
      ) : null}
      {error ? (
        <div
          className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded px-2 py-1.5 text-[11px]"
          style={{ background: "var(--p-surface-raised)", color: "var(--p-text)" }}
        >
          <AlertTriangle
            className="mt-px h-3 w-3 shrink-0"
            style={{ color: "var(--p-warning)" }}
          />
          <span className="leading-snug">{error}</span>
        </div>
      ) : null}
    </div>
  )
}
