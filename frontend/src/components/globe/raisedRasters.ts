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
 * BACK TO FRONT, WITH DEPTH WRITES OFF. These quads are translucent and they
 * overlap; sorted by elevation and drawn without writing depth is the painter's
 * order, which is what lets the lower raster show through the upper one rather
 * than being cut away by a depth test against a fragment that was never opaque.
 */
import { MercatorCoordinate } from "maplibre-gl"
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl"

import type { Bounds } from "@/lib/types"

export interface RaisedRaster {
  /** Stable across renders; it is what decides reuse versus rebuild. */
  id: string
  url: string
  bounds: Bounds
  opacity: number
  /** How far above the ground, in metres. */
  elevationM: number
}

/** Four corners, clockwise from the top left, as the image source takes them. */
function quad(b: Bounds): Float32Array {
  /*
    Two triangles rather than a strip: a strip would need its corners in a
    zig-zag, and the readable order here is the one the extent is written in.
    Six vertices is nothing, and the arithmetic below stays legible.
  */
  const tl = MercatorCoordinate.fromLngLat({ lng: b.lon_min, lat: b.lat_max })
  const tr = MercatorCoordinate.fromLngLat({ lng: b.lon_max, lat: b.lat_max })
  const br = MercatorCoordinate.fromLngLat({ lng: b.lon_max, lat: b.lat_min })
  const bl = MercatorCoordinate.fromLngLat({ lng: b.lon_min, lat: b.lat_min })
  // position.xy, uv.xy per vertex.
  return new Float32Array([
    tl.x, tl.y, 0, 0,
    tr.x, tr.y, 1, 0,
    br.x, br.y, 1, 1,
    tl.x, tl.y, 0, 0,
    br.x, br.y, 1, 1,
    bl.x, bl.y, 0, 1,
  ])
}

/** Metres per mercator unit at this extent's middle latitude. */
function mercatorPerMetre(b: Bounds): number {
  const mid = (b.lat_min + b.lat_max) / 2
  return MercatorCoordinate.fromLngLat(
    { lng: b.lon_min, lat: mid },
    0
  ).meterInMercatorCoordinateUnits()
}

