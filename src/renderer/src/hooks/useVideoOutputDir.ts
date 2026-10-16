import { useEffect } from 'react'
import { create } from 'zustand'
import { isSafeAbsolutePath } from '@shared/pathSafety'
import { persistSetting } from '../lib/persistSetting'

/**
 * Where the GIF, Compile, Reframe and picture-in-picture panels write (T-124 (21), T-125 (10)).
 *
 * Export and Clip Kit remembered their folder between visits (INIT-E, T-120) and these four asked from scratch every time the
 * studio opened, though each is "a file in a folder" exactly like an export. ONE shared key, `video.lastOutputDir`, because the four
 * write the same kind of thing and a person who has chosen where their side exports go means all of them: any of the four that
 * finishes a file writes it, and every panel reads it. (Export and the kit keep their own keys: a kit is a FOLDER of files, and an
 * export is a batch.)
 *
 * The folder is read when a panel appears (so its button shows where the file will go, as Export's does) and again when the person
 * presses the action with nothing chosen (so a folder another panel remembered a moment ago is used, not asked again). What was
 * stored came off disk: main answers it only if it is a folder that exists now (`settings:get`, T-125 (10): a folder that was deleted
 * or lives on an unplugged drive is ignored, as USER_GUIDE says), and it is used only if it is an absolute path without `..`
 * (`isSafeAbsolutePath`). A failed read is no reason to stop - the chooser opens as it always did, ON the current folder.
 *
 * T-125 (10): the four buttons are ONE value. Each panel used to hold the folder in its own state, read once at mount, so a pick in
 * GIF left Compile, Reframe and Picture-in-picture showing nothing while the guide says they follow each other. The value is a tiny
 * module store (zustand, like every other store in the renderer): a pick, a chooser's answer or a file written anywhere updates all four
 * at once, within the visit. The plain functions are what the unit test drives; the hook is the React binding.
 */
export const VIDEO_OUTPUT_DIR_KEY = 'video.lastOutputDir'

interface OutputDirState {
  dir: string | null
}
export const useOutputDirStore = create<OutputDirState>(() => ({ dir: null }))

const setDir = (dir: string): void => useOutputDirStore.setState({ dir })

export async function readRemembered(): Promise<string | null> {
  const stored = await window.api.settings.get<string>(VIDEO_OUTPUT_DIR_KEY).catch(() => undefined)
  return isSafeAbsolutePath(stored) ? stored : null
}

/** What every panel does as it appears: take the remembered folder, unless a folder is already chosen (the person's pick outranks it). */
export async function seedOutputDir(): Promise<void> {
  const dir = await readRemembered()
  if (dir && useOutputDirStore.getState().dir === null) setDir(dir)
}

/** The folder button: open the chooser on the current folder, and keep the answer for every panel. */
export async function pickOutputDir(): Promise<void> {
  const picked = await window.api.video.pickOutputDir(useOutputDirStore.getState().dir ?? undefined)
  if (picked) setDir(picked)
}

/** The folder for the file about to be written: the chosen one, else the remembered one, else the chooser's answer (null: canceled). */
export async function resolveOutputDir(): Promise<string | null> {
  const chosen = useOutputDirStore.getState().dir
  if (chosen) return chosen
  const dir = (await readRemembered()) ?? (await window.api.video.pickOutputDir())
  if (dir) setDir(dir)
  return dir
}

/** A file was written in `dir`: remember it for the next visit, and every panel follows now. */
export function rememberOutputDir(dir: string): void {
  void persistSetting(VIDEO_OUTPUT_DIR_KEY, dir)
  setDir(dir)
}

export interface VideoOutputDir {
  /** The folder the panel will write to, or null while none is chosen or remembered. */
  outDir: string | null
  /** The folder button: open the chooser on the current folder, and keep the answer. */
  pick: () => Promise<void>
  /**
   * The folder for the file about to be written: the one chosen, else the remembered one, else the chooser's answer (null
   * when it is canceled: the action stops). A folder found this way is kept, so every button shows it afterwards.
   */
  resolve: () => Promise<string | null>
  /** Remember `dir` for every panel and the next visit: called after a file was written there. */
  remember: (dir: string) => void
}

export function useVideoOutputDir(): VideoOutputDir {
  const outDir = useOutputDirStore((s) => s.dir)
  useEffect(() => {
    void seedOutputDir()
  }, [])
  return { outDir, pick: pickOutputDir, resolve: resolveOutputDir, remember: rememberOutputDir }
}
