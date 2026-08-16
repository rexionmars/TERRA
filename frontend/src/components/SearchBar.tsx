import { useState } from "react"
import { Search, Loader2, MapPin } from "lucide-react"
import { notifyError, notifyInfo } from "@/lib/notify"
import { GeocodeSearch } from "../../wailsjs/go/main/App"
import type { GeocodeResult } from "@/lib/types"

interface SearchBarProps {
  onSelectLocation: (lat: number, lon: number) => void
}

export function SearchBar({ onSelectLocation }: SearchBarProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  const runSearch = async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    try {
      const res = (await GeocodeSearch(q)) as unknown as GeocodeResult[]
      setResults(res ?? [])
      setOpen(true)
      if ((res ?? []).length === 0) {
        notifyInfo("No location found.")
      }
    } catch (e) {
      notifyError("Falha na busca", e)
    } finally {
      setLoading(false)
    }
  }

  const pick = (r: GeocodeResult) => {
    onSelectLocation(r.lat, r.lon)
    setOpen(false)
    setQuery(r.display_name.split(",").slice(0, 2).join(", "))
  }

  return (
    <div className="app-no-drag absolute left-1/2 top-3 z-[1050] w-[26rem] max-w-[60%] -translate-x-1/2">
      <div className="panel flex items-center gap-2 rounded-lg px-2.5 py-1.5">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch()
          }}
          placeholder="Search location..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <button
            onClick={runSearch}
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Search
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="panel panel-scroll mt-1 max-h-64 overflow-y-auto rounded-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-secondary"
              >
                <MapPin className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2">{r.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
