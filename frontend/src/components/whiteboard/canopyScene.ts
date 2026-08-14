/**
 * One orchard module, shaded by marching its leaf-area density.
 *
 * ONE OF TWO MODULES IN THIS APPLICATION THAT IMPORT `three`; the other is
 * boardScene.ts. The two are separate on purpose rather than by omission: that
 * file is a stack of textured planes with a picker, a gizmo and a fog, and this
 * is a floor and a box with a ray-march in it. Folding this into a 2000-line
 * file that already carries a different question would make both harder to
 * read, and vite already routes `three` to its own chunk, so a second importer
 * costs nothing on the wire.
 *
 * WHAT IS DIFFERENT FROM THE BOARD, AND WHY. The board's canvas lives outside
 * the area tree and survives a workspace switch, because rebuilding a scene of
 * many textured planes on every switch would be felt. This one is created when
 * its area mounts and disposed when it unmounts. The scene is a plane, a box
 * and one 3D texture, so rebuilding it is cheap, and paying that instead means
 * the second WebGL context exists only while a canopy is actually on screen.
 *
 * GEOMETRY IS IN METRES, NOT IN A SCALED UNIT CUBE.
 *
 * The first version built a 1x1x1 box, scaled it to the module's proportions,
 * and derived field coordinates from the vertex's local position. That was
 * wrong in a way that rendered rather than raised: the ground shading was
 * computed for every fragment of the box regardless of which face it sat on, so
 * all six walls were painted with the floor's own pattern, and with `BackSide`
 * and no depth write what a reader saw was the inside of a box repeating the
 * shadow on every surface.
 *
 * So the mapping is now stated once and holds everywhere:
 *
 *     field.x = world.x + spacing/2      the module spans [-s/2, s/2] in x
 *     field.y = world.z + spacing/2      and in z, centred on the origin
 *     field.z = world.y                  three's up is the field's height
 *
 * The floor is a plane at world y = 0 and the canopy is a box sitting on it.
 * A fragment's field position comes from its world position, so a shader cannot
 * accidentally shade one surface with another's answer.
 *
 * THE MARCH IS NOT WRITTEN HERE. It comes from `lib/canopyShader.ts`, which is
 * also what `scripts/check-canopy-shader.ts` runs against the numpy engine in a
 * real WebGL 2 context. Composing that source rather than restating it is the
 * point: a copy of the march in this file would be a third implementation, and
 * nothing would compare it to anything.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Data3DTexture,
  DoubleSide,
  FloatType,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MOUSE,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
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
  CANOPY_WORLD_GLSL,
  fieldToTextureOrder,
  type CanopyFieldMeta,
} from "@/lib/canopyShader"

/** What the caller can change without rebuilding the scene. */
export interface CanopyView {
  /** Direction to the sun, in the field's own frame. Normalised here. */
  sun: [number, number, number]
  /** Exposure of the shading, so a dark orchard can still be read. */
  gain: number
  /** Whether the canopy volume is drawn over the floor it shades. */
  mode: "shadow" | "volume"
}

export interface CanopyHandle {
  setField(field: CanopyFieldMeta, grid: Float32Array): void
  setView(view: CanopyView): void
  frame(): void
  dispose(): void
}

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const COMMON_GLSL = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;

${CANOPY_UNIFORMS_GLSL}

uniform vec3 uEye;
uniform vec3 uShade;
uniform vec3 uLit;
uniform float uGain;

varying vec3 vWorld;

${CANOPY_MARCH_GLSL}
${CANOPY_WORLD_GLSL}

/**
 * Transmittance to colour, the same on both passes so they agree.
 *
 * uShade is NOT the studio's background. It was, and full shade then came out
 * the same colour as the void behind the scene -- so a correct shadow covering
 * a third of the floor read as a hole in it, and the orchard looked like a
 * broken polygon rather than a lit one. A shaded ground is ground.
 */
vec3 shade(float tau) {
  return mix(uShade, uLit, clamp(tau * uGain, 0.0, 1.0));
}
`

/**
 * The floor: how much direct light reaches each point of the orchard ground.
 *
 * Opaque and depth-writing, so it occludes the volume behind it and the
 * transparent pass can be depth-tested against it.
 */
const GROUND_FRAGMENT = /* glsl */ `
${COMMON_GLSL}

