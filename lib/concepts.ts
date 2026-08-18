import { nowIso, readText, writeJson } from "./fs.ts";
import { refreshStatuses } from "./mastery.ts";
import type { Concept, ConceptStore } from "./types.ts";
import { defaultConcept } from "./types.ts";
import type { ProjectPaths } from "./paths.ts";

export function emptyStore(): ConceptStore {
	return { version: 1, updatedAt: nowIso(), concepts: {} };
}

export function loadConcepts(paths: ProjectPaths): ConceptStore {
	const text = readText(paths.concepts);
	if (!text || text.trim() === "") return emptyStore();
	const parsed = JSON.parse(text) as ConceptStore;
	if (!parsed.concepts) parsed.concepts = {};
	return parsed;
}

export function saveConcepts(paths: ProjectPaths, store: ConceptStore): void {
	store.updatedAt = nowIso();
	store.version = 1;
	writeJson(paths.concepts, store);
}

export function upsertConcepts(
	store: ConceptStore,
	incoming: Array<Partial<Concept> & { id: string; name?: string }>,
): ConceptStore {
	const concepts = { ...store.concepts };
	for (const item of incoming) {
		const existing = concepts[item.id];
		const base = existing ?? defaultConcept({
			id: item.id,
			name: item.name ?? item.id,
			prerequisites: item.prerequisites,
			description: item.description,
		});
		concepts[item.id] = {
			...base,
			...item,
			id: item.id,
			name: item.name ?? base.name,
			prerequisites: item.prerequisites ?? base.prerequisites,
			misconceptions: item.misconceptions ?? base.misconceptions,
			evidence: item.evidence ?? base.evidence,
		};
	}
	return {
		version: 1,
		updatedAt: nowIso(),
		concepts: refreshStatuses(concepts),
	};
}

export function getConcept(store: ConceptStore, id: string): Concept | null {
	return store.concepts[id] ?? null;
}

export function resetConcepts(
	store: ConceptStore,
	ids: string[] | "all",
): ConceptStore {
	if (ids === "all") return emptyStore();
	const concepts = { ...store.concepts };
	for (const id of ids) delete concepts[id];
	return { version: 1, updatedAt: nowIso(), concepts: refreshStatuses(concepts) };
}
