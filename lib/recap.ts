/**
 * Recap of recent learning, computed only from evidence.jsonl and the graph.
 * No model call: every number here can be checked against the log.
 */

import path from "node:path";
import { loadConcepts } from "./concepts.ts";
import { loadEvidence, recomputeStore } from "./evidence.ts";
import { writeText } from "./fs.ts";
import { computeFrontier } from "./graph.ts";
import { loadMission } from "./mission.ts";
import { deriveMisconceptions } from "./misconceptions.ts";
import type { ProjectPaths } from "./paths.ts";
import { dueReviews, formatDays, nextReview } from "./review.ts";
import type { ConceptStore, EvidenceEvent } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecapStats {
	days: number;
	from: string;
	to: string;
	activeDays: number;
	items: number;
	graded: number;
	correct: number;
	accuracy: number | null;
	dontKnow: number;
	conceptsPracticed: string[];
	newlyMastered: string[];
	lapses: string[];
	misconceptionsFound: string[];
	misconceptionsResolved: string[];
	dueNow: string[];
	next: string | null;
}

export function computeRecap(store: ConceptStore, events: EvidenceEvent[], days = 7, now: Date = new Date()): RecapStats {
	const span = Math.max(1, Math.floor(days));
	const from = new Date(now.getTime() - span * DAY_MS);
	const inWindow = (ts: string) => {
		const t = Date.parse(ts);
		return t >= from.getTime() && t <= now.getTime();
	};
	const recent = events.filter((e) => inWindow(e.ts));
	const before = events.filter((e) => Date.parse(e.ts) < from.getTime());

	const current = recomputeStore(store, events.filter((e) => Date.parse(e.ts) <= now.getTime()));
	const earlier = recomputeStore(store, before);

	const graded = recent.filter((e) => e.correct !== null && e.source !== "self_report");
	const correct = graded.filter((e) => e.correct === true).length;
	const masteredBefore = new Set(Object.values(earlier.concepts).filter((c) => c.status === "mastered").map((c) => c.id));

	const lapses = new Set<string>();
	for (const event of recent) {
		if (event.correct !== false) continue;
		const prior = events.filter((e) => e.concept === event.concept && e.ts < event.ts);
		if (prior.some((e) => e.correct === true && e.source !== "self_report")) lapses.add(event.concept);
	}

	const misconceptions = deriveMisconceptions(events.filter((e) => Date.parse(e.ts) <= now.getTime()));

	return {
		days: span,
		from: from.toISOString(),
		to: now.toISOString(),
		activeDays: new Set(recent.map((e) => e.ts.slice(0, 10))).size,
		items: recent.length,
		graded: graded.length,
		correct,
		accuracy: graded.length ? correct / graded.length : null,
		dontKnow: recent.filter((e) => e.notes === "dont_know").length,
		conceptsPracticed: [...new Set(recent.map((e) => e.concept))].sort(),
		newlyMastered: Object.values(current.concepts)
			.filter((c) => c.status === "mastered" && !masteredBefore.has(c.id))
			.map((c) => c.id)
			.sort(),
		lapses: [...lapses].sort(),
		misconceptionsFound: misconceptions.filter((m) => inWindow(m.firstSeen)).map((m) => `${m.concept}: ${m.text}`),
		misconceptionsResolved: misconceptions
			.filter((m) => m.resolvedAt && inWindow(m.resolvedAt) && m.status !== "open")
			.map((m) => `${m.concept}: ${m.text}`),
		dueNow: dueReviews(current.concepts, now).map((r) => r.id),
		next: computeFrontier(current.concepts).next?.id ?? null,
	};
}

export function recapMarkdown(stats: RecapStats, goal: string | null, store?: ConceptStore, now: Date = new Date()): string {
	const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");
	const accuracy = stats.accuracy === null ? "—" : `${Math.round(stats.accuracy * 100)}%`;
	const upcoming = store ? nextReview(store.concepts, now) : null;
	return `# Recap — last ${stats.days} day${stats.days === 1 ? "" : "s"} (${stats.from.slice(0, 10)} to ${stats.to.slice(0, 10)})

Goal: ${goal ?? "(no active mission)"}

## Activity

- Active days: ${stats.activeDays}
- Evidence items: ${stats.items} (${stats.graded} graded, ${stats.correct} correct, accuracy ${accuracy})
- "I don't know" answers: ${stats.dontKnow}
- Concepts practiced: ${stats.conceptsPracticed.join(", ") || "—"}

## Newly mastered

${list(stats.newlyMastered)}

## Forgotten and relearning

${list(stats.lapses)}

## Misconceptions found

${list(stats.misconceptionsFound)}

## Misconceptions resolved

${list(stats.misconceptionsResolved)}

## Next

- Reviews due now: ${stats.dueNow.join(", ") || `none${upcoming ? ` (next: ${upcoming.id} in ${formatDays(-upcoming.overdueDays)})` : ""}`}
- Next new concept: ${stats.next ?? "(none)"}
`;
}

/** Build the recap and save it as learning-records/recap-YYYY-MM-DD.md. */
export function writeRecap(paths: ProjectPaths, days = 7, now: Date = new Date()): { file: string; markdown: string; stats: RecapStats } {
	const events = loadEvidence(paths);
	const base = loadConcepts(paths);
	const stats = computeRecap(base, events, days, now);
	const current = recomputeStore(base, events);
	const markdown = recapMarkdown(stats, loadMission(paths)?.goal ?? null, current, now);
	const file = path.join(paths.records, `recap-${now.toISOString().slice(0, 10)}.md`);
	writeText(file, markdown);
	return { file, markdown, stats };
}
