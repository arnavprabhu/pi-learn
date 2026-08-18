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

	it("registers project-local knowledge retrieval", () => {
		const knowledge = fs.readFileSync(path.join(repoRoot, ".pi/extensions/knowledge.ts"), "utf8");
		const learningState = fs.readFileSync(path.join(repoRoot, ".pi/extensions/learning-state.ts"), "utf8");
		const teachExtension = fs.readFileSync(path.join(repoRoot, ".pi/extensions/teach.ts"), "utf8");
		const skill = fs.readFileSync(path.join(repoRoot, ".pi/skills/teach/SKILL.md"), "utf8");
		assert.match(knowledge, /name: "knowledge_search"/);
		assert.match(learningState, /syncKnowledge/);
		assert.match(teachExtension, /await syncKnowledge\(paths\)/);
		assert.match(skill, /Check the `# Knowledge` inventory/);
	});

	it("hardens weak-model tool use", () => {
		const learningState = fs.readFileSync(path.join(repoRoot, ".pi/extensions/learning-state.ts"), "utf8");
		const quiz = fs.readFileSync(path.join(repoRoot, ".pi/extensions/quiz.ts"), "utf8");
		assert.match(learningState, /name: "learner_record_self_report"/);
		assert.match(learningState, /tryWriteAutomaticLearningRecord/);
		assert.doesNotMatch(learningState, /Type\.Literal\("paused"\)/);
		assert.ok(quiz.indexOf("validateMultipleChoice(params)") < quiz.indexOf("savePendingQuiz(paths, pending)"));
		assert.match(quiz, /type: Type\.Optional\(QuizTypeSchema\)/);
		assert.match(quiz, /evidenceType: Type\.Optional\(\s*Type\.String/);
		assert.doesNotMatch(quiz, /Type\.Literal\("recognition"\)/);
	});
});

describe("user-facing docs", () => {
	const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

	it("keeps the README short while covering the learner path", () => {
		const readme = read("README.md");
		const lines = readme.split("\n").length;
		assert.ok(lines <= 180, `README grew to ${lines} lines`);
		for (const needle of [
			"/teach",
			"/frontier",
			"/teach-reset",
			"I don't know",
			"knowledge/",
			"knowledge/README.md",
			"Probe",
			"learner/evidence.jsonl",
			"learner/concepts.json",
			"MISSION.md",
			"learning-records/",
			"--approve",
			"npm run reset",
			"~/.pi/",
		]) {
			assert.match(readme, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		}
	});

	it("keeps AGENTS.md as a short project cheat-sheet", () => {
		const agents = read("AGENTS.md");
		assert.ok(agents.split("\n").length <= 25, "AGENTS.md should stay a cheat-sheet");
		assert.match(agents, /\/teach/);
		assert.match(agents, /\/frontier/);
		assert.match(agents, /\/teach-reset/);
		assert.match(agents, /knowledge\//);
		assert.match(agents, /~\/\.pi\//);
	});

	it("documents knowledge, records, and learner folders without extra manuals", () => {
		const knowledge = read("knowledge/README.md");
		assert.match(knowledge, /not indexed/i);
		assert.match(knowledge, /50 MB/);
		assert.match(knowledge, /\.gitignore/);

		const records = read("learning-records/README.md");
		assert.match(records, /Chat logs are not canonical/i);
		assert.match(records, /resets keep/i);

		const learner = read("learner/README.md");
		assert.match(learner, /evidence\.jsonl/);
		assert.match(learner, /concepts\.json/);
		assert.match(learner, /\/teach-reset/);
	});
});
