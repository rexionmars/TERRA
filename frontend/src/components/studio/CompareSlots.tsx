/**
 * The two slots the compare editor reads, named in its header.
 *
 * WHY THIS EXISTS. The pair used to be `predictionPicks.slice(-2)`: the last
 * two prediction planes in the selection path. With exactly two selected that
 * is the right answer and needs no control. With three it is still an answer --
 * the editor compared two of them, drew figures, and said nothing about which,
 * and there was no gesture that would reach the third. The design record names
 * this: a rule that assigns content by arity is well defined at two and
 * undefined above it.
 *
 * PINNING is Blender's own escape from a surface following the selection. A
 * pinned properties editor keeps displaying what it was pinned to while the
 * selection moves on, which is what lets one surface answer a question that
 * outlives the click that asked it. Here it does two things at once: it says
 * WHICH two planes are being read, and it stops the answer changing underfoot
 * while the reader looks at the board.
 *
 * Unpinned is the old behaviour, unchanged, so nothing anyone already does
 * stops working -- an empty slot follows the selection and says so.
 */
import { PushPin, PushPinSlash } from "@phosphor-icons/react"
import type { PredictionCompareSide } from "@/components/studio/BoardSolarDetail"
import {
  StudioMenuGroup,
  StudioMenuItem,
  StudioPopover,
} from "@/components/studio/StudioPopover"
import { StudioHeaderPopoverButton } from "@/components/studio/StudioHeaderControls"
import { cn } from "@/lib/utils"

export interface ComparePins {
  a?: string
  b?: string
}

/**
 * Which two board areas the slots resolve to, given the pins and the selection.
 *
 * Pure and separate from the component because the rule is not obvious and the
 * cases are easy to get wrong by one index. Returns the pair, or null when
 * either side has nothing to stand on.
 *
 *   pins        selected      result       why
 *   ----------  ------------  -----------  ----------------------------------
 *   none        [X, Y]        [X, Y]       the previous behaviour, unchanged
 *   none        [X, Y, Z]     [Y, Z]       the last two, as before
 *   none        [X]           null         a pair needs two
 *   A=P         [X]           [P, X]       pin the source, click the target
 *   A=P         [P, X]        [P, X]       the pinned plane is not spent twice
 *   B=Q         [X]           [X, Q]       the free slot is A here
 *   A=P, B=Q    anything      [P, Q]       both fixed; the selection is ignored
 *
 * The fourth row is the working case rather than an edge one. The question the
 * studio exists for is one source measured against each target in turn, so the
 * gesture is to pin the source and click through the targets -- and filling the
 * free slot by POSITION would blank the editor at exactly that moment, there
 * being no second pick to index.
 */
export function resolveComparePair(
  picks: ReadonlyArray<{ areaId: string }>,
  pins: ComparePins | undefined
): [string, string] | null {
  if (pins?.a && pins.b) return [pins.a, pins.b]
  // A pinned plane that is also selected must not fill the free slot as well,
  // or a single selection would compare a plane against itself.
  const free = picks.filter((p) => p.areaId !== pins?.a && p.areaId !== pins?.b)
  const take = free.slice(pins?.a || pins?.b ? -1 : -2)
  let next = 0
  const slot = (pinned?: string) =>
    pinned ?? take[next++]?.areaId ?? null
  const a = slot(pins?.a)
  const b = slot(pins?.b)
  return a && b ? [a, b] : null
}

function Slot({
  paneId,
  slot,
  side,
  pinned,
  available,
  surface,
  openFor,
  onOpenChange,
  onPin,
}: {
  paneId: string
  slot: "a" | "b"
  side: PredictionCompareSide | null
  pinned?: string
  available: readonly PredictionCompareSide[]
  surface: HTMLElement | null
  openFor: string | null
  onOpenChange: (key: string | null) => void
  onPin: (paneId: string, slot: "a" | "b", boardAreaId?: string) => void
}) {
  const key = `${paneId}:${slot}`
  const open = openFor === key
  const letter = slot.toUpperCase()

  return (
    <StudioPopover
      open={open}
      onOpenChange={(next) => onOpenChange(next ? key : null)}
      surface={surface}
      widthRem={15}
      trigger={(p) => (
        <StudioHeaderPopoverButton
          {...p}
          icon={pinned ? PushPin : undefined}
          /*
            The letter before the name, because the figures below this header
            are signed B minus A: a reader checking which way a delta points
            should not have to infer which plane is which from its position.
          */
          label={`${letter} ${side?.label ?? "follows selection"}`}
          showLabel
          open={open}
          active={!!pinned}
          className={cn("max-w-[11rem]", !side && "italic")}
          title={
            pinned
              ? `Slot ${letter} is pinned to ${side?.label ?? pinned}`
              : `Slot ${letter} follows the selection`
          }
        />
      )}
    >
      <StudioMenuGroup label={`Side ${letter}`}>
        <StudioMenuItem
          icon={PushPinSlash}
          label="Follow selection"
          checked={!pinned}
          title="Take this side from whatever prediction planes are selected"
          onSelect={() => {
            onPin(paneId, slot, undefined)
            onOpenChange(null)
          }}
        />
        {available.map((s) => (
          <StudioMenuItem
            key={s.areaId}
            icon={PushPin}
            label={s.label}
            note={s.period ?? undefined}
            checked={pinned === s.areaId}
            indented
            onSelect={() => {
              onPin(paneId, slot, s.areaId)
              onOpenChange(null)
            }}
          />
        ))}
      </StudioMenuGroup>
    </StudioPopover>
  )
}

