# Session handoff — paused 2026-10-16, resume Thursday 2026-10-22

Written by the expediter session
(https://claude.ai/code/session_017Z46tdNYUhqpXu6uU6Htju) at the owner's
instruction: "Hold additional work until Thursday, Oct 22. Find a
stopping place and make a handoff document." Delete this file when the
work below has landed.

The session's container is ephemeral: every clone, worktree, scratch
ledger and fixture dies with it. Everything durable is in git. This file
is the map.

---

## Where things stand

- **Shipped:** v1.6.0 (commit 8ffe179) — rounds 49-77, every verified
  finding from seventeen review sweeps, headlined by the phone-home fix
  (spellcheck dictionary + DoH probes; a built-app net-log e2e now holds
  "zero network requests"). Open as PR #66 (ready, mergeable; this repo
  has no pull_request CI — verification is the local gate suite).
- **This branch** (`claude/imagii-e2e-review-testing-7v7ww6`) also
  carries: the T-128/129/130/131 tickets, T-110 letters through (az),
  the 2026-10-15/16 routing amendments in CLAUDE.md, and this handoff.
- **Sweep #17** (nine-reviewer gate on the shipped tree): NOT CLEAN —
  verdicts and expediter verification are recorded in the T-131 ticket
  text (docs/TICKETS.md), which carries every mechanism. The clean-pass
  count is at zero; sweep #18 becomes candidate #1 only after the three
  in-flight tickets land.

## In-flight work, preserved as wip branches (NOT expedited, NOT gated)

Each branch forks from 327ccbf and carries the worker's own ledger under
`handoff/` (label, file, sha_before, sha_broken, sha_restored, restored=,
exit, failure quote — the red-first record).

| Branch | Ticket | State when stopped |
|---|---|---|
| `wip/t128-partial-20261016` | T-128 small-debt batch (6 items) | 58 files; items 1-4, 6 in progress; item 5 mid-implementation. Two scope notes were delivered and are REQUIRED: the titles additions (ExportPanel:644 queue row; Record tiles + mood-board h3 priority; make DESIGN_GUIDE:220-222 true) and the item-5 CRITICAL rule — the quit sweep must never delete a finalizing take's webm (the take's only copy; e2e: window-X mid-convert → the mp4 exists OR the webm survives, never both gone). |
| `wip/t129-partial-20261016` | T-129 waveform peaks (T-110 (ao)) | 30 files; Opus-tier work; peaks job + renderer wiring + ceiling retirement largely drafted, worker was filling TESTING counts. Scope note delivered and REQUIRED: a visible "Drawing the waveform… NN%" line from the peaks job's progress events. STOP rule stands: never fall back to a renderer decode. |
| `wip/t131-partial-20261016` | T-131 sweep-17 fixes (18 items) | 6 files; item 1 (apad whole_dur) and its tests just begun. |

**Resume procedure per branch (the worker-death protocol applies —
trust nothing unverified):** start a fresh Sonnet worker (Opus for
T-129) in a CLONE of the wip branch; it must re-verify the inherited
ledger's claims (named tests exist and pass; re-run one red per
completed item with byte-identical sha256 content-replace restores)
before continuing; then finish the ticket per its text in
docs/TICKETS.md and run full gates. The expediter re-runs all gates on
the worker's tree, spot-reads, runs ONE independent mutation at a seam
the ledger does not name, then lands.

## Landing procedure (owner's checkpoint policy, 2026-10-16)

