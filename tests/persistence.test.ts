import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, it } from "node:test";
import { loadConcepts, saveConcepts, upsertConcepts } from "../lib/concepts.ts";
import { loadEvidence, recordAndUpdate } from "../lib/evidence.ts";
import { computeFrontier } from "../lib/graph.ts";
import { writeMission } from "../lib/mission.ts";
import { projectPaths } from "../lib/paths.ts";
import { writeLearningRecord } from "../lib/records.ts";
import { compactSnapshotText, loadSnapshot } from "../lib/snapshot.ts";
import { makeTempProject, rmrf } from "./helpers.ts";

const root = makeTempProject();
after(() => rmrf(root));

describe("persistence", () => {
	it("survives a restart: evidence log is source of truth", () => {
		const paths = projectPaths(root);
		let store = upsertConcepts(loadConcepts(paths), [
			{ id: "functions", name: "Functions" },
			{ id: "scope", name: "Lexical scope", prerequisites: ["functions"] },
		]);
		saveConcepts(paths, store);

		({ store } = recordAndUpdate(paths, store, {
			concept: "functions",
			type: "application",
			score: 1,
			correct: true,
			source: "quiz",
		}));
		saveConcepts(paths, store);

		const events = loadEvidence(paths);
		assert.equal(events.length, 1);
		assert.equal(events[0].concept, "functions");

		const reloaded = loadSnapshot(paths);
		assert.ok(reloaded.store.concepts.functions.mastery > 0.25);
		assert.equal(reloaded.store.concepts.functions.evidence.application, 1);
		assert.match(compactSnapshotText(reloaded.snapshot), /functions/);
	});

	it("writes a learning record the next session can read", () => {
		const paths = projectPaths(root);
		const { snapshot, store } = loadSnapshot(paths);
		const file = writeLearningRecord(paths, {
			mission: snapshot.mission,
			store,
			events: loadEvidence(paths),
			topic: "closures",
		});
		assert.equal(fs.existsSync(file), true);
		const body = fs.readFileSync(file, "utf8");
		assert.match(body, /Learning goal/);
		assert.match(body, /Current frontier/);
	});

	it("stores missions independently of the graph", () => {
		const paths = projectPaths(root);
		const mission = writeMission(paths, {
			goal: "Understand closures well enough to predict captured bindings.",
			topic: "closures",
			desiredDepth: "Conceptual + small examples",
		});
		assert.match(mission.goal, /closures/);
		assert.equal(mission.status, "active");
	});
});
