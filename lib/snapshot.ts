import { computeFrontier, relatedSubgraph } from "./graph.ts";
import { loadConcepts, saveConcepts } from "./concepts.ts";
import { loadEvidence, recentEvidence, recomputeStore } from "./evidence.ts";
import { loadMission } from "./mission.ts";
import { deriveMisconceptions, misconceptionsToRecheck } from "./misconceptions.ts";
import { loadPendingQuiz } from "./pending.ts";
import type { ProjectPaths } from "./paths.ts";
import { dueReviews, formatDays, nextReview } from "./review.ts";
import type { LearnerSnapshot } from "./types.ts";

export function loadSnapshot(paths: ProjectPaths, options?: { recompute?: boolean; focus?: string[]; now?: Date }): {
	snapshot: LearnerSnapshot;
	store: ReturnType<typeof loadConcepts>;
} {
	let store = loadConcepts(paths);
	const events = loadEvidence(paths);
	if (options?.recompute !== false) {
		store = recomputeStore(store, events);
		saveConcepts(paths, store);
	}
	const concepts = options?.focus
		? relatedSubgraph(store.concepts, options.focus)
		: store.concepts;
	const frontier = computeFrontier(store.concepts);
	const now = options?.now ?? new Date();
	const misconceptions = deriveMisconceptions(events);
	return {
		store,
		snapshot: {
			mission: loadMission(paths),
			frontier,
			concepts: Object.values(concepts),
			recentEvidence: recentEvidence(events, 8),
			pendingQuiz: loadPendingQuiz(paths),
			dueReviews: dueReviews(store.concepts, now),
			misconceptions: misconceptionsToRecheck(misconceptions, now),
		},
	};
}

export function compactSnapshotText(snapshot: LearnerSnapshot, now: Date = new Date()): string {
	const mission = snapshot.mission;
	const next = snapshot.frontier.next;
	const lines: string[] = [];
	lines.push("# Learner snapshot");
	if (mission) {
		lines.push(`Goal: ${mission.goal}`);
		lines.push(`Depth: ${mission.desiredDepth}`);
		lines.push(`Status: ${mission.status}`);
		if (mission.constraints.length) {
			lines.push(`Constraints: ${mission.constraints.join("; ")}`);
		}
	} else {
		lines.push("Goal: (no mission yet)");
	}
	lines.push("");
	lines.push(`Frontier next: ${next ? `${next.name} (${next.id}) mastery=${next.mastery.toFixed(2)}` : "(none)"}`);
	lines.push(`Ready: ${snapshot.frontier.ready.map((c) => c.id).join(", ") || "—"}`);
	lines.push(`Mastered: ${snapshot.frontier.mastered.map((c) => c.id).join(", ") || "—"}`);
	lines.push(`Blocked: ${snapshot.frontier.blocked.map((c) => c.id).join(", ") || "—"}`);
	lines.push("");
	const due = snapshot.dueReviews ?? [];
	if (due.length) {
		lines.push(`Due for review (${due.length}; review up to 3 before new material):`);
		for (const r of due.slice(0, 8)) {
			lines.push(`- ${r.id}: overdue ${formatDays(r.overdueDays)}, predicted recall ${Math.round(r.retrievability * 100)}%`);
		}
	} else {
		const upcoming = nextReview(snapshot.concepts, now);
		lines.push(`Due for review: none${upcoming ? ` (next: ${upcoming.id} in ${formatDays(-upcoming.overdueDays)})` : ""}`);
	}
	const recheck = snapshot.misconceptions ?? [];
	if (recheck.length) {
		lines.push("Misconceptions to re-check (pass the id as quiz targetMisconception):");
		for (const m of recheck.slice(0, 8)) {
			const state = m.status === "open" ? `open, seen ${m.count}x` : "resolved, confirm it";
			lines.push(`- ${m.id} [${m.concept}] ${m.text} (${state})`);
		}
	}
	lines.push("");
	lines.push("Concepts:");
	if (snapshot.concepts.length === 0) lines.push("- (empty graph)");
	for (const c of snapshot.concepts) {
		const mis = c.misconceptions.length ? `; misconceptions: ${c.misconceptions.join(" | ")}` : "";
		const review = c.review && c.review.stability > 0 && c.review.due
			? ` review=${c.review.due.slice(0, 10)}`
			: "";
		lines.push(
			`- ${c.id}: mastery=${c.mastery.toFixed(2)} conf=${c.confidence.toFixed(2)} status=${c.status} prereqs=[${c.prerequisites.join(", ")}] n=${c.evidenceCount}${review}${mis}`,
		);
	}
	lines.push("");
	lines.push("Recent evidence:");
	if (snapshot.recentEvidence.length === 0) lines.push("- (none)");
	for (const e of snapshot.recentEvidence) {
		lines.push(`- ${e.ts.slice(0, 19)} ${e.concept} ${e.type} score=${e.score} correct=${e.correct}`);
	}
	if (snapshot.pendingQuiz) {
		lines.push("");
		lines.push(`Pending quiz: ${snapshot.pendingQuiz.quizType} on ${snapshot.pendingQuiz.concept}`);
		lines.push(`Question: ${snapshot.pendingQuiz.question}`);
	}
	return lines.join("\n");
}
