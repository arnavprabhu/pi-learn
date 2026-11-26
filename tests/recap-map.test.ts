import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { loadConcepts, saveConcepts, upsertConcepts } from "../lib/concepts.ts";
import { appendEvidence } from "../lib/evidence.ts";
import { writeText } from "../lib/fs.ts";
import { searchKnowledge, syncKnowledge, tokenize } from "../lib/knowledge.ts";
import { buildMapRows, mapText } from "../lib/map.ts";
import { strengthFor } from "../lib/mastery.ts";
import { projectPaths } from "../lib/paths.ts";
import { writeRecap } from "../lib/recap.ts";
import { loadSnapshot } from "../lib/snapshot.ts";
import type { EvidenceType } from "../lib/types.ts";
import { makeTempProject, rmrf } from "./helpers.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T12:00:00.000Z");

function seed(root: string) {
	const paths = projectPaths(root);
	saveConcepts(paths, upsertConcepts(loadConcepts(paths), [
		{ id: "functions", name: "Functions" },
		{ id: "scope", name: "Lexical scope", prerequisites: ["functions"] },
		{ id: "closures", name: "Closures", prerequisites: ["scope"] },
	]));
	const add = (daysAgo: number, concept: string, correct: boolean, type: EvidenceType = "application", extra = {}) =>
		appendEvidence(paths, {
			ts: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
			concept,
			type,
			score: correct ? 1 : 0,
			strength: strengthFor(type),
			correct,
			source: "quiz",
			...extra,
		});
	add(30, "functions", true);
	add(28, "functions", true);
	add(20, "functions", true, "transfer");
	add(3, "scope", true);
	add(2, "scope", true, "transfer");
	add(1, "closures", false, "recall", { misconceptions: ["thinks closures copy variables"] });
	add(1, "functions", false);
	return paths;
}

describe("recap", () => {
	it("summarizes the window from evidence alone and saves it", () => {
		const root = makeTempProject();
		try {
			const paths = seed(root);
			const { file, markdown, stats } = writeRecap(paths, 7, NOW);
			assert.equal(stats.items, 4);
			assert.equal(stats.graded, 4);
			assert.equal(stats.correct, 2);
			assert.equal(stats.accuracy, 0.5);
			assert.deepEqual(stats.newlyMastered, ["scope"]);
			assert.deepEqual(stats.lapses, ["functions"]);
			assert.deepEqual(stats.misconceptionsFound, ["closures: thinks closures copy variables"]);
			assert.equal(path.basename(file), "recap-2026-11-20.md");
			assert.equal(fs.readFileSync(file, "utf8"), markdown);
			assert.match(markdown, /accuracy 50%/);
		} finally {
			rmrf(root);
		}
	});
});

describe("concept map", () => {
	it("orders concepts by prerequisites with depth and markers", () => {
		const root = makeTempProject();
		try {
			const paths = seed(root);
			const { store } = loadSnapshot(paths, { now: NOW });
			const rows = buildMapRows(store.concepts, NOW);
			assert.deepEqual(rows.map((r) => [r.id, r.depth]), [["functions", 0], ["scope", 1], ["closures", 2]]);
			assert.equal(rows.find((r) => r.id === "closures")?.openMisconceptions.length, 1);
			assert.match(mapText(rows), /Closures \(closures\)/);
		} finally {
			rmrf(root);
		}
	});
});

describe("BM25 knowledge search", () => {
	it("folds plurals and drops stopwords", () => {
		assert.deepEqual(tokenize("The rectangles of partitions"), ["rectangle", "partition"]);
		assert.deepEqual(tokenize("C++ and C#"), ["c++", "c#"]);
	});

	it("ranks the passage about the rare query term above repeated common words", async () => {
		const root = makeTempProject();
		try {
			const paths = projectPaths(root);
			writeText(path.join(paths.knowledge, "a.md"), "function function function function function. Calls and returns.");
			writeText(path.join(paths.knowledge, "b.md"), "A closure captures the variables of the function where it was defined.");
			writeText(path.join(paths.knowledge, "c.md"), "Loops repeat a function body.");
			const index = await syncKnowledge(paths);
			const matches = searchKnowledge(paths, index, "closure function");
			assert.equal(matches[0].path, "b.md");
		} finally {
			rmrf(root);
		}
	});
});
