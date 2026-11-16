import { useEffect, useRef, useState } from "react"

import { ActivityGrid } from "@/components/ActivityGrid"
import {
  Camera,
  CircleNotch,
  ImageSquare,
  Plus,
  UploadSimple,
  User,
  X,
} from "@/components/icons"
import {
  LineDelete,
  LineFolderOpen,
  LineSave,
  LineSignOut,
} from "@/components/lineIcons"
import { SettingGroup, SettingRow } from "@/components/shell/settingsParts"
import {
  BannerFigure,
  PHOTO_CHIP,
  SceneCredit,
  TabbedBanner,
} from "@/components/ui/TabbedBanner"
import { btnGhost, btnPrimary } from "@/components/ui/buttons"
import { MenuGroup, MenuItem, MenuPopover } from "@/components/workspace/MenuPopover"
import { displayRunLabel } from "@/lib/aoiLabel"
import { useAuth, type AccountPicture } from "@/lib/auth"
import { notifyError } from "@/lib/notify"
import { SCENES, type Scene } from "@/lib/orbitScenes"
import {
  BADGE_FIT,
  COVER_FIT,
  readAsDataURL,
  readPicture,
  type PictureFit,
} from "@/lib/pictureFile"
import { mergePreferenceExtras, parsePreferenceExtras } from "@/lib/preferenceExtras"
import { runRowLine } from "@/lib/runSummary"
import type { InferenceRun } from "@/lib/types"
import { cn } from "@/lib/utils"

const MAX_AVATAR_BYTES = 2_000_000

/** The cover before one is chosen: the Cerrado, which the catalogue shows last. */
const DEFAULT_COVER = SCENES.length - 1

/** The cover preference that picks the reader's own picture over the scenes. */
const UPLOADED_COVER = "upload"

/** A cover: one of the scenes, or the picture the reader uploaded. */
type Cover = { scene: Scene } | { uri: string }

/** How each picture is fitted before it is sent, and what a failure is called. */
const FITTED: Record<"cover" | "badge", { fit: PictureFit; failure: string }> = {
  cover: { fit: COVER_FIT, failure: "The cover could not be set" },
  badge: { fit: BADGE_FIT, failure: "The badge could not be set" },
}

/** How many of the latest analyses the profile lists. */
const RECENT = 5

