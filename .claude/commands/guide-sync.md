---
description: >-
  Check that the imagii guides still match the code, update any that
  drifted, then run the design + QA reviewers and fix what they find.
---

# /guide-sync — keep the guides honest and the code reviewed

Run this after a batch of changes (a feature, a refactor, a bug round)
to make sure the project's guides, code, and reviews stay in lockstep.

The guides are the contract:

- `docs/PRODUCT_GUIDE.md` — what imagii is, the studios, the principles
- `docs/DESIGN_GUIDE.md` — visual system, tokens, layout, resolution
- `docs/STYLE_GUIDE.md` — code-level UI conventions, the no-emoji rule
- `docs/BRANDING_GUIDE.md` — name, voice, identity
- `docs/USER_GUIDE.md` — end-user instructions per studio

## Steps

1. **See what changed.** `git diff` against the last guide-sync point
   (or `origin/main` if unsure). Note new/changed/removed: routes,
   studios, features, components, tokens, settings, copy.

2. **Audit each guide for drift.** For every guide above, ask: does any
   statement in it now contradict the code? Common drift:
   - A new studio/route/feature not listed in PRODUCT_GUIDE or
     USER_GUIDE.
   - A new design token, component class, or icon not in DESIGN_GUIDE.
   - A new convention (or a relaxed one) not in STYLE_GUIDE.
   - Renamed UI / changed copy that BRANDING_GUIDE or USER_GUIDE still
     describes the old way.
   Update any guide that drifted. If a guide is still accurate, leave
   it untouched — don't churn it.

3. **Run the reviewers.** Launch both in parallel:
   - the `design-reviewer` agent — design-system + guide conformance
   - the `qa-reviewer` agent — real bugs
   Give each the diff range so they focus on what changed (or ask for
   a full sweep if that's the intent).

4. **Fix what they find.** Triage by severity. Fix HIGH and MED
   findings. For each fix: add or update a regression test, and add a
   `docs/LESSONS_LEARNED.md` entry if it's a bug. Verify false
   positives against source before dismissing them.

5. **Verify.** `npm run verify` (emoji guard + typecheck + tests). All
   green before you're done.

6. **Report.** Summarize: which guides were updated and why (or "no
   drift"), what the reviewers found, what was fixed, test count
   before/after.

## Rules

- A guide change ships in the **same commit** as the code that caused
  it — never a separate "docs" commit lagging behind.
- Enforce the guides, don't just check them: if the code violates a
  guide, fix the code (or, if the guide is wrong, fix the guide — but
  decide deliberately which one is authoritative).
- Don't invent work. If nothing drifted and the reviewers find
  nothing, say so and stop.
