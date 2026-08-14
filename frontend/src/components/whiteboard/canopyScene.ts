/**
 * One orchard module, shaded by marching its leaf-area density.
 *
 * THE SECOND MODULE IN THIS APPLICATION THAT IMPORTS `three`. `boardScene.ts`
 * used to say it was the only one and its header now says otherwise. The two
 * are separate on purpose rather than by omission: the board is a stack of
 * textured planes with a picker, a gizmo and a fog, and this is a box with one
 * shader in it. Folding this into a 2000-line file that already carries a
 * different question would make both harder to read, and vite already routes
 * `three` to its own chunk, so a second importer costs nothing on the wire.
 *
 * WHAT IS DIFFERENT FROM THE BOARD, AND WHY. The board's canvas lives outside
 * the area tree and survives a workspace switch, because rebuilding a scene of
 * many textured planes on every switch would be felt. This one is created when
 * its area mounts and disposed when it unmounts. The scene is a box, a shader
 * and one 3D texture, so rebuilding it is cheap, and paying that instead means
 * the second WebGL context exists only while a canopy is actually on screen.
 * The webview caps live contexts and boardScene.ts:2012-2019 records what
 * happens when that budget is spent, so the cheaper of two scenes is the one
 * that should be transient.
 *
 * WHAT IS THE SAME, AND MUST BE. Render on demand with one coalesced frame,
 * Blender's middle-button navigation, damping that only works because the
 * controls' own change event re-enters render, a ResizeObserver on the host
 * rather than the window, a capped pixel ratio, and a disposal tail that ends
 * in forceContextLoss. Every one of those is copied deliberately; the comments
 * in boardScene say what breaks without each.
 *
 * THE SHADER IS NOT WRITTEN HERE. The march comes from `lib/canopyShader.ts`,
 * which is also what `scripts/check-canopy-shader.ts` runs against the numpy
 * implementation in a real WebGL 2 context. Composing the source rather than
 * restating it is the whole point: a copy of the march in this file would be a
 * third implementation, and nothing would compare it to anything.
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  Data3DTexture,
  FloatType,
  Mesh,
  MOUSE,
  NearestFilter,
  PerspectiveCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

import {
  CANOPY_MARCH_GLSL,
  CANOPY_UNIFORMS_GLSL,
  fieldToTextureOrder,
  type CanopyFieldMeta,
} from "@/lib/canopyShader"

/** What the caller can change without rebuilding the scene. */
export interface CanopyView {
  /** Direction to the sun, in the field's own metres. Normalised here. */
  sun: [number, number, number]
  /** Exposure of the shading, so a dark orchard can still be read. */
  gain: number
  /** Whether the ground plane carries the shadow or the volume is drawn. */
  mode: "shadow" | "volume"
}

export interface CanopyHandle {
  setField(field: CanopyFieldMeta, grid: Float32Array): void
  setView(view: CanopyView): void
  frame(): void
  dispose(): void
}

/**
 * The volume pass.
 *
 * `BackSide` so fragments are generated on the far face of the box and the ray
 * can start at the camera rather than at whatever the near plane clipped. The
 * march itself is the shared source; only the entry and the mapping to colour
 * are local.
 */
const VERTEX = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;

${CANOPY_UNIFORMS_GLSL}

uniform vec3 uSun;
uniform vec3 uCameraLocal;
uniform vec3 uExtent;      // module width, module width, canopy height
uniform vec3 uInk;
uniform vec3 uLit;
uniform float uGain;
uniform int uMode;         // 0 shadow on the ground, 1 the volume itself

varying vec3 vLocal;

${CANOPY_MARCH_GLSL}

/** Box local coordinates, which run -0.5..0.5, into field metres. */
vec3 toField(vec3 local) {
  return (local + 0.5) * uExtent;
}

