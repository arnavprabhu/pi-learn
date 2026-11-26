import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCodeQuiz } from "../lib/code-runner.ts";
import {
	gradeCodeRun,
	gradeMultiSelect,
	gradeNumeric,
	parseNumber,
	parseSelections,
	resolveQuizType,
	validateCode,
	validateMultiSelect,
	validateNumeric,
} from "../lib/grade.ts";

describe("numeric grading", () => {
	it("parses numbers in common written forms", () => {
		assert.equal(parseNumber("42"), 42);
		assert.equal(parseNumber("about -3.5 m/s"), -3.5);
		assert.equal(parseNumber("1,234.5"), 1234.5);
		assert.equal(parseNumber("6.02e23"), 6.02e23);
		assert.equal(parseNumber("3 x 10^8"), 3e8);
		assert.equal(parseNumber("1/3"), 1 / 3);
		assert.equal(parseNumber("25%"), 0.25);
		assert.equal(parseNumber("−2"), -2);
		assert.equal(parseNumber("no idea what"), null);
	});

	it("accepts answers within tolerance and rejects the rest", () => {
		assert.equal(gradeNumeric({ answer: "1/3", expectedAnswer: "0.3333" }).correct, true);
		assert.equal(gradeNumeric({ answer: "0.33", expectedAnswer: "0.3333", tolerance: 0.001 }).correct, false);
		assert.equal(gradeNumeric({ answer: "0.33", expectedAnswer: "0.3333", tolerance: 0.01 }).correct, true);
		assert.equal(gradeNumeric({ answer: "0", expectedAnswer: "0" }).correct, true);
	});

	it("names sign and scale slips", () => {
		const sign = gradeNumeric({ answer: "-9.8", expectedAnswer: "9.8" });
		assert.equal(sign.correct, false);
		assert.match(sign.missingIdeas[0], /sign/);
		assert.equal(sign.recommendedAction, "remediate");
		const scale = gradeNumeric({ answer: "980", expectedAnswer: "9.8" });
		assert.match(scale.missingIdeas[0], /power of ten/);
	});

	it("treats I don't know and non-numbers correctly", () => {
		assert.equal(gradeNumeric({ answer: "I don't know", expectedAnswer: "2" }).dontKnow, true);
		const words = gradeNumeric({ answer: "the integral", expectedAnswer: "2" });
		assert.equal(words.correct, false);
		assert.equal(words.dontKnow, false);
	});

	it("rejects malformed numeric quizzes", () => {
		assert.match(validateNumeric({}) ?? "", /expectedAnswer/);
		assert.match(validateNumeric({ expectedAnswer: "about half" }) ?? "", /number/);
		assert.match(validateNumeric({ expectedAnswer: "2", tolerance: -1 }) ?? "", /tolerance/);
		assert.equal(validateNumeric({ expectedAnswer: "2", tolerance: 0.1 }), null);
	});
});

describe("multi-select grading", () => {
	const choices = ["Lexical scope", "Garbage collection", "Captured variables", "Hoisting"];

	it("parses letters, numbers, and choice text", () => {
		assert.deepEqual([...parseSelections(choices, "A, C")], [0, 2]);
		assert.deepEqual([...parseSelections(choices, "1 and 3")], [0, 2]);
		assert.deepEqual([...parseSelections(choices, "Lexical scope\nCaptured variables")], [0, 2]);
	});

	it("gives full credit only for the exact set, with partial score otherwise", () => {
		const exact = gradeMultiSelect({ answer: "A, C", choices, correctChoices: ["A", "Captured variables"] });
		assert.equal(exact.correct, true);
		assert.equal(exact.score, 1);
		const partial = gradeMultiSelect({ answer: "A", choices, correctChoices: ["A", "C"] });
		assert.equal(partial.correct, false);
		assert.equal(partial.score, 0.5);
		const guessAll = gradeMultiSelect({ answer: "A, B, C, D", choices, correctChoices: ["A", "C"] });
		assert.equal(guessAll.score, 0);
	});

	it("validates the answer key", () => {
		assert.match(validateMultiSelect({ choices, correctChoices: [] }) ?? "", /correctChoices/);
		assert.match(validateMultiSelect({ choices, correctChoices: ["E"] }) ?? "", /Every correctChoices/);
		assert.equal(validateMultiSelect({ choices, correctChoices: ["a", "3"] }), null);
	});

	it("infers the format from its answer key", () => {
		assert.equal(resolveQuizType({ choices, correctChoices: ["A"] }), "multi_select");
		assert.equal(resolveQuizType({ tests: "assert.equal(f(), 1)" }), "code");
	});
});

describe("code grading", () => {
	it("passes code that satisfies the tests", async () => {
		const run = await runCodeQuiz({
			language: "javascript",
			code: "function add(a, b) { return a + b; }",
			tests: 'import assert from "node:assert"; assert.equal(add(2, 3), 5);',
		});
		assert.equal(run.status, "passed");
		assert.equal(gradeCodeRun({ passed: true, timedOut: false, output: run.output }).score, 1);
	});

	it("fails code that breaks the tests and keeps the error output", async () => {
		const run = await runCodeQuiz({
			language: "javascript",
			code: "function add(a, b) { return a - b; }",
			tests: 'import assert from "node:assert"; assert.equal(add(2, 3), 5);',
		});
		assert.equal(run.status, "failed");
		const grade = gradeCodeRun({ passed: false, timedOut: run.timedOut, output: run.output });
		assert.equal(grade.correct, false);
		assert.match(grade.notes ?? "", /AssertionError|Expected/);
	});

	it("stops code that runs too long", async () => {
		const run = await runCodeQuiz({ language: "javascript", code: "while (true) {}", tests: "", timeoutMs: 300 });
		assert.equal(run.status, "failed");
		assert.equal(run.timedOut, true);
	});

	it("reports a missing interpreter as unavailable", async () => {
		const previous = process.env.PI_TEACH_PYTHON;
		process.env.PI_TEACH_PYTHON = "definitely-not-a-python-binary";
		try {
			const run = await runCodeQuiz({ language: "python", code: "x = 1", tests: "assert x == 1" });
			assert.equal(run.status, "unavailable");
		} finally {
			if (previous === undefined) delete process.env.PI_TEACH_PYTHON;
			else process.env.PI_TEACH_PYTHON = previous;
		}
	});

	it("requires tests", () => {
		assert.match(validateCode({}) ?? "", /tests/);
		assert.equal(validateCode({ tests: "assert True", language: "python" }), null);
	});
});
