/**
 * /teach and related commands. Project-local only.
 */

import fs from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { compactKnowledgeText, syncKnowledge } from "../../lib/knowledge.ts";
import { buildMapRows, mapText, masteryBar, type MapRow } from "../../lib/map.ts";
import { projectPaths } from "../../lib/paths.ts";
import { writeRecap } from "../../lib/recap.ts";
import { resetLearner } from "../../lib/reset.ts";
import { compactSnapshotText, loadSnapshot } from "../../lib/snapshot.ts";
import { refreshTeachWidget } from "../../lib/widget.ts";

function kickoff(topic: string, skill: string, knowledge: string): string {
	const trimmed = topic.trim();
	const topicLine = trimmed
		? `Learning topic / mission: ${trimmed}`
		: "Resume or continue the current mission. If none exists, ask what they want to learn.";
	return `${skill}

---

The teach skill above is now in effect. ${topicLine}

Knowledge was synchronized before this turn:

${knowledge}

Start by calling learner_snapshot. Then follow Review → Probe → Plan → Teach → Verify → Persist.
Do not dump a textbook chapter. Teach one frontier concept at a time.
`;
}

const STATUS_COLOR: Record<MapRow["status"], Parameters<Theme["fg"]>[0]> = {
	mastered: "success",
	learning: "accent",
	probing: "accent",
	unknown: "muted",
	blocked: "dim",
};

function mapRowLine(row: MapRow, theme: Theme, selected: boolean): string {
	const marks =
		(row.isNext ? theme.fg("accent", "▶") : " ") +
		(row.due ? theme.fg("warning", "↻") : " ") +
		(row.openMisconceptions.length ? theme.fg("error", "!") : " ");
	const name = `${"  ".repeat(row.depth)}${row.name}`;
	const bar = theme.fg(STATUS_COLOR[row.status], masteryBar(row.mastery));
	const body = `${selected ? "›" : " "} ${marks} ${selected ? theme.bold(name) : name}  ${bar} ${row.mastery.toFixed(2)} ${theme.fg(STATUS_COLOR[row.status], row.status)}`;
	return body;
}

function mapDetail(row: MapRow, theme: Theme): string[] {
	const lines = [theme.fg("accent", theme.bold(`${row.name} (${row.id})`))];
	if (row.description) lines.push(row.description);
	lines.push(
		theme.fg("dim", `mastery ${row.mastery.toFixed(2)} · confidence ${row.confidence.toFixed(2)} · evidence ${row.evidenceCount} · ${row.status}`),
	);
	lines.push(theme.fg("dim", `prerequisites: ${row.prerequisites.join(", ") || "none"}`));
	if (row.reviewDue) lines.push(theme.fg(row.due ? "warning" : "dim", `review ${row.due ? "due since" : "due"} ${row.reviewDue.slice(0, 16).replace("T", " ")}`));
	for (const m of row.openMisconceptions) lines.push(theme.fg("error", `! ${m}`));
	return lines;
}

async function showMap(ctx: ExtensionCommandContext, rows: MapRow[]): Promise<void> {
	await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
		let cursor = Math.max(0, rows.findIndex((r) => r.isNext));
		let top = 0;
		return {
			render(width: number): string[] {
				const height = Math.max(5, Math.min(rows.length, (tui.terminal?.rows ?? 30) - 14));
				if (cursor < top) top = cursor;
				if (cursor >= top + height) top = cursor - height + 1;
				const visible = rows.slice(top, top + height);
				const out = [
					theme.fg("accent", theme.bold("Concept map")) + theme.fg("dim", `  ${rows.length} concepts · ▶ next  ↻ review due  ! misconception`),
					"",
					...visible.map((row, i) => mapRowLine(row, theme, top + i === cursor)),
				];
				if (rows.length > height) out.push(theme.fg("dim", `  ${top + 1}–${top + visible.length} of ${rows.length}`));
				out.push("", ...mapDetail(rows[cursor], theme), "", theme.fg("dim", "↑/↓ move · enter/esc close"));
				return out.map((line) => truncateToWidth(line, width));
			},
			handleInput(data: string): void {
				if (keybindings.matches(data, "tui.select.up")) cursor = Math.max(0, cursor - 1);
				else if (keybindings.matches(data, "tui.select.down")) cursor = Math.min(rows.length - 1, cursor + 1);
				else if (keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.select.cancel")) return done();
				else return;
				tui.requestRender();
			},
			invalidate() {},
		};
	});
}

