/**
 * Beer-Lambert extinction through a leaf-area-density field, in GLSL.
 *
 * WHAT THIS IS A COPY OF. `sidecar/canopy_voxel.py` marches the same field in
 * numpy to answer the same question. Two implementations of one numerical
 * method drift unless something compares them, and this repository has already
 * shipped a hand-copied table that drifted on every stop while nothing failed,
 * because nothing compared them -- see scripts/check-contrast.ts, which exists
 * for that reason. The comparison here is scripts/check-canopy-shader.ts: it
 * runs THIS source in a real WebGL 2 context and holds it to transmittances the
 * Python march produced.
 *
 * So the march below is written to match line for line, not to be idiomatic
 * GLSL. Where the two languages agree the code looks the same on purpose:
 *
 *   numpy                                    GLSL
 *   np.mod(x, spacing)                       mod(x, uSpacing)      same convention
 *   .astype(int)   on a value >= 0           int()                 both truncate
 *   % n_xy                                   % uDims.x             both non-negative
 *   np.clip(i, 0, n_z - 1)                   clamp(i, 0, uDims.z-1)
 *   grid[ix, iy, iz]                         texelFetch(..., 0).r
 *
 * WHY texelFetch AND NOT texture(). `texture()` samples in normalised
 * coordinates through the filter and the wrap mode, which introduces a half
 * texel offset and, at the default GL_LINEAR, trilinear interpolation.
 * Interpolating the field is not a rounding difference -- measured against
 * nearest sampling on an ellipsoidal crown it moves transmittance by -1.9% at
 * an overhead sun to -3.9% at cos z = 0.4, which is larger than the march's own
 * error against analytic Beer-Lambert. `texelFetch` takes integer texel
 * coordinates and ignores both filter and wrap, so it does exactly what
 * indexing a numpy array does. The wrap the orchard needs is periodic in x and
 * y and clamped in z, which are different rules per axis and are therefore done
 * in the arithmetic rather than left to a sampler.
 *
 * TEXTURE AXIS ORDER. The Python grid is indexed `grid[ix, iy, iz]` and is
 * C-contiguous, so its fastest axis is iz. A 3D texture's fastest axis is x.
 * The field is therefore uploaded transposed to (iz, iy, ix) so that after
 * flattening the fastest axis is ix again, and `texelFetch(uField,
 * ivec3(ix, iy, iz))` reads the cell `grid[ix, iy, iz]`. Uploading the array
 * untransposed produces a canopy rotated into its own depth axis, which renders
 * as a plausible-looking canopy and is wrong everywhere.
 */

/** Compile-time ceiling on the march, since GLSL wants a bounded loop.
 *
 * This is a CONTRACT, not a safety margin, and it is the same number as
 * MAX_MARCH_STEPS in sidecar/canopy_field.py. Getting that wrong is not a
 * clamped edge case: numpy marches as many steps as the geometry asks for while
 * this loop simply stops, so the two produce different answers with nothing
 * raised on either side. Measured, a 1.5 cm cell under a 6 m canopy wants 3311
 * steps; running 2048 of them disagreed with numpy by 7e-2, thirty times the
 * gate's tolerance, on a field the builder was perfectly willing to emit.
 *
 * The builder is the side that respects it -- `_check_march` refuses a field
 * needing more and names the cell size that would fit. So raising this number
 * without raising that one only re-opens the gap in the other direction, and
 * raising both trades frame rate for resolution: this many texture fetches per
 * fragment is already a heavy interactive budget.
 */
export const CANOPY_MAX_STEPS = 2048

/** Uniform block the march needs. Declared apart so a consumer can compose it
 *  with its own varyings without duplicating the names. */
export const CANOPY_UNIFORMS_GLSL = /* glsl */ `
uniform highp sampler3D uField;   // leaf area density, m2 of leaf per m3
uniform float uCell;              // voxel side, m
uniform float uSpacing;           // periodic orchard module, m
uniform float uZTop;              // top of the grid, m
uniform float uStepFrac;          // march step, in fractions of a cell
uniform float uMaxPath;           // longest path considered, m
uniform float uG;                 // projection coefficient of the leaf angles
uniform ivec3 uDims;              // n_xy, n_xy, n_z
uniform vec3 uSun;                // direction towards the sun, field frame
`

