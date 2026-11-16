import { useState } from "react"

import { CaretDown, Clock, Polygon, X, type Icon } from "@/components/icons"
import { LineModels, LineSearch } from "@/components/lineIcons"
import { KINDS, tint } from "@/components/shell/analysisParts"
import { MenuGroup, MenuItem, MenuPopover } from "@/components/workspace/MenuPopover"
import {
  NO_FILTER,
  SINCE,
  isFiltered,
  savedLabel,
  type FacetOption,
  type Facets,
  type RunFilter,
  type Saved,
} from "@/lib/runFilters"
import { cn } from "@/lib/utils"

type Menu = "model" | "saved" | "area"

/* A list longer than this is given a field to narrow it, and a scroll. */
const LONG_LIST = 8

const RULE = <div className="my-1 border-t border-[rgb(var(--p-line)/0.22)]" />

/*
  THE FILTERS ABOVE THE LOG OF ANALYSES.

  The products are a row of pills, since they are few and their counts are
  read at a glance. The model, the day saved and the area are a chip each that
  opens a menu: a chip with a dashed edge is a filter not set, and a set one is
  drawn solid, with its value and a cross that clears it.

  Every count is taken under the other filters (lib/runFilters.ts), so an
  option at zero is greyed rather than hidden and a menu keeps its shape while
  the reader narrows the page. A pill at zero stays pressable: the page it
  opens says that nothing matches and offers to clear.
*/
export function AnalysisFilters({
  facets,
  surface,
  onChange,
}: {
  facets: Facets
  /** Portal host for the menus. */
  surface: HTMLElement | null
  onChange: (filter: RunFilter) => void
}) {
  const [menu, setMenu] = useState<Menu | null>(null)
  const f = facets.filter
  const set = (patch: Partial<RunFilter>) => onChange({ ...f, ...patch })
  const toggle = (m: Menu) => (open: boolean) => setMenu(open ? m : null)
  const pick = (patch: Partial<RunFilter>) => {
    set(patch)
    setMenu(null)
  }

  const products = KINDS.filter((k) => facets.products.has(k.id))
  const everyProduct = [...facets.products.values()].reduce((a, b) => a + b, 0)
  const months = facets.months
  const model = facets.models.find((m) => m.key === f.model)
  const area = facets.areas.find((a) => a.key === f.area)

  const showModel = facets.models.length > 1 || f.model !== null
  const showSaved = months.length > 0
  const showArea = facets.areas.length > 1 || f.area !== null
  if (products.length < 2 && !showModel && !showSaved && !showArea) return null

  return (
    <div className="mt-6 flex flex-col gap-2.5">
      {products.length > 1 && (
        <div role="radiogroup" aria-label="Product" className="flex flex-wrap gap-1.5">
          <Pill
            on={f.product === null}
            label="All products"
            count={everyProduct}
            onSelect={() => set({ product: null })}
          />
          {products.map((kind) => (
            <Pill
              key={kind.id}
              on={f.product === kind.id}
              label={kind.label}
              count={facets.products.get(kind.id) ?? 0}
              icon={
                <kind.icon className="size-3.5" style={{ color: tint(kind.token) }} />
              }
              onSelect={() => set({ product: kind.id })}
            />
          ))}
        </div>
      )}

      <div
        role="group"
        aria-label="Filters"
        className="flex flex-wrap items-center gap-1.5"
      >
        {showModel && (
          <FilterChip
            icon={LineModels}
            name="Model"
            value={model?.label ?? null}
            open={menu === "model"}
            onOpenChange={toggle("model")}
            onClear={() => pick({ model: null })}
            surface={surface}
            widthRem={15}
          >
            <MenuItem
              label="Any model"
              checked={f.model === null}
              onSelect={() => pick({ model: null })}
            />
            {RULE}
            <MenuGroup label="Classification made with">
              {facets.models.map((o) => (
                <OptionItem
                  key={o.key}
                  option={o}
                  checked={o.key === f.model}
                  onSelect={() => pick({ model: o.key })}
                />
              ))}
            </MenuGroup>
          </FilterChip>
        )}

        {showSaved && (
          <FilterChip
            icon={Clock}
            name="Saved"
            value={f.saved.when === "any" ? null : savedLabel(f.saved)}
            open={menu === "saved"}
            onOpenChange={toggle("saved")}
            onClear={() => pick({ saved: { when: "any" } })}
            surface={surface}
            widthRem={16}
          >
            <MenuItem
              label="Any time"
              checked={f.saved.when === "any"}
              onSelect={() => pick({ saved: { when: "any" } })}
            />
            {SINCE.map((s) => (
              <OptionItem
                key={s.id}
                option={{ key: s.id, label: s.label, count: facets.since[s.id] }}
                checked={f.saved.when === "since" && f.saved.since === s.id}
                onSelect={() => pick({ saved: { when: "since", since: s.id } })}
              />
            ))}
            {months.length > 0 && (
              <>
                {RULE}
                <MenuGroup label="Month">
                  <div className={cn(months.length > 6 && "max-h-44 overflow-y-auto")}>
                    {months.map((o) => (
                      <OptionItem
                        key={o.key}
                        option={o}
                        checked={f.saved.when === "month" && f.saved.month === o.key}
                        onSelect={() =>
                          pick({ saved: { when: "month", month: o.key } })
                        }
                      />
                    ))}
                  </div>
                </MenuGroup>
              </>
            )}
            {RULE}
            <MenuGroup label="Between">
              <Between saved={f.saved} onChange={(saved) => set({ saved })} />
            </MenuGroup>
          </FilterChip>
        )}

        {showArea && (
          <FilterChip
            icon={Polygon}
            name="Area"
            value={area?.label ?? null}
            open={menu === "area"}
            onOpenChange={toggle("area")}
            onClear={() => pick({ area: null })}
            surface={surface}
            widthRem={15}
          >
            <AreaMenu
              areas={facets.areas}
              chosen={f.area}
              onPick={(key) => pick({ area: key })}
            />
          </FilterChip>
        )}

        {isFiltered(f) && (
          <button
            type="button"
            onClick={() => {
              onChange(NO_FILTER)
              setMenu(null)
            }}
            className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-label text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3" />
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

function Pill({
  on,
  label,
  count,
  icon,
  onSelect,
}: {
  on: boolean
  label: string
  count: number
  icon?: React.ReactNode
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onSelect}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-label transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        on
          ? "border-[rgb(var(--p-line-strong)/0.7)] bg-[rgb(var(--p-surface-raised))] text-foreground"
          : "border-[rgb(var(--p-line)/0.45)] text-muted-foreground hover:bg-hover hover:text-foreground",
        !on && count === 0 && "opacity-55"
      )}
    >
      {icon}
      {label}
      <span className="telemetry text-meta text-muted-foreground">{count}</span>
    </button>
  )
}

/**
 * A filter as a chip that opens its menu. Unset, its edge is dashed and it
 * names the filter; set, it is solid, shows the value, and has a cross.
 */
function FilterChip({
  icon: Glyph,
  name,
  value,
  open,
  onOpenChange,
  onClear,
  surface,
  widthRem,
  children,
}: {
  icon: Icon
  name: string
  value: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClear: () => void
  surface: HTMLElement | null
  widthRem: number
  children: React.ReactNode
}) {
  return (
    <MenuPopover
      open={open}
      onOpenChange={onOpenChange}
      surface={surface}
      align="start"
      widthRem={widthRem}
      trigger={(t) => (
        <span
          ref={t.ref}
          className={cn(
            "inline-flex h-7 items-center rounded-full border text-label transition-colors",
            value
              ? "border-[rgb(var(--p-line-strong)/0.7)] bg-[rgb(var(--p-surface-raised))] text-foreground"
              : cn(
                  "border-dashed border-[rgb(var(--p-line)/0.6)] text-muted-foreground hover:bg-hover hover:text-foreground",
                  open && "bg-hover text-foreground"
                )
          )}
        >
          <button
            type="button"
            onClick={t.onClick}
            aria-expanded={t["aria-expanded"]}
            aria-haspopup={t["aria-haspopup"]}
            aria-label={value ? `${name}: ${value}` : `Filter by ${name.toLowerCase()}`}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-full pl-3 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
              value ? "pr-1.5" : "pr-2.5"
            )}
          >
            <Glyph className="size-3.5 shrink-0" />
            <span className={cn(value && "text-muted-foreground")}>{name}</span>
            {value && (
              <>
                <span aria-hidden className="h-3 w-px bg-[rgb(var(--p-line)/0.6)]" />
                <span className="max-w-48 truncate">{value}</span>
              </>
            )}
            <CaretDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
          {value && (
            <button
              type="button"
              onClick={onClear}
              title={`Clear the ${name.toLowerCase()} filter`}
              aria-label={`Clear the ${name.toLowerCase()} filter`}
              className="mr-1 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      )}
    >
      {children}
    </MenuPopover>
  )
}

/** An option and its count; at zero, and not the one chosen, it cannot be pressed. */
function OptionItem({
  option,
  checked,
  onSelect,
}: {
  option: FacetOption
  checked: boolean
  onSelect: () => void
}) {
  return (
    <MenuItem
      label={option.label}
      note={String(option.count)}
      checked={checked}
      disabled={option.count === 0 && !checked}
      onSelect={onSelect}
    />
  )
}

/** Two days, both included; either may be left empty to leave that end open. */
function Between({
  saved,
  onChange,
}: {
  saved: Saved
  onChange: (saved: Saved) => void
}) {
  const from = saved.when === "between" ? saved.from : ""
  const to = saved.when === "between" ? saved.to : ""
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 px-2 pb-1">
      <label htmlFor="analyses-saved-from" className="text-label text-muted-foreground">
        From
      </label>
      <input
        id="analyses-saved-from"
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onChange({ when: "between", from: e.target.value, to })}
        className="field-input"
      />
      <label htmlFor="analyses-saved-to" className="text-label text-muted-foreground">
        To
      </label>
      <input
        id="analyses-saved-to"
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onChange({ when: "between", from, to: e.target.value })}
        className="field-input"
      />
    </div>
  )
}

