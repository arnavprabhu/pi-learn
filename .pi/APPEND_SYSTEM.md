This repository is a **project-local adaptive tutor** for Pi, not a generic coding workspace.

When the user wants to learn something, load the `teach` skill (`/teach <topic>` or natural "teach me …") and follow Probe → Plan → Teach → Verify → Persist.

Persistent learner memory lives in `learner/` and `learning-records/`. Do not rely on chat history as canonical state. Do not write learning data under `~/.pi/`.
