# r78b ledger (T-129) - worker notes
Worktree: /home/user/imagii/.claude/worktrees/agent-a82a5b6ca35c248e6
Scratch: r78b/ ; pristine base snapshot r78b/base = `git archive 23e4e6a` (411 files), taken BEFORE any edit.
ledger.tsv columns (r77 format): label, file, sha_before, sha_broken, sha_restored, restored=, exit=, failure quote.

## BASE (read first) - SUPERSEDED overlay note below; the expediter reset the worktree
- The expediter ran `git reset --hard 327ccbf` in this worktree (their op, not mine) after seeing my overlay.
  Re-baselined: r78b/base is now `git archive 327ccbf` (411 files); `cmpbase.py` (r78b/cmpbase.py) vs the worktree
  = only the worktree's own `.git` pointer file -> the worktree is EXACTLY 327ccbf with zero edits of mine.
  HEAD = 327ccbf61f85b6fbe96da536681177592da270af. The harvest diff is now simply `git diff` (+ untracked) in the worktree,
  and equally r78b/cmpbase.py vs r78b/base. r78b/rebase-to-23e4e6a.patch is obsolete (kept only as a record).

## (obsolete) first overlay, before the expediter's reset
- The worktree was created at 4fd247d (= origin/main, PR #65), TWO commits behind the expediter's branch
  claude/imagii-e2e-review-testing-7v7ww6 @ 23e4e6a (8ffe179 v1.6.0 + 23e4e6a tickets T-128/T-129/T-130).
  The ticket T-129 and the T-123..T-127 work exist only at 23e4e6a.
- Fix WITHOUT any git write op (no checkout/merge/reset/index/ref change): `git diff --binary 4fd247d 23e4e6a > r78b/rebase-to-23e4e6a.patch`
  then `git apply` of that patch (working-tree only; 79 added + 212 modified files, no deletions).
  `diff -rq --exclude=.git --exclude=node_modules <worktree> r78b/base` = EMPTY after the apply: the working tree is byte-identical to 23e4e6a.
  HEAD (and the index) stay at 4fd247d, so `git status` in the worktree shows the v1.6.0 delta as well as mine.
- HARVEST: my own change set is the diff of the worktree against r78b/base (= 23e4e6a), NOT against HEAD.
  r78b/t129.patch (written at the end) is exactly that diff; r78b/changed-files.txt lists the files.

## Progress notes (live)
- 15:20Z baseline `npm run verify` on 327ccbf: exit 0, 160 files / 4386 tests (gates/verify-baseline.log, 2m12s wall: a parallel worker shares the box).
- 15:25Z WAVESURFER CAPABILITY CHECK (installed 7.12.6, node_modules/wavesurfer.js/dist/wavesurfer.js): YES, it takes external peaks+duration
  without decoding. `loadAudio(url, blob, channelData, duration)` (l.305-363): `if (!blob && !channelData)` is the ONLY branch that calls
  `Fetcher.fetchBlob(url)`; `setSrc(url, undefined)` sets `media.src = url` (player.js l.132-150: streams, no blob); the duration promise
  resolves at once from the given `duration` (no wait for loadedmetadata); `if (channelData) decodedData = Decoder.createBuffer(channelData, duration)`
  (decoder.js: builds an AudioBuffer-shaped object from the arrays, no AudioContext, no decodeAudioData) - `Decoder.decode` is reached
  only in the `else if (blob)` branch. The constructor calls `load(initialUrl, options.peaks, options.duration)`. Bars read channel 0 as the
  top and channel 1 as the bottom (renderer-utils.js calculateBarSegments, |value| max per bar): so peaks = [highest per bucket, lowest per bucket].
  STOP rule NOT triggered.
- Fixture timing probe (fx/gen.sh): 2h05m 48k mono 32 kbps MP3 encode = 48 s (too slow to encode in a test; stream-copy loop instead);
  2h05m 8k u8 WAV = 1.7 s; streamed decode to 8 kHz s16le mono: MP3 12.4 s, WAV 3.5 s (120 MB of PCM through the pipe).
- 15:30Z DESIGN (expediter scope note folded in at 15:35Z: the waveform area shows "Drawing the waveform… N%" while the job runs):
  * main: NEW src/main/audio/peaks.ts - readPeaks(file, jobId, onProgress): run = latch.begin(jobId); run.guard(probeAudio) for the length;
    ffmpeg `-v error -i F -map 0:a:0 -vn -ac 1 -ar 8000 -f s16le -acodec pcm_s16le pipe:1`; stdout chunks folded by createPeakFolder
    (pure: PEAK_BUCKETS=4000 [high, low] Float64Arrays + at most 1 carried byte; bucket = floor(sample*buckets/expected), extra samples
    clamp to the last bucket); progress {jobId, percent} on each whole-percent step (<=99 while reading, 100 at the end); exit!=0 ->
    WAVEFORM_READ_FAILED (ffmpeg stderr to the console); registry activePeaks Map + its own CancelLatch; cancelPeaksJob(jobId) /
    cancelAllPeaks(); process.ts cancelAudioJob -> cancelPeaksJob too (so `audio:cancel` reaches it), cancelAllAudioJobs -> cancelAllPeaks.
  * ipc/audio.ts: `audio:peaks` (path + jobId validated; progress over `audio:peaksProgress` via sendIfAlive); extractFromVideo loses the
    ceiling (pre-check AND the T-126 (8) WAV backstop); hasVideo plumbing kept (probe.hasVideo / NoUsableDurationError.hasVideo / return).
  * renderer: loadSource resolves when the file is OPEN (source set, waveform null, drawing {jobId, percent}); drawWaveform runs the job
    (onPeaksProgress -> drawing.percent; answer validated by isWaveformPeaks; source replaced/closed meanwhile -> silent; failure ->
    the studio lets go of the file + reportFailure(err, {failed: "Couldn't draw the waveform."}) so WAVEFORM_READ_FAILED shows as written).
    clearSource and a superseding loadSource cancel the in-flight job (`audio:cancel`). WaveformView: WaveSurfer.create({url, peaks,
    duration}) only once `waveform` exists; while drawing, a h-24 box role=progressbar "Drawing the waveform… N%"; media `error` ->
    PLAYBACK_ERROR_MESSAGE + Play off. `waveform` kept OUT of the source object so `replacedSince` identity checks are untouched.
  * WHY the job is store-run and not WaveformView-run: a Home visit mid-draw must not throw the job away, and the refusal must reach
    every route (importer / Clean audio / project) from one place.
- 15:40Z UNIT reds (pristine bytes via prefix.py, rows i1-unit-prefix-peaks, i3-unit-prefix-shared-audio, i3-unit-prefix-extract-handler(-pair)):
  peaks.test.ts cannot import without peaks.ts (suite red); shared audio.test.ts new cases red on base audio.ts ('expected [...] to not
  include WAVEFORM_MAX_SEC', 'expected undefined to be 4000'); audioExtractCeiling.test.ts on the pristine PAIR (ipc/audio.ts +
  shared/audio.ts): 12 flipped cases red with 'promise rejected "Error: That file is longer than 2 hours, …"', the 13 unchanged
  hasVideo/no-sound cases green on base too (continuity). (Row i3-unit-prefix-extract-handler, handler alone at base, is SUPERSEDED by
  the -pair row: alone, the base handler calls a function the new shared module no longer has, so its reds are TypeErrors.)
- 15:45Z store unit red (row i2-unit-prefix-store-pair: audioStore.ts + shared/audio.ts at base): the 7 T-129 cases red ('That file is
  longer than 2 hours ... Split it into shorter files', 'expected undefined to be null', 'expected [] to deeply equal [ undefined ]'), the 8
  T-126 (7) cases green on base (continuity). ProjectIO.test.ts: PEAKS_BRIDGE stub spread into every audio bridge (9 sites) + the AIFF/video
  over-two-hours case flipped to "opens".
- 15:50Z verify-1 (gates/verify-1.log): 1 failure only, validators.test.ts soft-assert audit (peaks.ts used `assert`): peaks.ts -> assertAlways.
  Also fixed before it: networkAllowlist ALLOWED + 'main/audio/peaks.ts': ['import:child_process']; cancelLatch runner-shape scan flagged
  `return { peaks: folder.peaks(), duration }` (a call in a run's return) -> `const peaks = folder.peaks(); return { peaks, duration }`;
  docClaims cite src/main/index.ts:122-123 -> 123-124 (my cancelAllPeaks import shifted it; image.spec.ts comment re-pointed too).
- 15:55Z LAYER 5 (tests/integration/media.spec.ts NEW describe 'the waveform is read from a stream of the sound in main, into the right
  buckets at the right heights (real ffmpeg, T-129)', 4 its) GREEN on 7.0.2 and 6.1.1. Memory measured: streamed +13..+27 MB RSS over a
  2h05m file (120 MB of PCM through the pipe); KEPT-CHUNKS mutant +116.3 MB (7.0.2) / +115.8 MB (6.1.1) -> line set at 60 MB.
  Round-21 reds, all restored IDENTICAL (rows i4-L5-*-702 / -611): bucket-time (x1.05) 'burst at 5 s: lowest bucket top: expected 0 to be
  greater than 0.47'; downmix (-ac 2) same + 'the whole length is drawn: expected 0.0829'; sign (readUInt16LE) 'highest bucket top:
  expected 1.9025 to be less than 0.52'; failure-sentence (raw stderr) "expected 'ffmpeg exit 234: [aist#0:0/none ...' to be 'imagii
  couldn't read...'"; cancel-nokill 'the job answered finished: expected false to be true'; progress-final 'expected 99 to be 100';
  mem-buffering 'this process grew 116.3 MB ... expected 116.25 to be less than 60'. 6.1.1: bucket-time, sign, failure-sentence,
  cancel-nokill, mem-buffering all red the same way. FIRST i4-L5-mem-buffering-702 row (exit=1, 'No test files found') is SUPERSEDED:
  mut.py joined an unquoted -t filter; re-run with the command as one quoted argv element.
  FLIPPED L5 extraction cases (T-126 (7)/(8) describe): 'an audio-only mkv over two hours is extracted (no ceiling, T-129)' (13.7 s, 1.38 GB
  WAV removed by the case) and 'a durationless file longer than two hours is extracted too' - green on 7.0.2. Their red on the pristine
  PAIR (ipc/audio.ts + shared/audio.ts), BOTH majors (rows i3-L5-prefix-extract-flips-702/-611): 'That file is longer than 2 hours, which
  is more than Audio Studio can draw a waveform for without running out of memory. Split it into shorter files in another app fir…' x2.
- 16:30Z E2E. New/flipped cases green on the new build (gates/e2e-t129-green-1.log, e2e-t129-long-green-1.log, e2e-t129-clean-green-1.log).
  Fixes while greening: a duplicate helper name (the file already had a 1 h `makeLongMp3`; mine is `makeTwoHourMp3`), the concat MP3 is
  2:05:03 (encoder padding per joined minute: regex), bar-gap columns are empty (count painted columns only).
  RED on the pristine 327ccbf build (r78b/basebuild, out/main/index.js sha 8f712b0c...aac5 = v1.6.0; current specs copied in;
  red/e2e-t129-audio-base.log, red/e2e-t129-clean-base.log): all 7 cases red - ADPCM: 'Received array: ["Loaded", "Couldn't draw this
  file's waveform. ..."]' (not the playback sentence); unknown-format: same old sentence instead of the refusal; long file: progressbar
  'element(s) not found'; Close / quit: 'expected > 0, received 0' (no job); long video: Play 'element(s) not found'; Clean audio long:
  'Received array: ["Video loaded", "That file is longer than 2 hours, ..."]'.
  PER-DEFECT MUTATIONS on the new build (mutmulti.py, rebuild each, rows e2e-E1..E5, all restored IDENTICAL, clean rebuild after):
  E1 wavesurfer given url alone (the renderer decode back) -> long-file case red 'Play expected enabled, received disabled' (the run ended
  at 29 s: the renderer CRASHED, see the measurement below); E2 Close without stopDrawing -> 'Expected ["SIGKILL"] received [0-exit]' ;
  E3 both quit sweeps without cancelAllPeaks -> 'the peaks ffmpeg at will-quit: [{"pid":30253,"exit":null}]'; E4 the progress box's
  role/label removed -> 'element(s) not found'; E5 percent not wired -> 'expected > 0, received 0'.
- 16:45Z RSS MEASURED ON THE LONG FIXTURE (2 h 5 min, 48 kHz mono MP3, 30 MB; scratch spec r78b/measure/zz-t129-measure.spec.ts,
  renderer VmHWM / VmRSS from /proc, sampled every 0.5 s):
  * OLD path, ceiling LIFTED (r78b/measurebuild = 327ccbf with WAVEFORM_MAX_SEC = 99 h, measurement only): renderer 170 MB -> 481 -> 987 ->
    1428 MB in 6 s, then `render-process-gone` reason 'crashed' exit 5; the waveform never drew (gates/measure-old-path.log). With the
    ceiling as shipped the file is refused at load (that is the e2e red above).
  * NEW path (this round's build, out/main/index.js cb2b75c1...1588): renderer 168 MB -> peak 182 MB, waveform drawn at 16 s
    (gates/measure-new-path.log). The e2e case itself logged 184 MB (VmHWM) and asserts < 800 MB.
  * main, Layer 5: +13..+27 MB RSS streaming a 2 h 5 min file (120 MB of PCM); +116 MB when the chunks are kept (the red).
