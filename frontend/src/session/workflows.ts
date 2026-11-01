/** Saved workflows, which the store keeps as studios, and opening one. */
import { useCallback, useEffect, useState } from "react"

import {
  clearBoardMemory,
  onBoardDirtyChange,
  restoreBoard,
  snapshotBoard,
  writeBoardMemory,
} from "@/components/workspace/boardMemory"
import { useAuth } from "@/lib/auth"
import { notifyError, notifyInfo } from "@/lib/notify"
import { listStudios, openStudio, saveStudio, type Studio } from "@/lib/studios"
import { SetBoardDirty } from "../../wailsjs/go/main/App"

export interface WorkflowProps {
  /**
   * A request to open the board, bumped each time one arrives.
   *
   * A nonce rather than a boolean: the board's open state is this screen's, and
   * a flag would fire only on its first change -- opening the same studio
   * twice in a row has to work.
   */
  openBoardNonce?: number
  /** Saved workflows, which the store keeps as studios. */
  studios?: Studio[]
  onOpenStudio?: (board: Studio) => void
  onNewStudio?: (name: string) => void
  /** Called when the list of workflows is about to be read, to refresh it. */
  /*
    Returns its promise, so a caller that needs the list BEFORE it draws again
    can wait for it. The menu that opens on hover does not and ignores it; the
    manage dialog does, since it shows the result of its own rename or delete.
  */
  onStudiosMenu?: () => Promise<void>
}

