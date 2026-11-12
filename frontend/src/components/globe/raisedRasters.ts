/**
 * The overlays, lifted off the ground they were measured over.
 *
 * WHY THIS IS HAND-WRITTEN WEBGL AND NOT A STYLE LAYER. A MapLibre `raster`
 * layer is draped on the terrain: it has an opacity, a hue rotation and a
 * resampling mode, and no elevation. Nothing in the style spec at 6.6 gives any
 * layer a vertical offset except `fill-extrusion`, which extrudes a polygon
 * from a colour or a tiled pattern and cannot carry a georeferenced image. So
 * two rasters over one area are coplanar, the upper hides the lower, and the
 * only lever is opacity.
 *
 * A custom layer is the supported way out, and it costs what it costs: the
 * ordering, the opacity and the update path that `syncOverlays` provides for
 * style layers all have to exist here again, against a second renderer.
 *
 * THE ELEVATION MEANS TWO DIFFERENT THINGS, and that is the trap in this file.
 * MapLibre's shader prelude gives `projectTileFor3D(vec2 posInTile, float
 * elevation)` in two variants, and they do not agree on the unit:
 *
 *   - mercator: `u_projection_matrix * vec4(posInTile, elevation, 1.0)` --
 *     elevation is in MERCATOR UNITS, the same space as the 0..1 position.
 *   - globe: elevation is in METRES above the sphere.
 *
 * A single uniform would be right in one projection and wrong by five orders of
 * magnitude in the other. Both are passed and the prelude's own `GLOBE` define
 * picks. The mercator value is derived from the metres at the raster's own
 * latitude, because a mercator unit is a different number of metres at the
 * equator than at sixty degrees.
 *
 * AND BOTH ARE WANTED AT ONCE WHILE THE PROJECTION IS CHANGING, which is the
 * thing `projectTileFor3D` cannot express and the reason the globe path below
 * is written out instead of delegated. MapLibre hands a custom layer a globe
 * matrix and a fallback matrix and crossfades between them as the sphere
 * flattens; the fallback it hands is the MERCATOR custom-layer matrix, whose z
 * is scaled by the world size. So inside one call the sphere wants metres and
 * the fallback wants mercator units, and the helper takes one argument for
 * both.
 *
 * Feeding it metres put the fallback corner an Earth's circumference up: for
 * the width of the crossfade the quad was mixed between a position on the
 * ground and one forty thousand kilometres above it. That is what smeared the
 * overlay from 11.1 and had it gone by 11.5, and why nothing was ever wrong
 * above 12 -- past the crossfade the transition is 1, the fallback drops out
 * of the mix, and the sphere term is the only one left.
 *
 * BACK TO FRONT, AND NOT DEPTH TESTED AT ALL. These quads are translucent and
 * they overlap; sorted by elevation and drawn without writing depth is the
 * painter's order, which is what lets the lower raster show through the upper
 * one rather than being cut away by a fragment that was never opaque.
 *
 * The test went with the writes, and that took measuring rather than taste.
 * MapLibre fills the depth buffer with the ground itself -- `painter` line
 * `if (isRenderingGlobe && !map.terrain) this._renderTilesDepthBuffer()`, the
 * tile meshes drawn at elevation zero. So on the sphere, with relief OFF, the
 * ground is in the buffer and this quad is a metre above it: one part in six
 * million of the globe's radius, far under what the buffer can separate at that
 * scale. Two surfaces the depth test cannot tell apart is z-fighting, and
 * z-fighting is banding -- which is what the overlay did below zoom 12, in
 * stripes that moved when the camera turned and closed up when it flattened.
 *
 * AND THE TEST WAS NEVER BUYING WHAT IT CLAIMED. It was here so terrain could
 * occlude a raster behind a ridge, and relief on is the case where MapLibre
 * skips the pre-pass. An overlay asked for over an area is drawn over that
 * area, so a ridge between the camera and it does not hide it; occluding one by
 * relief is a thing to build from the terrain's own elevation, deliberately,
 * and not to half-inherit from a shared buffer.
 *
 * LIFTED FROM THE GROUND, NOT FROM SEA LEVEL. With relief on, MapLibre draws
 * the ground at its height and drapes every style layer over it, the area's
 * outline among them. A raster lifted from zero lies under any ground above the
 * sea and, drawn with no depth test, shows through it shifted off its outline
 * by the parallax of that height. So the raster is a mesh: with relief, about
 * as many cells across its extent as the terrain's own mesh has there, each
 * vertex raised by the ground height under it plus the raster's place in the
 * stack. With no relief it is one cell, the quad it always was.
 */
