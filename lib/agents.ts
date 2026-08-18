import { readText } from "./fs.ts";
import path from "node:path";
import type { ProjectPaths } from "./paths.ts";

export interface AgentDef {
	name: string;
	description: string;
	tools: string[];
	body: string;
	filePath: string;
}

export function loadAgent(paths: ProjectPaths, name: string): AgentDef {
	const filePath = path.join(paths.agents, `${name}.md`);
	const raw = readText(filePath);
	if (!raw) throw new Error(`Project-local agent not found: ${name} (${filePath})`);
	return parseAgent(raw, filePath);
}

export function parseAgent(raw: string, filePath: string): AgentDef {
	const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) {
		return {
			name: path.basename(filePath, ".md"),
			description: "",
			tools: [],
			body: raw.trim(),
			filePath,
		};
	}
	const front = match[1];
	const body = match[2].trim();
	const fields: Record<string, string> = {};
	for (const line of front.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return {
		name: fields.name || path.basename(filePath, ".md"),
		description: fields.description || "",
		tools: (fields.tools || "")
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean),
		body,
		filePath,
	};
}
