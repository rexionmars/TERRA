/**
 * The keymap, drawn from the operator table itself.
 *
 * Not a list kept beside the code: a shortcut printed here is the one the
 * window listens for, because both read `OPERATORS`. Operators without keys
 * are listed too, since the search finds them and this is where a reader looks
 * to learn what exists.
 */
import { useState } from "react"

import { OPERATORS, OPERATOR_IDS, formatKeys } from "@/lib/operators"

export function KeymapTable() {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const rows = OPERATOR_IDS.filter((id) => {
    if (!q) return true
    const o = OPERATORS[id]
    const keys = (o.keys ?? []).map((k) => formatKeys(k)).join(" ")
    return `${o.label} ${o.menu} ${keys} ${id}`.toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
      <p className="text-body leading-relaxed text-muted-foreground">
        None of these work while typing in a field, except the ones that save, search
        and open settings. Every command here can also be found by name with{" "}
        <span className="telemetry text-foreground">{formatKeys("F3")}</span>.
      </p>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by name or key"
        aria-label="Filter the keymap"
        spellCheck={false}
        className="field-input max-w-xs focus-visible:ring-1 focus-visible:ring-ring"
      />
      <table className="w-full text-body">
        <thead className="text-left">
          <tr className="eyebrow !text-micro">
            <th className="py-1 pr-2 font-normal">Command</th>
            <th className="py-1 pr-2 font-normal">Keys</th>
            <th className="py-1 font-normal">Menu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((id) => {
            const o = OPERATORS[id]
            return (
              <tr key={id} className="border-t border-hairline" title={o.description}>
                <td className="py-1 pr-2 text-foreground">{o.label}</td>
                <td className="py-1 pr-2">
                  {o.keys?.map((k) => (
                    <span
                      key={k}
                      className="telemetry mr-1 inline-block rounded-xs px-1 text-foreground"
                      style={{ background: "rgb(var(--p-line) / 0.28)" }}
                    >
                      {formatKeys(k)}
                    </span>
                  ))}
                </td>
                <td className="py-1 text-muted-foreground">{o.menu}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-2 text-muted-foreground">
                No command matches.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
