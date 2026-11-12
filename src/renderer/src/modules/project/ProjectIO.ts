import toast from 'react-hot-toast'
import type { ChainSpec } from '@shared/audio'
import { MIN_CLIP_SEC, floorRange, type Clip } from '@shared/clip'
import type { ImagiiProject, PlaceRecord } from '@shared/workspace'
import { KNOWN_ROUTES, MAX_SCHEMA_VERSION, hasStudioState } from '@shared/projectValidation'
import { isMissingFileError, userFacingError } from '@shared/userFacingError'
import { useVideoStore, videoKey } from '../video-studio/store/videoStore'
import { useAudioStore, soundKey, waveformArrived, waveformRefused, type AudioSource } from '../audio-studio/state/audioStore'
import { useCanvasStore } from '../image-studio/state/canvasStore'
import { useReferencesStore } from '../references/state/referencesStore'
import { basename } from '../../components/OutputDirLabel'
import { audioCloseMessage } from '../audio-studio/audioClose'
import { countOf } from '@shared/plural'

/**
 * T-47 — the route the user is on, read off the HashRouter's own hash so a
 * plain function can capture it without being a component. Anything that is
 * not one of the app's routes is dropped rather than stored, the same rule
 * the validator applies when the snapshot comes back off disk.
 *
 * T-132 (1): and it is the only way to ask "where is the person NOW" from code that outlives its component. A studio that started a
 * long job and was left (Clean audio's extraction runs for minutes) holds the router location of the render it started in, and its
 * `navigate` still works after it unmounted; what the hash says is what is on screen at the moment of asking.
 */
export function currentRoute(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined
  const hash = window.location.hash
  const route = hash.startsWith('#') ? hash.slice(1) : hash
  return (KNOWN_ROUTES as readonly string[]).includes(route) ? route : undefined
}

/**
 * Where the user is: route, selections, playhead. Kept separate from the
 * studio state above it because the two degrade differently on the way back
 * in — see `sanitizePlace` in shared/projectValidation.ts.
 */
function capturePlace(): PlaceRecord | undefined {
  const video = useVideoStore.getState()
  const canvas = useCanvasStore.getState()
  const place: PlaceRecord = {
    route: currentRoute(),
    videoClipId: video.selectedClipId ?? undefined,
    canvasLayerId: canvas.selectedLayerId ?? undefined,
    referencesTab: useReferencesStore.getState().tab,
    // A playhead at 0 is the default the studio opens at anyway, so it is
    // not worth a field — and omitting it keeps a fresh snapshot small.
    videoTimeSec: video.currentTime > 0 ? video.currentTime : undefined
  }
  return Object.values(place).some((v) => v !== undefined) ? place : undefined
}

/**
 * T-99 — what a project stores for the audio studio. A sound pulled out of a
 * video is a scratch WAV under the OS temp folder (`imagii-audio`), which the
 * next launch deletes once it is old enough: a project that kept ITS path said
 * "Couldn't find aB3dE5fG7h.wav" the next day, with no way back. So such a
 * project keeps the VIDEO and says the sound is to be extracted again; user
 * data never points into a temp family. A plain audio file is user data itself
 * and is stored as it always was.
 */
function captureAudio(
  source: AudioSource,
  chain: ChainSpec
): NonNullable<ImagiiProject['audioStudio']> {
  if (source.fromVideo) {
    // T-107: when that video is itself a converted import's working copy, the
    // project names the original — the copy is scratch too.
    const video = source.fromVideo.convertedFrom ?? source.fromVideo.videoPath
    return { sourcePath: video, extractedFromVideo: true, chain }
  }
  // T-125 (7): the same for the sound of an AIFF or a WMA - the scratch WAV is not stored, the file it came from is, and the marker
  // says "extract the sound again" (its name predates the second kind; the schema keeps it so an older build opens the file too).
  if (source.extractedFrom) return { sourcePath: source.extractedFrom, extractedFromVideo: true, chain }
  return { sourcePath: source.filePath, chain }
}