import { LngLat, MercatorCoordinate } from "maplibre-gl"
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
  MapSourceDataEvent,
} from "maplibre-gl"

import { cornersOf } from "@/lib/mapLayers"
import type { Bounds } from "@/lib/types"

export interface RaisedRaster {
  /** Stable across renders; it is what decides reuse versus rebuild. */
  id: string
  url: string
  bounds: Bounds
  opacity: number
  /** How far above the ground, in metres. */
  elevationM: number
  /**
   * Sampled nearest rather than linearly: a class raster, where a blend of two
   * class colours names no class. RasterLayer carries the same flag.
   */
  pixelated?: boolean
  /**
   * Drawn only to the right of the curtain, while there is one, so what lies
   * under it shows to the left. The top of each area's stack is the one cut.
   */
  cut?: boolean
}

/**
 * The rasters whose extent holds a ground point, top of the stack first.
 *
 * What a right-click on the globe offers (GlobeSurface, onOverlayContext).
 * Picked on the ground because an elevated point cannot be projected through
 * MapLibre's public interface; a stack over one area shares one extent, so all
 * of it is returned and the menu names each.
 */
export function rastersAt<T extends Pick<RaisedRaster, "bounds" | "elevationM">>(
  rasters: readonly T[],
  lng: number,
  lat: number
): T[] {
  return rasters
    .filter(
      (r) =>
        lng >= r.bounds.lon_min &&
        lng <= r.bounds.lon_max &&
        lat >= r.bounds.lat_min &&
        lat <= r.bounds.lat_max
    )
    .sort((a, b) => b.elevationM - a.elevationM)
}

/*
  A texture per url AND filter. The same raster drawn once as classes and once
  as colour is two textures, since the filter is a property of the texture.
*/
const textureKey = (r: Pick<RaisedRaster, "url" | "pixelated">) =>
  `${r.pixelated ? "nearest" : "linear"}:${r.url}`

/** Cells along a side of each terrain tile's mesh: MapLibre's `meshSize`. */
const TERRAIN_MESH_CELLS = 128

/**
 * The most cells along a side of a raster's mesh.
 *
 * 64 is 4,225 ground samples, a few milliseconds, and the mesh is sampled again
 * whenever a DEM tile arrives, which while the relief loads is every frame. An
 * extent wider than 64 of the terrain's cells follows the ground more coarsely
 * than the ground is drawn, by a fraction of the parallax this mesh removes.
 */
const MAX_CELLS = 64

const EQUATOR_M = 40_075_016.686

/**
 * How many cells along a side the raster's mesh is cut into.
 *
 * One with no relief: the ground is the sphere or the plane, and a quad lies on
 * it. With relief, about as many as the terrain's own mesh has over the extent
 * at this tile zoom, so the raster bends where the ground does and no finer.
 */
export function cellsFor(b: Bounds, tileZoom: number | null): number {
  if (tileZoom === null) return 1
  const cos = Math.cos((((b.lat_min + b.lat_max) / 2) * Math.PI) / 180)
  const cellM = (EQUATOR_M * cos) / 2 ** tileZoom / TERRAIN_MESH_CELLS
  const wideM = ((b.lon_max - b.lon_min) / 360) * EQUATOR_M * cos
  const tallM = ((b.lat_max - b.lat_min) / 360) * EQUATOR_M
  const n = Math.ceil(Math.max(wideM, tallM) / cellM)
  return Math.min(MAX_CELLS, Math.max(1, n))
}

/** Floats per vertex: mercator x and y, texture u and v, ground in metres. */
const FLOATS_PER_VERTEX = 5

/**
 * The mesh's vertices, row by row from the top left corner.
 *
 * Interpolated between the four corners rather than over the box, because a
 * raster is pinned to its corners and they need not make a rectangle. One cell
 * is the quad the corners make, with the texture's corners on them.
 */
