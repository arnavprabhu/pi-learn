import { readText, writeText } from "./fs.ts";
import type { ProjectPaths } from "./paths.ts";
import type { Mission } from "./types.ts";

const TEMPLATE = `# Mission

## Goal

(describe what "done" looks like)

## Desired Depth

Conceptual introduction.

## Constraints

- Teach only prerequisites needed for the goal.
- Prefer "I don't know" over guessing.

## Status

Active
`;

export function parseMission(raw: string): Mission {
	const goal = section(raw, "Goal") ?? firstHeading(raw) ?? "Unspecified goal";
	const desiredDepth = section(raw, "Desired Depth") ?? "Conceptual";
	const constraintBlock = section(raw, "Constraints") ?? "";
	const constraints = constraintBlock
		.split("\n")
		.map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
		.filter(Boolean);
	const statusRaw = (section(raw, "Status") ?? "Active").split("\n")[0]?.trim().toLowerCase();
	const status: Mission["status"] =
		statusRaw === "complete" || statusRaw === "completed"
			? "complete"
			: statusRaw === "paused"
				? "paused"
				: "active";
	const topic = section(raw, "Topic") ?? undefined;
	return { goal, desiredDepth, constraints, status, topic, raw };
}

export function loadMission(paths: ProjectPaths): Mission | null {
	const raw = readText(paths.mission);
	if (!raw || !raw.trim()) return null;
	if (raw.trim() === TEMPLATE.trim()) return null;
	return parseMission(raw);
}

export function writeMission(
	paths: ProjectPaths,
	input: {
		goal: string;
		desiredDepth?: string;
		constraints?: string[];
		status?: Mission["status"];
		topic?: string;
	},
): Mission {
	const constraints = input.constraints?.length
		? input.constraints
		: [
				"Teach only prerequisites needed for the goal.",
				"Do not recursively teach the entire field.",
				'Prefer "I don\'t know" over guessing.',
			];
	const raw = `# Mission

## Goal

${input.goal.trim()}

## Desired Depth

${(input.desiredDepth ?? "Conceptual + light manipulation.").trim()}

## Constraints

${constraints.map((c) => `- ${c}`).join("\n")}

## Topic

${(input.topic ?? "").trim()}

## Status

${capitalize(input.status ?? "active")}
`;
	writeText(paths.mission, raw);
	return parseMission(raw);
}

export function missionTemplate(): string {
	return TEMPLATE;
}

function section(raw: string, heading: string): string | null {
	const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
	const match = re.exec(raw);
	if (!match || match.index === undefined) return null;
	const start = match.index + match[0].length;
	const rest = raw.slice(start);
	const next = rest.search(/^##\s+/m);
	const body = (next === -1 ? rest : rest.slice(0, next)).trim();
	return body || null;
}

function firstHeading(raw: string): string | null {
	const match = raw.match(/^#\s+(.+)$/m);
	return match?.[1]?.trim() ?? null;
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
