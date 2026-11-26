# Learner state

Persistent model of what has been demonstrated. Inspect these files; prefer `/teach-reset` over hand-editing unless you are debugging.

- `evidence.jsonl` — canonical log. Mastery can always be recomputed from it.
- `concepts.json` — derived cache (graph, mastery, review schedule, open misconceptions). Misconception history and the review schedule are replayed from `evidence.jsonl`.
- `profile.md` / `preferences.md` — durable facts and interaction style.
- `pending-quiz.json` — in-flight quiz, gitignored.
