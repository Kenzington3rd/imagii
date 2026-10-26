import { createRunStore } from '../../../lib/runStore'

/**
 * The audio importer's file (T-137 (1)): the sound whose load - and, for a video or a format WebAudio cannot decode, whose extraction - is under way.
 *
 * It was `AudioImporter`'s `useRef` / `useState` (T-119's `busyRef`, `extractingRef`), so a trip to Home re-armed the importer over an extraction main
 * was still running: the returning importer was idle, took a plain WAV (main refuses only a second EXTRACTION), and the first extraction's landing
 * then called `loadSource` and replaced the WAV, its chain and its undo history - loading resets all three and cannot be undone. The Video Importer
 * had the same shape until T-136 (2) (`useImportRun`); this is that run for the other importer. `extracting` only chooses the words of the refusal
 * ("Still extracting audio..." / "Still loading..."). The claim is `begin()`, taken the instant the import starts.
 */
export const useAudioImportRun = createRunStore<{ filePath: string; extracting: boolean }>()
