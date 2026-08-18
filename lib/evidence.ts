import { randomUUID } from "node:crypto";
import { appendLine, nowIso, readText, writeText } from "./fs.ts";
import { normalizeConceptId } from "./concepts.ts";
import { applyEvidence, recomputeConcept, refreshStatuses, strengthFor } from "./mastery.ts";
import type { ProjectPaths } from "./paths.ts";
import type { ConceptStore, EvidenceEvent, EvidenceType } from "./types.ts";
import { defaultConcept } from "./types.ts";

export function loadEvidence(paths: ProjectPaths): EvidenceEvent[] {
	const text = readText(paths.evidence);
	if (!text) return [];
	const events: EvidenceEvent[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		events.push(JSON.parse(trimmed) as EvidenceEvent);
	}
	return events;
}

export function appendEvidence(paths: ProjectPaths, event: Omit<EvidenceEvent, "id" | "ts"> & Partial<Pick<EvidenceEvent, "id" | "ts">>): EvidenceEvent {
	const full: EvidenceEvent = {
		id: event.id ?? randomUUID(),
		ts: event.ts ?? nowIso(),
		concept: event.concept,
		quizType: event.quizType,
		type: event.type,
		score: event.score,
		strength: event.strength,
		correct: event.correct,
		source: event.source,
		misconceptions: event.misconceptions,
		notes: event.notes,
	};
	appendLine(paths.evidence, JSON.stringify(full));
	return full;
}

export function filterEvidence(events: EvidenceEvent[], conceptIds?: string[]): EvidenceEvent[] {
	if (!conceptIds) return events;
	const set = new Set(conceptIds);
	return events.filter((e) => set.has(e.concept));
}

export function recentEvidence(events: EvidenceEvent[], n = 8): EvidenceEvent[] {
	return events.slice(-n);
}

/** Rebuild mastery caches from the JSONL log. */
export function recomputeStore(store: ConceptStore, events: EvidenceEvent[]): ConceptStore {
	const concepts = { ...store.concepts };
	const seen = new Set(Object.keys(concepts));
	for (const event of events) {
		if (!concepts[event.concept]) {
			concepts[event.concept] = defaultConcept({ id: event.concept, name: event.concept });
			seen.add(event.concept);
		}
	}
	for (const id of seen) {
		concepts[id] = recomputeConcept(concepts[id], events);
	}
	return {
		version: 1,
		updatedAt: nowIso(),
		concepts: refreshStatuses(concepts),
	};
}

export function applyEventToStore(store: ConceptStore, event: EvidenceEvent): ConceptStore {
	const existing = store.concepts[event.concept] ?? defaultConcept({
		id: event.concept,
		name: event.concept,
	});
	const updated = applyEvidence(existing, event);
	const concepts = refreshStatuses({
		...store.concepts,
		[event.concept]: updated,
	});
	return { version: 1, updatedAt: event.ts, concepts };
}

export function recordAndUpdate(
	paths: ProjectPaths,
	store: ConceptStore,
	input: {
		concept: string;
		type: EvidenceType;
		score: number;
		correct: boolean | null;
		source: EvidenceEvent["source"];
		quizType?: EvidenceEvent["quizType"];
		misconceptions?: string[];
		notes?: string;
		strength?: number;
	},
): { event: EvidenceEvent; store: ConceptStore } {
	const concept = normalizeConceptId(input.concept);
	const event = appendEvidence(paths, {
		...input,
		concept,
		strength: input.strength ?? strengthFor(input.type),
	});
	const next = applyEventToStore(store, event);
	return { event, store: next };
}

export function resetEvidence(paths: ProjectPaths, conceptIds: string[] | "all"): void {
	if (conceptIds === "all") {
		writeText(paths.evidence, "");
		return;
	}
	const normalizedIds = conceptIds.map(normalizeConceptId);
	const keep = loadEvidence(paths).filter((e) => !normalizedIds.includes(e.concept));
	writeText(paths.evidence, keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""));
}
