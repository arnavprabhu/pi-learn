import { computeFrontier, relatedSubgraph } from "./graph.ts";
import { loadConcepts, saveConcepts } from "./concepts.ts";
import { loadEvidence, recentEvidence, recomputeStore } from "./evidence.ts";
import { loadMission } from "./mission.ts";
import { loadPendingQuiz } from "./pending.ts";
import type { ProjectPaths } from "./paths.ts";
import type { LearnerSnapshot } from "./types.ts";

export function loadSnapshot(paths: ProjectPaths, options?: { recompute?: boolean; focus?: string[] }): {
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
	return {
		store,
		snapshot: {
			mission: loadMission(paths),
			frontier,
			concepts: Object.values(concepts),
			recentEvidence: recentEvidence(events, 8),
			pendingQuiz: loadPendingQuiz(paths),
		},
	};
}

export function compactSnapshotText(snapshot: LearnerSnapshot): string {
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
	lines.push("Concepts:");
	if (snapshot.concepts.length === 0) lines.push("- (empty graph)");
	for (const c of snapshot.concepts) {
		const mis = c.misconceptions.length ? `; misconceptions: ${c.misconceptions.join(" | ")}` : "";
		lines.push(
			`- ${c.id}: mastery=${c.mastery.toFixed(2)} conf=${c.confidence.toFixed(2)} status=${c.status} prereqs=[${c.prerequisites.join(", ")}] n=${c.evidenceCount}${mis}`,
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