export function gridVertices(
  b: Bounds,
  cells: number,
  groundAt: (lng: number, lat: number) => number
): Float32Array {
  const [tl, tr, br, bl] = cornersOf(b).map(([lng, lat]) =>
    MercatorCoordinate.fromLngLat({ lng, lat })
  )
  const out = new Float32Array((cells + 1) ** 2 * FLOATS_PER_VERTEX)
  let at = 0
  for (let row = 0; row <= cells; row++) {
    const v = row / cells
    // Down the left and right edges, then across between them.
    const lx = tl.x + (bl.x - tl.x) * v
    const ly = tl.y + (bl.y - tl.y) * v
    const rx = tr.x + (br.x - tr.x) * v
    const ry = tr.y + (br.y - tr.y) * v
    for (let col = 0; col <= cells; col++) {
      const u = col / cells
      const x = lx + (rx - lx) * u
      const y = ly + (ry - ly) * u
      const { lng, lat } = new MercatorCoordinate(x, y).toLngLat()
      out.set([x, y, u, v, groundAt(lng, lat)], at)
      at += FLOATS_PER_VERTEX
    }
  }
  return out
}

/**
 * Two triangles per cell, wound as the quad was: top left, top right, bottom
 * right, then top left, bottom right, bottom left.
 */
export function gridIndices(cells: number): Uint16Array {
  const side = cells + 1
  const out = new Uint16Array(cells * cells * 6)
  let at = 0
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const tl = row * side + col
      const bl = tl + side
      out.set([tl, tl + 1, bl + 1, tl, bl + 1, bl], at)
      at += 6
    }
  }
  return out
}

/** Mercator units per metre at this extent's middle latitude. */
function mercatorPerMetre(b: Bounds): number {
  const mid = (b.lat_min + b.lat_max) / 2
  return MercatorCoordinate.fromLngLat(
    { lng: b.lon_min, lat: mid },
    0
  ).meterInMercatorCoordinateUnits()
}

export const vertexSource = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
in vec2 a_pos;
in vec2 a_uv;
in float a_ground_m;
uniform float u_lift_m;
uniform float u_mercator_per_m;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  // The ground under this vertex, zero with no relief, and the stack above it.
  float metres = a_ground_m + u_lift_m;
  float mercator = metres * u_mercator_per_m;
  /*
    The unit differs by variant; see this file's header. The define is
    MapLibre's own, so the branch cannot fall out of step with the prelude it
    was compiled beside.
  */
#ifdef GLOBE
  /*
    What the prelude's own projectTileFor3D does, with one difference: the two
    terms are given the two units they are each written in, rather than one
    number spent on both. Everything used here is the prelude's -- the sphere,
    the radius, the fallback matrix and the transition -- so this stays a
    restatement of MapLibre's arithmetic and not a second projection.
  */
  v_projection_tile_x = a_pos.x;
  vec3 spherePos = projectToSphere(a_pos, a_pos);
  vec3 raised = spherePos * (1.0 + metres / GLOBE_RADIUS);
  vec4 onSphere = u_projection_matrix * vec4(raised, 1.0);
  if (u_projection_transition > 0.999) {
    // Wholly a sphere: the fallback is not mixed in, so it is not computed.
    gl_Position = onSphere;
  } else {
    vec4 onPlane = u_projection_fallback_matrix * vec4(a_pos, mercator, 1.0);
    gl_Position = mix(onPlane, onSphere, u_projection_transition);
  }
#else
  gl_Position = projectTileFor3D(a_pos, mercator);
