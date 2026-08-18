import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("skill and extension layout", () => {
	it("registers /teach via a project extension and a SKILL.md", () => {
		const skill = fs.readFileSync(path.join(repoRoot, ".pi/skills/teach/SKILL.md"), "utf8");
		assert.match(skill, /^---\nname: teach/m);
		assert.match(skill, /Probe/);
		const teachExt = fs.readFileSync(path.join(repoRoot, ".pi/extensions/teach.ts"), "utf8");
		assert.match(teachExt, /registerCommand\("teach"/);
		assert.match(teachExt, /registerCommand\("frontier"/);
	});

	it("quiz redacts expected answers from renderers", () => {
		const quiz = fs.readFileSync(path.join(repoRoot, ".pi/extensions/quiz.ts"), "utf8");
		assert.match(quiz, /renderQuizCall/);
		assert.match(quiz, /expectedAnswer/);
		assert.doesNotMatch(quiz, /renderCall[\s\S]*expectedAnswer/);
	});
});
