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
import type { CardPlane } from "@/lib/isolateCards"
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
  id: string
  opacity: number
  visible: boolean
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
  setSelected: (id: string | null) => void
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
    cards: CardPlane[]
    background: string
    /** --p-line, for the grid. */
    line: string
    /** --p-accent, for the selected plane's outline. */
    accent: string
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
    onSelect: (id: string) => void
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
    const targets = meshes.filter((m): m is Mesh => !!m && m.visible)
    if (!targets.length) return
    toPointer(e)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObjects(targets, false)[0]
    if (!hit) return
    const index = meshes.indexOf(hit.object as Mesh)
    if (index >= 0) opts.onSelect(opts.cards[index].id)
    // The plane the drag runs on passes through the stack's current height, so
    // the grab point does not jump to y=0 on the first move.
    dragPlane.constant = -stack.position.y
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return
    grabOffset.copy(stack.position).sub(hitPoint)
    dragging = true
    controls.enabled = false
    renderer.domElement.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    toPointer(e)
    raycaster.setFromCamera(pointer, camera)
    if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return
    stack.position.x = hitPoint.x + grabOffset.x
    stack.position.z = hitPoint.z + grabOffset.z
    render()
  }

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return
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
    One group for every raster, so the stack moves as one object. That is also
    what makes the next step -- a second analysis beside this one -- an added
    group rather than a rewrite.
  */
  const stack = new Group()
  scene.add(stack)
  const loader = new TextureLoader()
  let pending = opts.cards.length

  /*
    Held in the cards' own order rather than read back from stack.children.

    Textures load asynchronously, so the children arrive in whatever order the
    decoder finishes -- which is not the stack order. Indexing that array by
    position, as setGap did, assigned the wrong height to each plane the first
    time the spread was moved, silently reordering the stack.
  */
  const meshes: (Mesh | null)[] = opts.cards.map(() => null)
  const indexById = new Map(opts.cards.map((c, i) => [c.id, i]))

  /**
   * Which plane is outlined. Held here rather than passed in, because the
   * planes appear as their textures decode and a selection made before one
   * arrives has to survive until it does.
   */
  let selectedId: string | null = null
  /*
    The one place a plane's state lives. Seeded from the caller and updated by
    setAppearance; the mesh reads it when it is created and whenever it is
    changed. Two paths to the same property is what produced the fault this
    replaces: the card said one thing, the handle said another, and whichever
    ran last won.
  */
  const state = new Map<string, PlaneState>(
    opts.appearance.map((a) => [a.id, a])
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

  opts.cards.forEach((card, index) => {
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
      const now = state.get(card.id)
      const material = new MeshBasicMaterial({
        map: t,
        transparent: true,
        opacity: now?.opacity ?? 1,
        depthWrite: false,
      })
      const mesh = new Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(card.x, card.y, card.z)
      mesh.renderOrder = index
      // Built whether or not it is shown, so hiding one later is a flag on an
      // existing plane rather than a different scene.
      mesh.visible = now?.visible ?? true
      meshes[index] = mesh
      stack.add(mesh)
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
      outline.renderOrder = opts.cards.length + index
      outline.visible = card.id === selectedId
      mesh.add(outline)
      disposables.push(outline.geometry)

      if (--pending === 0) {
        // Framed once every plane is placed, or the first to arrive would set
        // the distance and the rest would fall outside it.
        const box = new Box3().setFromObject(stack)
        const sphere = box.getBoundingSphere(new Sphere())
        stack.position.y = -sphere.center.y
        addGround(sphere.radius)
        frame(sphere.radius)
      }
      render()
    })
  })

  return {
    render,
    setGap(gap: number) {
      // Card order, not the layer's ordering number: even spacing however far
      // apart those numbers happen to be. Hidden planes keep their slot, so
      // showing one again puts it back where the stack left a space for it.
      meshes.forEach((mesh, i) => {
        if (mesh) mesh.position.y = i * gap
      })
      render()
    },
    setSelected(id) {
      if (id === selectedId) return
      selectedId = id
      for (const mesh of meshes) {
        // Its own outline is the only child a plane has.
        const outline = mesh?.children[0]
        if (!mesh || !outline) continue
        const index = meshes.indexOf(mesh)
        outline.visible = opts.cards[index].id === id
      }
      render()
    },
    setAppearance(next) {
      let changed = false
      for (const c of next) {
        // Recorded whether or not the plane exists yet: a texture still
        // decoding will read this when it lands.
        state.set(c.id, c)
        const i = indexById.get(c.id)
        const mesh = i === undefined ? null : meshes[i]
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
