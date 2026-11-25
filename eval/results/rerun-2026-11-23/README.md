# .rx rerun on Solid main 30e7805eb (2026-11-23)

24 new .rx apps: board and desk9, 6 Opus + 6 Haiku each, same scaffold as round 15 (`--brief plain --inline-docs`),
current guide, Solid main 30e7805eb (#5095, #5104, #5146 fixed). Graded with `harness/grade.sh` (`FUZZ_ROUND=--r15`).
Defects = failed hidden + overlap tests + fuzz seeds with a hole, minus tests whose hold probe passes and the
after-left family (`python3 score.py`).

| | round 15 | rerun |
|---|---|---|
| desk9 Opus | 0.00 | 0.33 (2,0,0,0,0,0) |
| desk9 Haiku | 1.50 | 3.50 |
| board Opus | 4.83 | 1.83 (0,3,1,0,0,7) |
| board Haiku | 19.67 | 17.00 |

2026-11-25: board fuzz regraded with B6 (the detail may say loading while a column's fetch is in the air; Ryan) in
`grades/*.fuzz-b6.txt`, and every board app also run through `trace/holds-item-reload.mjs` and
`trace/holds-rename-decline.mjs`. The round 15 column is now
[`../round15-2026-11-16/rescore-2026-11-25`](../round15-2026-11-16/rescore-2026-11-25/README.md), which runs every
probe on all six arms (an earlier rescore here read hold outputs where the round 15 rx apps had not built).
Before B6: board Opus 3.67 (0,14,1,0,0,7), Haiku 19.00.

Probe changes (judgement calls; Ryan 2026-11-25: "These are all fine"):
- `round15/trace/holds9.mjs` re-ask also answers the selected issue's detail; `round15/trace/holds.mjs` `reloads()`
  answers columns not named as they first loaded. Apps that re-ask every list after a write held there and settle right.
- `trace/holds-board-reopen.mjs`: "the new-card input starts empty when the board opens again" checked after To do's
  re-ask lands. All six Opus apps keep the add input under To do's loading (ruled acceptable 2026-11-12).

Traced:
- board opus-2 (13 seeds before B6): the detail sits in one loading region that reads all three columns, so it says
  "loading" until every column has arrived. Ryan 2026-11-25: valid, the detail reads every column (B6). Left: seed 10
  (card count vs progress) and seed 12 (Doing heading counts 2 beside 1 card), untraced.
- board opus-6 (7 seeds): page NotReadyError = solidjs/solid#5174 (a handler reading a ternary prop while its source
  re-asks; `repro/handler-reads-ternary-prop-during-reask.spec.tsx`). Minimal trail: land doing; land todo; left #3;
  land move; right #2.
- Haiku's 12 agents each posted one stray chat message (a tool they were told not to use); not part of the task.
