# pi-learn

`pi-learn` is a project-local adaptive tutor for Pi. It builds a small learning plan, teaches one concept at a time, checks understanding with a quiz, and saves evidence so the next session can continue.

Chat history is not the learner model. Progress lives in files in this repository.

## Prerequisites

- Node.js 22 or newer
- Pi 0.84 or newer (`@earendil-works/pi-coding-agent`)
- `pi-subagents` 0.50 or newer
- `pi-web-access` 0.23 or newer

## Setup

Install Pi and the extensions, then start Pi from this repository:

```bash
npm install -g @earendil-works/pi-coding-agent
pi install npm:pi-subagents
pi install npm:pi-web-access

git clone https://github.com/arnavprabhu/pi-learn.git
cd pi-learn
npm install
pi --approve
```

`--approve` trusts this project so Pi can load its local skills, extensions, agents, and settings. Pi may prompt for this approval interactively instead.

## Everyday use

```text
/teach Riemann sums
/frontier
```

`/teach` with no topic resumes the current mission. You can also ask in plain language: `Teach me how Riemann sums approximate area.`

`/frontier` prints the next concept from saved files, not from chat. When a mission is active, the footer shows the goal and the next concept id.

If `/teach` asks you to wait, let the current turn finish first.

### Quizzes

Checks appear as a quiz overlay, not as “does that make sense?” Multiple choice is a list; free response is a short editor. **I don't know** is always an option and is better than guessing. The answer key is never shown in the UI.

### Your sources

Put readings, notes, code, or textbooks in `knowledge/`, then `/teach` again. Pi indexes changed files, searches relevant passages, and keeps a local cache. An empty folder is fine.

PDF, Markdown, text, HTML, JSON, CSV, and common source-code files are supported. PDF extraction is local and does not use OCR. `knowledge/README.md` is a guide for you and is not indexed as a source.

Files in `knowledge/` are tracked by Git by default. Uncomment the knowledge rules in `.gitignore` if the material should stay local.

## How it works

```text
Probe → Plan → Teach → Verify → Persist
```

The tutor finds the nearest unmastered concept (the frontier), teaches that one step, then quizzes. “I get it” is not treated as evidence. A later session reads the same files and continues there.

## Where progress lives

| File | Role |
|------|------|
| `MISSION.md` | Current goal and depth cap |
| `learner/evidence.jsonl` | Canonical evidence log |
| `learner/concepts.json` | Derived mastery cache |
| `learning-records/` | Compact daily notes |
| `knowledge/` | Your source material |
| `.pi/knowledge-cache/` | Generated local index |

Optional steering: `learner/profile.md` and `learner/preferences.md`. The tutor also writes `MISSION.md` when a topic starts.

## Reset

Resets are never automatic. They ask for confirmation and keep `knowledge/`, its cache, and learning records.

```text
/teach-reset topic <id>
/teach-reset mission
/teach-reset all
```

CLI equivalents:

```bash
npm run reset -- --topic riemann-sums
npm run reset -- --mission
npm run reset -- --all --yes
```

## Isolation

Skills, extensions, agents, sessions, and learner state live in this repository. The project does not install anything into `~/.pi/` or use global Pi sessions. Pi itself may update its trust file if you approve the project. The researcher uses `pi-subagents` and `pi-web-access`; the tutor does not browse directly.

## Tests

```bash
npm test
```

Tests use Node's built-in test runner and TypeScript's native type stripping.

## Project layout

```text
.pi/                 project-local Pi configuration and tutoring logic
knowledge/           learner-provided source material
lib/                 inspectable mastery, graph, grading, and persistence code
learner/             saved learner state
learning-records/    session memory
scripts/reset.mjs    explicit learner-state reset CLI
tests/               automated tests
MISSION.md           current learning goal
```
