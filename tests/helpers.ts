import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyStore, saveConcepts } from "../lib/concepts.ts";
import { writeText } from "../lib/fs.ts";
import { missionTemplate } from "../lib/mission.ts";
import { projectPaths } from "../lib/paths.ts";

export function makeTempProject(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teach-"));
	const paths = projectPaths(root);
	fs.mkdirSync(paths.learner, { recursive: true });
	fs.mkdirSync(paths.records, { recursive: true });
	fs.mkdirSync(paths.agents, { recursive: true });
	fs.mkdirSync(paths.knowledge, { recursive: true });
	saveConcepts(paths, emptyStore());
	writeText(paths.evidence, "");
	writeText(paths.mission, missionTemplate());
	writeText(paths.profile, "# profile\n");
	writeText(path.join(paths.agents, "verifier.md"), "---\nname: verifier\n---\nGrade JSON only.\n");
	writeText(path.join(paths.agents, "researcher.md"), "---\nname: researcher\n---\nResearch briefly.\n");
	return root;
}

export function rmrf(dir: string): void {
	fs.rmSync(dir, { recursive: true, force: true });
}
