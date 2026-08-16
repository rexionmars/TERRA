/**
 * A grown stand of plants, drawn as the triangles it is made of.
 *
 * WHAT THIS REPLACED. `canopyScene.ts` drew a leaf-area density on a voxel
 * grid: a box with a ray-march in it, which is the right picture of a field of
 * numbers and the wrong one of a crop. There was no leaf anywhere in that
 * representation to draw, because the architecture is integrated away when the
 * field is built -- so no amount of shading it produces a canopy a reader
 * recognises. That file and its GLSL march are gone; this draws the
 * architecture itself, grown by Helios and carried over as GLB.
 *
 * The two were never two qualities of one thing. A density answers "how much
 * light gets through", and that question still has an answer: the march, the
 * field and the extinction coefficient live in sidecar/canopy_field.py, in
 * numpy, where they are computed rather than drawn. A stand answers "what does
 * this crop look like", which is what someone means when they ask to see a
 * canopy, and it is the only one of the two that is a picture.
 *
 * GEOMETRY IS IN METRES AND Z IS UP, WHICH IS HELIOS'S FRAME, NOT THREE'S.
 * Helios grows in a right-handed frame with z as height; three's camera and
 * controls assume y. Rather than transform every vertex, the loaded scene is
 * rotated -90 degrees about x once, on the group. A reader inspecting a vertex
 * in the debugger sees the number Helios produced.
 *
 * LIGHTING IS NOT THE RADIATION MODEL. The plants are lit by a hemisphere and a
 * directional light so their shape reads. That is scene lighting for legibility
 * and nothing more -- the light that gets computed is computed by the canopy
 * engines in the sidecar, on the field, in numpy. Nothing here feeds a number
 * back into any calculation, which is why a plain lambert material is honest
 * here where it would not be in the march.
 */
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  MOUSE,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

/**
 * The sky the stand stands under, as the AOI's own record measured it.
 *
 * WHY THE BALANCE AND NOT THE BRIGHTNESS. A canopy under a clear sky is lit
 * mostly by a beam from one direction and throws hard shadows; under an
 * overcast one the same canopy is lit from the whole hemisphere and throws
 * almost none. That is not a mood, it is the term the march weights by, and it
 * moves between seasons on one site: the cell this was developed against runs
 * a diffuse share of 0.293 in June against 0.447 in February.
 *
 * So `diffuseShare` splits the two lights the scene already has and leaves the
 * total roughly where it was -- the picture changes character, not exposure.
 * `clearness` is global over clear-sky, 1 being cloudless, and drives the haze
 * instead of the intensity, because the two are correlated and scaling both by
 * cloud would count it twice.
 *
 * Both optional. Absent, the scene keeps the fixed studio lighting it had, and
 * that is the right default for the drawn stand, which stands under no sky at
 * all until an area is read.
 */
export interface StandSky {
  diffuseShare?: number
  clearness?: number
  /**
   * The fraction of ground under leaf, which decides what colour the light
   * bouncing back UP is.
   *
   * A hemisphere light's lower half is the ground's own reflection, and under a
   * closed canopy that ground is leaves rather than soil. The effect is real
   * multiple scattering and not a tint: it is why the underside of a canopy
   * reads green and not brown, and it grows with cover.
   */
  cover?: number
}

/*
  Rayleigh optical depth at the three primaries, at sea level.

  From tau ~ 0.0088 * lambda^-4.15 with lambda in micrometres, evaluated at 0.60,
  0.55 and 0.45 um. Blue is scattered out roughly three times as hard as red,
  which is the whole reason a low sun is orange -- and, at this project's own
  latitude, the reason the first and last hours of the track look nothing like
  the middle: air mass runs 1.0 at noon against 7.8 at seven degrees elevation.
*/
const RAYLEIGH_TAU: [number, number, number] = [0.0733, 0.1052, 0.242]