/**
 * Where a point in the scene sits in the field.
 *
 * THIS IS IN THE SHARED MODULE FOR THE SAME REASON THE MARCH IS. It is a
 * second thing a view has to get right, it is invisible when wrong -- a
 * transposed pair of axes or an offset of half a module draws a smooth,
 * plausible floor that is wrong at every point -- and it has already been the
 * defect twice. Keeping it beside the march means the parity check can drive
 * it, which the scattered reference points cannot: a consumer comparing
 * against those is handed field coordinates and never performs this step.
 *
 * The convention, which the geometry has to match rather than the other way
 * round: three's up is the field's height, the module is centred on the origin
 * and spans one spacing in x and z.
 *
 *     field.x = world.x + spacing/2
 *     field.y = world.z + spacing/2
 *     field.z = world.y
 */
export const CANOPY_WORLD_GLSL = /* glsl */ `
vec3 toField(vec3 world) {
  return vec3(world.x + uSpacing * 0.5, world.z + uSpacing * 0.5, world.y);
}

/** Direct light reaching the orchard floor under a point of the scene. */
float groundTransmittance(vec3 world) {
  vec3 p = toField(world);
  // A hair above the ground rather than on it: at exactly zero the first
  // sample sits on a cell boundary, which is the one place the index is
  // decided by rounding.
  return canopyTransmittance(vec3(p.x, p.y, 0.001), uSun);
}
`

/**
 * The march itself.
 *
 * Returns the fraction of a beam arriving at `pos` from direction `dir`, where
 * `dir` points towards the sun. A sun at or below the horizon transmits
 * nothing, which is a convention rather than a limit -- the numpy side returns
 * zero there rather than dividing by a vanishing cosine, and the two have to
 * agree about it or the shader lights the scene at dusk.
 */
export const CANOPY_MARCH_GLSL = /* glsl */ `
float canopyTransmittance(vec3 pos, vec3 dir) {
  vec3 d = normalize(dir);
  if (d.z <= 1e-6) return 0.0;

  float stepLen = uCell * uStepFrac;
  int nSteps = int(min(uMaxPath, (uZTop + stepLen) / d.z) / stepLen) + 1;

  float acc = 0.0;
  for (int k = 0; k < ${CANOPY_MAX_STEPS}; k++) {
    if (k >= nSteps) break;

    // Half a step in front, so a point sampled inside a cell is not shaded by
    // the whole of its own cell.
    vec3 q = pos + d * ((float(k) + 0.5) * stepLen);

    // The ray has left the canopy. It cannot come back: d.z is positive, so z
    // is monotonic along the march and the numpy side's cumulative liveness
    // flag is a break here.
    if (q.z >= uZTop) break;

    // Periodic in x and y -- a ray leaving the module returns on the opposite
    // side, which is an infinite orchard without replicating a tree. Clamped in
    // z, because there is ground below and sky above, not more orchard.
    int ix = int(mod(q.x, uSpacing) / uCell) % uDims.x;
    int iy = int(mod(q.y, uSpacing) / uCell) % uDims.y;
    int iz = clamp(int(q.z / uCell), 0, uDims.z - 1);

    acc += texelFetch(uField, ivec3(ix, iy, iz), 0).r * stepLen;
  }

  return exp(-uG * acc);
}
`

/**
 * Vertex shader for a full-target pass: one fragment per texel, no transform.
 *
 * Used by the verification, where the target is N by 1 and each texel is one
 * case. A view of the canopy uses its own vertex shader over real geometry;
 * only the march is shared, because only the march is the thing that can drift.
 */
export const FULLSCREEN_VERTEX_GLSL = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Fragment shader that answers one reference case per texel.
 *
 * The target is points across by suns down, so one draw covers the whole
 * fixture: column x is the point, row y is the sun. Positions and directions
 * arrive as float textures rather than as uniform arrays so that the case count
 * is not baked into the program -- the fixture can grow without recompiling,
 * and a driver's uniform-array limit cannot silently truncate the comparison
 * into a pass.
 */