Queue expedited trees; land SERIALLY onto the main branch (apply the
tree's diff vs its fork point; T-128/T-131 may collide on ExportPanel,
INTERACTION_COVERAGE, LESSONS — resolve by hand); re-run verify + the
touched gates on the landed tree; write the ticket's Done entry and flip
its status; ONE consolidated commit per checkpoint with the agent
trailers; push (PR #66 extends). No per-save commits. **Zero GitHub
Actions minutes until the end-state sweeps are clean** — no workflow
dispatches, release.yml included; pushes are free (no push/PR CI
exists).

## After the three tickets land

Dispatch sweep #18 as clean-pass candidate #1: nine review agents
(.claude/agents/), each with an explicit `model: "sonnet"`, briefed with
the tree state, the rounds-78/79 delta, dispositions (a)-(az), and the
verdict protocol (exactly "CLEAN PASS — no findings", or findings with
file:line + severity + scenario + evidence; the expediter verifies every
finding personally and replicates measured claims on real binaries).
Clean → sweep #19 as candidate #2. Two consecutive cleans → report to
the owner and PROPOSE the release dispatch (workflow_dispatch of
release.yml WITH inputs {tag:"v1.6.x"} — never without inputs). Any
verified finding → ticket, fix round, count restarts.

## Environment recipes (these died with the container — rebuild as
## follows)

- **Gate suite (the expediter runs it personally per round):**
  sha-snapshot key files; `npm run verify` ×3; `npm run test:media`
  (bundled ffmpeg-static 7.0.2); the touched Layer 5 blocks on ffmpeg
  6.1.1 (the shipped win32 major — distro /usr/bin/ffmpeg) via a vitest
  config that aliases the binaries; `xvfb-run -a npm run test:e2e:build`
  (build + FULL Playwright, --workers=1). Baseline at 327ccbf:
  verify 160 files / 4386 tests; media 279 passed | 11 skipped of 290;
  e2e 334. Seven known 6.1.1 whole-suite failures are ledgered platform
  pins (4 drawtext, GIF 25/2, ansi text-file, mpegts).
- **6.1.1 alias config** (recreate as vitest.exp61.config.mjs; adapt
  `root` when running inside a clone):

      import { defineConfig } from 'vitest/config'
      import { resolve } from 'node:path'
      const stub = (p, v) => { /* write a tiny mjs exporting default path */ }
      // Two stub modules, each `export default '<path>'`:
      //   ffmpeg-static  -> /usr/bin/ffmpeg
      //   ffprobe-static -> /usr/bin/ffprobe   (named export `path` too)
      export default defineConfig({
        root: '<repo or clone root>',
        resolve: { alias: {
          'ffmpeg-static': '<stub-ffmpeg.mjs>',
          'ffprobe-static': '<stub-ffprobe.mjs>',
          '@shared': resolve('<root>/src/shared')
        } },
        test: { include: ['tests/integration/media.spec.ts'],
                testTimeout: 600000, hookTimeout: 600000 }
      })

  Run blocks with `-t '<block name>'`.
- **Net-log capture (the zero-requests proof):** run the BUILT app
  `xvfb-run -a npx electron out/main/index.js --no-sandbox
  --log-net-log=<file> --net-log-capture-mode=Everything` for ~30 s;
  tally `"url":"<scheme>://host"` occurrences — the fixed build shows
  ZERO outbound hosts (red capture on pre-fix bytes showed 4×
  redirector.gvt1.com + 42× dns.google). The smoke.spec.ts e2e automates
  the same check with a loopback control.
- **T-131 item-1 replication harness:** a 10 s testsrc2 video with 6 s
  of sine audio (AAC); production `runConcat` with segments
  [1,3],[7,9],[2,4] must deliver 6.0 s (the broken tree delivers 2.0 s),
  and [1,3],[5,8],[2,4] must deliver 7.0 s (broken: 5.014 s). The
  banked warnings in the T-131 ticket are measurements — do not deviate
  from apad=whole_dur.
- **Worker environments:** the harness cuts `isolation: "worktree"`
  worktrees from MAIN, not the working branch — always verify/correct a
  new worktree's base, or use a local clone of the branch (the pattern
  used for r78a/r79). Workers never run git write operations; the
  expediter harvests uncommitted diffs.

## Standing rules (also in CLAUDE.md)

Implementation tier Haiku/Sonnet/Opus by effectiveness (Opus only where
Sonnet would likely fail); reviewers dispatch with model "sonnet";
parallel workers for independent items; the expediter owns
docs/TICKETS.md, package.json, the lockfile, adjudication, gates and
the independent mutations; red-first with sha256 content-replace
restores, never `git checkout --`; no emoji in src/; tokens only; no
model identifiers in repo artifacts.

## Owner hand-checks outstanding (no model usage needed)

- Review/merge PR #66 when satisfied.
- Release run (LAST, after two clean sweeps, and only via dispatch WITH
  inputs {tag:...}): on the win32 build confirm the net-log is clean
  (allow a possible OS-level `wpad` lookup if "Automatically detect
  settings" is on — that is the OS proxy setting, not the app), the
  asar contains no @fontsource, and resources/licenses/Inter-OFL.txt is
  present once T-131 (18) lands.
- `/long.mp4` — a 647 KB round-74 scratch file at the CONTAINER
  filesystem root; it dies with the container, no action needed unless
  the same container persists.

## T-110 backlog after this work

Letters (a)-(az) stand; T-130 (60 fps presets, kit thumbnail crop,
watermark insets) is written and undis­patched; the prioritized estimate
for clearing everything (~18-22M tokens, (ao) and (at) first) was given
in chat on 2026-10-15.