/*
  The two ends the sky colour runs between, and the two the ground bounce does.

  OVERCAST is warm-neutral and not grey: a real overcast sky is slightly warm,
  and a neutral one reads as a lighting bug rather than as weather. CANOPY_BOUNCE
  is a desaturated green, because light that has been through a leaf twice is
  much duller than the leaf.
*/
const CLEAR_SKY = new Color(0xbcd6ff)
const OVERCAST_SKY = new Color(0xd8d5cf)
const SOIL_BOUNCE = new Color(0x6b5a3e)
const CANOPY_BOUNCE = new Color(0x4a5c33)

/**
 * Relative air mass by Kasten and Young (1989).
 *
 * Not the schoolbook 1/sin(elevation), which diverges at the horizon and is
 * already 10 percent wrong by five degrees -- exactly the elevations where the
 * reddening this feeds is largest and most visible.
 */
export function airMass(elevationDeg: number): number {
  const e = Math.max(elevationDeg, -1)
  const denom =
    Math.sin((e * Math.PI) / 180) + 0.50572 * Math.pow(e + 6.07995, -1.6364)
  return denom > 0 ? 1 / denom : 40
}

/**
 * The beam's colour after that much atmosphere, normalised to white at zenith.
 *
 * Relative to air mass 1 rather than absolute, so a high sun renders neutral and
 * the whole effect is the CHANGE with elevation. An absolute Rayleigh
 * transmittance is slightly warm even overhead, which would leave every scene
 * faintly yellow and read as a colour-grading choice rather than as air.
 */
export function beamColour(elevationDeg: number): Color {
  const extra = Math.max(airMass(elevationDeg) - 1, 0)
  const rgb = RAYLEIGH_TAU.map((tau) => Math.exp(-tau * extra))
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6)
  return new Color(rgb[0] / peak, rgb[1] / peak, rgb[2] / peak)
}

/** The sun as the surface states it, in degrees, plus the sky it sits in. */
export interface StandView {
  elevation: number
  azimuth: number
  sky?: StandSky
}

export interface StandHandle {
  /** URL the asset server serves the last grown GLB from. */
  setMesh(url: string): Promise<void>
  setView(view: StandView): void
  frame(): void
  dispose(): void
}

/*
  Organ colours.

  Not physical and not the optical properties the radiation model uses -- those
  live in the sidecar and are per band. These exist so a reader can tell blade
  from stem at a glance, which is the whole job of this view.
*/
const ORGAN_COLOR: Record<string, number> = {
  leaf: 0x3f7d2a,
  petiole: 0x4a6b28,
  peduncle: 0x55702c,
  fruit: 0x9d5230,
  other: 0x5a4326,
}

function tokenColor(host: HTMLElement, name: string): Color {
  const raw = getComputedStyle(host).getPropertyValue(name).trim()
  const [r, g, b] = raw.split(/\s+/).map((v) => Number(v) / 255)
  return Number.isFinite(r) ? new Color(r, g, b) : new Color(0.1, 0.1, 0.1)
}

/**
 * A solar compass bearing, in the scene's own frame.
 *
 * TWO CONVENTIONS MEET HERE AND NEITHER IS WRONG, which is the same joint
 * `canopy_field._canopy_azimuth` documents on the sidecar side, and this
 * mirrors its arithmetic on purpose so the picture and the number are lit by
 * one sun. Solar azimuth is clockwise from north; the scene measures
 * anticlockwise from its own +x, because a stand has no north -- it has a
 * module with two axes.
 *
 * What joins them is the direction the rows run, which is agronomy and not
 * convention. `rowAzimuthDeg` is that bearing, so the sun's bearing relative to
 * the rows is the difference, and the sign flips because one convention turns
 * the other way.
 *
 * THE ASSUMPTION THIS CARRIES, stated because it is not verifiable from here:
 * that the loaded mesh has its rows along the scene's +x. The sidecar builds
 * the stand that way and the march reads it that way; a mesh built otherwise
 * would need its own offset, and the shadows would point plausibly and wrongly.
 */
export function sceneAzimuthFromCompass(
  compassDeg: number,
  rowAzimuthDeg = 0
): number {
  return 90 - (compassDeg - rowAzimuthDeg)
}

