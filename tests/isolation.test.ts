import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { loadAgent } from "../lib/agents.ts";
import { projectPaths } from "../lib/paths.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function loadPiSkills() {
	const cli = fs.realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
	const pkgRoot = path.dirname(path.dirname(cli));
	const mod = await import(pathToFileURL(path.join(pkgRoot, "dist/index.js")).href);
	return mod as {
		loadSkills: (opts: {
			cwd: string;
			agentDir: string;
			skillPaths: string[];
			includeDefaults: boolean;
		}) => { skills: Array<{ name: string; filePath: string; sourceInfo?: { scope?: string } }> };
	};
}

describe("project isolation", () => {
	it("discovers the teach skill from this repository", async () => {
		const { loadSkills } = await loadPiSkills();
		const fakeAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-empty-"));
		const { skills } = loadSkills({
			cwd: repoRoot,
			agentDir: fakeAgentDir,
			skillPaths: [],
			includeDefaults: true,
		});
		fs.rmSync(fakeAgentDir, { recursive: true, force: true });
		const teach = skills.find((s) => s.name === "teach");
		assert.ok(teach, "teach skill should be discovered in this repo");
		assert.ok(teach.filePath.includes(`${path.sep}.pi${path.sep}skills${path.sep}teach`));
	});

	it("does not expose the teach skill from an unrelated directory", async () => {
		const { loadSkills } = await loadPiSkills();
		const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "not-the-learning-repo-"));
		const fakeAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-empty-"));
		const { skills } = loadSkills({
			cwd: elsewhere,
			agentDir: fakeAgentDir,
			skillPaths: [],
			includeDefaults: true,
		});
		fs.rmSync(elsewhere, { recursive: true, force: true });
		fs.rmSync(fakeAgentDir, { recursive: true, force: true });
		assert.equal(skills.some((s) => s.name === "teach"), false);
	});

	it("keeps learner state and agents inside the project", () => {
		const paths = projectPaths(repoRoot);
		assert.ok(paths.concepts.startsWith(repoRoot));
		assert.ok(paths.evidence.startsWith(repoRoot));
		assert.ok(paths.agents.startsWith(repoRoot));
		assert.doesNotMatch(paths.concepts, /\/\.pi\/agent\//);
		const researcher = loadAgent(paths, "researcher");
		assert.equal(researcher.name, "researcher");
		assert.match(researcher.body, /prerequisite map/i);
		const verifier = loadAgent(paths, "verifier");
		assert.equal(verifier.name, "verifier");
		assert.match(verifier.body, /JSON/i);
	});

	it("does not require a global settings change for the learning files", () => {
		const settings = fs.readFileSync(path.join(os.homedir(), ".pi/agent/settings.json"), "utf8");
		assert.equal(settings.includes(repoRoot), false);
	});
});
