/**
 * T-140 (1) - the one sentence a panel says when a save landed BESIDE the file the person chose.
 *
 * Every render is written to a partial and swapped over the chosen file when whole (`main/ffmpeg/partialOutput.ts`). On Windows a file open in a player or an
 * editor refuses that swap for as long as it is open, and the render has taken minutes, so main keeps it next to the file under the next free name
 * ("cleaned (2).mp3") and ANSWERS that path. A panel that reports the path it chose would say "saved" over the file that was not replaced and reveal the old one:
 * each panel reports the answer, and when the answer is not what it asked for it adds this sentence (T-84: what happened, in the person's words, with the
 * names that matter and no folder). It is shared so the audio export, the re-attach, the burn-in and the recording all say it alike.
 *
 * `chosenPath` is undefined where the panel did not choose it (Record's Save dialog is main's): the recording result carries it only when it moved.
 * Returns null when the file landed where it was chosen. The sentence ends in a full stop, so it follows a completion sentence ("Cleaned audio exported.").
 */
export function landedBesideNote(chosenPath: string | undefined, landedPath: string, what: string): string | null {
  if (chosenPath === undefined || chosenPath === landedPath) return null
  return `${leaf(chosenPath)} is open in another app, so this ${what} was saved as ${leaf(landedPath)}.`
}

/** The file's own name: a path from Windows or from anywhere else, with either separator. */
function leaf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}
