# Adaptive learning (Pi)

This project is a **project-local** tutoring harness. Skills, extensions, and learner state live here.

- Start or resume: `/teach [topic]`
- Inspect frontier: `/frontier` (file-backed, not chat)
- Reset (never automatic): `/teach-reset topic <id>` · `mission` · `all`
- State: `learner/concepts.json`, `learner/evidence.jsonl`, `MISSION.md`, `learning-records/`
- Sources: `knowledge/` (indexed on `/teach`; `knowledge/README.md` is not a source)
- Cache: `.pi/knowledge-cache/`

Do not install anything into `~/.pi/` for this system. Global Pi packages already present on this machine (`pi-subagents`, `pi-web-access`) are reused when available.