/*
  WHO IS SIGNED IN, SET ON THE GROUND THEY READ: a banner on one of the scenes
  of lib/orbitScenes.ts, or on a picture of the reader's own, with the photo and
  the name on the page's ground where it rises into the banner (TabbedBanner),
  as the catalogue's title is. The cover is chosen from one button on the
  banner, shown while the pointer is over it: the reader's own picture or one
  of the scenes, and the choice is kept in the preferences, so the banner is
  theirs rather than one the screen chose.

  EACH PICTURE IS CHANGED WHERE IT IS SEEN. Pressing the photo or the badge
  picks a new one, and a cross at its corner, shown on hover, takes it away;
  the cover's menu uploads and removes the reader's own. Settings has no rows
  for them, which only repeated what the pictures already do.

  The badge of the reader's institution sits above the name, where the eyebrow
  is when there is none. It is drawn on a light plate, because institutions
  publish their logos for white paper: a dark wordmark on a transparent ground
  would vanish into the dark theme's page.

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
    setPicture,
    clearPicture,
    refreshRuns,
    logout,
  } = useAuth()
  const [name, setName] = useState("")
  /** What is being saved: the name or one of the pictures. */
  const [working, setWorking] = useState<AccountPicture | "name" | null>(null)
  const busy = working !== null
  /** The cover just chosen, shown before the preferences come back with it. */
  const [chosenCover, setChosenCover] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const coverInput = useRef<HTMLInputElement>(null)
  const badgeInput = useRef<HTMLInputElement>(null)

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

  const covers: Cover[] = [
    ...(user.cover_uri ? [{ uri: user.cover_uri }] : []),
    ...SCENES.map((scene) => ({ scene })),
  ]
  const coverChoice =
    chosenCover ?? parsePreferenceExtras(prefs?.extras_json).profile_cover
  const coverIndex = covers.findIndex((c) =>
    "uri" in c ? coverChoice === UPLOADED_COVER : c.scene.path === coverChoice
  )
  const cover: Cover =
    coverIndex >= 0 ? covers[coverIndex] : { scene: SCENES[DEFAULT_COVER] }

  const keepCover = (choice: string) => {
    setChosenCover(choice)
    if (!prefs) return
    void savePrefs(
      {
        ...prefs,
        extras_json: mergePreferenceExtras(prefs.extras_json, {
          profile_cover: choice,
        }),
      },
      { silent: true }
    ).catch((e: unknown) => notifyError("The cover could not be kept", e))
  }

  const saveName = async () => {
    if (!name.trim()) return
    setWorking("name")
    try {
      await updateProfile(name.trim())
    } finally {
      setWorking(null)
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
      setWorking("photo")
      await setPicture("photo", await readAsDataURL(file))
    } catch (e) {
      notifyError("The photo could not be set", e)
    } finally {
      setWorking(null)
      if (photoInput.current) photoInput.current.value = ""
    }
  }

  /* A cover or a badge is fitted to where it is drawn first (lib/pictureFile.ts). */
  const onPickFitted = async (picture: "cover" | "badge", file: File | null) => {
    if (!file) return
    const { fit, failure } = FITTED[picture]
    setWorking(picture)
    try {
      await setPicture(picture, await readPicture(file, fit))
      if (picture === "cover") keepCover(UPLOADED_COVER)
    } catch (e) {
      notifyError(failure, e)
    } finally {
      setWorking(null)
      const input = picture === "cover" ? coverInput.current : badgeInput.current
      if (input) input.value = ""
    }
  }

  const removePicture = async (picture: AccountPicture) => {
    setWorking(picture)
    try {
      await clearPicture(picture)
      if (picture === "cover" && "uri" in cover) {
        keepCover(SCENES[DEFAULT_COVER].path)
      }
    } catch (e) {
      notifyError(`The ${picture} could not be removed`, e)
    } finally {
      setWorking(null)
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
        ref={photoInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
      />
      <input
        ref={coverInput}
        type="file"
        accept={COVER_FIT.accept.join(",")}
        className="hidden"
        onChange={(e) => void onPickFitted("cover", e.target.files?.[0] ?? null)}
      />
      <input
        ref={badgeInput}
        type="file"
        accept={BADGE_FIT.accept.join(",")}
        className="hidden"
        onChange={(e) => void onPickFitted("badge", e.target.files?.[0] ?? null)}
      />
      <section aria-labelledby="profile-name">
        <TabbedBanner
          className="group/banner"
          held={
            <div className="flex items-end gap-4">
              <div className="group/photo relative shrink-0">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => photoInput.current?.click()}
                  title="Change the photo: PNG, JPEG or WebP, up to 2 MB. It is also shown at the foot of the rail"
                  aria-label="Change the photo"
                  className="group relative block size-18 overflow-hidden rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Portrait uri={user.avatar_uri} name={user.display_name} />
                  <span className="absolute inset-0 grid place-items-center bg-[rgb(4_6_11/0.55)] text-[rgb(236_232_223)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {working === "photo" ? (
                      <CircleNotch className="size-5 animate-spin" />
                    ) : (
                      <Camera className="size-5" />
                    )}
                  </span>
                </button>
                {user.avatar_uri && (
                  <RemoveCross
                    label="Remove the photo"
                    busy={busy}
                    reveal="group-hover/photo:opacity-100"
                    onRemove={() => void removePicture("photo")}
                  />
                )}
              </div>
              <div className="min-w-0 pb-0.5">
                {user.badge_uri ? (
                  <div className="group/badge relative mb-1.5 w-fit">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => badgeInput.current?.click()}
                      title={`Change the badge of your institution: ${BADGE_FIT.acceptLabel}, drawn on a light plate`}
                      aria-label="Change the badge of your institution"
                      className="group relative block overflow-hidden rounded-sm bg-white px-2 py-1 ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <img
                        src={user.badge_uri}
                        alt="Badge of your institution"
                        draggable={false}
                        className="h-8 w-auto max-w-[14rem] object-contain"
                      />
                      <span className="absolute inset-0 grid place-items-center bg-[rgb(4_6_11/0.55)] text-[rgb(236_232_223)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        {working === "badge" ? (
                          <CircleNotch className="size-4 animate-spin" />
                        ) : (
                          <UploadSimple className="size-4" />
                        )}
                      </span>
                    </button>
                    <RemoveCross
                      label="Remove the badge"
                      busy={busy}
                      reveal="group-hover/badge:opacity-100"
                      onRemove={() => void removePicture("badge")}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="eyebrow">Profile</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => badgeInput.current?.click()}
                      title={`Set the logo of your university, laboratory or company above your name: ${BADGE_FIT.acceptLabel}`}
                      className="inline-flex items-center gap-1 rounded-sm text-meta text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {working === "badge" ? (
                        <CircleNotch className="size-3 animate-spin" />
                      ) : (
                        <Plus className="size-3" />
                      )}
                      Institution badge
                    </button>
                  </div>
                )}
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
          {"uri" in cover ? (
            <img
              src={cover.uri}
              alt=""
              draggable={false}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <>
              <img
                key={cover.scene.path}
                src={cover.scene.path}
                alt=""
                draggable={false}
                decoding="async"
                className="absolute inset-0 size-full object-cover"
                style={{ objectPosition: cover.scene.focus }}
              />
              <div className="absolute top-3 right-3 left-3 flex justify-end">
                <SceneCredit scene={cover.scene} />
              </div>
            </>
          )}
          <div className="absolute right-3 bottom-3">
            <CoverMenu
              own={Boolean(user.cover_uri)}
              current={"uri" in cover ? UPLOADED_COVER : cover.scene.path}
              busy={busy}
              uploading={working === "cover"}
              onChoose={keepCover}
              onUpload={() => coverInput.current?.click()}
              onRemove={() => void removePicture("cover")}
            />
          </div>
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
              <LineSignOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </section>

      <div className="mt-10">
        <SettingGroup title="Identity">
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
                <LineSave className="size-3.5" />
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
                  <LineFolderOpen className="size-3.5" />
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