export default function teachExtension(pi: ExtensionAPI) {
	pi.registerCommand("teach", {
		description: "Start or resume adaptive tutoring for a topic",
		handler: async (args, ctx) => {
			const paths = projectPaths(ctx.cwd);
			let skill = "";
			try {
				skill = fs.readFileSync(paths.teachSkill, "utf8");
			} catch {
				ctx.ui.notify("Missing .pi/skills/teach/SKILL.md", "error");
				return;
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish, then /teach again.", "warning");
				return;
			}

			const knowledge = await syncKnowledge(paths);
			pi.sendUserMessage(kickoff(args, skill, compactKnowledgeText(knowledge)));
		},
	});

	pi.registerEntryRenderer("learner-frontier", (entry, _opts, theme) => {
		const data = entry.data as { text?: string };
		return new Text(theme.fg("text", data.text ?? ""), 0, 0);
	});

	pi.registerCommand("frontier", {
		description: "Show current learning frontier and mastery (from files, not chat)",
		handler: async (_args, ctx) => {
			const { snapshot } = loadSnapshot(projectPaths(ctx.cwd));
			pi.appendEntry("learner-frontier", { text: compactSnapshotText(snapshot) });
			refreshTeachWidget(ctx);
			ctx.ui.notify(snapshot.frontier.next ? `Next: ${snapshot.frontier.next.name}` : "No frontier yet", "info");
		},
	});

	pi.registerEntryRenderer("learner-map", (entry, _opts, theme) => {
		const data = entry.data as { text?: string };
		return new Text(theme.fg("text", data.text ?? ""), 0, 0);
	});

	pi.registerCommand("map", {
		description: "Browse the concept map: prerequisites, mastery, reviews due, and open misconceptions",
		handler: async (_args, ctx) => {
			const { store } = loadSnapshot(projectPaths(ctx.cwd));
			const rows = buildMapRows(store.concepts);
			refreshTeachWidget(ctx);
			if (rows.length === 0) {
				ctx.ui.notify("The concept map is empty. Start with /teach <topic>.", "info");
				return;
			}
			if (ctx.mode === "tui") {
				await showMap(ctx, rows);
				return;
			}
			pi.appendEntry("learner-map", { text: mapText(rows) });
		},
	});

	pi.registerEntryRenderer("learner-recap", (entry, _opts, _theme) => {
		const data = entry.data as { markdown?: string };
		return new Markdown(data.markdown ?? "", 0, 0, getMarkdownTheme());
	});

	pi.registerCommand("recap", {
		description: "Summarize recent learning from saved evidence. Args: [days] (default 7)",
		handler: async (args, ctx) => {
			const parsed = Number.parseInt(args.trim(), 10);
			const days = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 365) : 7;
			const { file, markdown, stats } = writeRecap(projectPaths(ctx.cwd), days);
			pi.appendEntry("learner-recap", { markdown, file });
			ctx.ui.notify(`Recap saved to ${file.slice(ctx.cwd.length + 1)} (${stats.items} evidence items)`, "info");
		},
	});

	pi.registerCommand("teach-reset", {
		description: "Reset learner data (never automatic). Args: topic <id> | mission | all",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed) {
				ctx.ui.notify("Usage: /teach-reset topic <id>[,id] | /teach-reset mission | /teach-reset all", "warning");
				return;
			}

			const parts = trimmed.split(/\s+/);
			const kind = parts[0];
			let summary = "";
			if (kind === "all") summary = "Delete ALL concepts, evidence, pending quiz, and reset MISSION.md. Learning records and knowledge sources are kept.";
			else if (kind === "mission") summary = "Reset MISSION.md to the template. Graph and evidence stay.";
			else if (kind === "topic") summary = `Remove concepts and evidence for: ${parts.slice(1).join(" ")}`;
			else {
				ctx.ui.notify("Usage: /teach-reset topic <id> | mission | all", "warning");
				return;
			}

			if (ctx.hasUI) {
				const ok = await ctx.ui.confirm("Reset learner data?", summary);
				if (!ok) {
					ctx.ui.notify("Reset cancelled", "info");
					return;
				}
			} else if (process.env.PI_TEACH_CONFIRM_RESET !== "1") {
				ctx.ui.notify("Refusing reset without confirmation. In print mode set PI_TEACH_CONFIRM_RESET=1.", "warning");
				return;
			}

			const paths = projectPaths(ctx.cwd);
			if (kind === "all") resetLearner(paths, { kind: "all" });
			else if (kind === "mission") resetLearner(paths, { kind: "mission" });
			else {
				const ids = parts.slice(1).join(" ").split(",").map((s) => s.trim()).filter(Boolean);
				if (ids.length === 0) {
					ctx.ui.notify("Specify at least one concept id", "warning");
					return;
				}
				resetLearner(paths, { kind: "topic", ids });
			}
			refreshTeachWidget(ctx);
			ctx.ui.notify("Reset complete", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		refreshTeachWidget(ctx);
	});
}
