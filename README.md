# pi-learn

`pi-learn` is a project-local adaptive tutoring harness for Pi. It builds a small learning plan, teaches one concept at a time, checks demonstrated understanding, and records evidence for the next session.

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
pi --approve
```

`--approve` trusts this project so Pi can load its local skills, extensions, agents, and settings. Pi may prompt for this approval interactively instead.

## Use it

```text
/teach closures
/frontier
```

You can also ask Pi directly, for example: `Teach me closures in programming languages.`

Useful commands:

- `/teach [topic]` starts or resumes a lesson.
- `/frontier` shows the next concept based on saved state.
- `/teach-reset topic <id>` resets selected topics.
- `/teach-reset mission` resets the mission template.
- `/teach-reset all` resets learner state after confirmation.

The equivalent CLI reset commands are:

```bash
npm run reset -- --topic closures,lexical-scope
npm run reset -- --mission
npm run reset -- --all --yes
```

## Persistence and isolation

Learner state lives in this repository:

- `learner/evidence.jsonl` is the evidence log.
- `learner/concepts.json` is the derived mastery cache.
- `learning-records/` stores compact session records.
- `MISSION.md` defines the current learning goal and depth cap.

Project files under `.pi/` provide the tutoring skills, extensions, agents, and session directory. The project does not install anything into `~/.pi/` or use global Pi sessions. Pi itself may update its trust file if you approve the project. The researcher uses `pi-subagents` and `pi-web-access`; the tutor does not browse directly.

## Tests

```bash
npm test
```

Tests use Node's built-in test runner and TypeScript's native type stripping.

## Project layout

```text
.pi/                 project-local Pi configuration and tutoring logic
lib/                 inspectable mastery, graph, grading, and persistence code
learner/             saved learner state
learning-records/    session memory
scripts/reset.mjs    explicit learner-state reset CLI
tests/               automated tests
MISSION.md           current learning goal
```