const VERT = (prelude: string, define: string) => `#version 300 es
${prelude}
${define}
in vec2 a_pos;
in vec2 a_uv;
uniform float u_elevation_m;
uniform float u_elevation_mercator;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  /*
    The unit differs by variant; see this file's header. The define is
    MapLibre's own, so the branch cannot fall out of step with the prelude it
    was compiled beside.
  */
  #ifdef GLOBE
  gl_Position = projectTileFor3D(a_pos, u_elevation_m);
  #else
  gl_Position = projectTileFor3D(a_pos, u_elevation_mercator);
  #endif
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
uniform float u_opacity;
out vec4 fragColor;
void main() {
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
  uElevM: WebGLUniformLocation | null
  uElevMerc: WebGLUniformLocation | null
  uImage: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
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

function compile(
  gl: WebGL2RenderingContext,
  src: string,
  kind: number
): WebGLShader {
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
}

export function raisedRasterLayer(
  id: string,
  map: MapLibreMap
): RaisedRasterLayer {
  let gl: WebGL2RenderingContext | null = null
  let rasters: readonly RaisedRaster[] = []
  /** One program per projection variant, keyed by the name MapLibre gives. */
  const programs = new Map<string, Program>()
  const textures = new Map<string, WebGLTexture>()
  const pending = new Set<string>()
  let buffer: WebGLBuffer | null = null

  /*
    Textures are fetched once per url and kept. A raster's image is a file on
    disk here, but decoding one is still tens of milliseconds and the set is
    rebuilt whenever an opacity slider moves.
  */
  const ensureTexture = (url: string) => {
    if (!gl || textures.has(url) || pending.has(url)) return
    pending.add(url)
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      pending.delete(url)
      if (!gl) return
      const tex = gl.createTexture()
      if (!tex) return
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // Linear, as the map's own raster layers resample by default. A class
      // raster that must not be interpolated is the caller's business; nothing
      // here yet draws one.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        img
      )
      textures.set(url, tex)
      map.triggerRepaint()
    }
    img.onerror = () => {
      pending.delete(url)
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
      VERT(shader.vertexShaderPrelude, shader.define),
      ctx.VERTEX_SHADER
    )
    const fs = compile(ctx, FRAG, ctx.FRAGMENT_SHADER)
    const program = ctx.createProgram()!
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
      uElevM: ctx.getUniformLocation(program, "u_elevation_m"),
      uElevMerc: ctx.getUniformLocation(program, "u_elevation_mercator"),
      uImage: ctx.getUniformLocation(program, "u_image"),
      uOpacity: ctx.getUniformLocation(program, "u_opacity"),
      projection,
    }
    programs.set(shader.variantName, built)
    return built
  }

  return {
    id,
    type: "custom",
    /*
      3d, so the depth buffer is shared with the rest of the map and terrain
      can occlude a raster that is behind a ridge. It is also what makes the
      mercator variant's z conformal, which is what the elevation is expressed
      against.
    */
    renderingMode: "3d",

    onAdd(_map, ctx) {
      gl = ctx
      buffer = ctx.createBuffer()
      for (const r of rasters) ensureTexture(r.url)
    },

    onRemove() {
      if (!gl) return
      for (const t of textures.values()) gl.deleteTexture(t)
      textures.clear()
      for (const p of programs.values()) gl.deleteProgram(p.program)
      programs.clear()
      if (buffer) gl.deleteBuffer(buffer)
      buffer = null
      gl = null
    },

    set(next) {
      rasters = next
      for (const r of next) ensureTexture(r.url)
      /*
        Textures for rasters nobody draws any more. Kept while the url is still
        in the set, because taking a raster off the globe and putting it back
        is a gesture, not a session.
      */
      const live = new Set(next.map((r) => r.url))
      if (gl) {
        for (const [url, tex] of textures) {
          if (live.has(url)) continue
          gl.deleteTexture(tex)
          textures.delete(url)
        }
      }
      map.triggerRepaint()
    },

    render(ctx, args) {
      if (!rasters.length || !buffer) return
      const prog = programFor(ctx, args.shaderData)
      ctx.useProgram(prog.program)

      const p = args.defaultProjectionData
      ctx.uniformMatrix4fv(
        prog.projection["u_projection_matrix"],
        false,
        p.mainMatrix
      )
      ctx.uniform4f(
        prog.projection["u_projection_tile_mercator_coords"],
        ...p.tileMercatorCoords
      )
      ctx.uniform4f(
        prog.projection["u_projection_clipping_plane"],
        ...p.clippingPlane
      )
      ctx.uniform1f(
        prog.projection["u_projection_transition"],
        p.projectionTransition
      )
      ctx.uniformMatrix4fv(
        prog.projection["u_projection_fallback_matrix"],
        false,
        p.fallbackMatrix
      )

      ctx.enable(ctx.BLEND)
      ctx.blendFunc(ctx.ONE, ctx.ONE_MINUS_SRC_ALPHA)
      ctx.enable(ctx.DEPTH_TEST)
      /*
        Tested but not written. These quads are translucent and stacked over
        one another; writing depth would make the first one drawn cut away
        every fragment of the ones behind it, whatever their alpha.
      */
      ctx.depthMask(false)
      ctx.depthFunc(ctx.LEQUAL)

      ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer)
      ctx.enableVertexAttribArray(prog.aPos)
      ctx.enableVertexAttribArray(prog.aUv)
      ctx.vertexAttribPointer(prog.aPos, 2, ctx.FLOAT, false, 16, 0)
      ctx.vertexAttribPointer(prog.aUv, 2, ctx.FLOAT, false, 16, 8)

      ctx.activeTexture(ctx.TEXTURE0)
      ctx.uniform1i(prog.uImage, 0)

      // Lowest first: the painter's order for translucent quads.
      const order = [...rasters].sort((a, b) => a.elevationM - b.elevationM)
      for (const r of order) {
        const tex = textures.get(r.url)
        if (!tex) continue
        ctx.bufferData(ctx.ARRAY_BUFFER, quad(r.bounds), ctx.DYNAMIC_DRAW)
        ctx.bindTexture(ctx.TEXTURE_2D, tex)
        ctx.uniform1f(prog.uOpacity, r.opacity)
        ctx.uniform1f(prog.uElevM, r.elevationM)
        ctx.uniform1f(
          prog.uElevMerc,
          r.elevationM * mercatorPerMetre(r.bounds)
        )
        ctx.drawArrays(ctx.TRIANGLES, 0, 6)
      }

      ctx.depthMask(true)
    },
  }
}
