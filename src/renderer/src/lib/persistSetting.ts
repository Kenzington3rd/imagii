import type { SettingsKey } from '@shared/api'
import { reportFailure } from './reportFailure'

/**
 * T-128 (4), T-110 (x): remember a preference without letting the remembering break what the person pressed.
 *
 * `window.api.settings.set` is an IPC round trip that main can refuse (a full disk, a `config.json` it cannot write, a value the schema
 * rejects). Written bare - `await window.api.settings.set(...)` in the middle of a click handler, or `void ...` after it - a refusal
 * ended the handler that awaited it (the Welcome screen's "Let's go" stayed on the Welcome screen; Export, which saved the watermark
 * handle before it started, did nothing) or was an unhandled rejection, and in neither case did the person read a word about it.
 *
 * This never rejects: a refusal is one plain sentence through `reportFailure` (the raw error goes to the console), and the caller carries
 * on as if it had not asked. Call it `void persistSetting(...)` when nothing depends on the write; `await` it where the order matters (the
 * recent-files list shows what it just saved). A write the NEXT LINE depends on - the posting diary's migration deletes the old copy only
 * once the new one is stored - is not this: it stays an `await` inside the `try` that handles its failure.
 * `failurePathLanguage.test.ts` fails on any other `window.api.settings.set` that is neither in a `try` with a `catch` nor `.catch`ed.
 */
export async function persistSetting(key: SettingsKey, value: unknown): Promise<void> {
  try {
    await window.api.settings.set(key, value)
  } catch (err) {
    reportFailure(err, { failed: "Couldn't save your settings.", id: SETTINGS_FAILED_TOAST_ID })
  }
}

/**
 * T-132 (13): the one toast every refused write shares. Export makes up to four `persistSetting` calls in one press (the handle, its
 * corner, the file-name template, the folder), and a refusal that is not about one key but about the settings file refuses all of them:
 * four identical red cards, one on top of another (executed). Given an id the library replaces the live card, so the person reads the
 * sentence once.
 */
export const SETTINGS_FAILED_TOAST_ID = 'settings-save-failed'
