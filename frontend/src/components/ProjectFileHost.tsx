/**
 * Project files, from the interface's side: the four operators, the files the
 * system hands over, and the account's record of which file is which project's.
 *
 * Mounted once beside OperatorHost, because what it needs -- the account, its
 * preferences, the active project and the way to activate another -- is App's,
 * and a file can arrive from the Finder while any screen is up.
 */
import { useCallback, useEffect, useRef } from "react"

import {
  OpenProjectFile,
  RevealProjectFile,
  SaveProjectFile,
  TakeOpenedFiles,
} from "../../wailsjs/go/main/App"
import { EventsOff, EventsOn } from "../../wailsjs/runtime/runtime"
import { useAuth } from "@/lib/auth"
import { notifyError, notifySuccess } from "@/lib/notify"
import { useOperators } from "@/lib/operators"
import {
  mergePreferenceExtras,
  parsePreferenceExtras,
  type PreferenceExtras,
} from "@/lib/preferenceExtras"
import {
  projectFileName,
  setProjectFileOpener,
  withRecent,
  withoutRecent,
} from "@/lib/projectFiles"

export function ProjectFileHost({
  activeProjectId,
  onActivateProject,
}: {
  activeProjectId: string | null
  onActivateProject: (id: string) => Promise<void>
}) {
  const { user, prefs, savePrefs, refreshProjects, refreshRuns } = useAuth()
  const extras = parsePreferenceExtras(prefs?.extras_json)
  const linked = activeProjectId ? extras.project_files?.[activeProjectId] : undefined

  // Read at the moment of writing, so two writes in one gesture do not each
  // start from the preferences as they were before the other.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const writeExtras = useCallback(
    (patch: (e: PreferenceExtras) => PreferenceExtras) => {
      const p = prefsRef.current
      if (!p) return
      const next = patch(parsePreferenceExtras(p.extras_json))
      void savePrefs(
        { ...p, extras_json: mergePreferenceExtras(p.extras_json, next) },
        { silent: true }
      ).catch(() => {
        /* the record is a convenience; the file itself is written */
      })
    },
    [savePrefs]
  )

  const remember = useCallback(
    (projectId: string, path: string) =>
      writeExtras((e) => ({
        project_files: { ...(e.project_files ?? {}), [projectId]: path },
        recent_project_files: withRecent(e.recent_project_files, path),
      })),
    [writeExtras]
  )

  const open = useCallback(
    async (path?: string) => {
      try {
        const sum = await OpenProjectFile(path ?? "")
        if (!sum) return // The dialog was cancelled.
        await Promise.all([refreshProjects(), refreshRuns()])
        await onActivateProject(sum.project_id)
        remember(sum.project_id, sum.path)
        notifySuccess(
          `Opened ${projectFileName(sum.path)}`,
          [
            `${sum.runs} ${sum.runs === 1 ? "run" : "runs"}, ${sum.studios} ${sum.studios === 1 ? "studio" : "studios"}`,
            sum.missing_assets
              ? `${sum.missing_assets} ${sum.missing_assets === 1 ? "file was" : "files were"} not in its data folder`
              : "",
          ]
            .filter(Boolean)
            .join(" \u00b7 ")
        )
      } catch (e) {
        // A recent file that has since moved or gone leaves the list.
        if (path && /no such file|cannot find/i.test(String(e))) {
          writeExtras((x) => ({ recent_project_files: withoutRecent(x.recent_project_files, path) }))
        }
        notifyError("Could not open the project file", e)
      }
    },
    [onActivateProject, refreshProjects, refreshRuns, remember, writeExtras]
  )

  const save = useCallback(
    async (path: string) => {
      if (!activeProjectId) return
      try {
        const sum = await SaveProjectFile(activeProjectId, path)
        if (!sum) return
        remember(activeProjectId, sum.path)
        notifySuccess(
          `Saved ${projectFileName(sum.path)}`,
          sum.missing_assets
            ? `${sum.missing_assets} ${sum.missing_assets === 1 ? "file" : "files"} named by its runs were not on this machine`
            : undefined
        )
      } catch (e) {
        notifyError("Could not save the project file", e)
      }
    },
    [activeProjectId, remember]
  )

  // Through a ref, so the opener and the Finder listener below are set once
  // rather than on every render of App, which is what changes `open`.
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => setProjectFileOpener((path) => openRef.current(path)), [])

  const needProject = () => (activeProjectId ? true : "Open a project first")
  useOperators({
    PROJECT_OPEN: {
      run: () => open(),
      poll: () => (user ? true : "Sign in first; a project belongs to an account"),
    },
    PROJECT_SAVE: {
      run: () => save(linked ?? ""),
      poll: () => {
        const p = needProject()
        if (p !== true) return p
        return linked ? true : "This project has no file yet; Save project file as\u2026 makes one"
      },
    },
    PROJECT_SAVE_AS: { run: () => save(""), poll: needProject },
    PROJECT_REVEAL: {
      run: () => {
        if (linked) {
          void RevealProjectFile(linked).catch((e) => notifyError("Could not show the file", e))
        }
      },
      poll: () => (linked ? true : "This project has no file yet"),
    },
  })

  /*
    Files the Finder handed over. Taken only with an account signed in, since
    a project is opened into one: before that they wait in Go, and the effect
    runs again when someone signs in. The event says only that there is
    something to take, so a file announced while the interface was already up
    and one held from before launch go through the same door.
  */
  const userRef = useRef(user)
  userRef.current = user
  useEffect(() => {
    const take = () => {
      if (!userRef.current) return
      void TakeOpenedFiles()
        .then((paths) => {
          // The last one, as a document application does when several arrive.
          const last = paths?.[paths.length - 1]
          if (last) void openRef.current(last)
        })
        .catch(() => {})
    }
    take()
    EventsOn("project:file-opened", take)
    return () => EventsOff("project:file-opened")
  }, [user])

  return null
}