/**
 * T-174 (4): the studio parts a project or an autosave could not apply because their file was unavailable (moved, an unplugged drive) or would not open (a failed
 * conversion, a full disk), kept for the session. The sentence for such a file sends the person to load it again, and loading it again opened it fresh - while the
 * next autosave replaced the only copy of its clips and chain. So `applyProject` keeps the part here (a SKIP is not kept: the person chose another file), `capture`
 * writes it while its studio has nothing open (the autosave keeps it), and `giveBack` applies it when the same file is opened (`videoKey` / `soundKey`), or drops it
 * when a different file opens in that studio (the person moved on). Closing the studio keeps it. Module-level: it outlives `clearSource` and is gone with the
 * renderer; a project file or the autosave carries it across a restart. `key` is the original the person opened (a converted import's, a video's sound's).
 * simplification: one part per studio, for the session; a second failed apply replaces the first. Upgrade: a map by key if two missing files ever need to wait together.
 */
const keptParts: {
  video?: { key: string; converted: boolean; clips: Clip[]; selectedClipId: string | null; srtPath: string | null }
  audio?: { key: string; extracted: boolean; chain: ChainSpec }
} = {}

/** T-195 (2): counts the applies that reached the audio part, so a refused sound's follow-up can tell it is still the latest (it never overwrites a newer open's slot). */
let audioApplies = 0

/**
 * T-198 (2): counts every `applyProject`, so an apply can tell it is no longer the newest. Opening a second project while the first still waits (a conversion or an extraction takes minutes;
 * Home calls that supported) used to let the first one's late sound land in the second one's session and its late failure overwrite the second's kept part: `replacedSince` reads an EMPTY studio
 * as "not replaced" (T-112), and only the refusal follow-up above honoured "a newer apply has the slot".
 */
let projectApplies = 0

/** What the open studios hold, as a project part each - and, unless `openOnly`, a kept part in the slot of a studio with nothing open (an open source always wins its slot). */
function capture(openOnly: boolean): ImagiiProject {
  const video = useVideoStore.getState()
  const audio = useAudioStore.getState()
  const canvas = useCanvasStore.getState()
  const keptVideo = openOnly ? undefined : keptParts.video
  const keptAudio = openOnly ? undefined : keptParts.audio

  return {
    // Always emit MAX_SCHEMA_VERSION on save; older versions are only
    // accepted on load (with automatic migration).
    schemaVersion: MAX_SCHEMA_VERSION,
    savedAt: Date.now(),
    appVersion: '1.0.0',
    place: capturePlace(),
    // T-107: a video the importer had to CONVERT (flv, ts, wmv, mpg, 3gp ...) is
    // played from an mp4 working copy under the OS temp folder (`imagii-import`),
    // which the next launch prunes once it is old enough — T-99's bug for pictures.
    // So such a project keeps the ORIGINAL file and says it is to be converted
    // again; user data never points into a temp family. A natively playable video
    // is user data itself and is stored as it always was.
    videoStudio: video.source
      ? {
          sourcePath: video.source.convertedFrom ?? video.source.filePath,
          ...(video.source.convertedFrom ? { convertedForImport: true } : {}),
          clips: video.clips,
          selectedClipId: video.selectedClipId,
          watermark: null,
          srtPath: video.srtPath
        }
      : keptVideo
        ? {
            sourcePath: keptVideo.key,
            ...(keptVideo.converted ? { convertedForImport: true } : {}),
            clips: keptVideo.clips,
            selectedClipId: keptVideo.selectedClipId,
            watermark: null,
            srtPath: keptVideo.srtPath
          }
        : undefined,
    audioStudio: audio.source ? captureAudio(audio.source, audio.chain)
      : keptAudio
        ? { sourcePath: keptAudio.key, ...(keptAudio.extracted ? { extractedFromVideo: true } : {}), chain: keptAudio.chain }
        : undefined,
    imageCanvas: canvas.doc.layers.length > 0 ? { doc: canvas.doc } : undefined
  }
}

/** The whole session as a project: what is open, and the parts set aside for a file that could not be opened (T-174 (4)). */
export function captureProject(): ImagiiProject {
  return capture(false)
}

/**
 * T-124 (5): does the live session hold work - a video, a sound, or a canvas with a layer? The Home page's autosave banner
 * is for a session that does not (a launch, or the page a crash reloads to): over a session that does, Restore would apply
 * a snapshot of an earlier moment on top of it with no question and wipe its undo histories. Asked of
 * `captureProject`, so it is the definition the autosave gate uses (`hasStudioState`), not a second one.
 */
export function sessionHoldsWork(): boolean {
  // T-174 (4): what is OPEN. A part kept for a file that could not be opened is not work the session holds - Restore over it replaces nothing a person can see.
  return hasStudioState(capture(true))
}

