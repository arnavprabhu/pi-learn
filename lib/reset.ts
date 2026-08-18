import fs from "node:fs";
import path from "node:path";
import { loadConcepts, resetConcepts, saveConcepts } from "./concepts.ts";
import { loadEvidence, recomputeStore, resetEvidence } from "./evidence.ts";
import { writeText } from "./fs.ts";
import { missionTemplate } from "./mission.ts";
import { clearPendingQuiz } from "./pending.ts";
import type { ProjectPaths } from "./paths.ts";

export type ResetTarget = { kind: "topic"; ids: string[] } | { kind: "mission" } | { kind: "all" };

/**
 * Reset learner data. Never called automatically.
 * Topic reset removes those concepts and their evidence.
 * Mission reset restores MISSION.md to the template (learner graph kept).
 * All reset clears concepts, evidence, pending quiz, and mission template.
 * Learning records are never deleted here.
 */
export function resetLearner(paths: ProjectPaths, target: ResetTarget): string[] {
	const changed: string[] = [];
	if (target.kind === "topic") {
		resetEvidence(paths, target.ids);
		const store = recomputeStore(resetConcepts(loadConcepts(paths), target.ids), loadEvidence(paths));
		saveConcepts(paths, store);
		changed.push(paths.concepts, paths.evidence);
		return changed;
	}
	if (target.kind === "mission") {
		writeText(paths.mission, missionTemplate());
		changed.push(paths.mission);
		return changed;
	}
	saveConcepts(paths, { version: 1, updatedAt: new Date().toISOString(), concepts: {} });
	resetEvidence(paths, "all");
	clearPendingQuiz(paths);
	writeText(paths.mission, missionTemplate());
	changed.push(paths.concepts, paths.evidence, paths.pending, paths.mission);
	return changed;
}

export function listRecordFiles(paths: ProjectPaths): string[] {
	try {
		return fs
			.readdirSync(paths.records)
			.filter((f) => f.endsWith(".md"))
			.map((f) => path.join(paths.records, f))
			.sort();
	} catch {
		return [];
	}
}