/** The areas in scope, narrowed by a field of its own when they are many. */
function AreaMenu({
  areas,
  chosen,
  onPick,
}: {
  areas: readonly FacetOption[]
  chosen: string | null
  onPick: (key: string | null) => void
}) {
  const [text, setText] = useState("")
  const long = areas.length > LONG_LIST
  const q = text.trim().toLowerCase()
  const listed = q ? areas.filter((a) => a.label.toLowerCase().includes(q)) : areas
  return (
    <>
      {long && (
        <label className="relative mb-1 flex items-center">
          <LineSearch className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && listed.length === 1) onPick(listed[0].key)
              // Into the list, which the menu's own arrows walk from there.
              if (e.key === "ArrowDown") {
                e.preventDefault()
                e.currentTarget
                  .closest("[role='menu']")
                  ?.querySelector<HTMLElement>("[role='menuitem']:not(:disabled)")
                  ?.focus()
              }
            }}
            placeholder="Find an area"
            aria-label="Find an area"
            // Not .field-input: an unlayered class, it would win over the inset
            // the glyph needs.
            className="h-8 w-full rounded-sm border border-[rgb(var(--p-line)/0.4)] bg-transparent pr-2 pl-7 text-body text-foreground outline-none placeholder:text-muted-foreground focus:border-[rgb(var(--p-accent)/0.55)]"
          />
        </label>
      )}
      <MenuItem
        label="Any area"
        checked={chosen === null}
        onSelect={() => onPick(null)}
      />
      {RULE}
      <div className={cn(long && "max-h-64 overflow-y-auto")}>
        {listed.map((o) => (
          <OptionItem
            key={o.key}
            option={o}
            checked={o.key === chosen}
            onSelect={() => onPick(o.key)}
          />
        ))}
        {listed.length === 0 && (
          <p className="px-2 py-1.5 text-label text-muted-foreground">
            No area by that name.
          </p>
        )}
      </div>
    </>
  )
}
