# Grading and evidence

Canonical log: `learner/evidence.jsonl`
Derived cache: `learner/concepts.json`

Recompute is always possible from the log. Do not treat `concepts.json` as the only source of truth.

## Strength weights (V1)

Defined in `lib/mastery.ts`:

| type          | strength | typical item              |
|---------------|----------|---------------------------|
| recognition   | 0.25     | MCQ, identify, match      |
| recall        | 0.50     | short free response       |
| explanation   | 0.65     | explain it back           |
| application   | 0.85     | novel small problem       |
| transfer      | 1.00     | new context / comparison  |

## Update rule

```
signed  = (score - 0.5) * 2
delta   = signed * strength * (1 - 0.35 * currentMastery)
mastery = clip(mastery + delta, 0, 1)
```

Confidence grows with count and strength, and dips after a contradiction.

Mastery does not decay. Forgetting is handled by the review schedule below.

Thresholds:

- mastered: mastery ≥ 0.70 (confidence is informational)
- prerequisite OK: mastery ≥ 0.65

## Spaced review

Defined in `lib/review.ts`. Each concept has a stability `S`: days after a successful recall until predicted recall falls to 90%. Predicted recall after `t` days is `R = 1 / (1 + t / (9S))`.

| event | effect |
|-------|--------|
| first success | `S = 1 + strength` (1.25 to 2 days) |
| success after at least half of `S` | `S = S × (1.5 + 1.5 × strength)` |
| success before half of `S` (massed) | no change |
| failure after a first success | `S = max(0.5, 0.3 × S)`, lapse counted |
| self-report or ungraded | no change |

A mastered concept is **due** once `S` days have passed since the last change. `learner_snapshot` lists due concepts, most forgotten first, and the footer shows the count. Review up to 3 before new material. The schedule is replayed from `evidence.jsonl` like mastery, so it is never edited by hand.

## Misconceptions

Defined in `lib/misconceptions.ts`. Each misconception has a stable id (`m-` plus a short hash of concept and wording) and a status:

- **open**: recorded by a grade or by `learner_record_evidence`
- **resolved**: a later item targeting it (`targetMisconception`) was answered correctly
- **confirmed**: another correct targeted item at least 2 days after it was resolved

Seeing it again reopens it. The snapshot lists open misconceptions and resolved ones ready to confirm. A wrong answer to a targeted item keeps it open and counts the repeat.

## "I don't know"

Preferable to guessing. Score 0, **not** a misconception. Recommended action is usually `probe_prerequisite` or a gentler reteach.

## Isolated verifier

The conversational tutor must not be the sole judge of free-response answers.

`quiz` / `grade_response` call the `verifier` agent with: concept, question, expected understanding, rubric, learner response.

The verifier returns JSON only (see `.pi/agents/verifier.md`). It does not tutor.

## Script-graded formats

These are graded without a model, so they stay reliable with small local models:

| format | grading | default evidence |
|--------|---------|------------------|
| `multiple_choice` | selected choice equals the key | recognition |
| `multi_select` | score = (correct picks − wrong picks) ÷ correct choices; correct only for the exact set | recognition |
| `numeric` | within `tolerance` (default 1% of the key); flags sign and power-of-ten slips | recall |
| `code` | learner code + tutor tests run in a temp folder, 10 s limit; exit 0 passes | application |

Malformed items are rejected before the question is shown or saved: every answer key must parse and match the listed choices. Answer keys are redacted from the TUI renderer and the model-visible result.

Code runs with your user permissions, like any code you run locally. JavaScript runs on the same Node as Pi. Python uses `python3`, or `PI_TEACH_PYTHON` if set. Without an interpreter, the verifier reads the code instead.

Self-reports use `learner_record_self_report`. They have low strength and must not replace a probe for important prerequisites.

## What the tutor should do with a grade

Obey `recommendedAction`. Mention misconceptions briefly when remediating. Do not paste the full expected answer after a miss unless that is now the teaching move.
