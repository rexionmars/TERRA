/**
 * The whiteboard's WebGL scene.
 *
 * ONE OF TWO MODULES IN THIS APPLICATION THAT IMPORT `three`; the other is
 * canopyScene.ts. It said "the only one" until the canopy editor landed, and
 * the two are separate on purpose rather than by omission: this file is a stack
 * of textured planes with a picker, a gizmo and a fog, and that one is a box
 * with a ray-march in it. What the rule protects is unchanged and still holds
 * -- both stay behind the lazy import of BoardSurface, so the button that opens
 * the board stays out of the same module graph and opening the map screen does
 * not fetch half a megabyte to draw a 34 px button.
 *
 * The GL surface is therefore two files to audit, and they spend two contexts
 * against the webview's cap. This one is never released on a workspace switch
 * (see the host div in BoardSurface); the canopy's is created and destroyed
 * with its area, which is why the cheaper scene is the transient one.
 *
 * Imperative rather than a React renderer. The scene graph is a handful of
 * planes and a grid, and the interaction that matters -- raycast, drag,
 * arbitrating the drag against the orbit control -- is pointer maths that a
 * reconciler does not simplify. @react-three/fiber would add roughly 200 kB
 * over three for a scene this size.
 *
 * Probe stage: one textured plane and an orbit camera, to prove context
 * creation, shader compilation in this WKWebView, a data-URI texture, and
 * non-power-of-two rasters (the real ones are 192x139, 60x118, 438x740). The
 * scene grows from here rather than being rewritten.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Clock,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MOUSE,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
/*
  Numbers and pure functions -- no React, no three -- which is what lets this
  file consult the partition without the chrome it must not pull.
*/
import type { CardGroup, CardPlane } from "@/lib/boardLayout"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper.js"

/**
 * A design token's channels as a colour three will actually parse.
 *
 * The tokens are stored space-separated -- `--p-ink: 23 23 23` -- because the
 * stylesheet composes them as `rgb(var(--p-ink) / 0.82)`, which is CSS Color 4
 * syntax. three's Color.setStyle predates that: its regular expression accepts
 * `rgb(r,g,b)` with commas only, and on anything else it warns to the console
 * and LEAVES THE COLOUR WHITE. That failure is silent on screen, and white is
 * the one background this surface must not have.
 *
 * Measured against three 0.185: `rgb(23 23 23)` parses to ffffff,
 * `rgb(23,23,23)` to 171717.
 */
/** Arrowhead size, in board units where the largest area's side is 1. */
const ARROW_RADIUS = 0.018
const ARROW_LENGTH = 0.055

export function tokenColor(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  if (!/^[\d\s.]+$/.test(raw)) return fallback
  const channels = raw.split(/\s+/).filter(Boolean)
  return channels.length === 3 ? `rgb(${channels.join(",")})` : fallback
}

/** What can change about a plane without the scene being rebuilt. */
export interface PlaneState {
  /**
   * Which area's stack the plane belongs to.
   *
   * Part of the key rather than assumed, because the board holds more than one
   * area and every one of them has a layer called `prediction`. A key that was
   * the layer id alone addressed two planes at once, and whichever was built
   * last would answer.
   */
  groupId: string
  id: string
  opacity: number
  visible: boolean
  /**
   * Sits at the base of its stack rather than at its own height.
   *
   * The stack separates layers along Y so orbiting pulls them apart, which is
   * what makes the order visible. That same separation is in the way when the
   * question is not "what is the order" but "does this line up with that": from
   * overhead, a layer a step above the base reads as floating over it rather
   * than lying on it, and moving the two together to compare a boundary means
   * comparing across a gap the board introduced.
   *
   * Held as a flag rather than as a Y value, because the height it returns to
   * is whatever the spread control says at the time -- a stored Y would be
   * right until the spread was moved once.
   */
  flat: boolean
}

/**
 * A CSS length that may be in rem, as a number of pixels.
 *
 * Only the two units this variable is ever written in. Anything else returns 0,
 * which is the same fallback the caller had and is honest about not knowing.
 */
export interface BoardHandle {
  /** Redraw once. The board renders on demand, not in a permanent loop. */
  render: () => void
  /**
   * Re-read the studio's partition after a seam has moved.
   *
   * The scene cannot subscribe to React state, and it reads the partition from
   * the custom properties the layout publishes. Those are read once at setup,
   * so a drag has to say that they changed.
   */
  setPartition: () => void
  /**
   * Move the layers apart or together, without rebuilding anything.
   *
   * A prop change that re-created the scene would drop the camera back to its
   * opening angle on every notch of the control, so the one thing the user was
   * looking at while adjusting it would keep jumping away.
   */
  setGap: (gap: number) => void
  /**
   * Change which planes are drawn and how solid, without rebuilding.
   *
   * For the same reason as setGap, and it matters more here: the sidebar's
   * sliders fire on every input event, and a rebuild per event would tear down
   * and recreate the GL context while the user drags -- resetting the camera
   * dozens of times and leaking a context each time the disposal missed one.
   */
  setAppearance: (next: PlaneState[]) => void
  /**
   * Outline one plane, or none.
   *
   * The list and the board are two views of one set of objects, and without
   * this the correspondence runs one way only: a row would say which plane it
   * meant and the plane would not say which row. On a stack seen at an angle,
   * where two rasters of the same AOI look much alike, that is the difference
   * between a list you read and a list you can use.
   */
  /**
   * Outline these planes, in this order, and draw the path through them.
   *
   * An ORDER rather than a set, because the order is the point: several
   * rasters selected one after another is someone saying "read this, then
   * this", and an arrowed path is that statement made visible. A set would
   * have thrown the statement away and left three highlighted planes with
   * nothing between them.
   */
  setSelection: (keys: { groupId: string; id: string }[]) => void
  /**
   * Which area's own outline reads as chosen.
   *
   * Separate from setSelection, which is about PLANES. An area with no rasters
   * has no plane to select, and its outline is the only thing on the board that
   * is it -- so being able to pick it is the difference between an area you can
   * see and one you can act on.
   */
  setActiveArea: (id: string | null) => void
  /**
   * Put an area where a saved arrangement says it was.
   *
   * The counterpart of onMove, and the reason a comparison can be reopened
   * rather than only rebuilt: the scene places areas side by side when it
   * knows nothing better, and this is how it is told better.
   */
  setGroupPosition: (groupId: string, x: number, z: number) => void
  /**
   * Put one plane where a saved arrangement says it was.
   *
   * Separate from setGroupPosition because the two are different facts: an
   * area's place on the board, and a plane's place within its area. A rebuild
   * restores planes from their cards, which know only where the layout first
   * put them, so anything moved since has to be re-applied.
   */
  setPlanePosition: (
    groupId: string,
    layerId: string,
    x: number,
    z: number
  ) => void
  /**
   * Draw lines joining the rasters of each area to one another.
   *
   * A plane can be dragged out of its stack, which is what makes comparing one
   * raster against another possible -- and it dissolves the area as something
   * you can see. With two areas on the board, six rasters lying about say
   * nothing about which three belong together. Off by default: an area whose
   * planes are still stacked needs no line to say so.
   */
  setLinks: (on: boolean) => void
  /**
   * Report where each raster's centre falls on screen, after every frame.
   *
   * The scene says WHERE a label goes and nothing about what it says. The text
   * is a layer's name, which the outliner already owns and someone can change;
   * drawing it here would mean a texture per label, regenerated on every
   * rename, in a module that has no business knowing the application's type.
   */
  setLabels: (on: boolean) => void
  /**
   * Which plane the brush probe listens on, or none.
   *
   * Separate from selection: the outliner can highlight a plane while the
   * probe is off, and turning the brush on should not rewrite the path.
   */
  setProbeTarget: (target: { groupId: string; id: string } | null) => void
  /**
   * Visual rover radius as a fraction of the shorter plane side (0.05–0.35).
   * Independent of the class-majority pixel radius the React side uses.
   */
  setProbeLensScale: (fraction: number) => void
  /**
   * Put the camera on one plane, filling the viewport with it.
   *
   * Separate from the entry framing, which fits the whole stack: a reader who
   * has just asked for one plane wants that plane, and the stack's own sphere
   * is as much larger than it as the board is deep. The direction the camera
   * comes from is kept, so the gesture is a zoom rather than a jump to a view
   * the reader did not choose.
   *
   * Returns false when the plane is not on the board, so the caller can say so
   * rather than appearing to do nothing.
   */
  focusPlane: (groupId: string, layerId: string) => boolean
  /** Release the GL context and every resource attached to it. */
  dispose: () => void
}

/**
 * Mounts the scene into a host element.
 *
 * Returns a handle rather than exposing the renderer, so the React side cannot
 * reach into three and the disposal contract stays in one place.
 */