/**
 * T-140 (6): the stores `sessionHoldsWork` reads, as something a banner can listen to. `listener` runs on every change to the video, audio or canvas store (the three
 * `hasStudioState` asks: a video source, a sound source, a canvas with a layer) and the caller asks `sessionHoldsWork()` itself. `AutosaveRestore` reads the question
 * once per mount, and a conversion or an extraction that lands while the person is on Home (the importers' runs outlive the route) fills a studio under a banner that
 * mounted over an empty session. Returns the way to stop listening.
 */
export function subscribeSessionStores(listener: () => void): () => void {
  const stops = [useVideoStore.subscribe(listener), useAudioStore.subscribe(listener), useCanvasStore.subscribe(listener)]
  return () => stops.forEach((stop) => stop())
}

/**
 * T-140 (6): the one sentence for a Restore that finds the session holding work (the press-time backstop): what is open, and that nothing was restored. It used to
 * withdraw the offer and return without a word. A toast shows it as written (one line, a period at the end), so it is plain words for the three studios: a video, audio
 * (Audio Studio's own word for a sound that is open, as "Close this audio?"), a Stream Graphics canvas. Asked of `captureProject`, as `sessionHoldsWork` is, so the
 * studios it names are the ones that made the work test true.
 */
export function describeRestoreRefused(project: ImagiiProject = capture(true)): string {
  const open = [
    project.videoStudio ? 'a video' : null,
    project.audioStudio ? 'audio' : null,
    project.imageCanvas ? 'a Stream Graphics canvas' : null
  ].filter((name): name is string => name !== null)
  const names = open.length > 1 ? `${open.slice(0, -1).join(', ')} and ${open[open.length - 1]}` : (open[0] ?? 'your work')
  return `Nothing was restored: ${names} ${open.length > 1 ? 'are' : 'is'} open now, and restoring would replace ${open.length > 1 ? 'them' : 'it'}.`
}

/**
 * T-47 — put the user back where they were, in the stores. Everything here
 * is applied only if it still refers to something that exists: a clip id
 * from a snapshot whose clips were themselves refused would otherwise
 * select nothing and leave the studio looking broken.
 *
 * The ROUTE is deliberately not applied here — navigation belongs to the
 * component that owns the router (`AutosaveRestore`), and "Open project"
 * has no business teleporting the user to another studio.
 */
export function applyPlace(place: PlaceRecord | undefined, videoOpened = true): void {
  if (!place) return
  const video = useVideoStore.getState()
  // T-113: the clip and the playhead are the PROJECT'S video's. When that video did not open
  // (moved, skipped because the person opened another, failed) whatever the studio holds is
  // someone else's, and seeking it to second 42 of a different recording is the one thing
  // "Open project" must not do to it.
  if (videoOpened && place.videoClipId && video.clips.some((c) => c.id === place.videoClipId)) {
    video.selectClip(place.videoClipId)
  }
  const canvas = useCanvasStore.getState()
  if (place.canvasLayerId && canvas.doc.layers.some((l) => l.id === place.canvasLayerId)) {
    canvas.selectLayer(place.canvasLayerId)
  }
  if (place.referencesTab) useReferencesStore.getState().setTab(place.referencesTab)
  // Park the playhead through the same channel the Timeline scrubs with.
  // The Player applies it — including a Player that has not mounted yet,
  // which is the case during a restore that then navigates to /video.
  if (videoOpened && place.videoTimeSec !== undefined && useVideoStore.getState().source) {
    useVideoStore.getState().requestSeek(place.videoTimeSec)
  }
}

/**
 * T-84 — a media file a project points at that could not be opened (moved,
 * deleted, an unplugged drive). One per studio that lost its file.
 */
export interface UnavailableSource {
  studio: 'video' | 'audio'
  path: string
  fileName: string
}

/**
 * A media file that WAS there and could not be opened (T-112): the conversion
 * failed, the disk filled up, the file is damaged or held by another app. Not the
 * same as `UnavailableSource` — "moved or deleted" is false of it — so it carries
 * the sentence `userFacingError` makes of the real cause.
 */
export interface FailedSource extends UnavailableSource {
  message: string
}

