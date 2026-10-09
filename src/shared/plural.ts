/**
 * A count with its noun, plural-correct: "1 file", "2 files", "0 files".
 *
 * Copy that interpolates a number next to a noun gets the singular wrong the
 * first time the number is 1 ("Export 1 files", "1 clip(s)"). One helper, so
 * each site states the noun once and cannot drift. Pass `plural` for a noun
 * that does not simply take an "s".
 */
export function countOf(n: number, singular: string, plural: string = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}
