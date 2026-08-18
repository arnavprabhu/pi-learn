import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEvidence, recomputeConcept, strengthFor } from "../lib/mastery.ts";
import { defaultConcept, type EvidenceEvent } from "../lib/types.ts";

function event(partial: Partial<EvidenceEvent> & Pick<EvidenceEvent, "type" | "score" | "correct">): EvidenceEvent {
	return {
		id: "e",
		ts: "2026-08-17T00:00:00.000Z",
		concept: "closures",
		source: "quiz",
		strength: partial.strength ?? strengthFor(partial.type),
		...partial,
	};
}

describe("mastery heuristic", () => {
	it("weights application more than MCQ recognition", () => {
		const base = defaultConcept({ id: "closures", name: "Closures" });
		const afterMcq = applyEvidence(base, event({ type: "recognition", score: 1, correct: true }));
		const afterApp = applyEvidence(base, event({ type: "application", score: 1, correct: true }));
		assert.ok(afterApp.mastery > afterMcq.mastery);
	});

	it("does not treat a single lucky MCQ as mastery", () => {
		const base = defaultConcept({ id: "closures", name: "Closures" });
		const after = applyEvidence(base, event({ type: "recognition", score: 1, correct: true }));
		assert.ok(after.mastery < 0.7);
	});

	it("recomputes the same mastery from the evidence log", () => {
		const base = defaultConcept({ id: "closures", name: "Closures" });
		const events = [
			event({ type: "recognition", score: 1, correct: true, id: "1" }),
			event({ type: "recall", score: 0, correct: false, id: "2", misconceptions: ["confused capture with copy"] }),
			event({ type: "application", score: 1, correct: true, id: "3" }),
		];
		let streamed = base;
		for (const e of events) streamed = applyEvidence(streamed, e);
		const replayed = recomputeConcept(base, events);
		assert.equal(replayed.mastery, streamed.mastery);
		assert.equal(replayed.evidenceCount, 3);
		assert.ok(replayed.misconceptions.some((m) => m.includes("capture")));
	});
});