export interface ApplyOutcome {
  /** In apply order: video, then audio. Empty when every file was found. */
  unavailable: UnavailableSource[]
  /** Files that were there and still could not be opened, in apply order (T-112). */
  failed: FailedSource[]
  /** Studios whose project source was NOT applied because the person opened a different
   *  one while it was loading (T-112) — what they opened is untouched. */
  skipped: Array<UnavailableSource['studio']>
  /** True when a newer `applyProject` started before this one ended (T-198 (2)): it changed nothing past that point (no sound, no kept part, no chain, no place), and the newer open speaks for
   *  the session - whoever opened this one says nothing about it. */
  superseded: boolean
  /** The sound this open put in Audio Studio, when it put one there (T-132 (11)): its waveform is read AFTER it opens, and
   *  `audioSettled` asks about exactly this source, even if main has refused it and the studio let go of it already. */
  audioOpened?: AudioSource
}

/**
 * The ONE sentence for the files a project could not find, or null when
 * nothing is missing. It names the file, says the rest is open, and says
 * where to load it again — the three things a bare probe error ("ffprobe
 * exit 1: …") never told the user.
 */
export function describeUnavailableSources(
  items: ReadonlyArray<UnavailableSource>
): string | null {
  if (items.length === 0) return null
  const names = [...new Set(items.map((i) => i.fileName))]
  const reload = items.map((i) =>
    i.studio === 'video' ? 'the video again in Video Studio' : 'the audio again in Audio Studio'
  )
  return (
    `Couldn't find ${names.join(' and ')}. ` +
    `${names.length === 1 ? 'It may' : 'They may'} have been moved or deleted. ` +
    `The rest of your project is open — load ${reload.join(' and ')}.`
  )
}

const SKIPPED_SENTENCE: Record<UnavailableSource['studio'], string> = {
  video:
    "Skipped the project's video because you opened another video while it was loading.",
  audio:
    "Skipped the project's audio because you opened another audio file while it was loading."
}

/** The same two facts for an autosave Restore (T-114): there is no project file to name. */
const SKIPPED_SENTENCE_AUTOSAVE: Record<UnavailableSource['studio'], string> = {
  video:
    "Skipped the autosave's video because you opened another video while it was loading.",
  audio:
    "Skipped the autosave's audio because you opened another audio file while it was loading."
}

const SKIPPED_NAME: Record<UnavailableSource['studio'], string> = { video: 'video', audio: 'audio' }

/** What an autosave stops holding when a studio's part of it was skipped (T-114). */
const AUTOSAVE_LOSES: Record<UnavailableSource['studio'], string> = {
  video: 'the video and its clips',
  audio: 'the audio and its settings'
}

const REST_IS_OPEN = 'The rest of your project is open.'

/** Who is asking: Open project (a file the person can open again) or the autosave Restore (T-114). */
export type ApplyVia = 'project' | 'autosave'

/**
 * Everything a project open has to tell the person, as one string — or null when
 * every studio opened as saved. A missing file, a file that would not open for
 * another reason (with the cause) and a source skipped because they opened a
 * different one meanwhile are three different facts (T-112); the callers toast
 * this instead of "Project loaded" when it is not null.
 *
 * `via` only changes what a SKIP says (T-114). After a skip the project can be opened
 * again; an autosave cannot: no file stands behind it, and the autosave is held for the
 * apply and saved the moment the hold lifts (`applyProjectHeld`), so opening another video
 * IS the change that replaces it with what is open now - the skipped part is gone from it.
 * The sentence says that instead of sending the person to a project that does not exist.
 */
export function describeApplyOutcome(outcome: ApplyOutcome, via: ApplyVia): string | null {
  const parts: string[] = []
  // Said once: a missing-file sentence already says the rest is open, and so does the failure's.
  let saidRestIsOpen = false
  const missing = describeUnavailableSources(outcome.unavailable)
  if (missing) {
    parts.push(missing)
    saidRestIsOpen = true
  }
  if (outcome.failed.length > 0) {
    parts.push(...outcome.failed.map((f) => f.message))
    if (!saidRestIsOpen) parts.push(REST_IS_OPEN)
    saidRestIsOpen = true
  }
  // T-113: a skip names what it left alone and the way back — the person opened something
  // else, so the project's part is simply not there, and re-opening the project brings it.
  // T-114: an autosave has no way back, and says what became of the skipped part.
  if (outcome.skipped.length > 0) {
    const sentences = via === 'autosave' ? SKIPPED_SENTENCE_AUTOSAVE : SKIPPED_SENTENCE
    for (const studio of outcome.skipped) parts.push(sentences[studio])
    if (!saidRestIsOpen) parts.push(via === 'autosave' ? 'The rest of your work is open.' : REST_IS_OPEN)
    if (via === 'autosave') {
      // "the video and its clips, and the audio and its settings, will not..." - the comma closes the pair.
      const lost = outcome.skipped.map((studio) => AUTOSAVE_LOSES[studio]).join(', and ')
      const closed = outcome.skipped.length > 1 ? `${lost},` : lost
      parts.push(`Your autosave now holds what you have open, so ${closed} will not come back from it.`)
    } else {
      const what = outcome.skipped.map((studio) => SKIPPED_NAME[studio]).join(' and ')
      parts.push(`Open the project again to bring its ${what} back.`)
    }
  }
  return parts.length > 0 ? parts.join(' ') : null
}

