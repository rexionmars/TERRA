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
  Fog,
  GridHelper,
  Group,
  type LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Sphere,
  SRGBColorSpace,
  TextureLoader,
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

export interface BoardHandle {
  /** Redraw once. The board renders on demand, not in a permanent loop. */
  render: () => void
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
  const viewHelper = new ViewHelper(camera, renderer.domElement)
  // left wins over right and bottom over top when the pair is set, per the
  // helper's own rule, so the corner is chosen by which two are given.
  viewHelper.location = { ...viewHelper.location, bottom: 12, left: 12 }
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

  const onPointerUp = (e: PointerEvent) => {
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

  for (const card of opts.cards) {
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
      const material = new MeshBasicMaterial({
        map: t,
        transparent: true,
        opacity: card.opacity,
        depthWrite: false,
      })
      const mesh = new Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(card.x, card.y, card.z)
      mesh.renderOrder = opts.cards.indexOf(card)
      stack.add(mesh)
      disposables.push(geometry, material, t)

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
  }

  return {
    render,
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      controls.removeEventListener("change", render)
      controls.dispose()
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
