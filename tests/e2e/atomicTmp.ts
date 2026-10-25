import { ATOMIC_TMP } from '../../src/main/fsAtomic'

/**
 * T-139 (1): the tmp main's `writeFileAtomic` keeps in a folder for the length of a write.
 *
 * Every save of a file the person chose (the image exports, the project, the .srt copy, a mood board) now writes `<target>.<8 hex>.tmp` BESIDE the target and
 * renames it over, so a test that LISTS the folder a save goes to can see the tmp: a poll on a COUNT (`waitForDownloads`, the Reference Export's wait) answers
 * "1 file" while that one is the tmp, then reads every name, and the tmp is partial or gone by the rename (the T-139 Track A full run: image.spec.ts "the
 * document background lands in the bytes" read a name that was not there any more). A listing of finished files goes through here.
 *
 * The pattern is `ATOMIC_TMP`, exported by the writer itself (`src/main/fsAtomic.ts`), and `fsAtomic.test.ts` pins it to the name the real writer makes;
 * `tests/unit/atomicWrites.test.ts` pins that the two specs that list such folders do it through `withoutAtomicTmp`.
 */
export { ATOMIC_TMP }

/** `names` without the atomic writer's tmp files: the files a save has FINISHED. */
export function withoutAtomicTmp(names: string[]): string[] {
  return names.filter((name) => !ATOMIC_TMP.test(name))
}