/**
 * Open one studio's media file; a file that cannot be read is REPORTED, not
 * thrown. This is the single point where a missing file is allowed to stop
 * being an exception, so everything after it in `applyProject` still runs.
 * The raw error goes to the console — it is ffprobe's stderr, not for the
 * user.
 *
 * `load` answers whether it applied the source: false is a deliberate skip (the
 * person opened something else while it was loading, T-112), which is neither a
 * success to apply clips over nor a missing file to report.
 *
 * T-112: only a failure that says the file is not there is "unavailable" ("moved
 * or deleted"); any other — a conversion that failed, a full disk, a file another
 * app holds — goes through `userFacingError`, so the real cause reaches the person
 * in the app's voice instead of a guess.
 */
async function loadReporting(
  studio: UnavailableSource['studio'],
  filePath: string,
  load: () => Promise<boolean>,
  outcome: ApplyOutcome
): Promise<boolean> {
  try {
    const applied = await load()
    if (!applied) outcome.skipped.push(studio)
    return applied
  } catch (err) {
    const fileName = basename(filePath)
    if (isMissingFileError(err)) {
      console.error(`[imagii] project ${studio} file could not be opened:`, filePath, err)
      outcome.unavailable.push({ studio, path: filePath, fileName })
    } else {
      const { message } = userFacingError(err, `Couldn't open ${fileName}.`)
      outcome.failed.push({ studio, path: filePath, fileName, message })
    }
    return false
  }
}

/**
 * True when `studio` now holds a source other than the one it held when a long
 * wait began (T-112). A studio that was CLOSED meanwhile (null) is not "something
 * else": Open project was always going to replace what was there, and closing it
 * first changes nothing about that. `before` is compared by identity — every
 * `loadSource` makes a new source object, so a reload of the same file counts too
 * (the person did something there).
 */
export function replacedSince<T>(before: T | null, now: T | null): boolean {
  return now !== null && now !== before
}

/**
 * T-132 (11): is a project open's good news true? `loadSource` resolves once a file is OPEN and its waveform is read after that (T-129),
 * so "Project loaded" and "Restored from autosave" were said while main could still refuse the sound (the studio then lets go of it and
 * says why, in red, beside a green line). True when the open put no sound in Audio Studio, or the sound it put there has its waveform;
 * false when that sound was refused. Asked about the source the open recorded (`outcome.audioOpened`), not about whatever the studio
 * holds now: a refusal that landed before this looks leaves the studio empty, which is not "nothing was opened".
 */
export async function audioSettled(outcome: Pick<ApplyOutcome, 'audioOpened'>): Promise<boolean> {
  return outcome.audioOpened ? waveformArrived(outcome.audioOpened) : true
}

/**
 * The video part of a project, put in the open video (T-153 (8) and the srt rule): the clips floored once the source's duration is known, the selection, then the
 * caption path (`loadSource` clears it). One function for the apply and for the give-back of a kept part (T-174 (4)), so a part comes back exactly as it would have.
 */
function applyVideoPart(part: { clips: Clip[]; selectedClipId: string | null; srtPath?: string | null }): void {
  if (part.clips.length > 0) {
    // T-153 (8): a clip a saved project or an autosave carries with no length ([0, 0], [D, D]; v1.6.0 wrote them) comes back
    // with the floor every range edit holds, once the source's duration is known - the validator checks finiteness only. Only a clip SHORTER
    // than the floor is touched: one with length that lies past the end of a recording that got shorter stays as saved (T-133 (4): Burn says so in a sentence).
    const duration = useVideoStore.getState().source?.probe.duration
    useVideoStore.setState({
      clips:
        duration === undefined
          ? part.clips
          : part.clips.map((c) => (c.endSec - c.startSec < MIN_CLIP_SEC ? { ...c, ...floorRange(c.startSec, c.endSec, duration) } : c)),
      selectedClipId: part.selectedClipId ?? part.clips[0]?.id ?? null
    })
  }
  // Restore srtPath after loadSource (which clears it). Ignore on
  // older v1 projects where the field was absent — they get null.
  if (part.srtPath) {
    useVideoStore.getState().setSrtPath(part.srtPath)
  }
}

