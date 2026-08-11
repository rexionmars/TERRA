/**
 * The isolate board's WebGL scene.
 *
 * THE ONLY MODULE IN THIS APPLICATION THAT IMPORTS `three`. Keeping it to one
 * file means the GL surface is one file to audit, and it is what lets the
 * button that opens the board stay out of the same module graph -- otherwise
 * opening the map screen would fetch half a megabyte to draw a 34 px button.
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
  Clock,
  Color,
  EdgesGeometry,
  Fog,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sphere,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import type { CardGroup, CardPlane } from "@/lib/isolateCards"
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

export interface BoardHandle {
  /** Redraw once. The board renders on demand, not in a permanent loop. */
  render: () => void
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
  setSelected: (groupId: string | null, id: string | null) => void
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
     * A plane was pressed.
     *
     * Fired on pointerdown, before any drag: pressing an object and then
     * moving it is one gesture in every editor built this way, and a selection
     * that waited for the release would make the first drag of a plane act on
     * whichever one happened to be selected before.
     */
    onSelect: (groupId: string, id: string) => void
    /**
     * Something was dragged, and where it came to rest.
     *
     * Reported rather than kept to the scene, because where things sit IS the
     * arrangement -- it is what a saved comparison is mostly made of, and a
     * position only three.js knew about could not be written down.
     */
    onMove: (
      groupId: string,
      /** The plane that moved, or null where the whole area did. */
      layerId: string | null,
      x: number,
      z: number
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
  const footPx =
    parseFloat(getComputedStyle(host).getPropertyValue("--map-foot")) || 0
  const viewHelper = new ViewHelper(camera, renderer.domElement)
  /*
    Bottom-right, and lifted clear of the foot.

    It was bottom-left, which is where the sidebar now is -- the helper drew
    into the canvas underneath it and was invisible. The right corner is free
    because the map's own controls went with the map, but the period track and
    the island still cross the bottom of the canvas, so the margin clears the
    reservation they are measured in.
  */
  viewHelper.location = { ...viewHelper.location, bottom: footPx + 12, right: 12 }
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
   * What the pointer is moving: an area, or one plane inside it.
   *
   * `mesh` null means the area. Both are held because a plane's position is
   * expressed relative to its area, so moving one needs the other.
   */
  let dragged: { rt: GroupRuntime; mesh: Mesh | null } | null = null

  const toPointer = (e: PointerEvent) => {
    const r = renderer.domElement.getBoundingClientRect()
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    )
  }

  const onPointerDown = (e: PointerEvent) => {
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
    if (!targets.length) return
    toPointer(e)
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(targets, false)
    if (!hits.length) return
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
    const hit = hits.reduce((best, h) =>
      h.distance <= nearest + 1e-3 && h.object.renderOrder > best.object.renderOrder
        ? h
        : best
    )
    const mesh = hit.object as Mesh
    // The area that was pressed is the one that moves. With one area on the
    // board this is the only area; with two it is the difference between
    // arranging them and dragging both at once.
    const rt = groupOfMesh.get(mesh)
    if (!rt) return
    const index = rt.meshes.indexOf(mesh)
    if (index >= 0) opts.onSelect(rt.id, rt.cards[index].id)
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

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
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
    dragged = null
    dragging = false
    controls.enabled = true
    renderer.domElement.releasePointerCapture(e.pointerId)
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown)
  renderer.domElement.addEventListener("pointermove", onPointerMove)
  renderer.domElement.addEventListener("pointercancel", endDrag)

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
  let raf = 0
  let disposed = false

  /**
   * Draw one frame, coalescing several requests in the same tick.
   *
   * On demand rather than a permanent loop: a desktop window that redraws an
   * unchanged scene sixty times a second spends battery to no effect. Damping
   * drives its own frames through the control's change event.
   */
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
  }

  /**
   * Which plane is outlined. Held here rather than passed in, because the
   * planes appear as their textures decode and a selection made before one
   * arrives has to survive until it does.
   */
  let selectedKey: string | null = null
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
  for (const rt of runtimes) {
  rt.cards.forEach((card, index) => {
    const order = drawIndex++
    loader.load(card.uri, (t) => {
      if (disposed) {
        t.dispose()
        return
      }
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
      mesh.position.set(card.x, heightOf(rt, index), card.z)
      mesh.renderOrder = order
      // Built whether or not it is shown, so hiding one later is a flag on an
      // existing plane rather than a different scene.
      mesh.visible = now?.visible ?? true
      rt.meshes[index] = mesh
      groupOfMesh.set(mesh, rt)
      rt.root.add(mesh)
      disposables.push(geometry, material, t)

      /*
        The selection outline, as a child so it inherits the plane's position,
        its rotation and every later move of the spread control without being
        told about any of them. Drawn after all the planes, so an outline is
        never buried under the raster of the layer above it.
      */
      const outline = new LineSegments(
        new EdgesGeometry(geometry),
        outlineMaterial
      )
      outline.renderOrder = totalPlanes + order
      outline.visible = selectedKey === planeKey(rt.id, card.id)
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
      }
      render()
    })
  })
  }

  return {
    render,
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
    setSelected(groupId, id) {
      const next = groupId && id ? planeKey(groupId, id) : null
      if (next === selectedKey) return
      selectedKey = next
      for (const rt of runtimes) {
        rt.meshes.forEach((mesh, i) => {
          // Its own outline is the only child a plane has.
          const outline = mesh?.children[0]
          if (!mesh || !outline) return
          outline.visible = planeKey(rt.id, rt.cards[i].id) === next
        })
      }
      render()
    },
    setPlanePosition(groupId, layerId, x, z) {
      const rt = runtimes.find((r) => r.id === groupId)
      const i = rt?.indexById.get(layerId)
      const mesh = rt && i !== undefined ? rt.meshes[i] : null
      if (!mesh || (mesh.position.x === x && mesh.position.z === z)) return
      mesh.position.x = x
      mesh.position.z = z
      render()
    },
    setGroupPosition(groupId, x, z) {
      const rt = runtimes.find((r) => r.id === groupId)
      if (!rt || (rt.root.position.x === x && rt.root.position.z === z)) return
      rt.root.position.x = x
      rt.root.position.z = z
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
      if (changed) render()
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      controls.removeEventListener("change", render)
      controls.dispose()
      renderer.domElement.removeEventListener("pointerdown", onPointerDown)
      renderer.domElement.removeEventListener("pointermove", onPointerMove)
      renderer.domElement.removeEventListener("pointercancel", endDrag)
      renderer.domElement.removeEventListener("pointerup", onPointerUp)
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