/**
 * The centre of the star: the region the model was fitted on.
 *
 * One slot rather than two, because the cohort's topology is not symmetric. Of
 * N areas one is privileged and every other is measured against it, which is
 * N-1 comparisons where a pairwise device offers N(N-1)/2 -- and the surplus
 * answers a question nobody asked. Naming the source is what turns a set of
 * runs into that structure; without it there is no axis to place a target on.
 *
 * It does not follow the selection. A source that changed as the reader
 * clicked through targets would redraw the whole figure on every click, and
 * the figure's whole claim is that its points share an origin.
 */
export function SourceSlot({
  paneId,
  source,
  available,
  surface,
  openFor,
  onOpenChange,
  onPick,
}: {
  paneId: string
  source: PredictionCompareSide | null
  available: readonly PredictionCompareSide[]
  surface: HTMLElement | null
  openFor: string | null
  onOpenChange: (key: string | null) => void
  onPick: (paneId: string, boardAreaId?: string) => void
}) {
  const key = `${paneId}:source`
  const open = openFor === key
  return (
    <StudioPopover
      open={open}
      onOpenChange={(next) => onOpenChange(next ? key : null)}
      surface={surface}
      widthRem={15}
      trigger={(p) => (
        <StudioHeaderPopoverButton
          {...p}
          icon={PushPin}
          label={`Source: ${source?.label ?? "none"}`}
          showLabel
          open={open}
          active={!!source}
          className={cn("max-w-[14rem]", !source && "italic")}
          title={
            source
              ? `Every other area is measured against ${source.label}`
              : "Choose the region the model was fitted on"
          }
        />
      )}
    >
      <StudioMenuGroup label="Fitted on">
        <StudioMenuItem
          icon={PushPinSlash}
          label="No source"
          checked={!source}
          title="Clear the source; the cohort has no centre without one"
          onSelect={() => {
            onPick(paneId, undefined)
            onOpenChange(null)
          }}
        />
        {available.map((s) => (
          <StudioMenuItem
            key={s.areaId}
            icon={PushPin}
            label={s.label}
            note={s.period ?? undefined}
            checked={source?.areaId === s.areaId}
            indented
            onSelect={() => {
              onPick(paneId, s.areaId)
              onOpenChange(null)
            }}
          />
        ))}
      </StudioMenuGroup>
    </StudioPopover>
  )
}

export function CompareSlots({
  paneId,
  sides,
  pins,
  available,
  surface,
  openFor,
  onOpenChange,
  onPin,
}: {
  paneId: string
  sides: [PredictionCompareSide, PredictionCompareSide] | null
  pins?: ComparePins
  available: readonly PredictionCompareSide[]
  surface: HTMLElement | null
  openFor: string | null
  onOpenChange: (key: string | null) => void
  onPin: (paneId: string, slot: "a" | "b", boardAreaId?: string) => void
}) {
  return (
    <span className="flex min-w-0 items-center gap-0.5">
      <Slot
        paneId={paneId}
        slot="a"
        side={sides?.[0] ?? null}
        pinned={pins?.a}
        available={available}
        surface={surface}
        openFor={openFor}
        onOpenChange={onOpenChange}
        onPin={onPin}
      />
      <span className="shrink-0 px-0.5 text-[9px] text-muted-foreground" aria-hidden>
        &rarr;
      </span>
      <Slot
        paneId={paneId}
        slot="b"
        side={sides?.[1] ?? null}
        pinned={pins?.b}
        available={available}
        surface={surface}
        openFor={openFor}
        onOpenChange={onOpenChange}
        onPin={onPin}
      />
    </span>
  )
}