/** A chip over the banner's picture, at its foot. */
const COVER_CHIP =
  "flex items-center gap-1.5 px-3 py-1 text-label transition-[background-color,opacity] hover:bg-[rgb(4_6_11/0.8)] focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"

/**
 * The banner's one control: the cover, chosen from the reader's own picture
 * and the scenes, with the upload and the removal of their own beside them.
 *
 * Hidden until the pointer is over the banner, so the picture is whole the
 * rest of the time; shown as well while it has the keyboard's focus, while its
 * menu is open, and while a cover is being uploaded.
 */
function CoverMenu({
  own,
  current,
  busy,
  uploading,
  onChoose,
  onUpload,
  onRemove,
}: {
  /** The reader has uploaded a picture of their own. */
  own: boolean
  /** UPLOADED_COVER, or the path of the scene shown. */
  current: string
  busy: boolean
  uploading: boolean
  onChoose: (choice: string) => void
  onUpload: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const close = (then: () => void) => () => {
    setOpen(false)
    then()
  }
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      surface={document.body}
      align="end"
      widthRem={17}
      trigger={(t) => (
        <button
          type="button"
          ref={t.ref}
          onClick={t.onClick}
          aria-expanded={t["aria-expanded"]}
          aria-haspopup={t["aria-haspopup"]}
          disabled={busy && !uploading}
          className={cn(
            PHOTO_CHIP,
            COVER_CHIP,
            "opacity-0 group-hover/banner:opacity-100 focus-visible:opacity-100",
            (open || uploading) && "opacity-100"
          )}
        >
          {uploading ? (
            <CircleNotch className="size-3.5 animate-spin" />
          ) : (
            <ImageSquare className="size-3.5" />
          )}
          Change cover
        </button>
      )}
    >
      <MenuGroup label="Cover">
        {own && (
          <MenuItem
            label="Your picture"
            checked={current === UPLOADED_COVER}
            onSelect={close(() => onChoose(UPLOADED_COVER))}
          />
        )}
        {SCENES.map((scene) => (
          <MenuItem
            key={scene.path}
            label={scene.place}
            checked={current === scene.path}
            onSelect={close(() => onChoose(scene.path))}
          />
        ))}
      </MenuGroup>
      <div className="my-1 border-t border-[rgb(var(--p-line)/0.22)]" />
      <MenuItem
        icon={UploadSimple}
        label={own ? "Replace your picture…" : "Upload a picture…"}
        title={`${COVER_FIT.acceptLabel}; a larger one is fitted to ${COVER_FIT.box.width} by ${COVER_FIT.box.height} px`}
        disabled={busy}
        onSelect={close(onUpload)}
      />
      {own && (
        <MenuItem
          icon={LineDelete}
          label="Remove your picture"
          disabled={busy}
          onSelect={close(onRemove)}
        />
      )}
    </MenuPopover>
  )
}

/**
 * The cross at a picture's top right corner that takes the picture away,
 * shown with its group's hover and with its own focus.
 */
function RemoveCross({
  label,
  busy,
  reveal,
  onRemove,
}: {
  label: string
  busy: boolean
  /** The group-hover class that shows it, for Tailwind to see written out. */
  reveal: string
  onRemove: () => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onRemove}
      title={label}
      aria-label={label}
      className={cn(
        "absolute -top-2 -right-2 grid size-5 place-items-center rounded-full border border-[rgb(var(--p-line)/0.6)] bg-[rgb(var(--p-ink))] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        reveal
      )}
    >
      <X className="size-3" />
    </button>
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
