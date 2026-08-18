import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GraphError, computeFrontier, topoSort } from "../lib/graph.ts";
import { refreshStatuses } from "../lib/mastery.ts";
import { defaultConcept, type Concept } from "../lib/types.ts";

function graph(nodes: Array<Partial<Concept> & { id: string; name: string; prerequisites?: string[] }>): Record<string, Concept> {
	const concepts: Record<string, Concept> = {};
	for (const n of nodes) {
		concepts[n.id] = defaultConcept(n);
		if (n.mastery !== undefined) concepts[n.id].mastery = n.mastery;
		if (n.confidence !== undefined) concepts[n.id].confidence = n.confidence;
		if (n.status) concepts[n.id].status = n.status;
		if (n.evidenceCount !== undefined) concepts[n.id].evidenceCount = n.evidenceCount;
	}
	return refreshStatuses(concepts);
}

describe("concept graph", () => {
	it("topologically sorts prerequisites", () => {
		const concepts = graph([
			{ id: "forms", name: "Forms", prerequisites: ["covectors"] },
			{ id: "vector-spaces", name: "Vector spaces" },
			{ id: "covectors", name: "Covectors", prerequisites: ["vector-spaces"] },
		]);
		assert.deepEqual(topoSort(concepts), ["vector-spaces", "covectors", "forms"]);
	});

	it("rejects cycles", () => {
		const concepts = graph([
			{ id: "a", name: "A", prerequisites: ["b"] },
			{ id: "b", name: "B", prerequisites: ["a"] },
		]);
		assert.throws(() => topoSort(concepts), GraphError);
	});

	it("picks the frontier as the nearest unmastered concept with ready prereqs", () => {
		const concepts = graph([
			{ id: "functions", name: "Functions", mastery: 0.8, confidence: 0.8, evidenceCount: 3 },
			{ id: "lexical-scope", name: "Lexical scope", prerequisites: ["functions"], mastery: 0.75, confidence: 0.7, evidenceCount: 2 },
			{ id: "closures", name: "Closures", prerequisites: ["lexical-scope"], mastery: 0.25, confidence: 0.15 },
		]);
		const frontier = computeFrontier(concepts);
		assert.equal(frontier.next?.id, "closures");
		assert.equal(frontier.mastered.map((c) => c.id).join(), "functions,lexical-scope");
	});

	it("does not teach a concept whose prerequisite is still weak", () => {
		const concepts = graph([
			{ id: "functions", name: "Functions", mastery: 0.4, confidence: 0.5, evidenceCount: 1 },
			{ id: "closures", name: "Closures", prerequisites: ["functions"] },
		]);
		const frontier = computeFrontier(concepts);
		assert.equal(frontier.next?.id, "functions");
		assert.ok(frontier.blocked.some((c) => c.id === "closures"));
	});
});