export function useWorkflows({
  activeProjectId,
  clearRetainedRuns,
  clearAnalysisResults,
  clearAreaAndComposition,
  forgetLeaving,
  setShowPredictionOverlay,
}: {
  activeProjectId: string | null
  clearRetainedRuns: () => void
  clearAnalysisResults: () => void
  clearAreaAndComposition: () => void
  forgetLeaving: () => void
  setShowPredictionOverlay: (v: boolean) => void
}) {
  const { goMap } = useAuth()

  /*
    The board's unsaved state, told to the shell as it changes, so a close or
    Cmd-Q that would discard it is asked about first -- see beforeClose in
    app_studios.go. Here rather than in the board, which unmounts on every
    trip to Settings while what it holds does not.
  */
  useEffect(
    () => onBoardDirtyChange((dirty) => void SetBoardDirty(dirty).catch(() => {})),
    []
  )

  /**
   * Saved studios, and the request to open one.
   *
   * The nonce is how the map screen is told to open its board: the board's
   * open state is that screen's, and a boolean would only fire the first time
   * -- opening the same studio twice in a row has to work.
   */
  const [studios, setStudios] = useState<Studio[]>([])
  const [openBoardNonce, setOpenBoardNonce] = useState(0)

  /*
    The boards of the open project.

    SCOPED, because the menu offered every board ever saved regardless of which
    project was open -- which is how a board came to hold runs from several. It
    reloads when the project changes for the same reason: a menu left showing
    the previous project's boards is the same offer by a slower route.

    With no project open there is no menu to fill. Listing everything there
    would put the boards of every project in front of a reader who has said
    nothing about which one they mean.
  */
  const refreshStudios = useCallback(async () => {
    if (!activeProjectId) {
      setStudios([])
      return
    }
    try {
      setStudios(await listStudios(activeProjectId))
    } catch {
      // A board list that cannot be read is an empty menu section, not an
      // error in front of whatever the user was actually doing.
    }
  }, [activeProjectId])
  useEffect(() => {
    void refreshStudios()
  }, [refreshStudios])

  /**
   * Put these runs on the board and show it.
   *
   * NAMED RATHER THAN NEW. This is exactly what opening a saved studio has
   * always done, and it was written inline inside that one handler: hand the
   * run ids to the board's own memory, go to the map the board sits over, and
   * bump the nonce that opens it. Every surface that wants to send a reader to
   * the studio needs the same three steps, and a second copy of them would be
   * a second answer to one question.
   *
   * The nonce rather than a boolean, for the reason `openBoardNonce` was a
   * nonce to begin with: opening the same thing twice in a row has to work, and
   * a flag that is already true does nothing the second time.
   *
   * The ids are CONSUMED by the board on mount, not read -- see the effect in
   * BoardSurface -- so sending the same run twice does not queue it twice.
   */
  const openInStudio = useCallback(
    (runIds: readonly string[], workspace?: string) => {
      writeBoardMemory("pendingRunIds", [...runIds])
      if (workspace) writeBoardMemory("pendingWorkspace", workspace)
      goMap()
      setOpenBoardNonce((n) => n + 1)
    },
    [goMap]
  )

  /**
   * Open a saved studio. handleNewStudio, below, is its mirror.
   */
  const handleOpenStudio = useCallback(
    async (board: Studio) => {
      try {
        const opened = await openStudio(board.id)
        if (!opened.snapshot) {
          notifyError(
            "Could not read this workflow",
            new Error("its arrangement is unreadable")
          )
          return
        }
        restoreBoard(opened.snapshot)
        /*
          The map's retained runs go with it. A stored board is the runs it was
          saved with; anything the map happened to be holding is not one of
          them, and `assetRuns` would add it as an area of this board.
        */
        clearRetainedRuns()
        /*
          AND THE MAP'S OWN ANALYSIS, which this path was leaving behind.

          handleNewStudio says why in full: a plane on the board comes from
          three places and only two of them are the board's, the third being
          whatever the map is showing right now. That fix was made for the new
          studio and not for this one, so opening a saved studio kept the
          previous studio's run on the map -- as the live area of the board
          just opened, since liveRunId in StudioScreen resolves from these very
          fields.

          What that costs is not cosmetic. The live area is a member like any
          other when the board is saved, so the studio being opened inherits
          the run of the studio being left, and saving it writes that run into
          its arrangement. One installation carried two studios saved two
          minutes apart naming the same run, with no analysis having been made
          between them, and the arrangement of the second holding a name for
          the ground of a third.

          THE AOI GOES TOO. Both of these paths used to keep it, on the
          argument that an area belongs to the project rather than to the
          board. The argument holds for the ownership and not for the drawing:
          a reader who has just changed studios is not standing on the ground
          they left, and the outline of it stays on the map saying they are.

          It is not only an outline. The area carries the auto-name the store
          minted for it -- "drawn", "drawn 2" -- and that name becomes the
          label of the next run made over it, so the run made after a switch
          was filed under the ground of the studio before it. That is visible
          in an installation where a studio named "Sao gonçalo" holds a run
          called run-drawn-2, which is the area of the studio saved two minutes
          earlier.
        */
        /*
          NOT A MOVE FROM ONE GROUND TO ANOTHER, so the run being left is not
          kept in hand.

          Clearing the area below moves activeAreaId, and an effect further
          down retains whatever the map was showing whenever that id changes --
          which put the run of the studio being left straight back onto the
          board of the one being opened, as an area of its own, after every
          clear above had already run. The board showed a studio named for one
          ground holding the run of another, which is the defect these clears
          exist to prevent, arriving one render later than they do.

          Retention is the map's affordance: a ground the map moved on from
          stays in hand so the board can still show it beside the new one.
          Putting the board down is the opposite gesture, and clearRetainedRuns
          above already says so.
        */
        forgetLeaving()
        clearAnalysisResults()
        clearAreaAndComposition()
        /*
          The rasters are fetched by the board itself, where LoadAnalysis
          already lives. Members whose run has been deleted are left out with
          a word rather than silently: a board that opened with one side
          missing and said nothing would look like it had been built that way.
        */
        const wanted = opened.snapshot.runIds.filter(
          (id) => !opened.missingRunIds.includes(id)
        )
        writeBoardMemory("savedId", board.id)
        writeBoardMemory("savedName", board.name)
        if (opened.missingRunIds.length) {
          notifyInfo(
            `${opened.missingRunIds.length} run(s) in this workflow no longer exist.`
          )
        }
        /*
          No workspace: a saved board carries its own arrangement, which
          `restoreBoard` has just put back. Asking for one here would replace
          what the reader saved with a preset.
        */
        openInStudio(wanted)
      } catch (e) {
        notifyError("Could not open this workflow", e)
      }
    },
    [
      openInStudio,
      clearAnalysisResults,
      clearAreaAndComposition,
      clearRetainedRuns,
      forgetLeaving,
    ]
  )

  /**
   * An empty board, bound to no saved studio.
   *
   * The mirror of handleOpenStudio: that one restores an arrangement and writes
   * the id and name it came from, this one clears both. Clearing the id is the
   * point rather than a detail -- taking every plane off by hand leaves the
   * board still bound to what it was opened from, so the next save writes over
   * the studio it started from instead of making the second one.
   *
   * THE MAP'S OWN ANALYSIS GOES TOO, and that is what the first attempt at this
   * missed. A plane on the board comes from one of three places, and only two
   * of them are the board's: the runs added through the picker and the runs the
   * map has finished with, both of which live in boardMemory. The third is
   * whatever the map is showing right now, which is not a member of any board
   * -- it is the ground the studio is standing on, and it appears in a saved
   * studio just as it does here. So clearing the board left it, and a new
   * studio opened holding the last analysis.
   *
   * Cleared WITHOUT being retained, unlike startNewClassification, which hands
   * the result to retainRun on the way out. A retained run becomes an area of
   * the board, which is the thing being emptied.
   *
   * THE AOI GOES WITH IT, which reverses what this used to do. It kept the
   * drawing on the argument that an area belongs to the project and not to the
   * board -- true of the ownership, and not of what the map should be showing
   * a reader who has just left one studio for another. See handleOpenStudio,
   * where the same reversal is made and where the cost of the old behaviour is
   * recorded: the kept area carries its "drawn N" name into the label of the
   * next run, so a run made after a switch is filed under the previous
   * studio's ground.
   *
   * The composition goes with it, since it would otherwise be the one plane
   * left on an empty board.
   *
   * `clearBoardMemory` runs first, because openInStudio writes pendingRunIds
   * into that same store and a clear afterwards would take them with it.
   */
  const handleNewStudio = useCallback(
    async (name: string) => {
      clearBoardMemory()
      clearRetainedRuns()
      // Not a move from one ground to another either. See handleOpenStudio.
      forgetLeaving()
      clearAnalysisResults()
      clearAreaAndComposition()
      setShowPredictionOverlay(true)
      /*
        WRITTEN NOW, EMPTY, RATHER THAN AT THE FIRST SAVE.

        A studio that exists only in the board's memory has no name to lend,
        and the ground drawn under it therefore took the store's provisional
        one -- "drawn 2" -- which then became the label of the run made over
        it. Both were written before the studio had a name of its own, and
        neither is revisited when it gets one.

        The row is created here so the name exists first. It costs a studio
        with no members, which the store already permits: SaveStudio requires a
        name and does not require an arrangement, because an arrangement is
        what a studio accumulates rather than what makes it one.

        Best effort. If the write fails the board is still cleared and still
        usable; what is lost is the binding, so the next save creates the
        studio instead of updating it -- which is exactly the behaviour this
        replaces.
      */
      try {
        const board = await saveStudio(
          name,
          snapshotBoard([]),
          undefined,
          activeProjectId
        )
        writeBoardMemory("savedId", board.id)
        writeBoardMemory("savedName", board.name)
        void refreshStudios()
      } catch (e) {
        notifyError("Could not start the workflow", e)
      }
      openInStudio([])
    },
    [
      openInStudio,
      clearAnalysisResults,
      clearAreaAndComposition,
      activeProjectId,
      refreshStudios,
      clearRetainedRuns,
      setShowPredictionOverlay,
      forgetLeaving,
    ]
  )

  const props: WorkflowProps = {
    openBoardNonce,
    studios,
    onOpenStudio: (b) => void handleOpenStudio(b),
    onNewStudio: (name) => void handleNewStudio(name),
    onStudiosMenu: refreshStudios,
  }

  return { props }
}