void main() {
  if (uMode == 0) {
    // The floor of the orchard: how much direct light reaches each point.
    vec3 p = toField(vec3(vLocal.x, vLocal.z, -0.5));
    float tau = canopyTransmittance(vec3(p.x, p.y, 0.001), uSun);
    vec3 c = mix(uInk, uLit, clamp(tau * uGain, 0.0, 1.0));
    gl_FragColor = vec4(c, 1.0);
    return;
  }

  // The volume: march from the far face towards the camera, accumulating what
  // each cell blocks. Front-to-back so the loop can stop once opaque.
  vec3 exit = toField(vLocal);
  vec3 eye = toField(uCameraLocal);
  vec3 dir = normalize(exit - eye);
  float span = length(exit - eye);
  float stepLen = uCell;
  int steps = int(min(span / stepLen, float(${1024})));

  float alpha = 0.0;
  vec3 rgb = vec3(0.0);
  for (int k = 0; k < ${1024}; k++) {
    if (k >= steps || alpha > 0.99) break;
    vec3 q = eye + dir * ((float(k) + 0.5) * stepLen);
    if (q.z < 0.0 || q.z >= uZTop) continue;

    int ix = int(mod(q.x, uSpacing) / uCell) % uDims.x;
    int iy = int(mod(q.y, uSpacing) / uCell) % uDims.y;
    int iz = clamp(int(q.z / uCell), 0, uDims.z - 1);
    float density = texelFetch(uField, ivec3(ix, iy, iz), 0).r;
    if (density <= 0.0) continue;

    // What this cell blocks, and how lit it is from the sun's direction.
    float blocked = 1.0 - exp(-uG * density * stepLen);
    float tau = canopyTransmittance(q, uSun);
    vec3 c = mix(uInk, uLit, clamp(tau * uGain, 0.0, 1.0));

    rgb += (1.0 - alpha) * blocked * c;
    alpha += (1.0 - alpha) * blocked;
  }

  if (alpha < 0.004) discard;
  gl_FragColor = vec4(rgb / max(alpha, 1e-4), alpha);
}
`

/** Reads a CSS custom property as a linear colour three can use. */
function tokenColor(host: HTMLElement, name: string): Color {
  const raw = getComputedStyle(host).getPropertyValue(name).trim()
  const [r, g, b] = raw.split(/\s+/).map((v) => Number(v) / 255)
  return Number.isFinite(r) ? new Color(r, g, b) : new Color(0.1, 0.1, 0.1)
}

export function createCanopyScene(
  host: HTMLDivElement,
  opts: { view: CanopyView }
): CanopyHandle {
  let disposed = false
  let raf = 0
  const disposables: Array<{ dispose(): void }> = []

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  // Marching is fill-rate bound, so this is capped harder than the board's 2:
  // every extra device pixel is another few hundred texture fetches, and the
  // shading a reader is looking at is a smooth field rather than an edge.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(38, 1, 0.05, 400)
  camera.position.set(9, 7, 9)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)
  // Blender's bindings, which the studio already uses. Two navigation schemes
  // in one application is worse than either of them.
  const NAV_DEFAULT = { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null }
  const NAV_ZOOM = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: null }
  controls.mouseButtons = { ...NAV_DEFAULT }

  const geometry = new BoxGeometry(1, 1, 1)
  disposables.push(geometry)

  const material = new ShaderMaterial({
    // glslVersion is deliberately unset. three compiles a ShaderMaterial as
    // `#version 300 es` regardless, so sampler3D and texelFetch are available
    // and `precision highp sampler3D` is injected -- while gl_FragColor keeps
    // working. Setting GLSL3 removes the output declaration and the program
    // fails to link.
    uniforms: {
      uField: { value: null as Data3DTexture | null },
      uCell: { value: 0.3 },
      uSpacing: { value: 6 },
      uZTop: { value: 3 },
      uStepFrac: { value: 0.5 },
      uMaxPath: { value: 25 },
      uG: { value: 0.5 },
      uDims: { value: new Vector3(1, 1, 1) },
      uSun: { value: new Vector3(0.3, 0.2, 0.93) },
      uCameraLocal: { value: new Vector3() },
      uExtent: { value: new Vector3(6, 6, 3) },
      uInk: { value: tokenColor(host, "--p-ink") },
      uLit: { value: tokenColor(host, "--p-accent") },
      uGain: { value: 1 },
      uMode: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    transparent: true,
    depthWrite: false,
  })
  disposables.push(material)

  const mesh = new Mesh(geometry, material)
  scene.add(mesh)

  let fieldTexture: Data3DTexture | null = null
  let extent = new Vector3(6, 6, 3)

  const localEye = new Vector3()
  const render = () => {
    if (disposed || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      controls.update()
      // The march runs in the field's metres, so the camera has to arrive in
      // them too. Recomputed per frame because orbiting moves it.
      localEye.copy(camera.position)
      mesh.worldToLocal(localEye)
      material.uniforms.uCameraLocal.value.copy(localEye)
      renderer.render(scene, camera)
    })
  }
  controls.addEventListener("change", render)

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  // Without this the first frame draws at three's default 300x150 and the
  // camera frames an aspect of 1.
  resize()

  const onNavModifier = (e: KeyboardEvent) => {
    const zoom = e.ctrlKey || e.metaKey
    controls.mouseButtons = { ...(zoom ? NAV_ZOOM : NAV_DEFAULT) }
  }
  const onNavBlur = () => {
    controls.mouseButtons = { ...NAV_DEFAULT }
  }
  window.addEventListener("keydown", onNavModifier)
  window.addEventListener("keyup", onNavModifier)
  window.addEventListener("blur", onNavBlur)

  const onLost = (e: Event) => {
    e.preventDefault()
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
  const onRestored = () => resize()
  renderer.domElement.addEventListener("webglcontextlost", onLost)
  renderer.domElement.addEventListener("webglcontextrestored", onRestored)

  const frame = () => {
    // Far enough out that the whole module fits, from an angle that shows both
    // the canopy and the ground it shades.
    const reach = Math.max(extent.x, extent.z) * 1.9
    camera.position.set(reach, reach * 0.75, reach)
    controls.target.set(0, 0, 0)
    controls.update()
    render()
  }

  return {
    setField(field, grid) {
      if (disposed) return
      const ordered = fieldToTextureOrder(grid, field.n_xy, field.n_z)
      const texture = new Data3DTexture(ordered, field.n_xy, field.n_xy, field.n_z)
      texture.format = RedFormat
      texture.type = FloatType
      // NEAREST for the reason the board gives for class rasters, and for a
      // second one the gate measured: interpolating the field is not a
      // rounding difference, it moves transmittance by up to 4% and the march
      // would stop being the one the numpy side verified.
      texture.minFilter = NearestFilter
      texture.magFilter = NearestFilter
      texture.unpackAlignment = 1
      texture.needsUpdate = true

      fieldTexture?.dispose()
      fieldTexture = texture
      disposables.push(texture)

      material.uniforms.uField.value = texture
      material.uniforms.uCell.value = field.cell
      material.uniforms.uSpacing.value = field.spacing
      material.uniforms.uZTop.value = field.z_top
      material.uniforms.uDims.value.set(field.n_xy, field.n_xy, field.n_z)

      extent = new Vector3(field.spacing, field.spacing, field.z_top)
      material.uniforms.uExtent.value.copy(extent)
      // The box carries the module's own proportions, so a tall hedgerow does
      // not arrive looking like a cube of the same leaf area.
      mesh.scale.set(1, extent.z / extent.x, 1)
      frame()
    },

    setView(view) {
      if (disposed) return
      const [x, y, z] = view.sun
      material.uniforms.uSun.value.set(x, y, z).normalize()
      material.uniforms.uGain.value = view.gain
      material.uniforms.uMode.value = view.mode === "volume" ? 1 : 0
      render()
    },

    frame,

    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      observer.disconnect()
      controls.removeEventListener("change", render)
      controls.dispose()
      window.removeEventListener("keydown", onNavModifier)
      window.removeEventListener("keyup", onNavModifier)
      window.removeEventListener("blur", onNavBlur)
      renderer.domElement.removeEventListener("webglcontextlost", onLost)
      renderer.domElement.removeEventListener("webglcontextrestored", onRestored)
      for (const d of disposables) d.dispose()
      renderer.dispose()
      // Not optional. The webview caps live contexts and this one is created
      // and destroyed every time its area mounts, so an omitted release here
      // spends the budget within a dozen workspace switches.
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
