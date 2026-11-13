import { useEffect, useRef, useState } from "react"

import { ActivityGrid } from "@/components/ActivityGrid"
import {
  Camera,
  CircleNotch,
  FloppyDisk,
  FolderOpen,
  ImageSquare,
  SignOut,
  Trash,
  User,
} from "@/components/icons"
import { SettingGroup, SettingRow } from "@/components/shell/settingsParts"
import {
  BannerFigure,
  PHOTO_CHIP,
  SceneCredit,
  TabbedBanner,
} from "@/components/ui/TabbedBanner"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"
import { displayRunLabel } from "@/lib/aoiLabel"
import { useAuth } from "@/lib/auth"
import { notifyError } from "@/lib/notify"
import { SCENES } from "@/lib/orbitScenes"
import { mergePreferenceExtras, parsePreferenceExtras } from "@/lib/preferenceExtras"
import { runRowLine } from "@/lib/runSummary"
import type { InferenceRun } from "@/lib/types"
import { cn } from "@/lib/utils"

const MAX_AVATAR_BYTES = 2_000_000

/** The cover before one is chosen: the Cerrado, which the catalogue shows last. */
const DEFAULT_COVER = SCENES.length - 1

/** How many of the latest analyses the profile lists. */
const RECENT = 5

/*
  WHO IS SIGNED IN, SET ON THE GROUND THEY READ: a banner on one of the scenes
  of lib/orbitScenes.ts, with the photo and the name on the page's ground where
  it rises into the banner (TabbedBanner), as the catalogue's title is. The
  reader picks the scene with "Change cover", and it is kept in the
  preferences, so the banner is theirs rather than one the screen chose.

  Under it, what the account is and holds; then the settings of the identity,
  the year's activity and the latest analyses, each in a card.
*/
export function ProfileSection({
  onOpenRun,
  opening,
}: {
  /** Opens a saved analysis on the map. */
  onOpenRun: (run: InferenceRun) => void
  /** An analysis is being opened, so the buttons wait for it. */
  opening: boolean
}) {
  const {
    user,
    runs,
    projects,
    prefs,
    savePrefs,
    updateProfile,
    setAvatar,
    clearAvatar,
    refreshRuns,
    logout,
  } = useAuth()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  /** The cover just chosen, shown before the preferences come back with it. */
  const [chosenCover, setChosenCover] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  /*
    The stored name SEEDS the field, and replaces what is in it only when the
    stored name itself changes: keyed on the string rather than on `user`,
    which is a fresh object after every save, so uploading a photo mid-edit
    does not revert a half-typed name.
  */
  const storedName = user?.display_name ?? ""
  useEffect(() => {
    setName(storedName)
  }, [storedName])

  /* Once, on arrival. `refreshRuns` is stable, so this is a mount effect. */
  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  if (!user) return null

  const coverPath =
    chosenCover ?? parsePreferenceExtras(prefs?.extras_json).profile_cover
  const coverIndex = SCENES.findIndex((s) => s.path === coverPath)
  const cover = SCENES[coverIndex >= 0 ? coverIndex : DEFAULT_COVER]

  const nextCover = () => {
    const next = SCENES[(SCENES.indexOf(cover) + 1) % SCENES.length]
    setChosenCover(next.path)
    if (!prefs) return
    void savePrefs(
      {
        ...prefs,
        extras_json: mergePreferenceExtras(prefs.extras_json, {
          profile_cover: next.path,
        }),
      },
      { silent: true }
    ).catch((e: unknown) => notifyError("The cover could not be kept", e))
  }

  const saveName = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await updateProfile(name.trim())
    } finally {
      setBusy(false)
    }
  }

  const onPickPhoto = async (file: File | null) => {
    if (!file) return
    try {
      if (!file.type.startsWith("image/")) {
        notifyError("That file is not a picture", "Choose a PNG, JPEG or WebP image.")
        return
      }
      if (file.size > MAX_AVATAR_BYTES) {
        notifyError("The photo is too large", "A profile photo can be up to 2 MB.")
        return
      }
      setBusy(true)
      await setAvatar(await readAsDataURL(file))
    } catch (e) {
      notifyError("The photo could not be set", e)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const created = new Date(user.created_at)
  const since = Number.isNaN(created.getTime())
    ? null
    : created.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
  const recent = runs.slice(0, RECENT)

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
      />
      <section aria-labelledby="profile-name">
        <TabbedBanner
          held={
            <div className="flex items-end gap-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                title="Change the photo"
                aria-label="Change the photo"
                className="group relative size-18 shrink-0 overflow-hidden rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Portrait uri={user.avatar_uri} name={user.display_name} />
                <span className="absolute inset-0 grid place-items-center bg-[rgb(4_6_11/0.55)] text-[rgb(236_232_223)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {busy ? (
                    <CircleNotch className="size-5 animate-spin" />
                  ) : (
                    <Camera className="size-5" />
                  )}
                </span>
              </button>
              <div className="min-w-0 pb-0.5">
                <p className="eyebrow">Profile</p>
                <h2
                  id="profile-name"
                  className="mt-1 max-w-[30rem] truncate font-display text-hero font-semibold text-foreground"
                >
                  {user.display_name}
                </h2>
                <p className="mt-0.5 truncate text-label text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
          }
        >
          <img
            key={cover.path}
            src={cover.path}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
            style={{ objectPosition: cover.focus }}
          />
          <div className="absolute top-3 right-3 left-3 flex justify-end">
            <SceneCredit scene={cover} />
          </div>
          <button
            type="button"
            onClick={nextCover}
            title={`The cover is one of ${SCENES.length} scenes; this shows the next`}
            className={cn(
              PHOTO_CHIP,
              "absolute right-3 bottom-3 flex items-center gap-1.5 px-3 py-1 text-label transition-colors hover:bg-[rgb(4_6_11/0.8)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            )}
          >
            <ImageSquare className="size-3.5" />
            Change cover
          </button>
        </TabbedBanner>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-12 gap-y-4">
          <p className="max-w-[26rem] text-read text-muted-foreground">
            An account on this machine. It ties your analyses and projects to you and
            holds your preferences; nothing of it is sent to a server.
          </p>
          <div className="flex items-end gap-8">
            <dl className="flex gap-8">
              <BannerFigure label="Projects" value={projects.length} />
              {since && <BannerFigure label="Since" value={since} />}
            </dl>
            {/*
              Sign out belongs to the account it ends, beside the name, not at
              the foot of a column as far from it as the layout allowed.
            */}
            <button
              type="button"
              onClick={() => void logout()}
              title="Saved runs and projects stay on this machine and are here when you sign back in"
              className={btnGhost}
            >
              <SignOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </section>

      <div className="mt-10">
        <SettingGroup title="Identity">
          <SettingRow
            title="Photo"
            description="Shown at the foot of the rail. PNG, JPEG or WebP, up to 2 MB."
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className={btnGhost}
              >
                <Camera className="size-3.5" />
                {user.avatar_uri ? "Replace" : "Upload"}
              </button>
              {user.avatar_uri && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearAvatar()}
                  className={btnGhost}
                >
                  <Trash className="size-3.5" />
                  Remove
                </button>
              )}
            </div>
          </SettingRow>
          <SettingRow
            title="Display name"
            description="The name in the rail and in the header of each analysis."
          >
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void saveName()
              }}
            >
              <input
                aria-label="Display name"
                className="field-input w-56 focus-visible:ring-1 focus-visible:ring-ring"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                type="submit"
                disabled={busy || !name.trim() || name.trim() === storedName}
                className={btnPrimary}
              >
                <FloppyDisk className="size-3.5" />
                Save
              </button>
            </form>
          </SettingRow>
          <SettingRow
            title="Email"
            description="What the account is known by on this machine. It cannot be changed."
          >
            <span className="telemetry text-label text-foreground">{user.email}</span>
          </SettingRow>
        </SettingGroup>

        <SettingGroup
          title="Activity"
          description="Runs per day over the last year. A run is one classification, composition or water analysis."
        >
          <div className="overflow-x-auto px-5 py-4">
            <ActivityGrid />
          </div>
        </SettingGroup>

        <SettingGroup
          title="Recent analyses"
          description="The latest few. Every analysis is under Analyses in the rail, filed by project."
        >
          {recent.length === 0 ? (
            <SettingRow
              title="No analyses yet"
              description="A run you make is saved here."
            />
          ) : (
            recent.map((r) => (
              <SettingRow
                key={r.id}
                title={displayRunLabel(r.label) || r.model_kind}
                description={<span className="block truncate">{runRowLine(r)}</span>}
              >
                <button
                  type="button"
                  disabled={opening}
                  onClick={() => onOpenRun(r)}
                  className={btnGhost}
                >
                  <FolderOpen className="size-3.5" />
                  Open
                </button>
              </SettingRow>
            ))
          )}
        </SettingGroup>
      </div>
    </>
  )
}

/** The photo, or the initials on a raised ground when there is none. */
function Portrait({ uri, name }: { uri?: string; name: string }) {
  if (uri) {
    return <img src={uri} alt="" className="size-full object-cover" />
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
  return (
    <span className="grid size-full place-items-center bg-[rgb(var(--p-surface-raised))] font-display text-display font-semibold text-foreground">
      {initials || <User className="size-7 text-muted-foreground" />}
    </span>
  )
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
