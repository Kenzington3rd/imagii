/**
 * The claim-first shape, once (T-131 (5)).
 *
 * A handler whose first `await` is a native dialog (a file chooser, a Save dialog, a folder chooser) is not safe from a double-click just
 * because the dialog is modal: the second press lands in the few milliseconds before the OS draws it (executed in the built app: two
 * choosers from one double-click on Home's Open project and Save project). T-125 (18) and T-126 (19) fixed the start handlers with the same
 * four lines - "if the flag is up, return; raise it; try; lower it in a finally" - and left every picker that was only a dialog ("pin-only,
 * the first await is a native dialog") on the rationale that the dialog protects itself. It does not. This is those four lines as one call.
 *
 * `flag` is a ref (or any `{ current }`) the caller owns: a `useRef(false)` in a component, a module-level object for a handler that is
 * not one. It is raised the instant this is CALLED, ahead of `work`'s first await, and given back in a `finally` whether `work` finishes,
 * is refused or throws, so a refused pick is retryable. A second call while the first runs does nothing and answers `undefined`, in
 * silence: the first one's dialog is on screen, which is the answer. `work`'s own result is returned when it ran.
 */
export async function claimFirst<T>(flag: { current: boolean }, work: () => Promise<T>): Promise<T | undefined> {
  if (flag.current) return undefined
  flag.current = true
  try {
    return await work()
  } finally {
    flag.current = false
  }
}
