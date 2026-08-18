import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, describe, it } from "node:test";
import { loadConcepts, normalizeConceptId, saveConcepts, upsertConcepts } from "../lib/concepts.ts";
import { loadEvidence, recordAndUpdate } from "../lib/evidence.ts";
import { evidenceTypeForQuiz, resolveQuizType, validateMultipleChoice } from "../lib/grade.ts";
import { loadMission, writeMission } from "../lib/mission.ts";
import { projectPaths } from "../lib/paths.ts";
import { writeAutomaticLearningRecord, writeLearningRecord } from "../lib/records.ts";
import { resetLearner } from "../lib/reset.ts";
import { refreshTeachWidget } from "../lib/widget.ts";
import { makeTempProject, rmrf } from "./helpers.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmrf(root);
});

function project() {
	const root = makeTempProject();
	roots.push(root);
	return { root, paths: projectPaths(root) };
}

describe("weak-model robustness", () => {
	it("does not reject a quiz because evidenceType was a quiz type", () => {
		assert.equal(evidenceTypeForQuiz("free_response", "free_response"), "recall");
		assert.equal(evidenceTypeForQuiz("multiple_choice", "free_response"), "recognition");
		assert.equal(evidenceTypeForQuiz("free_response", "explanation"), "explanation");
		assert.equal(evidenceTypeForQuiz("free_response", "short answer"), "recall");
	});

	it("recovers quiz type when the model omits type and puts free_response in evidenceType", () => {
		assert.equal(
			resolveQuizType({
				concept: "place-value",
				question: "Why does 23 have 2 tens?",
				evidenceType: "free_response",
			}),
			"free_response",
		);
		assert.equal(resolveQuizType({ type: "multiple_choice", evidenceType: "free_response" }), "multiple_choice");
		assert.equal(resolveQuizType({ evidenceType: "explanation", choices: ["2 tens", "2 ones"] }), "multiple_choice");
		assert.equal(resolveQuizType({ evidenceType: "explanation" }), "free_response");
	});

	it("rejects malformed multiple-choice keys", () => {
		assert.match(
			validateMultipleChoice({ choices: ["7", "10", "6"], expectedAnswer: "answer will be checked later" }) ?? "",
			/expectedAnswer must match/,
		);
		assert.equal(validateMultipleChoice({ choices: ["7", "10", "6"], expectedAnswer: "7" }), null);
		assert.equal(validateMultipleChoice({ choices: ["7", "10", "6"], expectedAnswer: "A" }), null);
		assert.equal(validateMultipleChoice({ choices: ["7", "10", "6"], expectedAnswer: "1" }), null);
	});

	it("normalizes model-supplied concept ids and prerequisites", () => {
		assert.equal(normalizeConceptId(" Single_Digit Sum "), "single-digit-sum");
		const { paths } = project();
		const store = upsertConcepts(loadConcepts(paths), [
			{ id: "Addition_Column", name: "Addition column", prerequisites: ["Single Digit Sum"] },
		]);
		assert.ok(store.concepts["addition-column"]);
		assert.deepEqual(store.concepts["addition-column"].prerequisites, ["single-digit-sum"]);
	});

	it("treats the mission template as no active mission and refreshes the widget", () => {
		const { root, paths } = project();
		assert.equal(loadMission(paths), null);
		let widget: string[] | undefined = ["stale"];
		const ctx = { cwd: root, ui: { setWidget: (_id: string, lines: string[] | undefined) => { widget = lines; } } };
		refreshTeachWidget(ctx);
		assert.equal(widget, undefined);

		writeMission(paths, { goal: "Learn addition", topic: "addition" });
		const store = upsertConcepts(loadConcepts(paths), [{ id: "Single_Digit Sum", name: "Single digit sum" }]);
		saveConcepts(paths, store);
		refreshTeachWidget(ctx);
		assert.match(widget?.join(" ") ?? "", /next: single-digit-sum/);

		resetLearner(paths, { kind: "all" });
		refreshTeachWidget(ctx);
		assert.equal(widget, undefined);
	});

	it("writes records automatically without erasing richer notes", () => {
		const { paths } = project();
		const mission = writeMission(paths, { goal: "Learn addition", topic: "addition" });
		let store = upsertConcepts(loadConcepts(paths), [{ id: "addition", name: "Addition" }]);
		({ store } = recordAndUpdate(paths, store, {
			concept: "addition",
			type: "application",
			score: 1,
			correct: true,
			source: "quiz",
		}));
		saveConcepts(paths, store);
		const automatic = writeAutomaticLearningRecord(paths, store);
		assert.equal(fs.existsSync(automatic), true);

		writeLearningRecord(paths, {
			mission,
			store,
			events: loadEvidence(paths),
			learnerQuestions: ["Why does carrying work?"],
			notes: "Keep this learner-specific note.",
		});
		({ store } = recordAndUpdate(paths, store, {
			concept: "addition",
			type: "transfer",
			score: 1,
			correct: true,
			source: "quiz",
		}));
		saveConcepts(paths, store);
		writeAutomaticLearningRecord(paths, store);
		const body = fs.readFileSync(automatic, "utf8");
		assert.match(body, /Keep this learner-specific note\./);
		assert.match(body, /Why does carrying work\?/);
	});
});
