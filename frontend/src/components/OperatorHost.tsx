/**
 * The keymap, the operator search, and the operators that belong to no screen.
 *
 * Mounted once, beside the title bar, so the keys work on every screen and the
 * search can be opened from any of them. The board registers its own operators
 * while it is mounted; what is registered here -- the search itself, Settings
 * and the keymap -- is about the application rather than about any board, and
 * has to answer on the settings screen too, where no board exists.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"

import { useAuth } from "@/lib/auth"
import {
  OPERATORS,
  formatKeys,
  installKeymap,
  pollOperator,
  runOperator,
  searchOperators,
  shortcut,
  useOperators,
} from "@/lib/operators"
import { ModalShell } from "@/components/ui/ModalShell"
import { cn } from "@/lib/utils"

export function OperatorHost() {
  const { user, goProfile } = useAuth()
  const [searching, setSearching] = useState(false)

  useEffect(() => installKeymap(), [])

  const signedIn = () => (user ? true : "Sign in first; settings belong to an account")
  useOperators({
    SEARCH: { run: () => setSearching(true) },
    PREFERENCES: { run: () => goProfile(), poll: signedIn },
    KEYMAP: { run: () => goProfile("keymap"), poll: signedIn },
  })

  return searching ? <OperatorSearch onClose={() => setSearching(false)} /> : null
}

/**
 * Every operator by name, with where its row lives, its shortcut, and why it
 * cannot run when it cannot.
 *
 * Unavailable operators are listed rather than filtered out. A search that
 * hides "Save studio" on the settings screen reads as a command that does not
 * exist; listed and greyed, with its reason on the highlighted row, it says
 * where to go to run it.
 */
function OperatorSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const results = useMemo(() => searchOperators(query), [query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [index])

  const run = (i: number) => {
    const id = results[i]
    if (!id || pollOperator(id) !== true) return
    onClose()
    runOperator(id)
  }

  return (
    <ModalShell
      onDismiss={onClose}
      label="Search operators"
      // Near the top, where a command line is looked for, rather than centred.
      className="mt-[12vh] w-[min(34rem,calc(100vw-2rem))] self-start"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3">
        <MagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search operators"
          role="combobox"
          aria-expanded="true"
          aria-controls="operator-search-list"
          aria-activedescendant={results[index] ? `op-${results[index]}` : undefined}
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIndex((i) => Math.min(results.length - 1, i + 1))
            else if (e.key === "ArrowUp") setIndex((i) => Math.max(0, i - 1))
            else if (e.key === "Enter") run(index)
            else return
            e.preventDefault()
          }}
          className="h-9 min-w-0 flex-1 bg-transparent text-emphasis text-foreground outline-none placeholder:text-muted-foreground"
        />
        <span className="telemetry shrink-0 text-[9px] text-muted-foreground">
          {formatKeys("F3")}
        </span>
      </div>
      <ul
        ref={list}
        id="operator-search-list"
        role="listbox"
        aria-label="Operators"
        className="max-h-[50vh] overflow-y-auto py-1"
      >
        {results.length === 0 && (
          <li className="px-3 py-2 text-meta text-muted-foreground">
            No operator matches.
          </li>
        )}
        {results.map((id, i) => {
          const op = OPERATORS[id]
          const poll = pollOperator(id)
          const disabled = poll !== true
          const on = i === index
          const Glyph = op.icon
          const keys = shortcut(id)
          return (
            <li
              key={id}
              id={`op-${id}`}
              data-index={i}
              role="option"
              aria-selected={on}
              aria-disabled={disabled || undefined}
              title={disabled ? poll : op.description}
              onPointerMove={() => setIndex(i)}
              onClick={() => run(i)}
              className={cn(
                "flex items-center gap-2 px-3 py-[5px] text-meta",
                on && "bg-accent-dim",
                disabled ? "text-muted-foreground/50" : "text-foreground"
              )}
            >
              <span className="flex size-3 shrink-0 items-center justify-center">
                {Glyph && <Glyph className="size-3 text-muted-foreground" />}
              </span>
              <span className="shrink-0 text-muted-foreground">{op.menu} ›</span>
              <span className="min-w-0 flex-1 truncate">{op.label}</span>
              {disabled && on && (
                <span className="max-w-[45%] truncate text-[9px] text-warning">
                  {poll}
                </span>
              )}
              {keys && (
                <span className="telemetry shrink-0 text-[9px] text-muted-foreground">
                  {keys}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </ModalShell>
  )
}
