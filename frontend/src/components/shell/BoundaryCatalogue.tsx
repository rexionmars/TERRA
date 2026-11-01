import { useEffect, useMemo, useState } from "react"

import { CaretRight } from "@/components/icons"
import {
  boundaryGeometry,
  listMunicipalities,
  listStates,
  type Boundary,
} from "@/lib/ibgeBoundaries"
import type { GeoJSONGeometry } from "@/lib/types"
import { PanelChoices } from "@/components/shell/ShellPanel"

/** Without accents, because a reader typing "sao" means São. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()

function Row({
  label,
  note,
  busy,
  onSelect,
}: {
  label: string
  note?: string
  busy: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        disabled={busy}
        onClick={onSelect}
        className="flex w-full items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-read text-foreground transition-colors hover:bg-hover disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{label}</span>
        {note && <span className="shrink-0 text-label text-muted-foreground">{note}</span>}
      </button>
    </li>
  )
}

/**
 * Brazilian states and municipalities from IBGE, each of which becomes an area.
 *
 * A STATE IS BOTH A CHOICE AND A FILTER. A list of 5,570 municipalities would be
 * answering inside a state the reader already has in mind, so the state list
 * narrows the municipalities, and is itself what is picked at the level above.
 */
export function BoundaryCatalogue({
  onPick,
}: {
  onPick: (name: string, geometry: GeoJSONGeometry) => void
}) {
  const [level, setLevel] = useState<"estados" | "municipios">("estados")
  const [states, setStates] = useState<Boundary[] | null>(null)
  const [state, setState] = useState<Boundary | null>(null)
  const [towns, setTowns] = useState<Boundary[] | null>(null)
  const [query, setQuery] = useState("")
  const [taking, setTaking] = useState<number | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listStates()
      .then((rows) => live && setStates(rows))
      .catch((e) => live && setFailed(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (level !== "municipios" || !state) return
    let live = true
    setTowns(null)
    listMunicipalities(state)
      .then((rows) => live && setTowns(rows))
      .catch((e) => live && setFailed(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [level, state])

  const shown = useMemo(() => {
    const rows = level === "estados" ? states : towns
    if (!rows) return null
    const q = fold(query)
    return q ? rows.filter((r) => fold(r.name).includes(q)) : rows
  }, [level, states, towns, query])

  const take = async (row: Boundary) => {
    setTaking(row.id)
    setFailed(null)
    try {
      const geom = await boundaryGeometry(level, row.id)
      if (geom) onPick(row.name, geom)
      else setFailed(`${row.name} has no published outline.`)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setTaking(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PanelChoices
        label="Boundary level"
        value={level}
        options={[
          { id: "estados", label: "State" },
          { id: "municipios", label: "Municipality" },
        ]}
        onChange={(id) => {
          setLevel(id)
          setQuery("")
        }}
      />
      {level === "municipios" && state && (
        <button
          type="button"
          onClick={() => {
            setState(null)
            setQuery("")
          }}
          className="flex items-center gap-1 self-start text-label text-muted-foreground hover:text-foreground"
        >
          <CaretRight aria-hidden className="size-3 rotate-180" />
          {state.name}
        </button>
      )}
      {(level === "estados" || state) && (
        <input
          aria-label={level === "estados" ? "Search states" : `Search in ${state?.name}`}
          className="field-input"
          value={query}
          placeholder={level === "estados" ? "Search states" : "Search here"}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {failed ? (
        <p className="text-label text-destructive-quiet">{failed}</p>
      ) : level === "municipios" && !state ? (
        <>
          <p className="text-label text-muted-foreground">Choose the state first.</p>
          <ul className="flex flex-col">
            {(states ?? []).map((s) => (
              <Row
                key={s.id}
                label={s.name}
                note={s.uf}
                busy={false}
                onSelect={() => {
                  setState(s)
                  setQuery("")
                }}
              />
            ))}
          </ul>
        </>
      ) : shown === null ? (
        <p className="text-label text-muted-foreground">Reading IBGE</p>
      ) : shown.length === 0 ? (
        <p className="text-label text-muted-foreground">Nothing by that name</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((row) => (
            <Row
              key={row.id}
              label={row.name}
              note={taking === row.id ? "Fetching" : row.uf}
              busy={taking !== null}
              onSelect={() => void take(row)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
