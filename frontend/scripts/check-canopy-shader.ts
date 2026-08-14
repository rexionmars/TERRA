/**
 * Fails when the GLSL canopy march stops agreeing with the numpy one.
 *
 * The handoff that asked for this shader made it a gate: "if the shader does
 * not reproduce analytic Beer-Lambert, it does not advance". This is that gate,
 * made executable. It builds a field with sidecar/canopy_field.py, asks the
 * numpy march for the transmittance at a few hundred point-and-sun pairs, then
 * runs src/lib/canopyShader.ts in a real WebGL 2 context and compares.
 *
 * Both sides are generated on the run, like scripts/check-contrast.ts reads
 * index.css rather than a copy of it. Nothing here is a committed fixture, so
 * nothing here can go stale: change the Python march and this fails; change the
 * GLSL and this fails; change both consistently and it passes, which is the
 * only case that should.
 *
 * WHY A BROWSER. The shader is the artefact under test, so running a
 * transliteration of it in TypeScript would test the transliteration. Chrome
 * runs headless with WebGL 2 and float render targets, prints the page back
 * with --dump-dom, and is already on every machine that develops this. That
 * costs no dependency: the repository has no test runner and no browser
 * automation, and this deliberately adds neither.
 *
 *   cd frontend && npx tsx scripts/check-canopy-shader.ts
 *
 * Set TERRA_PYTHON to pick the interpreter and CHROME to pick the browser.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

import {
  VERIFY_FRAGMENT_GLSL,
  VERIFY_GROUND_FRAGMENT_GLSL,
  FULLSCREEN_VERTEX_GLSL,
  fieldToTextureOrder,
  type CanopyFieldMeta,
  type CanopyReference,
} from "../src/lib/canopyShader"

const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, "..", "..")
const SIDECAR = join(REPO, "sidecar")

/** Fields to check. Each is a separate Python run and a separate draw. */
const CASES = [
  {
    name: "orchard, 6 m spacing, 30 cm cells",
    request: { spacing: 6.0, lai: 2.0, cell: 0.3, crown_a: 1.8, crown_b: 1.2, crown_z: 1.6 },
  },
  {
    // Finer cells and a wider crown: the crown now overlaps its own periodic
    // images, so rays wrap through leaf area rather than through empty module.
    name: "closed canopy, 4 m spacing, 16 cm cells",
    request: { spacing: 4.0, lai: 3.5, cell: 0.16, crown_a: 2.4, crown_b: 1.0, crown_z: 1.4 },
  },
  {
    // Coarse cells make each step optically thick, which is where a
    // half-cell sampling offset would show up largest.
    name: "sparse orchard, 8 m spacing, 50 cm cells",
    request: { spacing: 8.0, lai: 1.0, cell: 0.5, crown_a: 2.0, crown_b: 1.6, crown_z: 2.0 },
  },
  {
    // A row crop, which is what this application classifies. Very different
    // proportions from the orchard cases -- a half-metre module instead of six
    // -- so the periodic wrap is crossed many times per ray rather than once.
    name: "soy rows, 0.5 m spacing, 5 cm cells",
    request: { source: "rows", spacing: 0.5, lai: 3.0, cell: 0.05, height: 0.9, row_width_frac: 0.6 },
  },
  {
    // The degenerate case: the strip fills the module, so the field is a
    // uniform slab and the march has an answer in closed form. If the shader
    // reproduces numpy here it also reproduces analytic Beer-Lambert, which is
    // the condition the handoff set for this shader existing at all.
    name: "uniform slab (rows at full width)",
    request: { source: "rows", spacing: 0.5, lai: 3.0, cell: 0.05, height: 0.9, row_width_frac: 1.0 },
  },
  {
    // Just inside the step budget: 1.2 cm cells under 3 m of canopy need about
    // 2000 of the 2048 steps the shader runs.
    //
    // The first three cases all sit two orders below the cap, so they could not
    // have caught the shader silently stopping short -- and it did, by 7e-2, on
    // a slightly finer field than this. A parity check whose cases never
    // approach a bound does not test the bound.
    name: "fine hedgerow, 1 m spacing, 1.25 cm cells (1925 of 2048 steps)",
    request: { spacing: 1.0, lai: 3.0, cell: 0.0125, crown_a: 0.5, crown_b: 1.4, crown_z: 1.6 },
  },
]

// ---------------------------------------------------------------------------
// The two sides
// ---------------------------------------------------------------------------

