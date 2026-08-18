import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { loadConcepts, saveConcepts, upsertConcepts } from "../lib/concepts.ts";
import { recordAndUpdate } from "../lib/evidence.ts";
import { computeFrontier } from "../lib/graph.ts";
import { writeMission } from "../lib/mission.ts";
import { projectPaths } from "../lib/paths.ts";
import { resetLearner } from "../lib/reset.ts";
import { loadSnapshot } from "../lib/snapshot.ts";
import { makeTempProject, rmrf } from "./helpers.ts";

const root = makeTempProject();
after(() => rmrf(root));

describe("acceptance scenario: closures", () => {
	it("probes prereqs, skips demonstrated nodes, teaches the frontier, and resumes", () => {
		const paths = projectPaths(root);
		writeMission(paths, {
			goal: "Gain a solid conceptual introduction to closures in programming languages.",
			desiredDepth: "Conceptual + small examples",
			topic: "closures",
		});

		let store = upsertConcepts(loadConcepts(paths), [
			{ id: "functions", name: "Functions" },
			{ id: "local-variables", name: "Local variables", prerequisites: ["functions"] },
			{ id: "lexical-scope", name: "Lexical scope", prerequisites: ["functions", "local-variables"] },
			{ id: "closures", name: "Closures", prerequisites: ["lexical-scope"] },
		]);
		saveConcepts(paths, store);

		({ store } = recordAndUpdate(paths, store, {
			concept: "functions",
			type: "application",
			score: 1,
			correct: true,
			source: "probe",
		}));
		({ store } = recordAndUpdate(paths, store, {
			concept: "local-variables",
			type: "recall",
			score: 1,
			correct: true,
			source: "probe",
		}));
		({ store } = recordAndUpdate(paths, store, {
			concept: "lexical-scope",
			type: "explanation",
			score: 1,
			correct: true,
			source: "probe",
		}));
		saveConcepts(paths, store);

		let frontier = computeFrontier(store.concepts);
		assert.equal(frontier.next?.id, "closures");
		assert.ok(!frontier.ready.some((c) => c.id === "functions"));

		({ store } = recordAndUpdate(paths, store, {
			concept: "closures",
			type: "application",
			score: 0,
			correct: false,
			source: "quiz",
			misconceptions: ["confused captured value with captured variable binding"],
		}));
		saveConcepts(paths, store);
		assert.ok(store.concepts.closures.mastery < 0.7);
		assert.ok(store.concepts.closures.misconceptions.length > 0);

		({ store } = recordAndUpdate(paths, store, {
			concept: "closures",
			type: "application",
			score: 1,
			correct: true,
			source: "quiz",
		}));
		({ store } = recordAndUpdate(paths, store, {
			concept: "closures",
			type: "transfer",
			score: 1,
			correct: true,
			source: "quiz",
		}));
		saveConcepts(paths, store);

		const resumed = loadSnapshot(paths);
		assert.equal(resumed.store.concepts.closures.evidence.application >= 1, true);
		assert.ok(resumed.snapshot.recentEvidence.length >= 1);
		frontier = resumed.snapshot.frontier;
		assert.equal(frontier.mastered.some((c) => c.id === "functions"), true);
	});
});

describe("reset", () => {
	it("resets one topic without wiping the mission", () => {
		const paths = projectPaths(root);
		resetLearner(paths, { kind: "topic", ids: ["closures"] });
		const store = loadConcepts(paths);
		assert.equal(store.concepts.closures, undefined);
		assert.ok(store.concepts.functions);
		assert.match(loadSnapshot(paths).snapshot.mission?.goal ?? "", /closures|Goal|done/i);
	});
});
