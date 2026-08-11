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
  Color,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  WebGLRenderer,
  type Texture,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

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
  opts: { textureUri: string; background: string }
): BoardHandle {
  const renderer = new WebGLRenderer({ antialias: true })
  // An uncapped ratio on a 3x display renders a full-window canvas at nine
  // times the pixels for a difference nobody can see on a flat raster.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  scene.background = new Color(opts.background)

  const camera = new PerspectiveCamera(45, 1, 0.1, 1000)
  // Not top-down at entry. A plan view is indistinguishable from the map the
  // board replaced, so opening there would leave the user unsure anything
  // happened; the tilt is what says the surface has a third axis.
  camera.position.set(-0.9, 1.3, 1.2)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = false
  // Never under the board: from below you see the backs of the planes and the
  // stack order reverses on screen, which reads as a rendering fault rather
  // than as a point of view. Straight down is allowed -- that is the map view.
  controls.maxPolarAngle = Math.PI / 2 - 0.05

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
      renderer.render(scene, camera)
    })
  }
  controls.addEventListener("change", render)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
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

  let texture: Texture | null = null
  new TextureLoader().load(opts.textureUri, (t) => {
    if (disposed) {
      t.dispose()
      return
    }
    texture = t
    t.colorSpace = SRGBColorSpace
    /*
      Nearest, not linear. The same rule as .overlay-crisp in index.css:
      bilinear interpolation across a class raster invents colours between two
      classes that correspond to no class at all, and the legend stops matching
      the pixels. It also makes the non-power-of-two question moot.
    */
    t.magFilter = NearestFilter
    t.minFilter = NearestFilter
    t.generateMipmaps = false

    const aspect = t.image.width / t.image.height || 1
    const geometry = new PlaneGeometry(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1)
    /*
      Unlit. These rasters are data, not surfaces: any lighting model would
      multiply the class colours by a light term and the legend would stop
      matching what is drawn.
    */
    const material = new MeshBasicMaterial({ map: t, transparent: true })
    const mesh = new Mesh(geometry, material)
    // Flat in the XZ plane, like a sheet on a light table.
    mesh.rotation.x = -Math.PI / 2
    scene.add(mesh)
    disposables.push(geometry, material, t)
    render()
  })

  return {
    render,
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      controls.removeEventListener("change", render)
      controls.dispose()
      renderer.domElement.removeEventListener("webglcontextlost", onLost)
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored)
      for (const d of disposables) d.dispose()
      texture?.dispose()
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