/**
 * T-174 (4): a video was opened (or the studio emptied). Closing keeps the kept part; the same file (`videoKey`: the original, so a converted import's new working copy
 * is it) gets it applied; any other file means the person moved on, and it is dropped.
 */
function giveBackVideo(): void {
  const kept = keptParts.video
  const open = useVideoStore.getState().source
  if (!kept || !open) return
  delete keptParts.video
  if (videoKey(open) === kept.key) applyVideoPart(kept)
}

/** The sound's twin of `giveBackVideo`: `soundKey` is the file the person opened (a video's sound is its video), and the part is the chain. */
function giveBackAudio(): void {
  const kept = keptParts.audio
  const open = useAudioStore.getState().source
  if (!kept || !open) return
  delete keptParts.audio
  if (soundKey(open) !== kept.key) return
  useAudioStore.setState({ chain: kept.chain })
  // T-196 (1): the sound now owns the chain, but its waveform is read after it opens (T-129) and main can still refuse the file (T-195 (2)): the studio resets to the default chain and
  // the sentence sends the person to "try again" - so the part is kept again, as given back, for as many tries as it takes until a read arrives. Not awaited (a long file's read takes
  // seconds); a Close or another file opened is not a refusal, a newer apply that reached the audio part has the slot, and a part kept since is not overwritten.
  const generation = audioApplies
  void waveformArrived(open).then((arrived) => {
    if (!arrived && waveformRefused(open) && generation === audioApplies && keptParts.audio === undefined) keptParts.audio = kept
  })
}

/**
 * T-175 (3): the question every entry that opens a file into a studio asks BEFORE it claims its run, or null when nothing would be lost. A part kept for a file that
 * could not be opened (an unplugged drive) is dropped by the give-back when a DIFFERENT file opens in its studio - the loss T-174 (4) set out to prevent, with no
 * word, while every other way of discarding clip or chain work asks first. `key` is what the give-back compares (`videoKey` / `soundKey` of the file being opened),
 * so the same file never asks: it gets the part back. `openingName` is the file name of what is being opened. A part with nothing in it to lose is not asked about:
 * no clips (the caption path alone), or a chain at its defaults with no cuts and no second track (`audioCloseMessage` is null for exactly that).
 */
export function keptPartQuestion(studio: 'video' | 'audio', key: string, openingName: string): string | null {
  const lead = `Open ${openingName}?`
  if (studio === 'video') {
    const kept = keptParts.video
    if (!kept || kept.key === key || kept.clips.length === 0) return null
    return `${lead} The ${countOf(kept.clips.length, 'clip')} kept for ${basename(kept.key)}, which could not be opened, will be discarded.`
  }
  const kept = keptParts.audio
  if (!kept || kept.key === key || audioCloseMessage(kept.chain) === null) return null
  return `${lead} The changes kept for ${basename(kept.key)}, which could not be opened, will be discarded.`
}

// Installed once, with the module: the stores are singletons and a kept part can be waiting from the first apply.
useVideoStore.subscribe((state, prev) => {
  if (state.source !== prev.source) giveBackVideo()
})
useAudioStore.subscribe((state, prev) => {
  if (state.source !== prev.source) giveBackAudio()
})

/**
 * Put a project's studios back, each independently.
 *
 * T-84: this used to be one straight line of awaits, so the first
 * `loadSource` to throw (the recording had been moved) rejected the whole
 * call and left the project half-restored. The order is still canvas, video,
 * audio, place — but a studio whose file is gone is left exactly as it was
 * and reported in the outcome, and every other studio is applied regardless.
 * Nothing from a studio that lost its file is applied over the hole (no clips
 * or caption path for a video that is not there).
 */
