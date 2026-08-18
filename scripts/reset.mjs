#!/usr/bin/env node
/**
 * Never runs automatically. Explicit CLI reset for learner files.
 *
 *   node scripts/reset.mjs --topic closures,lexical-scope
 *   node scripts/reset.mjs --mission
 *   node scripts/reset.mjs --all --yes
 */

import { parseArgs } from "node:util";
import { projectPaths } from "../lib/paths.ts";
import { resetLearner } from "../lib/reset.ts";

const { values } = parseArgs({
	options: {
		topic: { type: "string" },
		mission: { type: "boolean", default: false },
		all: { type: "boolean", default: false },
		yes: { type: "boolean", default: false },
	},
});

const root = process.cwd();
const paths = projectPaths(root);

if (values.all) {
	if (!values.yes) {
		console.error("Refusing --all without --yes");
		process.exit(1);
	}
	console.log("Reset all learner data (records kept):", resetLearner(paths, { kind: "all" }));
} else if (values.mission) {
	console.log("Reset mission template:", resetLearner(paths, { kind: "mission" }));
} else if (values.topic) {
	const ids = values.topic.split(",").map((s) => s.trim()).filter(Boolean);
	console.log("Reset topics:", ids, resetLearner(paths, { kind: "topic", ids }));
} else {
	console.error("Usage: node scripts/reset.mjs --topic id[,id] | --mission | --all --yes");
	process.exit(1);
}