void main() {
  gl_FragColor = vec4(shade(groundTransmittance(vWorld)), 1.0);
}
`

/**
 * The canopy itself: leaf-area density, each cell lit by what reaches it.
 *
 * `BackSide` so a fragment is generated on the far wall of the box and the ray
 * can run from the eye to it, which is front-to-back and lets the loop stop
 * once the accumulated opacity leaves nothing to add.
 */
const VOLUME_FRAGMENT = /* glsl */ `
${COMMON_GLSL}

const int MAX_VOLUME_STEPS = 512;

void main() {
  vec3 exitField = toField(vWorld);
  vec3 eyeField = toField(uEye);
  vec3 dir = normalize(exitField - eyeField);
  float span = length(exitField - eyeField);
  float stepLen = uCell;
  int steps = int(min(span / stepLen, float(MAX_VOLUME_STEPS)));

  float alpha = 0.0;
  vec3 rgb = vec3(0.0);
  for (int k = 0; k < MAX_VOLUME_STEPS; k++) {
    if (k >= steps || alpha > 0.99) break;
    vec3 q = eyeField + dir * ((float(k) + 0.5) * stepLen);
    // Above the canopy or below the ground there is nothing to accumulate.
    // Horizontally there always is: the orchard is periodic, so a sample
    // outside the module belongs to the neighbouring tree.
    if (q.z < 0.0 || q.z >= uZTop) continue;

    int ix = int(mod(q.x, uSpacing) / uCell) % uDims.x;
    int iy = int(mod(q.y, uSpacing) / uCell) % uDims.y;
    int iz = clamp(int(q.z / uCell), 0, uDims.z - 1);
    float density = texelFetch(uField, ivec3(ix, iy, iz), 0).r;
    if (density <= 0.0) continue;

    float blocked = 1.0 - exp(-uG * density * stepLen);
    rgb += (1.0 - alpha) * blocked * shade(canopyTransmittance(q, uSun));
    alpha += (1.0 - alpha) * blocked;
  }

  // Nothing was in the way. Discarding rather than drawing a clear pixel keeps
  // the gaps between crowns actually empty.
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(rgb / max(alpha, 1e-4), alpha);
}
`

/** Reads a CSS custom property as a colour three can use. */
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
  // every extra device pixel is another few hundred texture fetches, and what
  // a reader is looking at is a smooth field rather than an edge.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  host.appendChild(renderer.domElement)

  const scene = new Scene()
  const camera = new PerspectiveCamera(38, 1, 0.05, 500)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  // The orchard is seen from above; there is nothing under the ground.
  controls.maxPolarAngle = Math.PI * 0.49
  // Blender's bindings, which the studio already uses. Two navigation schemes
  // in one application is worse than either of them.
  const NAV_DEFAULT = { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null }
  const NAV_ZOOM = { LEFT: null, MIDDLE: MOUSE.DOLLY, RIGHT: null }
  controls.mouseButtons = { ...NAV_DEFAULT }

  // One uniforms object for both passes, so the floor and the canopy above it
  // can never be shaded from different states of the same field.
  const uniforms = {
    uField: { value: null as Data3DTexture | null },
    uCell: { value: 0.3 },
    uSpacing: { value: 6 },
    uZTop: { value: 3 },
    uStepFrac: { value: 0.5 },
    uMaxPath: { value: 25 },
    uG: { value: 0.5 },
    uDims: { value: new Vector3(1, 1, 1) },
    uSun: { value: new Vector3(0.3, 0.2, 0.93) },
    uEye: { value: new Vector3() },
    uShade: { value: tokenColor(host, "--p-surface-raised") },
    uLit: { value: tokenColor(host, "--p-accent") },
    uGain: { value: 1 },
  }

  const groundMaterial = new ShaderMaterial({
    // glslVersion is deliberately unset. three compiles a ShaderMaterial as
    // `#version 300 es` regardless, so sampler3D and texelFetch are available
    // and `precision highp sampler3D` is injected -- while gl_FragColor keeps
    // working. Setting GLSL3 removes the output declaration and it fails to
    // link.
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: GROUND_FRAGMENT,
    side: DoubleSide,
  })
  const volumeMaterial = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: VOLUME_FRAGMENT,
    side: BackSide,
    transparent: true,
    depthWrite: false,
  })
  disposables.push(groundMaterial, volumeMaterial)

  /*
    The module's own outline.

    Without it the floor has no stated extent, and since a fully shaded patch
    is dark, a reader cannot tell a shadow from the edge of the ground. The
    orchard is periodic, so this square is not a boundary of the world -- it is
    the one module that repeats, which is exactly what a reader has to know to
    read the wrap at the edges.
  */
  const edgeMaterial = new LineBasicMaterial({
    color: tokenColor(host, "--p-line-strong"),
    transparent: true,
    opacity: 0.55,
  })
  disposables.push(edgeMaterial)
  let edges: LineSegments | null = null

  // Replaced whenever the module's size changes, since both are in metres.
  let groundMesh: Mesh | null = null
  let volumeMesh: Mesh | null = null
  let spacing = 6
  let zTop = 3

  const buildGeometry = () => {
    if (groundMesh) {
      scene.remove(groundMesh)
      groundMesh.geometry.dispose()
    }
    if (volumeMesh) {
      scene.remove(volumeMesh)
      volumeMesh.geometry.dispose()
    }

    const ground = new PlaneGeometry(spacing, spacing)
    ground.rotateX(-Math.PI / 2)
    groundMesh = new Mesh(ground, groundMaterial)
    scene.add(groundMesh)

    if (edges) {
      scene.remove(edges)
      edges.geometry.dispose()
    }
    const h = spacing / 2
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]]
    const line: number[] = []
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]
      const [bx, bz] = corners[(i + 1) % 4]
      line.push(ax, 0, az, bx, 0, bz)          // the footprint
      line.push(ax, 0, az, ax, zTop, az)       // and its height, so the box is legible
      line.push(ax, zTop, az, bx, zTop, bz)
    }
    const edgeGeometry = new BufferGeometry()
    edgeGeometry.setAttribute("position", new BufferAttribute(new Float32Array(line), 3))
    edges = new LineSegments(edgeGeometry, edgeMaterial)
    scene.add(edges)

    const box = new BoxGeometry(spacing, zTop, spacing)
    // Sitting on the floor rather than centred on it, so world y is the
    // field's height directly and the mapping needs no offset.
    box.translate(0, zTop / 2, 0)
    volumeMesh = new Mesh(box, volumeMaterial)
    volumeMesh.visible = opts.view.mode === "volume"
    scene.add(volumeMesh)
  }

  let fieldTexture: Data3DTexture | null = null

  const render = () => {
    if (disposed || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      controls.update()
      // The march runs in the field's metres, so the eye has to arrive in them
      // too. Recomputed per frame because orbiting moves it.
      uniforms.uEye.value.copy(camera.position)
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
    // Far enough that the module fits, from an angle that shows both the
    // canopy and the ground it shades.
    const reach = Math.max(spacing, zTop * 2) * 1.25
    camera.position.set(reach, reach * 0.7, reach)
    controls.target.set(0, zTop * 0.35, 0)
    controls.update()
    render()
  }

  buildGeometry()
  frame()

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

      uniforms.uField.value = texture
      uniforms.uCell.value = field.cell
      uniforms.uSpacing.value = field.spacing
      uniforms.uZTop.value = field.z_top
      uniforms.uDims.value.set(field.n_xy, field.n_xy, field.n_z)

      const changed = spacing !== field.spacing || zTop !== field.z_top
      spacing = field.spacing
      zTop = field.z_top
      if (changed) {
        buildGeometry()
        frame()
      } else {
        render()
      }
    },

    setView(view) {
      if (disposed) return
      const [x, y, z] = view.sun
      uniforms.uSun.value.set(x, y, z).normalize()
      uniforms.uGain.value = view.gain
      if (volumeMesh) volumeMesh.visible = view.mode === "volume"
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
      groundMesh?.geometry.dispose()
      volumeMesh?.geometry.dispose()
      edges?.geometry.dispose()
      fieldTexture?.dispose()
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