export function createBoard(
  host: HTMLElement,
  opts: {
    /**
     * The areas on the board, each with its own stack of planes.
     *
     * More than one is the reason this surface exists: on a map two analyses
     * of areas hundreds of kilometres apart cannot be put side by side,
     * because the map puts them where they are.
     */
    groups: CardGroup[]
    /**
     * How many planes are on the board, and how many have arrived.
     *
     * Every raster is a data URI decoded into a texture, and a board of four
     * areas can carry a dozen of them. Between the click that opens the studio
     * and the first plane appearing there was nothing to look at and nothing
     * to read, which is indistinguishable from a surface that has failed to
     * open. Reported per plane rather than once at the end so the wait has a
     * shape.
     */
    onCardsLoaded?: (loaded: number, total: number) => void
    background: string
    /** --p-line, for the grid. */
    line: string
    /** --p-accent, for the selected plane's outline. */
    accent: string
    /**
     * Separation between layers at the moment of the build.
     *
     * Passed so a plane can be placed at its true height as its texture lands.
     * Without it the scene would have to guess until the first setGap arrived,
     * and every plane would appear at the base for a frame.
     */
    gap: number
    /**
     * How each plane starts.
     *
     * Passed apart from the cards, and read again as each texture lands rather
     * than copied onto the mesh once. Textures decode asynchronously, so a
     * setAppearance can arrive before the plane it describes exists; holding
     * the state here means that call is not lost, it just applies later.
     */
    appearance: PlaneState[]
    /**
     * Where planes were left, for the ones that have been moved.
     *
     * Passed for the same reason `appearance` is, and it took the same fault
     * to notice: a plane's place is re-applied right after a rebuild, when its
     * texture is still decoding and there is no mesh to move. The call found
     * nothing and returned, so adding one raster to an arranged board sent
     * every other raster back to where the layout first put it.
     */
    positions: { groupId: string; id: string; x: number; z: number }[]
    /**
     * A plane was pressed.
     *
     * Fired on pointerdown, before any drag: pressing an object and then
     * moving it is one gesture in every editor built this way, and a selection
     * that waited for the release would make the first drag of a plane act on
     * whichever one happened to be selected before.
     */
    /**
     * A plane was picked. `additive` where Shift was held on a press that did
     * not turn into a drag -- see the press handler for why it cannot fire
     * immediately.
     */
    onSelect: (groupId: string, id: string, additive: boolean) => void
    /**
     * A right press on a plane, with where it landed on screen.
     *
     * Blender's navigation freed this button -- orbit, pan and zoom all moved
     * to the middle one -- and a context menu on the object is what it freed
     * it FOR: an action on a plane belongs on the plane, not in a footer three
     * surfaces away that a reader has to find first.
     */
    onPlaneContext?: (
      groupId: string,
      id: string,
      at: { x: number; y: number }
    ) => void
    /** An area's own outline was pressed, where it draws one. */
    onAreaPick?: (groupId: string) => void
    /** An arrowhead between two planes was pressed, in the path's direction. */
    onLinkPick?: (
      from: { groupId: string; id: string },
      to: { groupId: string; id: string }
    ) => void
    /**
     * Something was dragged, and where it came to rest.
     *
     * Reported rather than kept to the scene, because where things sit IS the
     * arrangement -- it is what a saved comparison is mostly made of, and a
     * position only three.js knew about could not be written down.
     */
    /**
     * Where each drawn raster's centre is, in pixels of the canvas.
     *
     * Called after a frame, and only while labels are on. Positions rather
     * than elements: what stands at each point is the caller's business.
     */
    onLabels: (
      spots: {
        groupId: string
        id: string
        x: number
        y: number
        /** False where the plane is behind the camera or off the canvas. */
        onScreen: boolean
      }[]
    ) => void
    onMove: (
      groupId: string,
      /** The plane that moved, or null where the whole area did. */
      layerId: string | null,
      x: number,
      z: number
    ) => void
    /**
     * UV under the pointer on the probe target, or null when the brush misses.
     *
     * Fired from pointermove while a probe target is set and nothing is being
     * dragged. The React side turns UV into a class via classMask; this module
     * only reports where on the texture the ray landed.
     */
    onProbe?: (
      sample: { groupId: string; id: string; u: number; v: number } | null
    ) => void
  }
): BoardHandle {
  const renderer = new WebGLRenderer({ antialias: true })
  /*
    Two passes go into one buffer -- the scene, then the orientation helper in a
    corner -- so the automatic clear is off and the clear is explicit below.
    Leaving it on would wipe the scene before the helper drew; leaving it off
    without clearing at all would let every frame accumulate on the last.
  */
  renderer.autoClear = false
  // An uncapped ratio on a 3x display renders a full-window canvas at nine
  // times the pixels for a difference nobody can see on a flat raster.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(opts.background)

  const FOV = 45
  /*
    Fog in the background colour, so the grid dissolves into it instead of
    ending at a hard rectangular edge. This is the cheapest thing that makes
    the surface read as a space rather than as a small object floating in
    void, and it costs one line -- a visible boundary is what tells the eye
    the ground is a finite plate.

    Near and far are set once the cards are laid out, since both depend on how
    large the stack turned out to be.
  */
  scene.fog = new Fog(new Color(opts.background).getHex(), 1, 10)

  const camera = new PerspectiveCamera(FOV, 1, 0.01, 1000)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  /*
    Panning moves the orbit target, so after one it is no longer the raster's
    centre that the camera turns about. That is the standard bargain in every
    orbit control and it is worth keeping: the raster opens centred, the target
    starts at its centre, and moving off it is then the user's choice rather
    than something that happened to them.
  */
  controls.screenSpacePanning = false
  // Never under the board: from below you see the backs of the planes and the
  // stack order reverses on screen, which reads as a rendering fault rather
  // than as a point of view. Straight down is allowed -- that is the map view.
  controls.maxPolarAngle = Math.PI / 2 - 0.05
  controls.target.set(0, 0, 0)

  /*
    BLENDER'S NAVIGATION, and the reason is not familiarity alone.

    The default here was left-drag to orbit and right-drag to pan, which spends
    the two buttons a reader most wants for other things: left had to be shared
    with selecting and dragging a plane -- arbitrated by a raycast at pointerup
    within four pixels -- and right had nothing left for a context menu.

    Blender puts all three navigations on the MIDDLE button and its modifiers,
    which frees left entirely for what is IN the scene and right entirely for
    what can be done to it. That is why its viewport can afford a select tool,
    a box select and a right-click menu at once.

      MMB              orbit
      Shift MMB        pan
      Ctrl MMB         zoom
      Wheel            zoom

    Left and right are handed to nothing here, so the board's own handlers own
    them without an arbitration.
  */
  /*
    ORBITCONTROLS ALREADY READS THE MODIFIERS, and swapping the mapping under
    it fights that rather than helping.

    Its own table, from the source:

      MOUSE.ROTATE + any modifier  ->  PAN
      MOUSE.PAN    + any modifier  ->  ROTATE
      MOUSE.DOLLY                  ->  dolly, modifiers not consulted

    So Shift needs NO swap: the middle button stays MOUSE.ROTATE and the
    control turns it into a pan by itself. The first version set MOUSE.PAN on
    Shift, which the second line then turned back into a rotate -- Shift-drag
    orbited, and pan could not be reached at all.

    Ctrl is the one that does need a swap, because the first line sends it to
    pan as well and Blender sends it to zoom. DOLLY ignores modifiers, so
    setting it is enough.
  */
  const NAV_DEFAULT = { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null }
  const NAV_ZOOM = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: null }
  controls.mouseButtons = { ...NAV_DEFAULT }

  /*
    Read while the key is held rather than at the moment of press:
    OrbitControls latches its action on pointerdown, so a reader who takes
    hold of the button first and reaches for Ctrl afterwards would otherwise
    orbit until they let go and try again.
  */
  const onNavModifier = (e: KeyboardEvent) => {
    controls.mouseButtons = {
      ...(e.ctrlKey || e.metaKey ? NAV_ZOOM : NAV_DEFAULT),
    }
  }
  window.addEventListener("keydown", onNavModifier)
  window.addEventListener("keyup", onNavModifier)
  /*
    A window that loses focus with Ctrl held would keep the zoom mapping for
    the next press, since the keyup never arrives here.
  */
  const onNavBlur = () => {
    controls.mouseButtons = { ...NAV_DEFAULT }
  }
  window.addEventListener("blur", onNavBlur)

  /**
   * Places the camera so the whole raster is in frame, at the opening angle.
   *
   * Fits the BOUNDING SPHERE rather than the rectangle. A rectangle's
   * projected size changes as it turns, so fitting it would either crop at
   * some angles or need recomputing on every frame of an orbit -- and framing
   * that shifts while you rotate reads as the object moving. The sphere is the
   * same from every direction, so once it fits it fits everywhere. It costs a
   * little empty margin at the angles where the rectangle is narrowest, which
   * is the right trade for a turntable.
   */
  /**
   * The orientation gizmo, bottom-left, and the only thing on this surface
   * that says which way is up.
   *
   * A board with no horizon, no basemap and no north arrow gives the eye
   * nothing to recover its bearings from once it has orbited: the raster
   * itself is symmetric enough that a quarter turn is indistinguishable from
   * where you started. This is the axis reference, and clicking a handle
   * snaps to that view -- so returning to plan, which is the map's own
   * viewpoint, is one click rather than a careful drag.
   *
   * three ships it, so it costs 12.8 kB of an addon rather than a component.
   */
  const viewHelper = new ViewHelper(camera, renderer.domElement)
  /*
    Twelve pixels from the corner of the canvas, and nothing subtracted.

    This used to read --map-foot and --board-right and take the gizmo clear of
    two bands and a column, because the canvas ran the whole width of the
    studio with the chrome painted over it. It got that wrong twice: once by
    parsing "12rem" as twelve pixels, and once by clearing the LEFT column's
    width on the right-hand side.

    The canvas is now the viewport AREA's own rectangle, so there is nothing
    over it to clear. The arithmetic that was wrong twice is gone rather than
    corrected a third time -- which is what putting the surface where it
    belongs buys.
  */
  function placeViewHelper() {
    viewHelper.location = {
      ...viewHelper.location,
      bottom: 12,
      right: 12,
    }
  }
  placeViewHelper()
  // It orbits about the same point the controls do, or a snap would swing the
  // camera around the origin while the controls still believe in the target.
  viewHelper.center = controls.target

  /**
   * Frames while the gizmo animates a snap.
   *
   * The board renders on demand, and a snap is the one thing here that moves
   * without the user's hand on it -- so it needs frames for as long as it
   * lasts, and none after.
   */
  const clock = new Clock()
  let snapping = false
  const stepSnap = () => {
    if (disposed) return
    if (!viewHelper.animating) {
      snapping = false
      controls.update()
      return
    }
    viewHelper.update(clock.getDelta())
    renderer.clear()
    renderer.render(scene, camera)
    viewHelper.render(renderer)
    requestAnimationFrame(stepSnap)
  }

  /*
    Dragging the stack, arbitrated against the orbit control by hit test rather
    than by a mode.

    Both want the left button. A modifier or a toolbar toggle would make the
    user declare an intention the pointer already carries: on the stack means
    move it, off the stack means turn the camera. So a press raycasts, and only
    a hit suspends the orbit -- a miss never reaches this code path at all.

    Motion is confined to the board plane. Y is the axis the layers are
    separated along, and dragging in it would destroy the relation the stack
    exists to show.

    Built for one stack, and unchanged for several: it translates a Group, so a
    second analysis is a second group and this code does not learn about it.
  */
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const dragPlane = new Plane(new Vector3(0, 1, 0), 0)
  const hitPoint = new Vector3()
  const grabOffset = new Vector3()
  let dragging = false
  /**
   * A Shift press waiting to be told apart from a Shift drag.
   *
   * Shift means two things on this surface -- extend the selection, as the tree
   * beside it does, and drag a whole area -- and which one a press meant is not
   * knowable until it is released. The pointer's position at the press is kept
   * so the release can measure how far it travelled.
   */
  let pressed: { groupId: string; id: string; x: number; y: number } | null =
    null
  /** How far a press may travel and still be a pick rather than a drag. */
  const PICK_SLOP_PX = 4
  /**
   * What the pointer is moving: an area, or one plane inside it.
   *
   * `mesh` null means the area. Both are held because a plane's position is
   * expressed relative to its area, so moving one needs the other.
   */
  let dragged: { rt: GroupRuntime; mesh: Mesh | null } | null = null
  /**
   * Plane the brush is reading. Null while the probe is off — pointermove then
   * only serves drag, as before.
   */
  let probeTarget: { groupId: string; id: string } | null = null
  let lastProbeKey: string | null = null
  /** Rover radius / shorter plane side. Matches the example lens scale. */
  let probeLensFrac = 0.14
  /*
    Circular rover on the plane: white ring + crosshair, like a map lens.
    Parent is reassigned to the hit mesh so it rides UV without world maths.
  */
  const probeLens = new Group()
  probeLens.visible = false
  probeLens.renderOrder = 10_000
  const probeRing = new Mesh(
    new RingGeometry(0.92, 1.0, 64),
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  )
  const probeDisc = new Mesh(
    new RingGeometry(0.0, 0.92, 64),
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.06,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
  )
  const crossPositions = new Float32Array([
    -0.18, 0, 0.01, 0.18, 0, 0.01, 0, -0.18, 0.01, 0, 0.18, 0.01,
  ])
  const crossGeo = new BufferGeometry()
  crossGeo.setAttribute("position", new BufferAttribute(crossPositions, 3))
  const probeCross = new LineSegments(
    crossGeo,
    new LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    })
  )
  probeLens.add(probeDisc, probeRing, probeCross)

  /*
    Everything the rover is NOT reading, dimmed.

    A ring of dark geometry cannot do this: a ring has no outer edge that
    follows the plane, so it would darken the space around the raster and the
    neighbouring areas with it. A quad the size of the plane, with the hole cut
    per fragment, is bounded by the plane by construction.

    Distances are taken in the plane's own units rather than in UV, so the hole
    is a circle on a raster of any aspect ratio -- in UV it would be an ellipse
    wherever the raster is not square, which every AOI here is not.
  */
  const probeDimGeometry = new PlaneGeometry(1, 1)
  const probeDimMaterial = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uCentre: { value: new Vector2(0.5, 0.5) },
      uSize: { value: new Vector2(1, 1) },
      uRadius: { value: 0.1 },
      uOpacity: { value: 0.55 },
      /*
        The raster's own texture, read for its ALPHA only.

        Without it the quad darkened the whole plane rectangle, and a plane is
        a rectangle while an AOI is not: every raster here carries transparent
        corners where the polygon does not reach. Dimming those painted a black
        wedge at each corner and a black band along every edge -- the plane's
        boundary drawn in shadow, which is not a boundary the data has.
      */
      uMap: { value: null as Texture | null },
      uHasMap: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec2 uCentre;
      uniform vec2 uSize;
      uniform float uRadius;
      uniform float uOpacity;
      uniform sampler2D uMap;
      uniform float uHasMap;
      varying vec2 vUv;
      void main() {
        float d = length((vUv - uCentre) * uSize);
        /*
          A hard edge. A soft one read as a blur on the raster rather than as
          the boundary of the lens, and it does not need to carry the boundary
          anyway: the white ring sits exactly at this radius and covers it.
        */
        float outside = step(uRadius, d);
        // Only where the raster is opaque. See uMap.
        float alpha = uHasMap > 0.5 ? texture2D(uMap, vUv).a : 1.0;
        gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity * outside * alpha);
      }
    `,
  })
  const probeDim = new Mesh(probeDimGeometry, probeDimMaterial)
  probeDim.visible = false

  /*
    The same place, marked on every other plane of the same area.

    A board carries a classification beside the imagery it was made from, and
    the question a reader has while pointing at a predicted pixel is what that
    pixel LOOKS like -- which is on the other plane, and until now they had to
    find it by eye. Every plane of one area is the same AOI on the same
    reference grid, so the UV under the pointer is the same ground on all of
    them.

    The same treatment as the plane being read: the ring, and everything
    outside it dimmed. A ring alone was the first attempt and it is lost on a
    true-colour raster, which is busy exactly where a field boundary is -- the
    mark has to remove the surroundings, not just outline the spot.

    No crosshair, though. That one says "the pointer is here", and the pointer
    is not here; this says "and here is the same place".

    Pooled rather than created per move. A group can carry six planes and the
    pointer moves on every frame; allocating a ring per frame is how a probe
    turns into garbage collection.
  */
  const echoGeometry = new RingGeometry(0.88, 1.0, 48)
  const echoMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  })

  interface Echo {
    ring: Mesh
    dim: Mesh
    material: ShaderMaterial
  }
  const echoPool: Echo[] = []
  const echoesInUse: Echo[] = []

  const takeEcho = (): Echo => {
    const spare = echoPool.pop()
    if (spare) return spare
    /*
      One material per echo, because only the texture differs.

      The hole is at the same UV and the same radius on every plane -- they are
      matched on being the same size, which is what makes the mark meaningful --
      so every uniform but uMap is shared. three caches the compiled program by
      shader source, so the clones cost uniforms and not a compile each.
    */
    const material = probeDimMaterial.clone()
    const dim = new Mesh(probeDimGeometry, material)
    const ring = new Mesh(echoGeometry, echoMaterial)
    ring.renderOrder = 10_000
    return { ring, dim, material }
  }

  const releaseEchoes = () => {
    for (const echo of echoesInUse) {
      echo.ring.parent?.remove(echo.ring)
      echo.dim.parent?.remove(echo.dim)
      echo.ring.visible = false
      echo.dim.visible = false
      // The texture is the host plane's, not this echo's, so it is dropped
      // rather than left holding a plane that may be removed from the board.
      echo.material.uniforms.uMap.value = null
      echoPool.push(echo)
    }
    echoesInUse.length = 0
  }

  const hideProbeLens = () => {
    if (probeLens.parent) probeLens.parent.remove(probeLens)
    probeLens.visible = false
    if (probeDim.parent) probeDim.parent.remove(probeDim)
    probeDim.visible = false
    releaseEchoes()
  }

  const placeProbeLens = (mesh: Mesh, u: number, v: number) => {
    const w = (mesh.userData.planeWidth as number) || 1
    const h = (mesh.userData.planeHeight as number) || 1
    const r = Math.min(w, h) * probeLensFrac
    if (probeLens.parent !== mesh) {
      probeLens.parent?.remove(probeLens)
      mesh.add(probeLens)
    }
    // PlaneGeometry UV: u→local X, v→local Y (mesh is rotated -90° about X).
    probeLens.position.set((u - 0.5) * w, (v - 0.5) * h, 0.012)
    probeLens.scale.setScalar(r)
    probeLens.visible = true

    if (probeDim.parent !== mesh) {
      probeDim.parent?.remove(probeDim)
      mesh.add(probeDim)
    }
    probeDim.scale.set(w, h, 1)
    probeDim.position.set(0, 0, 0.011)
    probeDimMaterial.uniforms.uCentre.value.set(u, v)
    probeDimMaterial.uniforms.uSize.value.set(w, h)
    probeDimMaterial.uniforms.uRadius.value = r
    // The plane's own texture, so the dim stops where the raster does.
    const planeMap =
      (mesh.material as MeshBasicMaterial | undefined)?.map ?? null
    probeDimMaterial.uniforms.uMap.value = planeMap
    probeDimMaterial.uniforms.uHasMap.value = planeMap ? 1 : 0
    /*
      Just after its own plane, not on top of the board.

      Nothing here writes depth, so renderOrder alone decides the transparent
      pass, and every plane carries a global index. At a fixed high order the
      dim painted over the planes ABOVE the one being read -- brushing the
      bottom of a stack shaded the whole stack. Half a step past its host puts
      it over its own raster and under everything stacked on it.
    */
    probeDim.renderOrder = mesh.renderOrder + 0.5
    probeDim.visible = true

    /*
      And the echoes, on the other planes of this area.

      Matched on plane dimensions rather than assumed: a group can carry a
      raster on another grid -- the MapBiomas reference is clipped natively and
      does not share the run's extent -- and marking the same UV on it would
      point at different ground with no way for a reader to know.
    */
    releaseEchoes()
    // The map the scene already keeps, rather than a search by parent.
    const group = groupOfMesh.get(mesh)
    if (group) {
      for (const other of group.meshes) {
        if (!other || other === mesh || !other.visible) continue
        const ow = (other.userData.planeWidth as number) || 0
        const oh = (other.userData.planeHeight as number) || 0
        if (Math.abs(ow - w) > 1e-3 || Math.abs(oh - h) > 1e-3) continue
        const echo = takeEcho()
        const otherMap =
          (other.material as MeshBasicMaterial | undefined)?.map ?? null

        other.add(echo.dim)
        echo.dim.scale.set(ow, oh, 1)
        echo.dim.position.set(0, 0, 0.011)
        echo.dim.renderOrder = other.renderOrder + 0.5
        echo.material.uniforms.uCentre.value.set(u, v)
        echo.material.uniforms.uSize.value.set(ow, oh)
        echo.material.uniforms.uRadius.value = r
        echo.material.uniforms.uMap.value = otherMap
        echo.material.uniforms.uHasMap.value = otherMap ? 1 : 0
        echo.dim.visible = true

        other.add(echo.ring)
        echo.ring.position.set((u - 0.5) * ow, (v - 0.5) * oh, 0.012)
        echo.ring.scale.setScalar(r)
        echo.ring.visible = true
        echoesInUse.push(echo)
      }
    }
  }

  const emitProbe = (
    sample: { groupId: string; id: string; u: number; v: number } | null
  ) => {
    const key = sample
      ? `${sample.groupId}\0${sample.id}\0${sample.u.toFixed(4)}\0${sample.v.toFixed(4)}`
      : ""
    if (key === lastProbeKey) return
    lastProbeKey = key
    opts.onProbe?.(sample)
  }

  const sampleProbe = (e: PointerEvent) => {
    if (!probeTarget || !opts.onProbe) {
      hideProbeLens()
      emitProbe(null)
      return
    }
    const targets: Mesh[] = []
    for (const rt of runtimes) {
      if (rt.id !== probeTarget.groupId) continue
      for (let i = 0; i < rt.meshes.length; i++) {
        const m = rt.meshes[i]
        if (m && m.visible && rt.cards[i]?.id === probeTarget.id) targets.push(m)
      }
    }
    if (!targets.length) {
      hideProbeLens()
      emitProbe(null)
      return
    }
    toPointer(e)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(targets, false)[0]
    const uv = hit?.uv
    if (!hit || !uv) {
      hideProbeLens()
      emitProbe(null)
      return
    }
    placeProbeLens(hit.object as Mesh, uv.x, uv.y)
    emitProbe({
      groupId: probeTarget.groupId,
      id: probeTarget.id,
      u: uv.x,
      v: uv.y,
    })
    render()
  }

  const toPointer = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    )
  }

  const onPointerDown = (e: PointerEvent) => {
    /*
      The middle button navigates now, and the browser's own autoscroll would
      answer it first -- a scroll cursor pinned to the middle of the canvas
      while the camera tries to orbit under it.
    */
    if (e.button === 1) {
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    /*
      Only the planes that are drawn. A hidden layer is built rather than
      omitted, so that hiding one does not rebuild the scene -- but three's
      raycaster does not test visibility, and without this filter an invisible
      plane would still catch the pointer and start a drag over empty board.

      Non-recursive, so the selection outlines hanging off each plane are not
      hit-tested as geometry of their own.
    */
    const targets: Mesh[] = []
    for (const rt of runtimes) {
      for (const m of rt.meshes) if (m && m.visible) targets.push(m)
    }
    toPointer(e)
    raycaster.setFromCamera(pointer, camera)

    /*
      An arrowhead first, and it wins over the plane behind it. The head sits in
      open board between two planes, so a press that lands on one was meant for
      it; and the pair it joins is the question the reader is asking -- how do
      these two compare -- which no plane alone can answer.
    */
    const heads = arrows.filter((a) => a.visible)
    if (heads.length) {
      const headHit = raycaster.intersectObjects(heads, false)[0]
      const pair = headHit && arrowPair.get(headHit.object as Mesh)
      if (pair) {
        opts.onLinkPick?.(pair[0], pair[1])
        return
      }
    }

    /*
      A footprint is pressable, and it is tested AFTER the planes: an area only
      draws one while it has no rasters, so the two never compete for the same
      pixel -- but a loop of another area can pass behind a plane, and the plane
      is what the eye sees there.

      A line has no width to hit, so the raycaster is given one. A hundredth of
      a world unit, where the largest area's longest side is one: enough to
      catch a deliberate press on the line and far too little to catch a press
      meant for the ground beside it. Restored afterwards, because the value is
      global to the raycaster and every other test here is against a mesh.
    */
    const loops = [...footprints.values()].filter((l) => l.visible)

    if (!targets.length) {
      if (loops.length) {
        const before = raycaster.params.Line?.threshold
        if (raycaster.params.Line) raycaster.params.Line.threshold = 0.01
        const loopHit = raycaster.intersectObjects(loops, false)[0]
        if (raycaster.params.Line && before !== undefined) {
          raycaster.params.Line.threshold = before
        }
        const picked = loopHit
          ? [...footprints.entries()].find(([, l]) => l === loopHit.object)?.[0]
          : undefined
        if (picked) opts.onAreaPick?.(picked)
      }
      return
    }
    const hits = raycaster.intersectObjects(targets, false)
    if (!hits.length) {
      if (loops.length) {
        const before = raycaster.params.Line?.threshold
        if (raycaster.params.Line) raycaster.params.Line.threshold = 0.01
        const loopHit = raycaster.intersectObjects(loops, false)[0]
        if (raycaster.params.Line && before !== undefined) {
          raycaster.params.Line.threshold = before
        }
        const picked = loopHit
          ? [...footprints.entries()].find(([, l]) => l === loopHit.object)?.[0]
          : undefined
        if (picked) opts.onAreaPick?.(picked)
      }
      return
    }
    /*
      Among planes the ray meets at the same place, take the one drawn on top.

      Coplanar planes are not a corner case here: dropping a layer to its
      stack's base is a control, and setting the spread to zero flattens every
      one of them. Their intersection distances then differ by rounding alone,
      and `[0]` returned whichever the arithmetic happened to favour -- in
      practice the base, since it is built first. Selecting a layer in the tree
      and dragging it moved the raster underneath instead.

      The tie is broken by renderOrder, which is the same order the eye sees:
      the plane painted last is the plane on top, so it is the plane a press
      lands on. The tolerance is a thousandth of the board's unit -- the
      largest area's longest side is 1 -- which is far below any separation the
      spread can produce and far above the rounding it has to absorb.
    */
    const nearest = hits[0].distance
    const tied = hits.filter((h) => h.distance <= nearest + 1e-3)
    /*
      The layer already chosen wins the tie, and only then the topmost.

      A selection is an intention the user has already stated, in the tree
      beside this. Where several planes lie under the pointer at the same
      place, a press that overrode it would take the layer they had picked and
      hand them the one above -- which is what happened: with prediction
      selected and confidence over it, pressing to drag prediction selected and
      moved confidence instead. Preferring the selection also makes the drag
      that follows act on the thing the panel is describing.

      Where the selected plane is not among them, the plane painted last is the
      plane on top, so it is the one a press lands on.
    */
    const hit =
      tied.find((h) => {
        const k = keyOfMesh.get(h.object as Mesh)
        return !!k && selectedKeys.includes(k)
      }) ??
      tied.reduce((best, h) =>
        h.object.renderOrder > best.object.renderOrder ? h : best
      )
    const mesh = hit.object as Mesh
    // The area that was pressed is the one that moves. With one area on the
    // board this is the only area; with two it is the difference between
    // arranging them and dragging both at once.
    const rt = groupOfMesh.get(mesh)
    if (!rt) return
    const index = rt.meshes.indexOf(mesh)
    /*
      A plain press selects at once, as it always has. A SHIFT press cannot,
      because Shift is already the area drag below -- firing on press would
      make every attempt to arrange two areas also rewrite the selection.

      So it is remembered and resolved at pointerup: released without having
      moved, it was a pick and extends the selection; released after moving, it
      was the drag it looked like and the selection is left alone. The two
      gestures are told apart by what actually happened rather than by giving
      one of them a different modifier from the tree's.
    */
    if (index >= 0) {
      const cardId = rt.cards[index].id
      if (e.shiftKey) {
        pressed = { groupId: rt.id, id: cardId, x: e.clientX, y: e.clientY }
      } else {
        pressed = null
        opts.onSelect(rt.id, cardId, false)
      }
    }
    /*
      The plane that was grabbed moves, and Shift moves the whole area.

      One object at a time is what the outliner beside this says the board is
      made of, and it is what the question "does this line up with that" needs:
      sliding one raster over another is the comparison. Moving every layer of
      an area together is still wanted -- it is how two areas are arranged
      beside each other -- so it keeps the modifier rather than the plain drag,
      because arranging areas happens once and comparing happens all afternoon.
    */
    dragged = { rt, mesh: e.shiftKey ? null : mesh }
    /*
      The plane the drag runs on passes through the height of the thing being
      moved, so the grab point does not jump on the first move. For an area
      that is the root's height, since an area only moves in X and Z; for a
      plane it is the root's plus the plane's own, which is what the spread and
      the base-level flag decide.
    */
    dragPlane.constant = -(
      world.position.y +
      (dragged.mesh ? rt.root.position.y + dragged.mesh.position.y : 0)
    )
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return
    grabOffset
      .copy(dragged.mesh ? dragged.mesh.position : rt.root.position)
      .sub(hitPoint)
    dragging = true
    controls.enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
  }

  /*
    The right button, which the navigation no longer wants.

    OrbitControls preventDefaults contextmenu whenever it is enabled, so the
    browser's own menu never appears and this is free to answer instead. It
    picks with the same ray the left button does; anything that is not a plane
    falls through and opens nothing, rather than opening a menu about nothing.
  */
  const onContextMenu = (e: MouseEvent) => {
    if (!opts.onPlaneContext) return
    const targets: Mesh[] = []
    for (const rt of runtimes) {
      for (const m of rt.meshes) if (m && m.visible) targets.push(m)
    }
    toPointer(e as unknown as PointerEvent)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(targets, false)[0]
    if (!hit) return
    const mesh = hit.object as Mesh
    const rt = groupOfMesh.get(mesh)
    if (!rt) return
    const index = rt.meshes.indexOf(mesh)
    const card = index >= 0 ? rt.cards[index] : null
    if (!card) return
    e.preventDefault()
    e.stopPropagation()
    opts.onPlaneContext(rt.id, card.id, { x: e.clientX, y: e.clientY })
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) {
      sampleProbe(e)
      return
    }
    toPointer(e)
    raycaster.setFromCamera(pointer, camera)
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return
    if (!dragged) return
    /*
      One expression for both, and the area's offset does NOT appear in it.

      A plane's position is local to its area and the hit point is in world
      space, so the two look like they need reconciling. They do not: the
      offset recorded at the grab is `local - world`, and adding it back to a
      later world point cancels the area's contribution -- the plane simply
      follows the pointer's delta. Subtracting the area's offset as well moved
      the plane backwards by exactly that offset, which for an area at x=1.4
      sent a plane grabbed at 1.65 and dragged to 2.05 out to 0.65.
    */
    const target = dragged.mesh ?? dragged.rt.root
    target.position.x = hitPoint.x + grabOffset.x
    target.position.z = hitPoint.z + grabOffset.z
    if (dragged.mesh) {
      // Through the same record the build reads, so a rebuild during a drag
      // does not undo the drag.
      const i = dragged.rt.meshes.indexOf(dragged.mesh)
      if (i >= 0) {
        placed.set(planeKey(dragged.rt.id, dragged.rt.cards[i].id), {
          x: target.position.x,
          z: target.position.z,
        })
      }
    }
    updateLinks()
    render()
  }

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return
    // Reported on release rather than on every move: where an area came to
    // rest is the arrangement, and the fifty positions it passed through are
    // not. See opts.onMove.
    if (dragged) {
      const { rt, mesh } = dragged
      const i = mesh ? rt.meshes.indexOf(mesh) : -1
      const p = mesh ? mesh.position : rt.root.position
      opts.onMove(rt.id, i >= 0 ? rt.cards[i].id : null, p.x, p.z)
    }
    /*
      Below the slop a press is a pick, not a drag of nothing. Four pixels is
      the hand's own tremor on a trackpad; anything above it was an attempt to
      move something, however short.
    */
    if (pressed) {
      const still =
        Math.abs(e.clientX - pressed.x) <= PICK_SLOP_PX &&
        Math.abs(e.clientY - pressed.y) <= PICK_SLOP_PX
      if (still) opts.onSelect(pressed.groupId, pressed.id, true)
      pressed = null
    }
    dragged = null
    dragging = false
    controls.enabled = true
    renderer.domElement.releasePointerCapture(e.pointerId)
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown)
  /*
    Capture, so it runs before OrbitControls' own handler suppresses the event
    -- that one only preventDefaults, but it is bound on the same element and
    the order is not ours to assume.
  */
  renderer.domElement.addEventListener("contextmenu", onContextMenu, true)
  renderer.domElement.addEventListener("pointermove", onPointerMove)
  renderer.domElement.addEventListener("pointercancel", endDrag)
  const onPointerLeave = () => {
    if (!dragging) {
      hideProbeLens()
      emitProbe(null)
      render()
    }
  }
  renderer.domElement.addEventListener("pointerleave", onPointerLeave)

  const onPointerUp = (e: PointerEvent) => {
    /*
      A release that ends a drag is not a click on the gizmo, even when it
      lands on one. Dragging the stack into the corner where the helper sits
      would otherwise both drop the card and snap the camera to an axis --
      two outcomes from one gesture, and the second unasked for.
    */
    const wasDragging = dragging
    endDrag(e)
    if (wasDragging) return
    if (viewHelper.handleClick(e)) {
      if (!snapping) {
        snapping = true
        clock.getDelta()
        requestAnimationFrame(stepSnap)
      }
    }
  }
  renderer.domElement.addEventListener("pointerup", onPointerUp)

  /** The sphere the raster sits in, once it is known. */
  let fitRadius = 0
  /** The grid's full width, for placing the fog's far plane. */
  let gridSpan = 0

  /** Distance at which that sphere just fits the current viewport. */
  const fitDistance = () => {
    const vFov = (FOV * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
    // The tighter of the two axes decides, or the object overflows the other.
    return (fitRadius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.12
  }

  /**
   * The ground the stack sits over: a sparse grid, fading out.
   *
   * Sparse and dim on purpose. A dense bright grid is what makes a surface
   * read as a 3D editor; at a wide pitch and low alpha it reads as graph
   * paper, which is what a board is. It exists at all because without it the
   * stack has nothing to sit over -- with an empty background there is no
   * parallax cue, so orbiting moves the rasters against nothing and the sense
   * of turning around an object is lost.
   */
  const addGround = (radius: number) => {
    // Ten cells across the object, out to four times its radius: fine enough
    // to read motion against, coarse enough not to draw attention.
    const span = radius * 8
    const grid = new GridHelper(span, 20, opts.line, opts.line)
    const material = grid.material as LineBasicMaterial
    material.transparent = true
    material.opacity = 0.14
    material.depthWrite = false
    // Below the lowest plane, so it never fights the rasters for the surface.
    grid.position.y = -radius * 0.35
    scene.add(grid)
    disposables.push(grid.geometry, material)

    gridSpan = span
  }

  /**
   * Keeps the fog behind the stack as the camera moves.
   *
   * Fog is measured from the CAMERA, not from the scene origin, so a fixed
   * near plane is only correct at one zoom. Set from the scene's own extent it
   * began inside the stack -- the camera sits about 2.6 radii out, so a near
   * plane at 2.2 radii dimmed the far half of the raster it was meant to leave
   * alone.
   *
   * Tied to the current distance instead: it starts just past the far side of
   * the stack and ends within the grid, at every zoom.
   */
  const updateFog = () => {
    const fog = scene.fog as Fog | null
    if (!fog || !fitRadius) return
    const d = camera.position.distanceTo(controls.target)
    fog.near = d + fitRadius * 1.2
    fog.far = d + gridSpan * 0.5
  }

  const frame = (radius: number) => {
    fitRadius = radius
    const distance = fitDistance()
    // Not top-down at entry: a plan view is indistinguishable from the map the
    // board replaced, so opening there would leave the user unsure anything
    // happened. The tilt is what says the surface has a third axis.
    const azimuth = -Math.PI / 5
    const elevation = Math.PI / 3.4
    camera.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * Math.cos(elevation) * distance
    )
    camera.lookAt(0, 0, 0)
    // Bounded by the object rather than by constants: close enough to read a
    // pixel, far enough to keep it in frame.
    controls.minDistance = radius * 0.35
    controls.maxDistance = distance * 4
    controls.update()
  }

  const disposables: { dispose: () => void }[] = []
  disposables.push(
    probeRing.geometry,
    probeRing.material as MeshBasicMaterial,
    probeDisc.geometry,
    probeDisc.material as MeshBasicMaterial,
    crossGeo,
    probeCross.material as LineBasicMaterial,
    probeDimGeometry,
    probeDimMaterial,
    echoGeometry,
    echoMaterial
  )
  let raf = 0
  let disposed = false

  /**
   * Draw one frame, coalescing several requests in the same tick.
   *
   * On demand rather than a permanent loop: a desktop window that redraws an
   * unchanged scene sixty times a second spends battery to no effect. Damping
   * drives its own frames through the control's change event.
   */
  /*
    Where the labels go, reported after the frame that placed them.

    A projection is only valid for the matrices the frame was drawn with, so it
    is computed here rather than on demand: asking later would answer for a
    camera that has since moved, and the label would trail the raster by a
    frame during every drag and every orbit.
  */
  let labelsOn = false
  const labelPoint = new Vector3()
  const reportLabels = () => {
    if (!labelsOn) return
    const { clientWidth: w, clientHeight: h } = renderer.domElement
    const spots: {
      groupId: string
      id: string
      x: number
      y: number
      onScreen: boolean
    }[] = []
    for (const rt of runtimes) {
      rt.meshes.forEach((mesh, i) => {
        if (!mesh || !mesh.visible) return
        mesh.getWorldPosition(labelPoint).project(camera)
        // z beyond 1 is behind the near plane: the point is at the camera's
        // back, where the projection wraps and would place the label on the
        // opposite side of the screen.
        const onScreen =
          labelPoint.z <= 1 &&
          Math.abs(labelPoint.x) <= 1.2 &&
          Math.abs(labelPoint.y) <= 1.2
        spots.push({
          groupId: rt.id,
          id: rt.cards[i].id,
          x: (labelPoint.x * 0.5 + 0.5) * w,
          y: (-labelPoint.y * 0.5 + 0.5) * h,
          onScreen,
        })
      })
    }
    opts.onLabels(spots)
  }

  const render = () => {
    if (disposed || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      controls.update()
      updateFog()
      renderer.clear()
      renderer.render(scene, camera)
      // After the scene and without clearing it: the helper draws into a
      // corner of the same buffer, clearing only depth so it is never hidden
      // behind the raster.
      viewHelper.render(renderer)
      reportLabels()
    })
  }
  controls.addEventListener("change", render)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host
    if (!w || !h) return
    /*
      updateStyle left at its default. Passing false writes the drawing buffer
      in device pixels and leaves the canvas with NO css size, so on a 2x
      display the element lays out at twice the intended width and height,
      anchored top-left -- what shows is the bottom-right quarter of a canvas
      spilling past the window. The raster looked pushed into the corner and
      hugely magnified because it was.
    */
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    /*
      Push the camera out if the new shape would crop, and only then. Re-framing
      outright would throw away the angle and the zoom the user chose, so a
      window resize would silently undo their work; leaving it alone entirely
      would let a narrower window cut the raster off. The target never moves, so
      it stays centred either way -- this is only about staying whole.

      The distance is the position's length because the target is the origin.
    */
    if (fitRadius) {
      const min = fitDistance()
      if (camera.position.length() < min) {
        camera.position.setLength(min)
        controls.update()
      }
    }
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  /*
    Without preventDefault the context never comes back and the board is dead
    until the application restarts. A window that lives for hours and gets
    backgrounded will lose one eventually.
  */
  const onLost = (e: Event) => {
    e.preventDefault()
  }
  const onRestored = () => resize()
  renderer.domElement.addEventListener("webglcontextlost", onLost)
  renderer.domElement.addEventListener("webglcontextrestored", onRestored)

  /*
    One three.js Group per area, all under one root.

    The root exists to be moved vertically without disturbing the areas: the
    stack is recentred on its own bounding sphere once the textures land, and
    doing that to each area separately would move them relative to each other.
    The root only ever translates in Y, which is why an area's local X and Z
    are also its world X and Z -- the drag below relies on that.

    A group per area, rather than a plane per area under one group, is what
    makes dragging one area a translation of an object that already exists.
  */
  const world = new Group()
  scene.add(world)
  const loader = new TextureLoader()
  /*
    What the studio is waiting for. The total is known at build time -- every
    visible plane of every area -- and the count rises as each texture lands,
    including the ones that fail: a board with one unreadable raster must not
    wait for it forever.
  */
  const cardsTotal = opts.groups.reduce((n, g) => n + g.cards.length, 0)
  let cardsLoaded = 0
  // Said once at the start, so a board with nothing on it is not reported as
  // perpetually loading.
  opts.onCardsLoaded?.(cardsLoaded, cardsTotal)
  let pending = opts.groups.reduce((n, g) => n + g.cards.length, 0)

  interface GroupRuntime {
    id: string
    root: Group
    cards: CardPlane[]
    /*
      Held in the cards' own order rather than read back from root.children.

      Textures load asynchronously, so the children arrive in whatever order
      the decoder finishes -- which is not the stack order. Indexing that array
      by position, as setGap once did, assigned the wrong height to each plane
      the first time the spread was moved, silently reordering the stack.
    */
    meshes: (Mesh | null)[]
    indexById: Map<string, number>
  }

  const runtimes: GroupRuntime[] = opts.groups.map((g) => {
    const root = new Group()
    root.position.set(g.x, 0, g.z)
    world.add(root)
    return {
      id: g.id,
      root,
      cards: g.cards,
      meshes: g.cards.map(() => null),
      indexById: new Map(g.cards.map((c, i) => [c.id, i])),
    }
  })
  /** Which area a plane belongs to, for the drag and for the hit test. */
  const groupOfMesh = new Map<Mesh, GroupRuntime>()

  /*
    The footprint of an area that has no rasters yet.

    Drawn in the grid's own colour rather than the accent: it is ground, not a
    selection. It exists because the board is where the work that produces
    those rasters is started, and an area you cannot see is an area you cannot
    aim at -- before this, a freshly drawn AOI opened onto an empty grid.

    Only while the area is empty. Once a raster lands it says where the area is
    far better than a line does, and a line still there would be a second
    boundary to reconcile with the first.
  */
  const footprintMaterial = new LineBasicMaterial({
    color: new Color(opts.line),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  /*
    The same line, in the accent, for the area that is selected.

    TWO materials rather than one per area: the colour is one of two things, so
    the loops share whichever they are wearing and switching is an assignment
    rather than an allocation. A material per area would be a material per area
    for a property with two values.
  */
  const footprintSelected = new LineBasicMaterial({
    color: new Color(opts.accent),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })
  disposables.push(footprintMaterial, footprintSelected)
  /** Each area's footprint, so the selection can find it without a search. */
  const footprints = new Map<string, LineLoop>()
  for (const rt of runtimes) {
    const g = opts.groups.find((x) => x.id === rt.id)
    if (!g?.outline?.length || g.cards.length) continue
    const loop = new LineLoop(
      new BufferGeometry().setAttribute(
        "position",
        new Float32BufferAttribute(
          // Flat on the ground: the ring is board XZ, and this hangs off the
          // area's root rather than off a plane, so no rotation is involved.
          g.outline.flatMap((pt) => [pt.x, 0, pt.z]),
          3
        )
      ),
      footprintMaterial
    )
    rt.root.add(loop)
    footprints.set(rt.id, loop)
    disposables.push(loop.geometry)
  }
  /** Its key, so a hit can be compared against the selection without a search. */
  const keyOfMesh = new Map<Mesh, string>()

  /*
    The lines between corresponding rasters of different areas.

    One LineSegments over a buffer allocated once, with the draw range saying
    how much of it is in use. Rebuilding the attribute on every drag would
    upload a new buffer per frame and leave the old ones on the GPU until the
    geometry was disposed -- three only drops a replaced attribute then.
  */
  const linkMaterial = new LineBasicMaterial({
    color: new Color(opts.accent),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  })
  const linkGeometry = new BufferGeometry()
  // Two ends per segment, and never more segments than there are planes: a
  // layer present in n areas contributes n-1 of them.
  const linkBuffer = new Float32Array(pending * 2 * 3)
  /*
    BufferAttribute, not Float32BufferAttribute.

    The convenience subclass runs `new Float32Array(array)` on what it is
    given, so it holds a COPY -- every write into the array here went to a
    buffer nothing read, the attribute stayed zeroed, and the lines were drawn
    as degenerate segments at the origin. Invisible, with no error anywhere.
    BufferAttribute keeps the reference.
  */
  const linkAttribute = new BufferAttribute(linkBuffer, 3)
  linkGeometry.setAttribute("position", linkAttribute)
  linkGeometry.setDrawRange(0, 0)
  const links = new LineSegments(linkGeometry, linkMaterial)
  /*
    BEFORE every plane, so the rasters are painted over it.

    The line says which rasters belong together, which is a fact about the
    board rather than about any raster -- drawn on top it crossed the middle of
    a classification and became something to read through. Under them it shows
    where it leaves and where it arrives, and hides where it has nothing to
    add. Nothing writes depth here, so the order is renderOrder alone.
  */
  links.renderOrder = -1
  links.visible = false
  world.add(links)
  disposables.push(linkGeometry, linkMaterial)

  /*
    The path through the selection, and the arrowheads that give it direction.

    A separate object from the links: those say what BELONGS together and are
    a property of the board, while this says in what ORDER to read a few things
    someone picked, and is a property of a gesture. Drawn in the accent, over
    the planes rather than under them -- an instruction about how to read the
    board is not part of the board.

    Arrowheads are cones at each segment's midpoint. At an end they would be
    hidden under the raster they point at, and the midpoint is where the eye
    already is when it follows a line.
  */
  const pathMaterial = new LineBasicMaterial({
    color: new Color(opts.accent),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  })
  const arrowMaterial = new MeshBasicMaterial({
    color: new Color(opts.accent),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const pathGeometry = new BufferGeometry()
  const pathBuffer = new Float32Array(pending * 2 * 3)
  const pathAttribute = new BufferAttribute(pathBuffer, 3)
  pathGeometry.setAttribute("position", pathAttribute)
  pathGeometry.setDrawRange(0, 0)
  const pathLine = new LineSegments(pathGeometry, pathMaterial)
  pathLine.renderOrder = pending * 4
  world.add(pathLine)
  disposables.push(pathGeometry, pathMaterial, arrowMaterial)

  /** One cone per segment, kept and reused rather than rebuilt. */
  const arrows: Mesh[] = []
  const arrowFrom = new Vector3()
  const arrowTo = new Vector3()
  const arrowDir = new Vector3()
  /** Cones point along +Y by default; this is the axis to rotate from. */
  const CONE_AXIS = new Vector3(0, 1, 0)
  /**
   * Which two planes each arrowhead joins.
   *
   * The arrow is the only part of a link big enough to press: a line is a pixel
   * wide and asking for one is asking for a miss. So the head carries the pair
   * and the head is the target.
   */
  const arrowPair = new Map<
    Mesh,
    [{ groupId: string; id: string }, { groupId: string; id: string }]
  >()

  const updatePath = () => {
    const points: Vector3[] = []
    const pointOwners: { groupId: string; id: string }[] = []
    for (const key of selectedKeys) {
      for (const rt of runtimes) {
        const i = rt.meshes.findIndex(
          (m, n) => !!m && planeKey(rt.id, rt.cards[n].id) === key
        )
        const mesh = i >= 0 ? rt.meshes[i] : null
        // Only what is drawn: a path through a hidden raster would point at
        // nothing, and it would still claim a reading order that cannot be
        // followed on screen.
        if (mesh && mesh.visible) {
          points.push(
            new Vector3(
              rt.root.position.x + mesh.position.x,
              rt.root.position.y + mesh.position.y,
              rt.root.position.z + mesh.position.z
            )
          )
          /*
            Kept beside the points because a segment is between two DRAWN
            planes, which is not the same as two consecutive selections: a
            hidden one in the middle is skipped above, so indexing back into
            the selection would name a pair the arrow does not join.
          */
          pointOwners.push({ groupId: rt.id, id: rt.cards[i].id })
        }
      }
    }

    let n = 0
    for (let i = 1; i < points.length; i++) {
      for (const p of [points[i - 1], points[i]]) {
        pathBuffer[n++] = p.x
        pathBuffer[n++] = p.y
        pathBuffer[n++] = p.z
      }
    }
    pathAttribute.needsUpdate = true
    pathGeometry.setDrawRange(0, n / 3)

    const segments = Math.max(0, points.length - 1)
    // Grown on demand and hidden rather than destroyed: a selection changes
    // often, and a cone per change would be a geometry allocated per click.
    while (arrows.length < segments) {
      const cone = new Mesh(
        new ConeGeometry(ARROW_RADIUS, ARROW_LENGTH, 8),
        arrowMaterial
      )
      cone.renderOrder = pending * 4 + 1
      arrows.push(cone)
      world.add(cone)
      disposables.push(cone.geometry)
    }
    arrowPair.clear()
    arrows.forEach((cone, i) => {
      cone.visible = i < segments
      if (!cone.visible) return
      arrowPair.set(cone, [pointOwners[i], pointOwners[i + 1]])
      arrowFrom.copy(points[i])
      arrowTo.copy(points[i + 1])
      cone.position.copy(arrowFrom).lerp(arrowTo, 0.5)
      arrowDir.copy(arrowTo).sub(arrowFrom)
      if (arrowDir.lengthSq() > 0) {
        cone.quaternion.setFromUnitVectors(CONE_AXIS, arrowDir.normalize())
      }
    })
  }

  /**
   * Re-points the lines at where the planes are now.
   *
   * Called from everything that moves a plane or changes which are drawn. A
   * line to a hidden raster would point at nothing, and one left behind by a
   * drag would say the areas are related in a way they are no longer arranged.
   */
  const updateLinks = () => {
    if (!links.visible) return
    /*
      Chained WITHIN an area, in stack order.

      What the lines have to say is membership: which scattered rasters are one
      area's. Once a plane can be dragged out of its stack, an area stops being
      a thing you can see and becomes rasters lying about, and with two areas
      on the board there is nothing to tell one constellation from the other.

      Not across areas. Joining one area's classification to another's would
      draw the comparison rather than the grouping -- and it is the grouping
      that is lost when planes move, since the comparison is what the person
      moving them is holding in their head.
    */
    let n = 0
    for (const rt of runtimes) {
      const drawn = rt.meshes.filter((m): m is Mesh => !!m && m.visible)
      for (let i = 1; i < drawn.length; i++) {
        for (const mesh of [drawn[i - 1], drawn[i]]) {
          linkBuffer[n++] = rt.root.position.x + mesh.position.x
          linkBuffer[n++] = rt.root.position.y + mesh.position.y
          linkBuffer[n++] = rt.root.position.z + mesh.position.z
        }
      }
    }
    linkAttribute.needsUpdate = true
    linkGeometry.setDrawRange(0, n / 3)
  }

  /*
    The separation in force, and the one place a plane's height is decided.

    Height comes from three things -- position in the stack, the spread, and
    whether the plane has been dropped to the base -- and two of them change
    without the scene being rebuilt. Deriving it in one function is what keeps
    setGap and setAppearance from each having their own opinion.
  */
  let currentGap = opts.gap
  const heightOf = (rt: GroupRuntime, index: number) =>
    state.get(planeKey(rt.id, rt.cards[index].id))?.flat ? 0 : index * currentGap
  const applyHeights = () => {
    for (const rt of runtimes) {
      rt.meshes.forEach((mesh, i) => {
        if (mesh) mesh.position.y = heightOf(rt, i)
      })
    }
    updateLinks()
    updatePath()
  }

  /**
   * Which plane is outlined. Held here rather than passed in, because the
   * planes appear as their textures decode and a selection made before one
   * arrives has to survive until it does.
   */
  /** Selected planes in the order they were chosen, by key. */
  let selectedKeys: string[] = []
  /*
    The one place a plane's state lives. Seeded from the caller and updated by
    setAppearance; the mesh reads it when it is created and whenever it is
    changed. Two paths to the same property is what produced the fault this
    replaces: the card said one thing, the handle said another, and whichever
    ran last won.
  */
  /** Area and layer together: two areas both have a layer called prediction. */
  const planeKey = (groupId: string, id: string) => `${groupId}\u0000${id}`
  const state = new Map<string, PlaneState>(
    opts.appearance.map((a) => [planeKey(a.groupId, a.id), a])
  )
  /*
    Where each moved plane sits, in the same shape and for the same reason as
    `state`: recorded whether or not the plane exists yet, and read when it is
    created. A card's x and z are the LAYOUT's first answer, and a plane that
    has been dragged has a later one.
  */
  const placed = new Map<string, { x: number; z: number }>(
    opts.positions.map((p) => [planeKey(p.groupId, p.id), { x: p.x, z: p.z }])
  )
  /*
    One material for every outline: the colour is the same and a material per
    plane would be a shader program per plane for no difference on screen.
    The geometries differ -- each is the edge of its own rectangle -- so those
    are per plane and disposed individually.
  */
  const outlineMaterial = new LineBasicMaterial({
    color: new Color(opts.accent),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  disposables.push(outlineMaterial)

  /*
    Every plane on the board, drawn in a single order.

    renderOrder is global rather than per area, because the transparent pass
    is a single sorted list: two areas each numbering their planes from zero
    would interleave, and a layer of one area could be painted between two
    layers of the other.
  */
  let drawIndex = 0
  const totalPlanes = pending
  /*
    With no textures to wait for, nothing would ever call the framing below --
    it hangs off the last one to land. An area drawn and not yet run has
    exactly that shape, so the board frames on what it does have.
  */
  if (pending === 0 && runtimes.length) {
    const box = new Box3().setFromObject(world)
    const sphere = box.getBoundingSphere(new Sphere())
    if (sphere.radius > 0) {
      world.position.y = -sphere.center.y
      addGround(sphere.radius)
      frame(sphere.radius)
      render()
    }
  }

  for (const rt of runtimes) {
  const group = opts.groups.find((g) => g.id === rt.id)!
  /*
    The ring's own extent, against which a plane is judged to be the area.

    Compared with the RING rather than with the group's footprint, which is
    the union of every layer: a composition covering a wider window makes that
    union wider than the area, and matching against it handed the ring to the
    composition and left the classification -- the layer whose extent IS the
    area -- with a rectangle. Exactly backwards.
  */
  const ringBox = group.outline?.length
    ? {
        x0: Math.min(...group.outline.map((p) => p.x)),
        x1: Math.max(...group.outline.map((p) => p.x)),
        z0: Math.min(...group.outline.map((p) => p.z)),
        z1: Math.max(...group.outline.map((p) => p.z)),
      }
    : null
  /*
    A plane is the area when its rectangle is the ring's, near enough.

    NOT exactly. A raster's extent is the area's bounding box snapped OUT to
    whole pixels of the source imagery, so it is always a little larger than
    the polygon and never equal to it -- an exact test, which is what this was,
    matched nothing and every plane kept its box. The tolerance is a twentieth
    of the plane's longer side, which absorbs a snap of some tens of pixels and
    still refuses a composition covering a different field.
  */
  const ringFor = (card: CardPlane) => {
    if (!ringBox) return null
    const tol = Math.max(card.width, card.height) * 0.05
    const near = (a: number, b: number) => Math.abs(a - b) <= tol
    return near(card.width, ringBox.x1 - ringBox.x0) &&
      near(card.height, ringBox.z1 - ringBox.z0) &&
      near(card.x, (ringBox.x0 + ringBox.x1) / 2) &&
      near(card.z, (ringBox.z0 + ringBox.z1) / 2)
      ? group.outline!
      : null
  }
  rt.cards.forEach((card, index) => {
    const order = drawIndex++
    loader.load(card.uri, (t) => {
      if (disposed) {
        t.dispose()
        return
      }
      // Counted as it lands. A texture that fails still counts, further down,
      // or a board with one unreadable raster would wait for it forever.
      cardsLoaded += 1
      opts.onCardsLoaded?.(cardsLoaded, cardsTotal)
      t.colorSpace = SRGBColorSpace
      /*
        Nearest for a class raster: bilinear interpolation invents colours
        between two classes that correspond to no class at all, and the legend
        stops matching the pixels. The same rule as .overlay-crisp in
        index.css. Continuous rasters may be filtered, and are.
      */
      if (card.pixelated) {
        t.magFilter = NearestFilter
        t.minFilter = NearestFilter
        t.generateMipmaps = false
      }

      const geometry = new PlaneGeometry(card.width, card.height)
      /*
        Unlit. These rasters are data, not surfaces: any lighting model would
        multiply the class colours by a light term and the legend would stop
        matching what is drawn.

        depthWrite off with an explicit renderOrder, so the transparent stack
        sorts by the order the layers were given rather than by distance to the
        camera -- which flips as you orbit, and would make layers swap places
        while you look at them.
      */
      const now = state.get(planeKey(rt.id, card.id))
      const material = new MeshBasicMaterial({
        map: t,
        transparent: true,
        opacity: now?.opacity ?? 1,
        depthWrite: false,
      })
      const mesh = new Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.userData.planeWidth = card.width
      mesh.userData.planeHeight = card.height
      const at = placed.get(planeKey(rt.id, card.id))
      mesh.position.set(
        at?.x ?? card.x,
        heightOf(rt, index),
        at?.z ?? card.z
      )
      mesh.renderOrder = order
      // Built whether or not it is shown, so hiding one later is a flag on an
      // existing plane rather than a different scene.
      mesh.visible = now?.visible ?? true
      rt.meshes[index] = mesh
      groupOfMesh.set(mesh, rt)
      keyOfMesh.set(mesh, planeKey(rt.id, card.id))
      rt.root.add(mesh)
      disposables.push(geometry, material, t)

      /*
        The selection outline, as a child so it inherits the plane's position,
        its rotation and every later move of the spread control without being
        told about any of them. Drawn after all the planes, so an outline is
        never buried under the raster of the layer above it.

        The AREA's own shape where it is known and the plane covers the whole
        of it. A raster is a rectangle because a raster is a grid; the area
        analysed is not, and a box around it claims ground the analysis never
        looked at. A layer covering a DIFFERENT window -- a composition can --
        keeps its rectangle, because the area's ring would then describe
        coverage the raster does not have.

        The ring arrives in board XZ and the outline is a child of a mesh
        rotated -90 degrees about X, which sends a child's local (x, y) to
        world (x, -y). So the local Y of a ring point is the negative of its Z,
        and both are taken relative to the plane's own offset.
      */
      const ring = ringFor(card)
      const outline = ring
        ? new LineLoop(
            new BufferGeometry().setAttribute(
              "position",
              new Float32BufferAttribute(
                ring.flatMap((pt) => [pt.x - card.x, -(pt.z - card.z), 0]),
                3
              )
            ),
            outlineMaterial
          )
        : new LineSegments(new EdgesGeometry(geometry), outlineMaterial)
      outline.renderOrder = totalPlanes + order
      outline.visible = selectedKeys.includes(planeKey(rt.id, card.id))
      mesh.add(outline)
      disposables.push(outline.geometry)

      if (--pending === 0) {
        // Framed once every plane is placed, or the first to arrive would set
        // the distance and the rest would fall outside it. Over the whole
        // board rather than one area: opening on two and framing one would
        // leave the other off screen with nothing saying it was there.
        const box = new Box3().setFromObject(world)
        const sphere = box.getBoundingSphere(new Sphere())
        world.position.y = -sphere.center.y
        addGround(sphere.radius)
        frame(sphere.radius)
        updateLinks()
      }
      render()
    },
    undefined,
    () => {
      /*
        A raster that cannot be decoded still counts.

        Without this the studio would sit at "3 of 4" forever on one bad data
        URI -- a wait with no end and no explanation, which is worse than a
        board with a plane missing from it. The plane is simply not placed;
        the tree still lists it, which is where its absence is legible.
      */
      if (disposed) return
      cardsLoaded += 1
      opts.onCardsLoaded?.(cardsLoaded, cardsTotal)
      render()
    }
  )
  })
  }

  return {
    render,
    /**
     * The partition moved: re-read it and redraw.
     *
     * Called when a seam is dragged. createBoard runs from an effect keyed on
     * the groups, so everything it read at setup is a snapshot -- without this
     * the axis gizmo would keep the inset the columns had when the board was
     * built and slide under whichever one grew.
     */
    setPartition() {
      placeViewHelper()
      render()
    },
    setGap(gap: number) {
      // Card order, not the layer's ordering number: even spacing however far
      // apart those numbers happen to be. Hidden planes keep their slot, so
      // showing one again puts it back where the stack left a space for it.
      // Per area, so two areas keep the same separation rather than one
      // stacking above the other.
      currentGap = gap
      applyHeights()
      render()
    },
    setActiveArea(id) {
      for (const [areaId, loop] of footprints) {
        loop.material = areaId === id ? footprintSelected : footprintMaterial
      }
      render()
    },
    setSelection(keys) {
      const next = keys.map((k) => planeKey(k.groupId, k.id))
      if (next.length === selectedKeys.length &&
          next.every((k, i) => k === selectedKeys[i])) {
        return
      }
      selectedKeys = next
      for (const rt of runtimes) {
        rt.meshes.forEach((mesh, i) => {
          // Its own outline is the first child a plane has.
          const outline = mesh?.children[0]
          if (!mesh || !outline) return
          outline.visible = next.includes(planeKey(rt.id, rt.cards[i].id))
        })
      }
      updatePath()
      render()
    },
    setLabels(on) {
      if (labelsOn === on) return
      labelsOn = on
      // Emptied rather than left where they were: labels turned off must not
      // leave their last positions standing on the board.
      if (!on) opts.onLabels([])
      render()
    },
    setProbeTarget(target) {
      const same =
        (!target && !probeTarget) ||
        (!!target &&
          !!probeTarget &&
          target.groupId === probeTarget.groupId &&
          target.id === probeTarget.id)
      if (same) return
      probeTarget = target
      lastProbeKey = null
      if (!target) {
        hideProbeLens()
        emitProbe(null)
        render()
      }
    },
    focusPlane(groupId, layerId) {
      const rt = runtimes.find((r) => r.id === groupId)
      const index = rt?.indexById.get(layerId)
      const mesh = index === undefined ? null : (rt?.meshes[index] ?? null)
      if (!mesh) return false

      /*
        The plane's bounding SPHERE, as the entry framing uses for the stack,
        and for the same reason: a rectangle's projected size changes as it
        turns, so fitting the rectangle would either crop when the board is
        orbited or leave a margin that grows with the angle.
      */
      const box = new Box3().setFromObject(mesh)
      const sphere = box.getBoundingSphere(new Sphere())
      if (!(sphere.radius > 0)) return false

      const vFov = (FOV * Math.PI) / 180
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
      const distance =
        (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.12

      // The direction the reader is already looking from, kept.
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize()
      if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() === 0) {
        direction.set(0, 1, 1).normalize()
      }
      controls.target.copy(sphere.center)
      camera.position.copy(sphere.center).addScaledVector(direction, distance)
      /*
        The clamps come from the stack and would fight a plane smaller than it:
        minDistance was set from the stack's radius, which can exceed the
        distance one plane needs, and the controls would push the camera back
        out on the next update.
      */
      controls.minDistance = Math.min(controls.minDistance, distance * 0.35)
      controls.maxDistance = Math.max(controls.maxDistance, distance * 1.5)
      controls.update()
      updateFog()
      render()
      return true
    },
    setProbeLensScale(fraction) {
      const next = Math.min(0.35, Math.max(0.05, fraction))
      if (Math.abs(next - probeLensFrac) < 1e-4) return
      probeLensFrac = next
      if (probeLens.visible && probeLens.parent) {
        const mesh = probeLens.parent as Mesh
        const w = (mesh.userData.planeWidth as number) || 1
        const h = (mesh.userData.planeHeight as number) || 1
        probeLens.scale.setScalar(Math.min(w, h) * probeLensFrac)
        render()
      }
    },
    setLinks(on) {
      if (links.visible === on) return
      links.visible = on
      // Pointed at where the planes are before being shown: the buffer holds
      // wherever they were when the lines were last drawn, which after a drag
      // with the lines off is nowhere useful.
      updateLinks()
      render()
    },
    setPlanePosition(groupId, layerId, x, z) {
      // Recorded whether or not the plane exists yet: a texture still decoding
      // reads this when it lands, so the call is applied late rather than lost.
      placed.set(planeKey(groupId, layerId), { x, z })
      const rt = runtimes.find((r) => r.id === groupId)
      const i = rt?.indexById.get(layerId)
      const mesh = rt && i !== undefined ? rt.meshes[i] : null
      if (!mesh || (mesh.position.x === x && mesh.position.z === z)) return
      mesh.position.x = x
      mesh.position.z = z
      updateLinks()
      render()
    },
    setGroupPosition(groupId, x, z) {
      const rt = runtimes.find((r) => r.id === groupId)
      if (!rt || (rt.root.position.x === x && rt.root.position.z === z)) return
      rt.root.position.x = x
      rt.root.position.z = z
      updateLinks()
      render()
    },
    setAppearance(next) {
      let changed = false
      for (const c of next) {
        // Recorded whether or not the plane exists yet: a texture still
        // decoding will read this when it lands.
        state.set(planeKey(c.groupId, c.id), c)
        const rt = runtimes.find((r) => r.id === c.groupId)
        const i = rt?.indexById.get(c.id)
        const mesh = rt && i !== undefined ? rt.meshes[i] : null
        // Absent while its texture is still decoding. Nothing further to do:
        // the record above is what the mesh reads when it is created, so the
        // call is applied late rather than lost.
        if (!mesh) continue
        const material = mesh.material as MeshBasicMaterial
        if (mesh.visible !== c.visible) {
          mesh.visible = c.visible
          changed = true
        }
        if (material.opacity !== c.opacity) {
          material.opacity = c.opacity
          changed = true
        }
        const y = heightOf(rt!, i!)
        if (mesh.position.y !== y) {
          mesh.position.y = y
          changed = true
        }
      }
      if (changed) {
        // Hiding a raster takes its line with it: a line to something that is
        // not drawn points at nothing.
        updateLinks()
        updatePath()
        render()
      }
    },
    dispose() {
      disposed = true
      // Returns every echo to the pool first, so the loop below sees them all.
      hideProbeLens()
      /*
        The echo materials are clones made on demand, so they are not in
        `disposables` -- that list is built when the scene is, and these do not
        exist yet. One per plane the rover has ever crossed in one area, held
        for the life of the scene and freed here.
      */
      for (const echo of echoPool) echo.material.dispose()
      echoPool.length = 0
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      controls.removeEventListener("change", render)
      controls.dispose()
      window.removeEventListener("keydown", onNavModifier)
      window.removeEventListener("keyup", onNavModifier)
      window.removeEventListener("blur", onNavBlur)
      renderer.domElement.removeEventListener("contextmenu", onContextMenu, true)
      renderer.domElement.removeEventListener("pointerdown", onPointerDown)
      renderer.domElement.removeEventListener("pointermove", onPointerMove)
      renderer.domElement.removeEventListener("pointercancel", endDrag)
      renderer.domElement.removeEventListener("pointerup", onPointerUp)
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave)
      viewHelper.dispose()
      renderer.domElement.removeEventListener("webglcontextlost", onLost)
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored)
      for (const d of disposables) d.dispose()
      renderer.dispose()
      /*
        forceContextLoss on top of dispose, because WebKit caps active contexts
        at roughly sixteen and dispose alone does not always return one. Under
        the HMR running during development this leaks one context per save, and
        around the twelfth edit the page dies with "Too many active WebGL
        contexts" -- which looks like a three bug and is not.
      */
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
