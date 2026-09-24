/**
 * The keymap, drawn from the operator table itself.
 *
 * Not a list kept beside the code: a shortcut printed here is the one the
 * window listens for, because both read `OPERATORS`. Operators without keys
 * are listed too, since the search finds them and this is where a reader looks
 * to learn what exists.
 */
import { useState } from "react"

import { OPERATORS, OPERATOR_IDS, SCOPE_NAMES, formatKeys } from "@/lib/operators"

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
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
      <p className="text-body leading-relaxed text-muted-foreground">
        Keys marked Viewport or Outliner work with the pointer over that editor,
        since no area holds the keyboard. None of them work while typing in a
        field, except the ones that save, search and open settings. Every
        command here can also be found by name with{" "}
        <span className="telemetry text-foreground">{formatKeys("F3")}</span>,
        or typed in the Console by the name in its last column.
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
          <tr className="eyebrow !text-[9px]">
            <th className="py-1 pr-2 font-normal">Command</th>
            <th className="py-1 pr-2 font-normal">Keys</th>
            <th className="py-1 pr-2 font-normal">Where</th>
            <th className="py-1 pr-2 font-normal">Menu</th>
            <th className="py-1 font-normal">Console</th>
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
                      className="telemetry mr-1 inline-block rounded-[2px] px-1 text-foreground"
                      style={{ background: "rgb(var(--p-line) / 0.28)" }}
                    >
                      {formatKeys(k)}
                    </span>
                  ))}
                </td>
                <td className="py-1 pr-2 text-muted-foreground">
                  {o.keys?.length ? SCOPE_NAMES[o.scope ?? "window"] : ""}
                </td>
                <td className="py-1 pr-2 text-muted-foreground">{o.menu}</td>
                <td className="telemetry selectable py-1 text-meta text-muted-foreground">
                  {id}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-2 text-muted-foreground">
                No command matches.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