/** Sun direction from elevation and azimuth in degrees, in three's frame. */
function sunVector(elevationDeg: number, azimuthDeg: number): Vector3 {
  const e = (elevationDeg * Math.PI) / 180
  const a = (azimuthDeg * Math.PI) / 180
  // y is up here, so height is sin(elevation) and the compass is in x/z.
  return new Vector3(
    Math.cos(e) * Math.cos(a),
    Math.sin(e),
    Math.cos(e) * Math.sin(a)
  ).normalize()
}

export function createStandScene(
  host: HTMLDivElement,
  opts: { view: StandView }
): StandHandle {
  let disposed = false
  let raf = 0
  const disposables: Array<{ dispose(): void }> = []

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  // Not capped as hard as the march is: this is geometry-bound rather than
  // fill-rate bound, and leaf edges are exactly what a reader is looking at.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  /*
    SHADOWS, because without them this view cannot show the one thing the
    simulation exists to measure.

    The march's whole subject is that leaves shade other leaves: explicit
    geometry intercepts 35 to 61 percent less than the coarse shapes a crop
    model uses at the same leaf area, and the clumping index that gap implies
    runs 0.40 to 0.56. A scene with shadowMap disabled draws every leaf as
    though it stood alone, so the picture flatly contradicts the number printed
    beside it -- and reads as correct, which is worse than reading as broken.

    Soft rather than hard: the sky term is a third to a half of the light on a
    Brazilian day, and a hard-edged shadow under a canopy is a claim about a
    beam-only sky nobody has here.
  */
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(38, 1, 0.02, 500)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.maxPolarAngle = Math.PI * 0.495
  // Bindings are set below, beside the modifier that completes them.

  const sun = new DirectionalLight(0xffffff, 2.1)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // A stand is centimetres of detail across a couple of metres, so the default
  // bias leaves acne on every leaf. Negative normalBias pulls the comparison
  // off the surface along its own normal, which is what thin double-sided
  // geometry needs; the plain bias stays small because a large one detaches
  // the shadow from the stem that casts it.
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  const sky = new HemisphereLight(0xbcd6ff, 0x6b5a3e, 1.15)

  /*
    The intensities the two lights carry when the sky is not stated.

    Derived so that the studio default -- the fixed 2.1 and 1.15 this scene has
    always used -- is what a diffuse share of 0.33 produces, which is roughly
    the annual figure for the cell this was developed against. So an unread
    stand looks exactly as it did, and a read one moves away from that in the
    direction its own record says.
  */
  const BEAM_FULL = 2.1 / (1 - 0.33)
  const SKY_FULL = 1.15 / 0.33
  /*
    A floor of ambient so the undersides of leaves are not black. Deep shade in
    a real canopy is dim, not absent, and a black underside reads as a hole.

    LOWERED FROM 0.35 BECAUSE THE SHADOWS NOW DO THIS JOB. That figure was set
    when shadowMap was off and nothing else filled a shaded surface, so it had
    to carry the whole of "not black" on its own. With the sun casting, the same
    0.35 lands on top of shadows that are already lit by the hemisphere and
    flattens them: the first stand rendered with shadows came out visibly washed,
    with the cast shade on the ground barely readable.

    Not zero, and not close to it. The number this stands for is real -- a
    canopy floor under a closed crop still receives light, and the march itself
    measures a diffuse transmittance rather than assuming darkness.
  */
  const fill = new AmbientLight(0xffffff, 0.18)
  // The target too: a DirectionalLight aims at its target's world position,
  // and a target outside the graph never gets one, so the shadow camera would
  // look at the origin however the stand was framed.
  scene.add(sun, sky, fill, sun.target)

  let stand: Group | null = null
  const loader = new GLTFLoader()

  /*
    Ground and haze, as the studio's other viewport has them.

    A stand on nothing has no parallax: orbiting moves the plants against void
    and the sense of turning around something is lost. The grid is what the eye
    reads motion against, and the fog is what keeps it from ending at a hard
    rectangular edge -- boardScene.ts makes the same two moves for the same
    reason, and this follows its numbers rather than inventing new ones.

    The fog colour is the host's own background token, so the grid dissolves
    into the panel instead of into a colour that is nearly it. Near and far are
    set per frame, because fog is measured from the CAMERA: a fixed near plane
    is correct at exactly one zoom and eats the stand at every other.
  */
  const groundColour = tokenColor(host, "--p-line")
  // `--p-ink` is the studio viewport's own background, which is what
  // BoardSurface paints behind the board scene. A token this file invented
  // ("--p-surface-sunken") does not exist, and tokenColor answers a missing
  // one with near-black -- close enough to the panel to look deliberate and
  // wrong enough that the haze would never quite dissolve into it.
  const hazeColour = tokenColor(host, "--p-ink")
  scene.fog = new Fog(hazeColour.getHex(), 1, 10)

  let grid: GridHelper | null = null
  let gridSpan = 0
  // The radius of the stand's bounding sphere, kept from the last framing so
  // the fog can start just past it.
  let fitRadius = 0
  // Global over clear-sky for the read area, or null for the studio default.
  let skyClearness: number | null = null
  // The surface the stand's shadow falls on. The grid is lines and catches
  // nothing, so without this the plants shade each other and stand on nothing,
  // which reads as a stand floating over its own floor.
  let catcher: Mesh | null = null

  const disposeGrid = () => {
    if (!grid) return
    scene.remove(grid)
    grid.geometry.dispose()
    const m = grid.material
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m?.dispose()
    grid = null
  }

  const disposeCatcher = () => {
    if (!catcher) return
    scene.remove(catcher)
    catcher.geometry.dispose()
    const m = catcher.material
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m?.dispose()
    catcher = null
  }

  const addGround = (box: Box3) => {
    disposeGrid()
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())
    // Out to four times the stand's own footprint, in twenty cells: far enough
    // that the edge is in the haze, fine enough to read motion against.
    const span = Math.max(Math.max(size.x, size.z) * 4, 1)
    const g = new GridHelper(span, 20, groundColour, groundColour)
    const material = g.material as LineBasicMaterial
    material.transparent = true
    material.opacity = 0.14
    // Never writes depth, so it cannot fight the plants for a surface.
    material.depthWrite = false
    // At the base of the stems rather than at y=0: Helios grows from a ground
    // plane, but a stand's lowest vertex is a hair under it and a grid at
    // exactly zero z-fights with it.
    g.position.set(centre.x, box.min.y - 0.001, centre.z)
    scene.add(g)
    grid = g
    gridSpan = span

    // ShadowMaterial draws nothing except where it is shadowed, so the floor
    // stays the grid over the panel's own background and gains only the shade.
    disposeCatcher()
    const plane = new Mesh(
      new PlaneGeometry(span, span),
      // Raised alongside the ambient drop: at 0.32 over a 0.35 fill the cast
      // shade was barely separable from the grid it fell on.
      new ShadowMaterial({ opacity: 0.45 })
    )
    plane.rotation.x = -Math.PI / 2
    // Just under the grid, for the reason the grid sits just under the stems:
    // two coplanar surfaces z-fight, and the artefact moves with the camera.
    plane.position.set(centre.x, box.min.y - 0.002, centre.z)
    plane.receiveShadow = true
    scene.add(plane)
    catcher = plane

    /*
      The shadow camera, fitted to the stand.

      A DirectionalLight shadows through an orthographic camera whose default
      frustum is 10 units across and 500 deep. A stand is a metre or two, so the
      default spends its whole 2048 map on mostly empty space and the leaves
      come out as steps. Fitted to the bounding sphere the same map lands on the
      plants, which is where the shading being drawn actually happens.

      Padded by half, so a sun near the horizon -- which is when the shadows are
      longest and most worth seeing -- does not push them out of the frustum.
    */
    const radius = box.getBoundingSphere(new Sphere()).radius || 1
    const half = radius * 1.5
    const cam = sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 0.1
    cam.far = 200
    cam.updateProjectionMatrix()
  }

  const updateFog = () => {
    const fog = scene.fog as Fog | null
    if (!fog || !fitRadius) return
    // Starts past the far side of the stand and ends inside the grid, at
    // whatever distance the reader has orbited to.
    const d = camera.position.distanceTo(controls.target)
    fog.near = d + fitRadius * 1.2
    /*
      Cloud thickens the haze, and this is where clearness is spent rather than
      on the light intensities.

      Cloud and diffuse share are the same phenomenon measured twice -- an
      overcast hour is both dimmer in the beam and more diffuse -- so scaling
      the lights by one and the balance by the other would count it twice and
      darken an overcast scene that is, in life, evenly bright. Depth of haze is
      the free axis, and it is the one a reader actually reads as weather.

      Clamped rather than trusted: a clearness above 1 is possible on an hour
      with cloud brightening, and it would push the near plane past the far one.
    */
    const k = skyClearness == null ? 1 : Math.min(Math.max(skyClearness, 0.2), 1)
    fog.far = d + gridSpan * 0.5 * k
  }

  /*
    Drawing is SCHEDULED, never done inline. This is the bug that cost four
    attempts to find, so it is worth stating exactly.

    `controls.update()` dispatches a `change` event whenever it moves the
    camera, and with damping enabled it moves the camera on almost every call
    while a gesture settles. `render` is registered as the `change` listener.
    Calling `controls.update()` directly inside `render` therefore reads:

        render -> update() -> "change" -> render -> update() -> "change" -> ...

    with nothing to unwind it -- which surfaced as "Maximum call stack size
    exceeded" the moment a stand was framed, an error naming no file and no
    layer. It reproduced nowhere outside the webview because every check made
    here exercised the loader and the geometry, never the controls.

    Guarding on `raf` breaks the cycle without losing damping: a `change` that
    arrives while a frame is already booked does nothing, and the `update` that
    would recurse runs one stack frame deep inside the callback instead. When
    damping settles, update() stops reporting movement, nothing reschedules,
    and the loop ends on its own.
  */
  const render = () => {
    if (disposed || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (disposed) return
      controls.update()
      // After update(), so the distance it reads is the one being drawn.
      updateFog()
      renderer.render(scene, camera)
    })
  }

  // Whether the reader has moved the camera since the stand was framed. A
  // resize should re-fit a view nobody has touched -- the first one arrives
  // after mount, when the aspect the fit used was still 1:1 -- but must not
  // yank a camera the reader positioned themselves. Declared above `frame`
  // rather than beside `resize` because `frame` clears it, and a `let` read
  // before its declaration is a temporal-dead-zone throw waiting for someone
  // to reorder these two.
  let userMoved = false

  /*
    Put the whole stand on screen.

    BOTH AXES, NOT JUST THE VERTICAL ONE. A perspective camera states its fov
    vertically, so fitting only that overflows sideways on any viewport wider
    than it is tall -- and this area is a wide strip under a header, where a
    stand 3.3 m deep and 1.4 m tall ran off both edges. The horizontal half-
    angle is atan(tan(fov/2) * aspect), so the distance each axis needs is its
    own half-span over its own tangent, and the camera has to take the larger.

    AFTER LAYOUT, NOT BEFORE. `camera.aspect` is only right once the host has
    been measured, so a frame computed during mount uses the initial 1:1 and is
    wrong by however wide the area really is. `resize` re-frames for that
    reason, and this is safe to call more than once.
  */
  const frame = () => {
    if (!stand) return
    const box = new Box3().setFromObject(stand)
    if (box.isEmpty()) return
    const size = box.getSize(new Vector3())
    const centre = box.getCenter(new Vector3())

    // Fitted to the bounding SPHERE, not to the box's sides.
    //
    // Sides are the obvious thing to fit and they do not work from an oblique
    // camera: the stand is seen from a corner and above, so what projects
    // widest is a diagonal, and which diagonal depends on the angle. Fitting
    // width and height separately let corners past the frustum at wide aspect
    // ratios -- checked, and it failed at 4.16:1, which is what this area is.
    // A sphere has no orientation, so its radius bounds the silhouette from
    // every direction at once and the fit holds however the reader orbits.
    const radius = size.length() / 2
    // Kept for the fog, which needs to know how far past the target the stand
    // reaches before it may start hazing.
    fitRadius = radius
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
    const dist = Math.max(
      radius / Math.sin(vFov / 2),
      radius / Math.sin(hFov / 2)
    ) * 1.06

    // A shallow rise: a canopy read from near ground level shows the rows
    // closing over, which is the thing worth seeing, where a top-down view
    // flattens it into a texture.
    const dir = new Vector3(0.62, 0.42, 0.66).normalize()
    camera.position.copy(centre).addScaledVector(dir, dist)
    // Framing is the deliberate act of putting the camera somewhere, so it
    // hands control back: a later resize may re-fit until the reader moves.
    userMoved = false
    controls.target.copy(centre)
    camera.near = Math.max(dist / 1000, 0.01)
    camera.far = dist * 12
    camera.updateProjectionMatrix()
    controls.update()
    render()
  }

  const resize = () => {
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    /*
      updateStyle left at its default, and boardScene.ts says why in a comment
      this file should have been read against before it was written:

        "Passing false writes the drawing buffer in device pixels and leaves
         the canvas with NO css size, so on a 2x display the element lays out
         at twice the intended width and height, anchored top-left [...] The
         raster looked pushed into the corner and hugely magnified because it
         was."

      That is this area's first reported symptom, exactly: the stand appeared
      enormous and shoved into a corner. It was diagnosed here as a framing
      problem and answered with bounding-sphere camera maths, which fitted a
      camera to a viewport that was never the size the canvas claimed. The
      maths is right and was not the cause.

      A canvas carries no intrinsic CSS size, so with no style written it lays
      out at its attribute size in CSS pixels -- 2w x 2h inside a w x h host on
      a Retina display. It then paints over the parameter bar below it, which
      is why the controls stop answering and the area reads as frozen. At
      devicePixelRatio 1 none of this happens, which is why every check made
      outside this machine passed.
    */
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    if (userMoved) render()
    else frame()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  // `start` fires on a drag or a wheel, never on the programmatic update()
  // calls frame() makes, so this marks intent rather than movement.
  const onUserInput = () => {
    userMoved = true
  }
  controls.addEventListener("start", onUserInput)
  controls.addEventListener("change", render)

  /*
    Blender's bindings, and the modifier that goes with them.

    LEFT is deliberately null across this application -- boardScene.ts and the
    canopy scene before this one both navigate on the middle button -- and
    Ctrl/Cmd turns that button into a dolly. Copying the bindings without the
    modifier, which is what this file did at first, leaves a reader with the
    convention half-applied: the gesture the rest of the studio teaches them
    does nothing here.

    Blur resets, because a modifier held while the window loses focus never
    delivers its keyup and the button would stay a dolly.
  */
  const NAV_DEFAULT = { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null }
  const NAV_ZOOM = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: null }
  controls.mouseButtons = { ...NAV_DEFAULT }
  const onNavModifier = (e: KeyboardEvent) => {
    controls.mouseButtons = { ...(e.ctrlKey || e.metaKey ? NAV_ZOOM : NAV_DEFAULT) }
  }
  const onNavBlur = () => {
    controls.mouseButtons = { ...NAV_DEFAULT }
  }
  window.addEventListener("keydown", onNavModifier)
  window.addEventListener("keyup", onNavModifier)
  window.addEventListener("blur", onNavBlur)

  /*
    WEBGL CONTEXT LOSS, WHICH READS AS THE AREA FREEZING.

    A lost context leaves the canvas showing its last frame and accepting no
    further draws -- so the stand appears, and then the area is stone. This
    application makes it likelier than usual: the board holds one context and
    this holds a second, and a webview is not generous with them.

    `preventDefault` is the load-bearing line. Without it the browser never
    fires `webglcontextrestored` at all, so the canvas is dead for the lifetime
    of the area rather than for a moment. The scene before this one had it; this
    file was written without it, which is a regression rather than an omission.

    Clearing `raf` matters just as much here. A frame booked before the context
    went away never runs, so nothing resets the guard, and every later render
    returns early on a raf that will never fire -- frozen even after the context
    comes back.
  */
  const onContextLost = (e: Event) => {
    e.preventDefault()
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
  const onContextRestored = () => {
    // resize() rebuilds the drawing buffer and re-frames or redraws, which is
    // everything this scene needs to be whole again: the geometry and the
    // materials are still in memory, only the GPU-side objects were lost.
    resize()
  }
  renderer.domElement.addEventListener("webglcontextlost", onContextLost)
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored)

  resize()

  const applyView = (view: StandView) => {
    const d = sunVector(view.elevation, view.azimuth)
    // Distance is arbitrary for a directional light; only the direction is
    // read. Kept well outside the stand so the helper, if ever added, is not
    // inside the plants.
    sun.position.copy(d).multiplyScalar(50)
    // The shadow camera looks from the light at the stand, so its target has to
    // travel with the stand rather than sit at the origin.
    sun.target.position.copy(controls.target)
    sun.target.updateMatrixWorld()

    const share = view.sky?.diffuseShare
    if (share != null && Number.isFinite(share)) {
      const d0 = Math.min(Math.max(share, 0), 1)
      sun.intensity = BEAM_FULL * (1 - d0)
      sky.intensity = SKY_FULL * d0
    } else {
      sun.intensity = BEAM_FULL * (1 - 0.33)
      sky.intensity = SKY_FULL * 0.33
    }

    // The beam reddens with the air it crossed. Applied always, since air mass
    // is a function of the elevation the caller already gave and needs no
    // record behind it -- a hand-placed sun low in the sky is low in the sky.
    sun.color.copy(beamColour(view.elevation))

    /*
      Cloud whitens the sky and desaturates it.

      A clear sky is the blue this scene has always used; an overcast one is a
      grey-white sheet, and the hemisphere light's upper colour is the only
      place that difference can live. Interpolated on clearness rather than
      switched, because a record runs the whole way between: on this cell an
      afternoon falls from 0.89 to 0.49 within one day.

      OVERCAST_SKY is warm-neutral rather than pure grey: a real overcast sky is
      slightly warm, and a neutral one reads as a lighting bug.
    */
    const clear = view.sky?.clearness
    if (clear != null && Number.isFinite(clear)) {
      const k = Math.min(Math.max(clear, 0), 1)
      sky.color.copy(OVERCAST_SKY).lerp(CLEAR_SKY, k)
    } else {
      sky.color.copy(CLEAR_SKY)
    }

    /*
      What bounces back up is leaves once the canopy closes.

      The hemisphere light's lower half stands for the ground's own reflection,
      and it has been soil brown regardless of what was standing on the soil.
      Under a closed canopy the upward light is green -- real multiple
      scattering, and the reason a canopy's underside reads green rather than
      brown. Cover is what says how much of the floor is still soil, and the
      sidecar now measures it: 0.91 on the reading this was developed against.
    */
    const cover = view.sky?.cover
    if (cover != null && Number.isFinite(cover)) {
      const k = Math.min(Math.max(cover, 0), 1)
      sky.groundColor.copy(SOIL_BOUNCE).lerp(CANOPY_BOUNCE, k)
    } else {
      sky.groundColor.copy(SOIL_BOUNCE)
    }

    skyClearness = view.sky?.clearness ?? null
    updateFog()
  }
  applyView(opts.view)

  const disposeStand = () => {
    if (!stand) return
    scene.remove(stand)
    stand.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        const m = o.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m?.dispose()
      }
    })
    stand = null
  }

  scene.background = null

  return {
    async setMesh(url) {
      if (disposed) return

      /*
        Fetched, never carried.

        The mesh used to come back from the bound method as base64 and be
        decoded here. That is what threw "Maximum call stack size exceeded",
        and not where it looked: the throw is inside the Wails bridge, which
        marshals every bound result to JSON and hands the webview one string of
        it, so it happens before any of this file runs. Shrinking the payload
        moved the threshold without removing it, and every check made outside
        the webview passed, because node's stack is not WKWebView's.

        Now the Go side holds the bytes and this fetches them from the asset
        server. The response is an ArrayBuffer the loader takes directly: no
        base64 anywhere on the path, and nothing that scales with the mesh
        crossing the bridge.
      */
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(
          `the grown stand could not be fetched (${response.status}). It is held ` +
            `only until the next grow, so this can mean it was replaced mid-request.`
        )
      }
      const buffer = await response.arrayBuffer()
      if (disposed) return
      const gltf = await loader.parseAsync(buffer, "")
      if (disposed) return

      disposeStand()
      const group = gltf.scene
      // Helios grows z-up; three is y-up. One rotation on the group rather than
      // a transform per vertex, so the numbers in the buffers stay Helios's.
      group.rotation.x = -Math.PI / 2

      group.traverse((o) => {
        if (!(o instanceof Mesh)) return
        // Both, and not only cast: the subject of this whole view is leaves
        // shading OTHER leaves, so a plant that casts without receiving
        // draws a canopy whose interior is as bright as its top.
        o.castShadow = true
        o.receiveShadow = true
        // The organ name is on the mesh: the bridge writes one node per organ
        // and names it, and three carries that name onto the object it builds.
        // Falling back to `other` rather than skipping, so an organ this file
        // has no colour for is still drawn.
        const colour = ORGAN_COLOR[o.name] ?? ORGAN_COLOR.other
        // The loader builds a PBR material per primitive from the glTF, and
        // replacing it drops the only reference to it. Disposed rather than
        // dropped: this runs again on every regrow, and a material abandoned
        // with GPU-side state behind it is a leak that ends in a lost context
        // -- which is the failure that looks like the whole area freezing.
        const built = o.material
        if (Array.isArray(built)) built.forEach((m) => m.dispose())
        else built?.dispose()
        /*
          DoubleSide because a leaf is a surface with no inside: Helios emits
          one triangle per blade face, and backface culling would drop every
          leaf the camera happens to see from below.

          flatShading is NOT a look chosen here -- it is the loader's own
          compensation, and replacing the material without it silently breaks
          the lighting. `write_glb` writes POSITION and indices and no NORMAL,
          so GLTFLoader sets flatShading on the material it builds
          (GLTFLoader.js:3446 `useFlatShading = geometry.attributes.normal ===
          undefined`, applied at :3505), which makes three derive the normal per
          fragment instead of reading an attribute that is not there. A fresh
          material defaults it to false, the shader then reads a missing normal
          attribute as (0,0,0), and every directional and hemisphere term
          collapses -- leaving only AmbientLight, which is why the stand came
          out a flat, uniform green with no shape in it.
        */
        o.material = new MeshLambertMaterial({
          color: colour,
          side: DoubleSide,
          flatShading: true,
        })
      })

      stand = group
      scene.add(group)
      // Sized to the stand, so a wider sowing gets a wider ground rather than
      // the same square with the plants spilling off it. Rebuilt per mesh
      // because rows and spacing are the reader's to change.
      group.updateMatrixWorld(true)
      addGround(new Box3().setFromObject(group))
      frame()
    },

    setView(view) {
      if (disposed) return
      applyView(view)
      render()
    },

    frame,

    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      // Removed explicitly rather than left to controls.dispose(): both
      // closures hold the renderer and the scene, and a listener that outlives
      // this handle keeps the whole WebGL context alive behind it.
      controls.removeEventListener("start", onUserInput)
      controls.removeEventListener("change", render)
      controls.dispose()
      // The window-level ones are the dangerous pair: they outlive the area
      // that created them, so an unmounted scene would keep rewriting the
      // bindings of whatever OrbitControls it closed over.
      window.removeEventListener("keydown", onNavModifier)
      window.removeEventListener("keyup", onNavModifier)
      window.removeEventListener("blur", onNavBlur)
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost)
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored)
      disposeGrid()
      disposeStand()
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      // Not optional, and the scene this replaced said so in as many words.
      // `dispose()` releases three's own objects but leaves the WebGL context
      // itself alive; the webview caps how many may exist, and this one is
      // created and destroyed every time its area mounts. Omitted, the budget
      // is spent within a dozen workspace switches and the next context is
      // refused or an existing one is taken away -- which is not reported as
      // an error anywhere, it just leaves an area that draws once and then
      // sits frozen.
      renderer.forceContextLoss()
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement)
      }
    },
  }
}

// Kept for the surface that reads a background token off the host.
export { tokenColor }
