/**
 * Brazil's administrative boundaries, as polygons a run can be made over.
 *
 * WHY A CATALOGUE AND NOT ANOTHER IMPORT. A polygon already reaches this
 * application two ways: drawn on the map, or read from a KML the reader has on
 * disk. Both put the burden of HAVING the shape on the reader, and for the
 * shapes that are administrative -- a state, a municipality -- that burden is
 * misplaced: those boundaries are published, they are the same for everyone,
 * and a reader asking about Natal should not have to find a file first.
 *
 * IBGE IS THE SOURCE BECAUSE IT IS THE REGISTER. The malhas service publishes
 * the same geometry the census and the statistical yearbooks are drawn on, so
 * an area taken from here is the one an official figure is about -- which is
 * the property that makes a run comparable to a published number, and the
 * reason not to take these from a general geocoder that returns whatever its
 * contributors have drawn.
 *
 * NEIGHBOURHOODS ARE NOT HERE, and the service says why: asked for a
 * municipality's subdivisions it answers "Quando a malha for um município do
 * Brasil, o parâmetro intrarregiao NÃO aceita valores". There is no national
 * bairro mesh to read, so that granularity waits for a source of its own
 * rather than being approximated from one that does not have it.
 *
 * QUALITY IS `intermediaria`, WHICH IS A CHOICE ABOUT WHAT THE SHAPE IS FOR.
 * The service offers minima, intermediaria and maxima. An AOI is read by a
 * sidecar that clips rasters to it; the coarsest mesh moves a coastline by
 * kilometres and the finest is megabytes of vertices for a boundary whose
 * error against a 10 m pixel is already below the pixel. The middle is the one
 * whose error is smaller than the data it will be used against.
 */
import type { GeoJSONGeometry } from "@/lib/types"

const LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades"
const MALHAS = "https://servicodados.ibge.gov.br/api/v3/malhas"
const GEOJSON = "application/vnd.geo+json"

/** One entry of the catalogue: what to show, and what to ask for. */
export interface Boundary {
  /** IBGE's own code, which is what the malhas service is keyed on. */
  id: number
  name: string
  /** The state it is in, for a municipality; absent for a state. */
  uf?: string
}

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`IBGE answered ${res.status} for ${url}`)
  }
  return (await res.json()) as T
}

/*
  The states, held for the session.

  They are 27 rows that last changed in 1988, so a second request for them is a
  request for an answer nobody expects to move. Held as the PROMISE rather than
  the value, so two cards mounting together make one request between them
  rather than two that race.
*/
let statesOnce: Promise<Boundary[]> | null = null

export function listStates(): Promise<Boundary[]> {
  statesOnce ??= read<{ id: number; sigla: string; nome: string }[]>(
    `${LOCALIDADES}/estados?orderBy=nome`
  ).then((rows) =>
    rows.map((r) => ({ id: r.id, name: r.nome, uf: r.sigla }))
  )
  return statesOnce
}

/*
  A state's municipalities, held per state for the same reason and with the
  same shape. Sao Paulo has 645 of them and Roraima has 15, so this is asked
  for one state at a time rather than for the 5,570 at once: the reader is
  choosing inside a state they have already named.
*/
const municipalitiesOnce = new Map<number, Promise<Boundary[]>>()

export function listMunicipalities(state: Boundary): Promise<Boundary[]> {
  const held = municipalitiesOnce.get(state.id)
  if (held) return held
  const asked = read<{ id: number; nome: string }[]>(
    `${LOCALIDADES}/estados/${state.id}/municipios`
  ).then((rows) =>
    rows.map((r) => ({ id: r.id, name: r.nome, uf: state.uf }))
  )
  municipalitiesOnce.set(state.id, asked)
  return asked
}

/**
 * The polygon of one entry.
 *
 * Not held: a mesh is hundreds of kilobytes and the reader asks for one, once,
 * at the moment they choose it. What follows is an area of the project, which
 * the store holds -- so a second ask for the same ground is answered from
 * there and never reaches this.
 */
export async function boundaryGeometry(
  level: "estados" | "municipios",
  id: number,
  signal?: AbortSignal
): Promise<GeoJSONGeometry | null> {
  const fc = await read<{
    features?: { geometry?: GeoJSONGeometry }[]
  }>(
    `${MALHAS}/${level}/${id}?formato=${encodeURIComponent(GEOJSON)}&qualidade=intermediaria`,
    signal
  )
  /*
    The first polygon, and there is only ever one: a malha request names a
    single locality and the service answers with that locality's own outline.
    A collection with none is an id the service does not hold, which is an
    error to report rather than a shape to invent.
  */
  return fc.features?.[0]?.geometry ?? null
}