#endif
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_opacity;
uniform float u_cut_x;
out vec4 fragColor;
void main() {
  /*
    The curtain, in framebuffer pixels from the left edge; negative when this
    raster is not cut. In screen space rather than on the ground, so the line
    stays straight and vertical whatever the camera's pitch, bearing or
    projection, and lies over every raster at the same place.
  */
  if (gl_FragCoord.x < u_cut_x) discard;
  vec4 c = texture(u_image, v_uv);
  /*
    Premultiplied on the way out, because the blend below is ONE,
    ONE_MINUS_SRC_ALPHA. A raster's transparent margin -- every one of these is
    an image clipped to a polygon -- would otherwise be drawn as a black frame
    the width of the bounding box.
  */
  fragColor = vec4(c.rgb * c.a * u_opacity, c.a * u_opacity);
}`

interface Program {
  program: WebGLProgram
  aPos: number
  aUv: number
  aGround: number
  uLiftM: WebGLUniformLocation | null
  uMercPerM: WebGLUniformLocation | null
  uImage: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
  uCutX: WebGLUniformLocation | null
  /** Every uniform the prelude declares, by name, so they can be fed. */
  projection: Record<string, WebGLUniformLocation | null>
}

const PROJECTION_UNIFORMS = [
  "u_projection_matrix",
  "u_projection_tile_mercator_coords",
  "u_projection_clipping_plane",
  "u_projection_transition",
  "u_projection_fallback_matrix",
] as const

function compile(gl: WebGL2RenderingContext, src: string, kind: number): WebGLShader {
  const sh = gl.createShader(kind)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`raised raster shader: ${log}`)
  }
  return sh
}

export interface RaisedRasterLayer extends CustomLayerInterface {
  /** Replace the set drawn. Images are fetched once and kept by url. */
  set(rasters: readonly RaisedRaster[]): void
  /**
   * Where the curtain stands, as a fraction of the map's width from its left
   * edge, or null for none. Only the rasters marked `cut` are cut by it.
   */
  setCurtain(at: number | null): void
}

export function raisedRasterLayer(id: string, map: MapLibreMap): RaisedRasterLayer {
  let gl: WebGL2RenderingContext | null = null
  let rasters: readonly RaisedRaster[] = []
  let curtain: number | null = null
  /** One program per projection variant, keyed by the name MapLibre gives. */
  const programs = new Map<string, Program>()
  const textures = new Map<string, WebGLTexture>()
  const pending = new Set<string>()
  /**
   * Each raster's vertices on the GPU, by raster id, with the key they were
   * sampled for. A mesh is cut again only when that changes: another extent,
   * another tile zoom, or new ground under it.
   */
  const meshes = new Map<
    string,
    { key: string; vertices: WebGLBuffer; cells: number }
  >()
  /** The triangles depend on the cell count alone, so meshes share them. */
  const indexBuffers = new Map<number, WebGLBuffer>()
  /*
    Bumped whenever the ground may have changed: relief turned on or off, or a
    DEM tile arrived. MapLibre clears its own elevation cache on the same
    events, before this layer next renders.
  */
  let groundVersion = 0
  const groundChanged = () => {
    groundVersion++
    map.triggerRepaint()
  }
  const onSourceData = (e: MapSourceDataEvent) => {
    if (e.sourceId === map.getTerrain()?.source) groundChanged()
  }

  const meshFor = (
    ctx: WebGL2RenderingContext,
    r: RaisedRaster,
    tileZoom: number | null,
    groundAt: (lng: number, lat: number) => number
  ) => {
    const cells = cellsFor(r.bounds, tileZoom)
    const key = [
      cells,
      tileZoom ?? "flat",
      tileZoom === null ? 0 : groundVersion,
      ...cornersOf(r.bounds).flat(),
    ].join(",")
    const held = meshes.get(r.id)
    if (held?.key === key) return held
    const vertices = held?.vertices ?? ctx.createBuffer()
    ctx.bindBuffer(ctx.ARRAY_BUFFER, vertices)
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      gridVertices(r.bounds, cells, groundAt),
      ctx.STATIC_DRAW
    )
    const mesh = { key, vertices, cells }
    meshes.set(r.id, mesh)
    return mesh
  }

  const indicesFor = (ctx: WebGL2RenderingContext, cells: number) => {
    const held = indexBuffers.get(cells)
    if (held) return held
    const made = ctx.createBuffer()
    ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, made)
    ctx.bufferData(ctx.ELEMENT_ARRAY_BUFFER, gridIndices(cells), ctx.STATIC_DRAW)
    indexBuffers.set(cells, made)
    return made
  }

  /*
    Textures are fetched once per url and kept. A raster's image is a file on
    disk here, but decoding one is still tens of milliseconds and the set is
    rebuilt whenever an opacity slider moves.
  */
  const ensureTexture = (r: RaisedRaster) => {
    const key = textureKey(r)
    const url = r.url
    if (!gl || textures.has(key) || pending.has(key)) return
    pending.add(key)
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      pending.delete(key)
      if (!gl) return
      const tex = gl.createTexture()
      if (!tex) return
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // Linear, as the map's own raster layers resample by default, except for
      // a class raster: interpolated, its boundaries became bands of colours
      // that belong to no class, which is how a mineral map read on the globe.
      const filter = r.pixelated ? gl.NEAREST : gl.LINEAR
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      textures.set(key, tex)
      map.triggerRepaint()
    }
    img.onerror = () => {
      pending.delete(key)
    }
    img.src = url
  }

  const programFor = (
    ctx: WebGL2RenderingContext,
    shader: CustomRenderMethodInput["shaderData"]
  ): Program => {
    const held = programs.get(shader.variantName)
    if (held) return held
    const vs = compile(
      ctx,
      vertexSource(shader.vertexShaderPrelude, shader.define),
      ctx.VERTEX_SHADER
    )
    const fs = compile(ctx, FRAG, ctx.FRAGMENT_SHADER)
    const program = ctx.createProgram()
    ctx.attachShader(program, vs)
    ctx.attachShader(program, fs)
    ctx.linkProgram(program)
    ctx.deleteShader(vs)
    ctx.deleteShader(fs)
    if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
      throw new Error(`raised raster link: ${ctx.getProgramInfoLog(program)}`)
    }
    const projection: Record<string, WebGLUniformLocation | null> = {}
    for (const name of PROJECTION_UNIFORMS) {
      projection[name] = ctx.getUniformLocation(program, name)
    }
    const built: Program = {
      program,
      aPos: ctx.getAttribLocation(program, "a_pos"),
      aUv: ctx.getAttribLocation(program, "a_uv"),
      aGround: ctx.getAttribLocation(program, "a_ground_m"),
      uLiftM: ctx.getUniformLocation(program, "u_lift_m"),
      uMercPerM: ctx.getUniformLocation(program, "u_mercator_per_m"),
      uImage: ctx.getUniformLocation(program, "u_image"),
      uOpacity: ctx.getUniformLocation(program, "u_opacity"),
      uCutX: ctx.getUniformLocation(program, "u_cut_x"),
      projection,
    }
    programs.set(shader.variantName, built)
    return built
  }

  return {
    id,
    type: "custom",
    /*
      3d for the projection, not for the depth: it is what makes the mercator
      variant's z conformal, which is the space the elevation is expressed in.
      The depth buffer is shared with the rest of the map and this layer neither
      reads nor writes it; the header says why.
    */
    renderingMode: "3d",

    onAdd(_map, ctx) {
      gl = ctx
      map.on("sourcedata", onSourceData)
      map.on("terrain", groundChanged)
      for (const r of rasters) ensureTexture(r)
    },

    onRemove() {
      map.off("sourcedata", onSourceData)
      map.off("terrain", groundChanged)
      if (!gl) return
      for (const t of textures.values()) gl.deleteTexture(t)
      textures.clear()
      for (const p of programs.values()) gl.deleteProgram(p.program)
      programs.clear()
      for (const m of meshes.values()) gl.deleteBuffer(m.vertices)
      meshes.clear()
      for (const b of indexBuffers.values()) gl.deleteBuffer(b)
      indexBuffers.clear()
      gl = null
    },

    set(next) {
      rasters = next
      for (const r of next) ensureTexture(r)
      const drawn = new Set(next.map((r) => r.id))
      for (const [rid, mesh] of meshes) {
        if (drawn.has(rid)) continue
        gl?.deleteBuffer(mesh.vertices)
        meshes.delete(rid)
      }
      /*
        Textures for rasters nobody draws any more. Kept while the url is still
        in the set, because taking a raster off the globe and putting it back
        is a gesture, not a session.
      */
      const live = new Set(next.map(textureKey))
      if (gl) {
        for (const [key, tex] of textures) {
          if (live.has(key)) continue
          gl.deleteTexture(tex)
          textures.delete(key)
        }
      }
      map.triggerRepaint()
    },

    setCurtain(at) {
      if (at === curtain) return
      curtain = at
      map.triggerRepaint()
    },

    render(ctx, args) {
      if (!rasters.length) return
      const prog = programFor(ctx, args.shaderData)
      ctx.useProgram(prog.program)

      const p = args.defaultProjectionData
      ctx.uniformMatrix4fv(prog.projection["u_projection_matrix"], false, p.mainMatrix)
      ctx.uniform4f(
        prog.projection["u_projection_tile_mercator_coords"],
        ...p.tileMercatorCoords
      )
      ctx.uniform4f(prog.projection["u_projection_clipping_plane"], ...p.clippingPlane)
      ctx.uniform1f(prog.projection["u_projection_transition"], p.projectionTransition)
      ctx.uniformMatrix4fv(
        prog.projection["u_projection_fallback_matrix"],
        false,
        p.fallbackMatrix
      )

      ctx.enable(ctx.BLEND)
      ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA)
      /*
        Neither tested nor written. Not written because these quads are
        translucent and stacked, and the first one drawn would cut away every
        fragment behind it whatever its alpha. Not tested because the only
        thing in the buffer to test against is the ground this raster is drawn
        over, a metre below it and indistinguishable from it on the sphere --
        see the header. Disabling the test disables the write with it, so the
        mask is the driver's business rather than ours.
      */
      ctx.disable(ctx.DEPTH_TEST)

      ctx.enableVertexAttribArray(prog.aPos)
      ctx.enableVertexAttribArray(prog.aUv)
      ctx.enableVertexAttribArray(prog.aGround)

      /*
        The ground from MapLibre's own DEM sampler, at the tile zoom it draws
        the terrain at, which MapLibre's transform takes as the whole zoom.
        `queryTerrainElevation` answers the same question but works out the
        tiles covering the view on every call, and a mesh asks thousands of
        times.
      */
      const terrain = map.getTerrain() ? map.terrain : null
      const tileZoom = terrain ? Math.max(0, Math.floor(map.getZoom())) : null
      const groundAt =
        terrain && tileZoom !== null
          ? (lng: number, lat: number) =>
              terrain.getElevationForLngLatZoom(new LngLat(lng, lat), tileZoom)
          : () => 0

      ctx.activeTexture(ctx.TEXTURE0)
      ctx.uniform1i(prog.uImage, 0)

      /*
        The drawing buffer's own width, not the canvas's CSS width: the fragment
        coordinate is in device pixels, and on a 2x display the CSS figure would
        put the cut at half the distance the handle shows.
      */
      const cutX = curtain === null ? -1 : curtain * ctx.drawingBufferWidth

      // Lowest first: the painter's order for translucent quads.
      const order = [...rasters].sort((a, b) => a.elevationM - b.elevationM)
      for (const r of order) {
        const tex = textures.get(textureKey(r))
        if (!tex) continue
        const mesh = meshFor(ctx, r, tileZoom, groundAt)
        const stride = FLOATS_PER_VERTEX * 4
        ctx.bindBuffer(ctx.ARRAY_BUFFER, mesh.vertices)
        ctx.vertexAttribPointer(prog.aPos, 2, ctx.FLOAT, false, stride, 0)
        ctx.vertexAttribPointer(prog.aUv, 2, ctx.FLOAT, false, stride, 8)
        ctx.vertexAttribPointer(prog.aGround, 1, ctx.FLOAT, false, stride, 16)
        ctx.bindBuffer(ctx.ELEMENT_ARRAY_BUFFER, indicesFor(ctx, mesh.cells))
        ctx.bindTexture(ctx.TEXTURE_2D, tex)
        ctx.uniform1f(prog.uOpacity, r.opacity)
        ctx.uniform1f(prog.uCutX, r.cut ? cutX : -1)
        ctx.uniform1f(prog.uLiftM, r.elevationM)
        ctx.uniform1f(prog.uMercPerM, mercatorPerMetre(r.bounds))
        ctx.drawElements(ctx.TRIANGLES, mesh.cells ** 2 * 6, ctx.UNSIGNED_SHORT, 0)
      }
    },
  }
}
