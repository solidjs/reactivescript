# Round 15 rescored with valid holds in every arm (2026-11-25)

Ryan, 2026-11-25: the hold allowances are not rx exclusions, they are valid behaviour, and they apply to every arm.
Round 15 had run the hold probes only on the rx apps (`../exclusions.json`). This rescore runs every hold probe on all
144 apps and regrades the board fuzz of all 72 board apps with the current oracle (B5 widened 2026-11-24, B6 new
2026-11-25: the card detail reads every column, so while a column's fetch is in the air it may say it is loading, and
while a column has failed it may show its errored fallback; it must never name a wrong column or title).

Defects = failed hidden + overlap tests (from `../grades`, unchanged) + fuzz seeds with a hole (`fuzz/`), minus tests
whose hold probe passes (`holds/`) and the after-left family. `python3 score.py` -> [`score.txt`](score.txt).

Probes: board `holds`, `holds-probe3`, `holds-noc`, `reopen`, `itemreload`, `renamedecline`; desk9 `holds9`,
`holds9-reopen`. rx apps built with the round 15 compiler (b071e45).

| | rx | React | Exact | XState | Foldkit | vanilla |
|---|---|---|---|---|---|---|
| desk9, Opus | **0.00** | 3.17 | 1.67 | 2.67 | 2.67 | 5.00 |
| desk9, Haiku | **1.50** | 9.00 | 21.83 | 16.50 | 16.00 | 11.00 |
| board, Opus | 4.83 (6.33) | **0.67** | 7.17 | 1.50 | 1.33 | 1.50 |
| board, Haiku | 19.67 (25.17) | 2.83 (3.00) | 31.67 | 15.50 (15.67) | **2.83** | 3.00 |

(Brackets: the round 15 score, where it changed.)

- Every arm got the same probes. Only two failures outside rx pass one: a React Haiku board app's "new-card input
  starts empty when the board opens again" and an XState Haiku app's "declined archive of a card whose rename is out".
  The other arms show their writes on top of the list rather than holding, so they pass those tests outright; they
  were not being penalised for valid holds.
- The fuzz regrade changed no seed outside rx (B5 and B6 are about a detail that says loading or errored, which only
  the rx apps show). rx board fuzz went 28 -> 23 seeds (Opus) and 41 -> 24 (Haiku).
- Caveat: eval's node_modules is now Solid main 30e7805eb, not rc.23, so the rx fuzz regrade also carries Solid fixes
  since the round; they can't be told apart from B6 here. With the round's own fuzz counts and the new probes, rx board
  would be 5.67 (Opus) and 22.50 (Haiku).
- Not counted as a hold, open for Ryan: in 18 apps outside rx (React Opus 3, Exact Opus 4, Foldkit 5, vanilla Opus 5,
  XState Opus 1) "two adds show both" fails because the accepted second add shows above the first add's placeholder
  and stays there once both land (#8 then #7, server #7 then #8). `holds-add-order.mjs` leaves the in-flight order free
  and still fails all three apps it was run on, on the settled order.
- "an earlier move declined while a later move of the card is out" fails in all 30 Haiku apps outside rx: the decline
  rolls the card out of the column the later move put it in (a tear, not a hold).
