/**
 * Operators by name, as a console: Enter runs, Enter on an empty line repeats
 * the last, Tab completes, the arrows walk back through what was typed. HELP
 * lists every operator and CLEAR empties the log.
 *
 * It is the report log with a line to add to it, as Solara's console and
 * Blender's Info editor are: what the application said, what ran, what was
 * typed and what the console answered, in the order it happened.
 *
 * Typing reaches it only while its line has the focus. The keymap leaves keys
 * alone inside a field, so HIDE_SELECTED can be typed without H hiding a plane
 * on the way.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react"

import {
  OPERATORS,
  OPERATOR_IDS,
  findOperator,
  formatKeys,
  operatorCompletions,
  operatorHere,
  runOperator,
} from "@/lib/operators"
import { clearReports, report, useReports, type ReportLevel } from "@/lib/reports"
import { AreaHeaderOptions } from "@/components/studio/StudioArea"
import { cn } from "@/lib/utils"

// What was typed, shared by every console for the session.
const past: string[] = []

const COLOUR: Partial<Record<ReportLevel, string>> = {
  input: "text-foreground",
  output: "text-foreground/80",
  operator: "text-muted-foreground",
  info: "text-accent-quiet",
  success: "text-foreground",
  error: "text-destructive-quiet",
}

/** The HELP listing: every operator, its label and its first key, in table order. */
function help(): void {
  const width = Math.max(...OPERATOR_IDS.map((id) => id.length))
  for (const id of OPERATOR_IDS) {
    const o = OPERATORS[id]
    const keys = o.keys?.[0] ? `  ${formatKeys(o.keys[0])}` : ""
    report("output", `${id.padEnd(width)}  ${o.label}${keys}`)
  }
}

function execute(typed: string): void {
  report("input", typed)
  const word = typed.trim().toUpperCase()
  if (word === "HELP") return help()
  if (word === "CLEAR") return clearReports()
  const id = findOperator(word)
  if (!id) {
    report("output", `${word} is not an operator. HELP lists them.`)
    return
  }
  if (!operatorHere(id)) {
    report("output", `${id} is not available on this screen.`)
    return
  }
  // Refused, it says why as a toast, which the log keeps; run, it logs itself.
  runOperator(id)
}

export function ConsoleEditor() {
  const lines = useReports()
  const [value, setValue] = useState("")
  const recall = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const completion = operatorCompletions(value)[0]
  const ghost =
    completion && completion.length > value.trim().length ? completion : undefined

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Enter": {
        const typed = value.trim() || past.at(-1)
        if (!typed) return
        if (value.trim()) past.push(typed)
        recall.current = null
        setValue("")
        execute(typed)
        return
      }
      case "Tab":
        if (ghost) {
          e.preventDefault()
          setValue(ghost)
        }
        return
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault()
        if (!past.length) return
        const at = recall.current ?? past.length
        const next = e.key === "ArrowUp" ? Math.max(0, at - 1) : at + 1
        if (next >= past.length) {
          recall.current = null
          setValue("")
        } else {
          recall.current = next
          setValue(past[next])
        }
        return
      }
      case "Escape":
        if (value) {
          e.stopPropagation()
          recall.current = null
          setValue("")
        }
    }
  }

  return (
    <>
      <AreaHeaderOptions>
        <button
          type="button"
          onClick={clearReports}
          disabled={lines.length === 0}
          className="flex h-5 items-center rounded-sm px-1.5 text-meta text-muted-foreground transition-colors hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </AreaHeaderOptions>
      <div
        className="telemetry flex h-full min-h-0 flex-col text-body leading-5"
        style={{ background: "var(--s-field)" }}
        // A press anywhere in the console is a press on its line, unless it
        // was the end of selecting text to copy.
        onClick={() => {
          if (!window.getSelection()?.toString()) input.current?.focus()
        }}
      >
        <div
          ref={scroller}
          role="log"
          aria-live="polite"
          className="panel-scroll selectable min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap px-2 pt-1"
        >
          {lines.map((l) => (
            <div key={l.id} className={cn(COLOUR[l.level])}>
              {l.level === "input"
                ? `>>> ${l.title}`
                : l.level === "operator"
                  ? `  ${l.title}`
                  : l.description
                    ? `${l.title} \u2014 ${l.description}`
                    : l.title}
            </div>
          ))}
        </div>
        <label className="flex h-6 shrink-0 items-center gap-1.5 border-t border-hairline px-2">
          <span className="text-accent-quiet" aria-hidden>
            &gt;&gt;&gt;
          </span>
          <span className="relative flex h-full flex-1 items-center">
            {ghost && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center text-foreground/35"
              >
                <span className="invisible whitespace-pre">{value}</span>
                {ghost.slice(value.length)}
              </span>
            )}
            <input
              ref={input}
              value={value}
              onChange={(e) => {
                recall.current = null
                setValue(e.target.value.toUpperCase())
              }}
              onKeyDown={onKeyDown}
              placeholder={value ? undefined : "An operator's name \u00b7 HELP lists them"}
              spellCheck={false}
              autoComplete="off"
              aria-label="Console input"
              className="relative w-full bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </span>
        </label>
      </div>
    </>
  )
}
