import { PREREQ_THRESHOLD } from "./mastery.ts";
import type { Concept, FrontierSnapshot } from "./types.ts";

export class GraphError extends Error {}

/** Stable topological order. Throws on cycles. */
export function topoSort(concepts: Record<string, Concept>): string[] {
	const ids = Object.keys(concepts);
	const incoming = new Map<string, number>();
	const edges = new Map<string, string[]>();

	for (const id of ids) {
		incoming.set(id, 0);
		edges.set(id, []);
	}

	for (const concept of Object.values(concepts)) {
		for (const pre of concept.prerequisites) {
			if (!concepts[pre]) continue;
			edges.get(pre)!.push(concept.id);
			incoming.set(concept.id, (incoming.get(concept.id) ?? 0) + 1);
		}
	}

	const ready = ids.filter((id) => incoming.get(id) === 0).sort();
	const ordered: string[] = [];

	while (ready.length > 0) {
		const id = ready.shift()!;
		ordered.push(id);
		for (const next of (edges.get(id) ?? []).slice().sort()) {
			const n = (incoming.get(next) ?? 0) - 1;
			incoming.set(next, n);
			if (n === 0) ready.push(next);
			ready.sort();
		}
	}

	if (ordered.length !== ids.length) {
		const leftover = ids.filter((id) => !ordered.includes(id));
		throw new GraphError(`Cycle detected among: ${leftover.join(", ")}`);
	}
	return ordered;
}

export function missingPrerequisites(
	concept: Concept,
	concepts: Record<string, Concept>,
): Concept[] {
	return concept.prerequisites
		.map((id) => concepts[id])
		.filter((c): c is Concept => Boolean(c))
		.filter((c) => c.mastery < PREREQ_THRESHOLD);
}

/**
 * Frontier = concepts whose prerequisites look understood, but which
 * the learner has not yet demonstrated mastery of.
 */
export function computeFrontier(concepts: Record<string, Concept>): FrontierSnapshot {
	const mastered: Concept[] = [];
	const ready: Concept[] = [];
	const blocked: Concept[] = [];
	const unknown: Concept[] = [];

	for (const concept of Object.values(concepts)) {
		if (concept.status === "mastered") {
			mastered.push(concept);
			continue;
		}
		const missing = missingPrerequisites(concept, concepts);
		if (missing.length > 0) {
			blocked.push(concept);
			continue;
		}
		if (concept.status === "unknown" && concept.evidenceCount === 0) {
			unknown.push(concept);
		}
		ready.push(concept);
	}

	const rank = (c: Concept) => c.mastery * 100 + c.prerequisites.length;

	ready.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
	blocked.sort((a, b) => a.id.localeCompare(b.id));
	mastered.sort((a, b) => a.id.localeCompare(b.id));
	unknown.sort((a, b) => a.id.localeCompare(b.id));

	return {
		ready,
		blocked,
		mastered,
		unknown,
		next: ready[0] ?? null,
	};
}

export function relatedSubgraph(
	concepts: Record<string, Concept>,
	focusIds: string[],
): Record<string, Concept> {
	const keep = new Set<string>();
	const visit = (id: string) => {
		if (keep.has(id) || !concepts[id]) return;
		keep.add(id);
		for (const pre of concepts[id].prerequisites) visit(pre);
	};
	for (const id of focusIds) visit(id);
	const out: Record<string, Concept> = {};
	for (const id of keep) out[id] = concepts[id];
	return out;
}
