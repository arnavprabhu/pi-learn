import path from "node:path";
import { nowIso, readText, slugify, writeText } from "./fs.ts";
import { loadEvidence } from "./evidence.ts";
import { computeFrontier } from "./graph.ts";
import { loadMission } from "./mission.ts";
import type { ProjectPaths } from "./paths.ts";
import type { ConceptStore, EvidenceEvent, Mission } from "./types.ts";

export interface LearningRecordInput {
	mission: Mission | null;
	store: ConceptStore;
	events: EvidenceEvent[];
	learnerQuestions?: string[];
	notes?: string;
	topic?: string;
}

/** Refresh the compact daily record after durable evidence is written. */
export function writeAutomaticLearningRecord(paths: ProjectPaths, store: ConceptStore): string {
	const mission = loadMission(paths);
	return writeLearningRecord(paths, {
		mission,
		store,
		events: loadEvidence(paths),
		topic: mission?.topic,
	});
}

export function tryWriteAutomaticLearningRecord(
	paths: ProjectPaths,
	store: ConceptStore,
): { file?: string; error?: string } {
	try {
		return { file: writeAutomaticLearningRecord(paths, store) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function writeLearningRecord(paths: ProjectPaths, input: LearningRecordInput): string {
	const frontier = computeFrontier(input.store.concepts);
	const date = nowIso().slice(0, 10);
	const topic = slugify(input.topic || input.mission?.topic || input.mission?.goal || "session");
	const file = path.join(paths.records, `${date}-${topic}.md`);
	const existing = readText(file);
	const existingQuestions = readExistingBullets(existing, "Important learner questions");
	const existingNotes = readExistingSection(existing, "Notes", "Updated:");
	const learnerQuestions = input.learnerQuestions ?? existingQuestions;
	const notes = input.notes === undefined ? existingNotes || "(none)" : input.notes.trim() || "(none)";

	const covered = Object.values(input.store.concepts).filter((c) => c.evidenceCount > 0);
	const demonstrated = covered.filter((c) => c.status === "mastered");
	const uncertain = covered.filter((c) => c.status !== "mastered");
	const misconceptions = covered.flatMap((c) =>
		c.misconceptions.map((m) => `- ${c.name}: ${m}`),
	);
	const recent = input.events.slice(-12);

	const body = `# Learning record — ${date}

## Learning goal

${input.mission?.goal ?? "(no active mission)"}

## Concepts covered

${bullets(covered.map((c) => `${c.name} (\`${c.id}\`) mastery=${fmt(c.mastery)} conf=${fmt(c.confidence)} [${c.status}]`))}

## Concepts demonstrated

${bullets(demonstrated.map((c) => `${c.name} (\`${c.id}\`)`))}

## Concepts still uncertain

${bullets(uncertain.map((c) => `${c.name} (\`${c.id}\`) mastery=${fmt(c.mastery)}`))}

## Misconceptions discovered

${misconceptions.length ? misconceptions.join("\n") : "- (none recorded)"}

## Important learner questions

${bullets(learnerQuestions)}

## Evidence collected

${recent.length ? recent.map(formatEvent).join("\n") : "- (none)"}

## Current frontier

${frontier.next ? `${frontier.next.name} (\`${frontier.next.id}\`)` : "(none — graph empty or mission complete)"}

Ready: ${frontier.ready.map((c) => c.id).join(", ") || "—"}

## Recommended next concept

${frontier.next ? frontier.next.name : "Review mission goal or add concepts to the graph."}

## Notes

${notes}

Updated: ${nowIso()}
`;

	writeText(file, body);
	return file;
}

function readExistingSection(existing: string | null, heading: string, nextHeading: string): string | null {
	if (!existing) return null;
	const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const escapedNext = nextHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = existing.match(new RegExp(`^## ${escapedHeading}\\s*\\n\\n([\\s\\S]*?)\\n\\n${escapedNext}`, "m"));
	const value = match?.[1]?.trim();
	return value && value !== "(none)" && value !== "- (none)" ? value : null;
}

function readExistingBullets(existing: string | null, heading: string): string[] {
	const section = readExistingSection(existing, heading, "## Evidence collected");
	if (!section) return [];
	return section.split("\n").map((line) => line.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
}

function bullets(items: string[]): string {
	if (items.length === 0) return "- (none)";
	return items.map((i) => `- ${i}`).join("\n");
}

function fmt(n: number): string {
	return n.toFixed(2);
}

function formatEvent(event: EvidenceEvent): string {
	const mark = event.correct === true ? "correct" : event.correct === false ? "incorrect" : "ungraded";
	return `- ${event.ts.slice(0, 19)} \`${event.concept}\` ${event.type} score=${event.score.toFixed(2)} strength=${event.strength} (${mark})`;
}