export const VERIFY_FRAGMENT_GLSL = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;
precision highp sampler2D;

${CANOPY_UNIFORMS_GLSL}

uniform sampler2D uPoints;      // xyz = position,  one texel per point
uniform sampler2D uDirections;  // xyz = direction towards the sun, one per sun

out vec4 fragColor;

${CANOPY_MARCH_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec3 pos = texelFetch(uPoints, ivec2(texel.x, 0), 0).xyz;
  vec3 dir = texelFetch(uDirections, ivec2(texel.y, 0), 0).xyz;
  fragColor = vec4(canopyTransmittance(pos, dir), 0.0, 0.0, 1.0);
}
`

/**
 * Fragment shader that answers the ground pass over the module.
 *
 * One texel per sample of the reference grid, in the same order the field
 * builder emits it: texel (i, j) is the centre of cell (i, j) of an n-by-n
 * division of the module, i along x. The world position is reconstructed from
 * the texel so that `toField` is exercised rather than bypassed -- which is the
 * whole point, since that mapping is what this pass exists to check.
 */
export const VERIFY_GROUND_FRAGMENT_GLSL = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;

${CANOPY_UNIFORMS_GLSL}

uniform int uSamples;

out vec4 fragColor;

${CANOPY_MARCH_GLSL}
${CANOPY_WORLD_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  float n = float(uSamples);
  // Field metres, then back into world, so the mapping under test runs
  // forwards on a position it did not choose.
  float fx = (float(texel.x) + 0.5) / n * uSpacing;
  float fy = (float(texel.y) + 0.5) / n * uSpacing;
  vec3 world = vec3(fx - uSpacing * 0.5, 0.0, fy - uSpacing * 0.5);
  fragColor = vec4(groundTransmittance(world), 0.0, 0.0, 1.0);
}
`

/** Everything the march reads, in the shape the field builder reports it. */
export interface CanopyFieldMeta {
  spacing: number
  cell: number
  z_top: number
  n_xy: number
  n_z: number
  lai: number
  leaf_area: number
  source: string
  occupancy: number
  density_in_crown: number
}

/** One sun and the transmittances the numpy march produced for it. */
export interface ReferenceSun {
  cos_zenith: number
  azimuth: number
  why: string
  direction: [number, number, number]
  transmittance: number[]
}

/**
 * Everything a second implementation needs in order to be compared.
 *
 * All four march parameters travel, including `max_path` -- which changes the
 * answer and was originally left for the consumer to hard-code, exactly the
 * hand-copied constant this whole arrangement exists to prevent. The divergence
 * would be invisible on any field whose longest path is under both values,
 * which is most of them.
 */
export interface CanopyReference {
  points: [number, number, number][]
  step_frac: number
  g_leaf: number
  max_path: number
  max_steps: number
  tolerance: number
  suns: ReferenceSun[]
  ground: {
    n: number
    suns: ReferenceSun[]
  }
}

/**
 * Transpose a field from the Python index order into texture upload order.
 *
 * `grid` arrives flat in C order over (ix, iy, iz). The texture wants ix
 * fastest. Doing it here rather than in Python keeps the wire format equal to
 * the array the sidecar already has, and puts the reordering next to the
 * `texelFetch` whose axis order it exists to satisfy.
 */
export function fieldToTextureOrder(
  grid: Float32Array,
  nXY: number,
  nZ: number
): Float32Array {
  if (grid.length !== nXY * nXY * nZ) {
    throw new Error(
      `field has ${grid.length} cells, expected ${nXY}x${nXY}x${nZ} = ${nXY * nXY * nZ}`
    )
  }
  const out = new Float32Array(grid.length)
  for (let ix = 0; ix < nXY; ix++) {
    for (let iy = 0; iy < nXY; iy++) {
      for (let iz = 0; iz < nZ; iz++) {
        out[ix + nXY * (iy + nXY * iz)] = grid[iz + nZ * (iy + nXY * ix)]
      }
    }
  }
  return out
}
