import { readJson, writeJson } from "./fs.ts";
import type { ProjectPaths } from "./paths.ts";
import type { PendingQuiz } from "./types.ts";

export function loadPendingQuiz(paths: ProjectPaths): PendingQuiz | null {
	const value = readJson<PendingQuiz | null>(paths.pending);
	if (!value || typeof value !== "object" || !("id" in value)) return null;
	return value;
}

export function savePendingQuiz(paths: ProjectPaths, quiz: PendingQuiz): void {
	writeJson(paths.pending, quiz);
}

export function clearPendingQuiz(paths: ProjectPaths): void {
	writeJson(paths.pending, null);
}