export async function applyProject(project: ImagiiProject): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { unavailable: [], failed: [], skipped: [], superseded: false }
  // T-198 (2): this apply's place in line; a newer one that starts while it waits makes it `superseded`.
  const apply = ++projectApplies
  const superseded = (): boolean => apply !== projectApplies
  // T-113: what BOTH media studios hold, captured before the first wait. The video's wait is a
  // transcode that can take minutes, and the sound's baseline was taken only when its own turn
  // came — after it — so a sound the person opened and tuned during the video's wait WAS the
  // baseline and the project's sound replaced it without a word. Each studio is compared with
  // what it held when the person pressed Open project.
  const heldVideo = useVideoStore.getState().source
  const heldAudio = useAudioStore.getState().source
  // T-58 + T-47: mood boards are not carried in a project file — they are
  // their own files on disk — so there is nothing to put back here. What the
  // contract does require is that no studio comes out of a restore offering
  // to undo something: a board edit from the session being replaced is not
  // work the user did in the session they now have.
  useReferencesStore.getState().resetHistory()
  if (project.imageCanvas) {
    // resetDocument, not setDocument: restoring a snapshot is not an edit.
    // Through setDocument the restore pushed an undo step, so the app came
    // back offering to undo work the user never did — and Home's global
    // Undo would have thrown the restored canvas away in one click.
    useCanvasStore.getState().resetDocument(project.imageCanvas.doc)
  }
  const video = project.videoStudio
  // T-113: whether the PROJECT'S video is the one now open — the place's clip and playhead
  // belong to it and to nothing else.
  let videoOpened = false
  if (video?.sourcePath) {
    const sourcePath = video.sourcePath
    // T-112: the conversion below takes minutes for a long VOD and the app is not locked
    // meanwhile; if the person opens a different video in that time it is theirs, and the
    // project's source must not replace it (source, clips, captions, undo history —
    // `loadSource` resets all of it). `heldVideo` (above) is what the studio held at the start.
    const heldBefore = heldVideo
    // T-107: a converted import is converted again, every time — the working copy
    // that held it last session was scratch, and its path is not in the project.
    // An original that moved fails inside the conversion and is reported as the
    // file that is gone (the original), like any other missing source. The wait
    // is a transcode, not a probe, so it says what it is doing (the importer's words).
    const load = video.convertedForImport
      ? async (): Promise<boolean> => {
          // T-113: its own id. The Importer's conversion is 'convert'; sharing it meant each one's
          // `finally` took down the other's toast while its job was still running.
          toast.loading('Converting for editing\u2026', { id: 'reopen-convert' })
          try {
            const converted = await window.api.video.convertForImport(sourcePath)
            if (replacedSince(heldBefore, useVideoStore.getState().source) || superseded()) return false
            await useVideoStore.getState().loadSource(converted, sourcePath)
            return true
          } finally {
            toast.dismiss('reopen-convert')
          }
        }
      : async (): Promise<boolean> => {
          await useVideoStore.getState().loadSource(sourcePath)
          return true
        }
    // T-174 (4): this project speaks for the video now, so a part kept from an earlier apply is superseded - and one loaded over it would otherwise be given back first.
    delete keptParts.video
    const loaded = await loadReporting('video', sourcePath, load, outcome)
    videoOpened = loaded
    // T-198 (2): a newer apply is the session's now - this one keeps no part and puts no clips over what that one opens.
    if (superseded()) {
      // (nothing: the final check below returns before the place)
    } else if (loaded) {
      applyVideoPart(video)
    } else if (!outcome.skipped.includes('video')) {
      // T-174 (4): the file could not be opened (unavailable or failed; a SKIP is the person's choice and keeps nothing): its clips and caption path wait for it.
      keptParts.video = {
        key: sourcePath,
        converted: video.convertedForImport === true,
        clips: video.clips,
        selectedClipId: video.selectedClipId,
        srtPath: video.srtPath ?? null
      }
    }
  }
  const audio = project.audioStudio
  // T-198 (2): the video's wait can be minutes; an apply that was overtaken in it has no sound to open (and must not take the audio slot or drop the newer apply's kept part). This is also the check the two load closures' top-of-section `replaced()` needs: no await lies between here and it, so it cannot differ.
  if (audio?.sourcePath && !superseded()) {
    const sourcePath = audio.sourcePath
    // T-112: the same guard for the sound — its extraction waits as long as the conversion.
    // T-113: against what it held at the START (`heldAudio`), not when this section begins:
    // the video's wait may have been minutes long, and a sound opened in it is theirs.
    const heldBefore = heldAudio
    // T-99: the sound of a video is extracted again, every time. The WAV that
    // held it last session was scratch — and its path is not in the project.
    // A video that moved fails inside `extractFromVideo` and is reported as the
    // file that is gone (the video), exactly like any other missing source.
    // T-112: the wait is on screen, like the conversion's above — its own toast id, so
    // one's `finally` never takes down the other's toast. T-135 (1) / T-136 (2): they do NOT
    // run beside each other any more - main has ONE extraction slot (`audio:extractFromVideo`)
    // and ONE conversion slot (`video:convertForImport`), and the second start is refused in a
    // finished sentence naming the file that is running, which `loadReporting` reports for
    // this studio ("failed") while the rest of the project opens.
    // T-132 (11): the source the load put in the studio, kept for `audioSettled` (its waveform is read after it opens).
    let opened: AudioSource | undefined
    const extractAgain = async (videoPath: string): Promise<boolean> => {
      toast.loading('Extracting audio\u2026', { id: 'reopen-extract-audio' })
      try {
        const { wavPath, hasVideo } = await window.api.audio.extractFromVideo(videoPath)
        if (replacedSince(heldBefore, useAudioStore.getState().source) || superseded()) return false
        opened = await useAudioStore.getState().loadSource(wavPath, videoPath, undefined, hasVideo)
        return true
      } finally {
        toast.dismiss('reopen-extract-audio')
      }
    }
    // T-107: a v1-3 project wrote the scratch WAV in `sourcePath` and the video
    // beside it. While the WAV is there it opens as it always did; once a launch
    // has pruned it, the sound is extracted again from that video instead of
    // reporting a file the person never chose — and if the VIDEO is gone, that is
    // the file named.
    const fromVideo = audio.extractedFromVideo ? null : (audio.fromVideoPath ?? null)
    // T-135 (9): the guard is asked at the TOP of every way the sound opens, not only in `extractAgain`. The video's wait ahead of this
    // section can be minutes, and the other two closures (the scratch WAV and a plain file) called `loadSource` unguarded, so a sound
    // the person opened and tuned in that wait was replaced by the project's with nothing in `skipped`.
    const replaced = (): boolean => replacedSince(heldBefore, useAudioStore.getState().source)
    const load = audio.extractedFromVideo
      ? () => extractAgain(sourcePath)
      : fromVideo
        ? async (): Promise<boolean> => {
            if (replaced()) return false
            try {
              opened = await useAudioStore.getState().loadSource(sourcePath, fromVideo)
              return true
            } catch (err) {
              console.error('[imagii] project audio scratch file is gone; extracting again:', err)
              return extractAgain(fromVideo)
            }
          }
        : async (): Promise<boolean> => {
            if (replaced()) return false
            opened = await useAudioStore.getState().loadSource(sourcePath)
            return true
          }
    // T-174 (4): the file this sound is named by - the one a failure reports, and the key a kept chain waits under (`soundKey` of the sound it will be opened as).
    const audioKey = fromVideo ?? sourcePath
    delete keptParts.audio
    // T-195 (2): this open's claim on the slot; a newer apply that reaches here takes it.
    const generation = ++audioApplies
    const loaded = await loadReporting('audio', audioKey, load, outcome)
    const keepPart = (): void => {
      keptParts.audio = { key: audioKey, extracted: audio.extractedFromVideo === true || fromVideo !== null, chain: audio.chain }
    }
    if (superseded()) {
      // T-198 (2): overtaken while it waited - the newer apply's sound, chain and kept part stand.
    } else if (loaded) {
      useAudioStore.setState({ chain: audio.chain })
      if (opened) {
        outcome.audioOpened = opened
        // T-195 (2): the file OPENED, and its waveform is read after that (T-129). If main refuses it the studio resets to the default chain, and the sentence ("try again") sends the
        // person to load the file again - so it is kept exactly as a load that threw is. Not awaited: a long file's read takes seconds and the open is not made to wait for it. A Close or
        // another file opened is not a refusal, and a newer open that has reached this section has the slot.
        const settled = opened
        void waveformArrived(settled).then((arrived) => {
          if (!arrived && waveformRefused(settled) && generation === audioApplies) keepPart()
        })
      }
    } else if (!outcome.skipped.includes('audio')) {
      keepPart()
    }
  }
  // Last: the selections and the playhead only mean anything once the
  // clips and layers they point at are in place.
  if (superseded()) {
    outcome.superseded = true
    return outcome
  }
  applyPlace(project.place, videoOpened)
  return outcome
}
