/**
 * The Cancel of a job that is running (T-136 (7)).
 *
 * Eleven panels draw one: GIF, Compile, Picture-in-picture, Reframe, the highlight scan, both Captions jobs and the model download, the Export
 * batch, the audio export and the Clip Kit. They were hand-copied, and two copies had drifted off the pattern (the audio export's was not a
 * `btn-ghost`, had no danger ink and no title; the Clip Kit's was a hand-rolled bordered box). One component, so a running job's Cancel looks and
 * reads the same wherever it is. `title` names the job that Cancel stops ("Cancel GIF export"): a bare "Cancel" button beside a progress row says
 * which job to the eye only, and the title is what says it to a pointer that rests on it. The button text stays "Cancel" - the name a screen
 * reader and a voice-control user say.
 *
 * Not a dialog's Cancel: a Modal's "Cancel" is an answer to a question and stays `btn-ghost px-3 py-1.5 text-sm` inside the Modal.
 * `interactionWiring.test.ts` fails on a hand-written running-job Cancel anywhere else under `src/renderer`.
 */
export function RunningCancel({ title, onClick }: { title: string; onClick: () => void }): JSX.Element {
  return (
    <button type="button" className="btn-ghost px-2 py-1.5 text-xs text-danger hover:text-danger-soft" onClick={onClick} title={title}>
      Cancel
    </button>
  )
}
