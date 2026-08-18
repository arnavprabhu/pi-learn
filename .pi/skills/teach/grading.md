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

Thresholds:

- mastered: mastery ≥ 0.70 (confidence is informational)
- prerequisite OK: mastery ≥ 0.65

## "I don't know"

Preferable to guessing. Score 0, **not** a misconception. Recommended action is usually `probe_prerequisite` or a gentler reteach.

## Isolated verifier

The conversational tutor must not be the sole judge of free-response answers.

`quiz` / `grade_response` call the `verifier` agent with: concept, question, expected understanding, rubric, learner response.

The verifier returns JSON only (see `.pi/agents/verifier.md`). It does not tutor.

MCQ is graded locally against the expected choice; the expected answer is redacted from the TUI renderer.
Malformed MCQs are rejected before the question is shown or saved. The expected answer must identify one listed choice.

Self-reports use `learner_record_self_report`. They have low strength and must not replace a probe for important prerequisites.

## What the tutor should do with a grade

Obey `recommendedAction`. Mention misconceptions briefly when remediating. Do not paste the full expected answer after a miss unless that is now the teaching move.
