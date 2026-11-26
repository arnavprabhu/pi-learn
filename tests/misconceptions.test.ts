import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConcepts, saveConcepts, upsertConcepts } from "../lib/concepts.ts";
import { loadEvidence, recordAndUpdate } from "../lib/evidence.ts";
import { applyEvidence } from "../lib/mastery.ts";
import {
	deriveMisconceptions,
	matchMisconception,
	misconceptionId,
	misconceptionsToRecheck,
} from "../lib/misconceptions.ts";
import { projectPaths } from "../lib/paths.ts";
import { compactSnapshotText, loadSnapshot } from "../lib/snapshot.ts";
import { defaultConcept, type EvidenceEvent } from "../lib/types.ts";
import { makeTempProject, rmrf } from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const TEXT = "thinks closures copy variables";

function event(days: number, partial: Partial<EvidenceEvent>): EvidenceEvent {
	return {
		id: `e${days}`,
		ts: new Date(T0 + days * DAY).toISOString(),
		concept: "closures",
		type: "recall",
		score: 0,
		strength: 0.5,
		correct: false,
		source: "quiz",
		...partial,
	};
}

describe("misconception lifecycle", () => {
	it("gives the same misconception a stable id regardless of case and punctuation", () => {
		assert.equal(misconceptionId("closures", TEXT), misconceptionId("closures", "Thinks closures copy variables."));
		assert.notEqual(misconceptionId("closures", TEXT), misconceptionId("scope", TEXT));
	});

	it("moves from open to resolved to confirmed, and reopens on relapse", () => {
		const id = misconceptionId("closures", TEXT);
		const seen = [event(0, { misconceptions: [TEXT] }), event(1, { misconceptions: [TEXT] })];
		assert.equal(deriveMisconceptions(seen)[0].count, 2);

		const resolved = [...seen, event(2, { correct: true, score: 1, resolvedMisconceptions: [id] })];
		assert.equal(deriveMisconceptions(resolved)[0].status, "resolved");

		const tooSoon = [...resolved, event(3, { correct: true, score: 1, resolvedMisconceptions: [id] })];
		assert.equal(deriveMisconceptions(tooSoon)[0].status, "resolved");

		const confirmed = [...resolved, event(5, { correct: true, score: 1, resolvedMisconceptions: [TEXT] })];
		assert.equal(deriveMisconceptions(confirmed)[0].status, "confirmed");

		const relapse = [...confirmed, event(9, { misconceptions: [TEXT] })];
		const record = deriveMisconceptions(relapse)[0];
		assert.equal(record.status, "open");
		assert.equal(record.count, 3);
	});

	it("matches by id, text, or an unambiguous fragment", () => {
		const records = deriveMisconceptions([event(0, { misconceptions: [TEXT, "confuses scope with lifetime"] })]);
		assert.equal(matchMisconception(records, "closures", misconceptionId("closures", TEXT))?.text, TEXT);
		assert.equal(matchMisconception(records, "closures", "Thinks closures copy variables")?.text, TEXT);
		assert.equal(matchMisconception(records, "closures", "copy variables")?.text, TEXT);
		assert.equal(matchMisconception(records, "closures", "thinks"), null);
	});

	it("lists open misconceptions and resolved ones ready to confirm", () => {
		const id = misconceptionId("closures", TEXT);
		const records = deriveMisconceptions([
			event(0, { misconceptions: [TEXT, "confuses scope with lifetime"] }),
			event(1, { correct: true, score: 1, resolvedMisconceptions: [id] }),
		]);
		assert.deepEqual(misconceptionsToRecheck(records, new Date(T0 + 2 * DAY)).map((m) => m.text), ["confuses scope with lifetime"]);
		assert.deepEqual(
			misconceptionsToRecheck(records, new Date(T0 + 4 * DAY)).map((m) => m.status),
			["open", "resolved"],
		);
	});

	it("removes a resolved misconception from the concept's open list", () => {
		const base = defaultConcept({ id: "closures", name: "Closures" });
		const wrong = applyEvidence(base, event(0, { misconceptions: [TEXT] }));
		assert.deepEqual(wrong.misconceptions, [TEXT]);
		const fixed = applyEvidence(wrong, event(1, { correct: true, score: 1, resolvedMisconceptions: [misconceptionId("closures", TEXT)] }));
		assert.deepEqual(fixed.misconceptions, []);
	});

	it("persists resolution through the evidence log and shows it in the snapshot", () => {
		const root = makeTempProject();
		try {
			const paths = projectPaths(root);
			saveConcepts(paths, upsertConcepts(loadConcepts(paths), [{ id: "closures", name: "Closures" }]));
			let { store } = recordAndUpdate(paths, loadConcepts(paths), {
				concept: "closures", type: "recall", score: 0, correct: false, source: "quiz", misconceptions: [TEXT],
			});
			saveConcepts(paths, store);
			const id = misconceptionId("closures", TEXT);
			assert.match(compactSnapshotText(loadSnapshot(paths).snapshot), new RegExp(id));

			({ store } = recordAndUpdate(paths, loadConcepts(paths), {
				concept: "closures", type: "recall", score: 1, correct: true, source: "quiz", resolvedMisconceptions: [id],
			}));
			saveConcepts(paths, store);
			assert.deepEqual(loadEvidence(paths).at(-1)?.resolvedMisconceptions, [id]);
			const { snapshot } = loadSnapshot(paths);
			assert.deepEqual(snapshot.concepts.find((c) => c.id === "closures")?.misconceptions, []);
			assert.equal(snapshot.misconceptions.length, 0);
		} finally {
			rmrf(root);
		}
	});
});
