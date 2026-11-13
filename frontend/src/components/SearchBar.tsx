import { useState } from "react"
import { MagnifyingGlass, CircleNotch, MapPin } from "@/components/icons"
import { notifyError, notifyInfo } from "@/lib/notify"
import { GeocodeSearch } from "../../wailsjs/go/main/App"
import type { GeocodeResult } from "@/lib/types"
import { cn } from "@/lib/utils"

interface SearchBarProps {
  onSelectLocation: (lat: number, lon: number) => void
  /**
   * Where the bar sits, REPLACING the position it chose for itself.
   *
   * It was written for one mount and hard-coded the map's: centred at the top,
   * 26rem wide, at a z above the map's chrome. A studio area is a fraction of
   * that width and has a control column in the corner this would open under,
   * so a second caller had either to accept a bar wider than its pane or to
   * own a second geocoder. The default is the work map's own placement, so
   * that mount is unchanged by this becoming a choice.
   */
  className?: string
  /** Focused on arrival, for a bar that is revealed rather than always up. */
  autoFocus?: boolean
  /**
   * No ground of its own, for a bar set on one: the map's search sits in a
   * notch of the window's frame, which is its ground and its edge. The list of
   * results keeps its panel, since it hangs over the map.
   */
  bare?: boolean
}

export function SearchBar({
  onSelectLocation,
  className = "app-no-drag absolute left-1/2 top-3 z-1050 w-[26rem] max-w-[60%] -translate-x-1/2",
  autoFocus,
  bare = false,
}: SearchBarProps) {
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
      notifyError("Could not search for the place", e)
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
    <div className={className}>
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5",
          !bare && "panel rounded-md"
        )}
      >
        <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch()
          }}
          placeholder="Search location..."
          className="w-full bg-transparent text-read outline-none placeholder:text-muted-foreground"
        />
        {loading ? (
          <CircleNotch className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <button
            onClick={() => void runSearch()}
            className="shrink-0 rounded-md px-2 py-0.5 text-body text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            Search
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="panel panel-scroll mt-1 max-h-64 overflow-y-auto rounded-md">
          {results.map((r, i) => (
            <li key={i}>
              <button
                onClick={() => pick(r)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-label hover:bg-secondary"
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
