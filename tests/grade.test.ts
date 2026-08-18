import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dontKnowResult, gradeMultipleChoice, isDontKnow, parseGradeJson } from "../lib/grade.ts";

describe("grading", () => {
	it("accepts I don't know without treating it as a misconception", () => {
		assert.equal(isDontKnow("I don't know"), true);
		assert.equal(isDontKnow("idk"), true);
		const grade = dontKnowResult("recall");
		assert.equal(grade.dontKnow, true);
		assert.equal(grade.misconceptions.length, 0);
		assert.equal(grade.recommendedAction, "probe_prerequisite");
	});

	it("grades MCQ without exposing extra credit for similar wording", () => {
		const grade = gradeMultipleChoice({
			answer: "B",
			expectedAnswer: "a function that closes over its defining environment",
			choices: [
				"a function that copies all locals",
				"a function that closes over its defining environment",
				"a global variable",
			],
		});
		// "B" is index 1 (0-based: A=0, B=1) — wait, letter B is index 1 which is the expected. Good.
		assert.equal(grade.correct, true);
		assert.equal(grade.evidenceType, "recognition");
	});

	it("marks a wrong MCQ choice incorrect", () => {
		const grade = gradeMultipleChoice({
			answer: "a function that copies all locals",
			expectedAnswer: "a function that closes over its defining environment",
			choices: [
				"a function that copies all locals",
				"a function that closes over its defining environment",
			],
		});
		assert.equal(grade.correct, false);
		assert.equal(grade.score, 0);
	});

	it("parses verifier JSON from a fenced blob", () => {
		const text = `Here you go:\n\`\`\`json\n{"correct":true,"score":0.9,"confidence":0.8,"evidenceStrength":0.65,"misconceptions":[],"missingIdeas":[],"recommendedAction":"advance"}\n\`\`\``;
		const grade = parseGradeJson(text, "explanation");
		assert.equal(grade.correct, true);
		assert.equal(grade.recommendedAction, "advance");
		assert.equal(grade.evidenceType, "explanation");
	});
});