function resolvePython(): string {
  if (process.env.TERRA_PYTHON) return process.env.TERRA_PYTHON
  for (const candidate of [
    join(REPO, "..", ".venv", "bin", "python"),
    join(REPO, ".venv", "bin", "python"),
    "python3",
  ]) {
    try {
      execFileSync(candidate, ["-c", "import numpy"], { stdio: "ignore" })
      return candidate
    } catch {
      /* try the next one */
    }
  }
  throw new Error(
    "No interpreter with numpy. Set TERRA_PYTHON to one that can import the sidecar."
  )
}

interface PythonSide {
  field: CanopyFieldMeta & { path: string }
  reference: CanopyReference
  grid: Float32Array
}

/**
 * Run the real `canopy_field` action, not the library behind it.
 *
 * Going through sidecar/infer.py means the grid the shader marches is the one
 * the application writes, byte for byte. That matters for one failure the Go
 * side cannot catch: its guard compares the file length against the cell count,
 * and a transposed write preserves the length under any permutation of axes. A
 * canopy rotated into its own depth axis passes every check on the boundary and
 * renders as a plausible canopy that is wrong at every point -- but it cannot
 * survive this comparison, because the numpy transmittances come from the
 * untransposed field and the shader would be marching a different one.
 */
function numpySide(python: string, request: object): PythonSide {
  const workDir = mkdtempSync(join(tmpdir(), "terra-field-"))
  try {
    const payload = JSON.stringify({ ...request, action: "canopy_field", work_dir: workDir })
    const out = execFileSync(python, [join(SIDECAR, "infer.py")], {
      input: payload,
      maxBuffer: 256 * 1024 * 1024,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    })
    const parsed = JSON.parse(out).canopy_field
    const bytes = readFileSync(parsed.field.path)
    return {
      field: parsed.field,
      reference: parsed.reference,
      grid: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function resolveChrome(): string {
  if (process.env.CHROME) return process.env.CHROME
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
  for (const c of candidates) if (existsSync(c)) return c
  throw new Error(
    "No Chrome or Chromium found. Set CHROME to a binary that runs headless with WebGL 2."
  )
}

/** The page that runs the shader. Kept in one template so the GLSL it uses is
 *  literally the exported source, not a paraphrase of it. */
function page(side: PythonSide): string {
  const { n_xy, n_z } = side.field
  const textureOrder = fieldToTextureOrder(side.grid, n_xy, n_z)
  const payload = {
    field: side.field,
    reference: side.reference,
    grid: Buffer.from(textureOrder.buffer).toString("base64"),
  }

  return `<!doctype html><meta charset="utf-8"><pre id="out">pending</pre>
<script id="payload" type="application/json">${JSON.stringify(payload)}</script>
<script type="module">
const out = document.getElementById("out")
const fail = (m) => { out.textContent = JSON.stringify({ error: String(m) }) }
try {
  const P = JSON.parse(document.getElementById("payload").textContent)
  const F = P.field, R = P.reference
  const nPoints = R.points.length, nSuns = R.suns.length

  const bin = atob(P.grid)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const field = new Float32Array(bytes.buffer)

  const canvas = document.createElement("canvas")
  canvas.width = nPoints; canvas.height = nSuns
  const gl = canvas.getContext("webgl2", { antialias: false })
  if (!gl) throw new Error("no webgl2 context")
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("no EXT_color_buffer_float")

  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("shader: " + gl.getShaderInfoLog(s))
    return s
  }
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, ${JSON.stringify(
    "#version 300 es\n" + FULLSCREEN_VERTEX_GLSL
  )}))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, ${JSON.stringify(
    "#version 300 es\n" + VERIFY_FRAGMENT_GLSL
  )}))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error("link: " + gl.getProgramInfoLog(prog))

  // The second pass drives toField, which the scattered points cannot reach:
  // a consumer comparing against those is handed field coordinates and never
  // performs the mapping. That mapping is what the scene gets wrong when the
  // picture is smooth and wrong everywhere.
  const groundProg = gl.createProgram()
  gl.attachShader(groundProg, compile(gl.VERTEX_SHADER, ${JSON.stringify(
    "#version 300 es\n" + FULLSCREEN_VERTEX_GLSL
  )}))
  gl.attachShader(groundProg, compile(gl.FRAGMENT_SHADER, ${JSON.stringify(
    "#version 300 es\n" + VERIFY_GROUND_FRAGMENT_GLSL
  )}))
  gl.linkProgram(groundProg)
  if (!gl.getProgramParameter(groundProg, gl.LINK_STATUS))
    throw new Error("ground link: " + gl.getProgramInfoLog(groundProg))

  gl.useProgram(prog)

  // The field, as a single-channel float volume. NEAREST because texelFetch
  // ignores filtering but an incomplete texture would still read as zero.
  const vol = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_3D, vol)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R32F, F.n_xy, F.n_xy, F.n_z)
  gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, F.n_xy, F.n_xy, F.n_z,
                   gl.RED, gl.FLOAT, field)

  const rgba32f = (unit, w, h, values) => {
    const t = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, values)
    return t
  }
  const pts = new Float32Array(nPoints * 4)
  R.points.forEach((p, i) => { pts[i*4] = p[0]; pts[i*4+1] = p[1]; pts[i*4+2] = p[2] })
  rgba32f(1, nPoints, 1, pts)
  const dirs = new Float32Array(nSuns * 4)
  R.suns.forEach((s, i) => { dirs[i*4] = s.direction[0]; dirs[i*4+1] = s.direction[1]; dirs[i*4+2] = s.direction[2] })
  rgba32f(2, nSuns, 1, dirs)

  const u = (n) => gl.getUniformLocation(prog, n)
  gl.uniform1i(u("uField"), 0)
  gl.uniform1i(u("uPoints"), 1)
  gl.uniform1i(u("uDirections"), 2)
  gl.uniform1f(u("uCell"), F.cell)
  gl.uniform1f(u("uSpacing"), F.spacing)
  gl.uniform1f(u("uZTop"), F.z_top)
  gl.uniform1f(u("uStepFrac"), R.step_frac)
  gl.uniform1f(u("uMaxPath"), R.max_path)
  gl.uniform1f(u("uG"), R.g_leaf)
  gl.uniform3i(u("uDims"), F.n_xy, F.n_xy, F.n_z)

  // Float target, so the answers come back as the numbers the shader computed
  // rather than quantised to 1/255 -- which would be coarser than the bar.
  const target = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + 3)
  gl.bindTexture(gl.TEXTURE_2D, target)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, nPoints, nSuns)
  const fb = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error("float framebuffer incomplete")

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(
    [-1,-1,0, 3,-1,0, -1,3,0]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, "position")
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)

  gl.viewport(0, 0, nPoints, nSuns)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const pixels = new Float32Array(nPoints * nSuns * 4)
  gl.readPixels(0, 0, nPoints, nSuns, gl.RGBA, gl.FLOAT, pixels)
  const err = gl.getError()
  if (err !== gl.NO_ERROR) throw new Error("gl error " + err)

  const shader = R.suns.map((_, y) =>
    Array.from({ length: nPoints }, (_, x) => pixels[(y * nPoints + x) * 4]))

  // --- the ground pass, one draw per sun over an n by n grid of the module ---
  const gN = R.ground.n
  const gTarget = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + 4)
  gl.bindTexture(gl.TEXTURE_2D, gTarget)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, gN, gN)
  const gFb = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, gFb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gTarget, 0)
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error("ground framebuffer incomplete")

  gl.useProgram(groundProg)
  const gu = (n) => gl.getUniformLocation(groundProg, n)
  gl.uniform1i(gu("uField"), 0)
  gl.uniform1f(gu("uCell"), F.cell)
  gl.uniform1f(gu("uSpacing"), F.spacing)
  gl.uniform1f(gu("uZTop"), F.z_top)
  gl.uniform1f(gu("uStepFrac"), R.step_frac)
  gl.uniform1f(gu("uMaxPath"), R.max_path)
  gl.uniform1f(gu("uG"), R.g_leaf)
  gl.uniform3i(gu("uDims"), F.n_xy, F.n_xy, F.n_z)
  gl.uniform1i(gu("uSamples"), gN)
  const gLoc = gl.getAttribLocation(groundProg, "position")
  gl.enableVertexAttribArray(gLoc)
  gl.vertexAttribPointer(gLoc, 3, gl.FLOAT, false, 0, 0)
  gl.viewport(0, 0, gN, gN)

  const ground = R.ground.suns.map((s) => {
    gl.uniform3f(gu("uSun"), s.direction[0], s.direction[1], s.direction[2])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    const px = new Float32Array(gN * gN * 4)
    gl.readPixels(0, 0, gN, gN, gl.RGBA, gl.FLOAT, px)
    // Row-major over (i, j) with i along x, the order the field builder emits.
    return Array.from({ length: gN * gN }, (_, k) => {
      const i = k / gN | 0, j = k % gN
      return px[(j * gN + i) * 4]
    })
  })

  const err2 = gl.getError()
  if (err2 !== gl.NO_ERROR) throw new Error("gl error in the ground pass " + err2)

  out.textContent = JSON.stringify({
    renderer: gl.getParameter(gl.RENDERER),
    shader,
    ground,
  })
} catch (e) { fail(e && e.message ? e.message : e) }
</script>`
}

function shaderSide(
  chrome: string,
  html: string
): { renderer: string; shader: number[][]; ground: number[][] } {
  const dir = mkdtempSync(join(tmpdir(), "terra-canopy-"))
  const file = join(dir, "check.html")
  writeFileSync(file, html)
  try {
    const dom = execFileSync(
      chrome,
      [
        "--headless",
        "--disable-gpu-sandbox",
        "--enable-unsafe-swiftshader",
        "--allow-file-access-from-files",
        "--dump-dom",
        `file://${file}`,
      ],
      { maxBuffer: 512 * 1024 * 1024, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    )
    const match = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)
    if (!match) throw new Error("the page produced no result element")
    const text = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    if (text.trim() === "pending") throw new Error("the page never ran; check the browser flags")
    const parsed = JSON.parse(text)
    if (parsed.error) throw new Error(parsed.error)
    return parsed
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------

const python = resolvePython()
const chrome = resolveChrome()
console.log(`python  ${python}`)
console.log(`chrome  ${chrome}`)

let failures = 0
let renderer = ""

for (const { name, request } of CASES) {
  const side = numpySide(python, request)
  const { field, reference } = side
  const result = shaderSide(chrome, page(side))
  renderer = result.renderer

  console.log(
    `\n${name}` +
      `\n  ${field.n_xy}x${field.n_xy}x${field.n_z} cells, LAI ${field.lai}, ` +
      `occupancy ${(field.occupancy * 100).toFixed(1)}%, ` +
      `${reference.points.length} points x ${reference.suns.length} suns`
  )

  // The ground pass first: if the mapping is wrong every point below is
  // meaningless, and the mapping is the layer a picture can be smooth and wrong
  // in without any of the scattered points noticing.
  const gN = reference.ground.n
  console.log(`  ground, ${gN}x${gN} over the module`)
  for (let s = 0; s < reference.ground.suns.length; s++) {
    const sun = reference.ground.suns[s]
    const got = result.ground[s]
    const want = sun.transmittance
    if (!got || got.length !== want.length) {
      console.log(`  FAIL cos z=${sun.cos_zenith.toFixed(2)}  the shader returned ${got?.length ?? 0} of ${want.length} samples`)
      failures++
      continue
    }
    let worst = 0
    let worstAt = -1
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(got[i] - want[i])
      if (d > worst) { worst = d; worstAt = i }
    }
    const ok = worst <= reference.tolerance
    if (!ok) failures++
    console.log(
      `  ${ok ? "ok  " : "FAIL"} cos z=${sun.cos_zenith.toFixed(2)}  worst |shader-numpy| ${worst.toExponential(2)}` +
        (ok
          ? ""
          : `  at sample (${(worstAt / gN) | 0},${worstAt % gN}): ${got[worstAt].toFixed(6)} vs ${want[worstAt].toFixed(6)}`)
    )
  }

  console.log(`  scattered points`)
  for (let s = 0; s < reference.suns.length; s++) {
    const sun = reference.suns[s]
    const got = result.shader[s]
    const want = sun.transmittance
    if (!got || got.length !== want.length) {
      console.log(`  FAIL cos z=${sun.cos_zenith.toFixed(2)}  the shader returned ${got?.length ?? 0} of ${want.length} values`)
      failures++
      continue
    }
    let worst = 0
    let worstAt = -1
    for (let i = 0; i < want.length; i++) {
      const d = Math.abs(got[i] - want[i])
      if (d > worst) { worst = d; worstAt = i }
    }
    const ok = worst <= reference.tolerance
    if (!ok) failures++
    const verdict = ok ? "ok  " : "FAIL"
    console.log(
      `  ${verdict} cos z=${sun.cos_zenith.toFixed(2)}  worst |shader-numpy| ${worst.toExponential(2)}` +
        (ok ? "" : `  at point ${worstAt}: ${got[worstAt].toFixed(6)} vs ${want[worstAt].toFixed(6)}`) +
        `   (${sun.why})`
    )
  }
}

console.log(`\nrenderer  ${renderer}`)
if (failures) {
  console.error(
    `\n${failures} sun(s) disagree beyond the tolerance.\n` +
      `The GLSL march in src/lib/canopyShader.ts and the numpy march in\n` +
      `sidecar/canopy_voxel.py are no longer the same algorithm. Neither is\n` +
      `authoritative by position -- read both before deciding which moved.`
  )
  process.exit(1)
}
console.log("\nThe GLSL march reproduces the numpy march at every reference case.")
