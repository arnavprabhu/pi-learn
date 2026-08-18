/**
 * /teach and related commands. Project-local only.
 */

import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { projectPaths } from "../../lib/paths.ts";
import { resetLearner } from "../../lib/reset.ts";
import { compactSnapshotText, loadSnapshot } from "../../lib/snapshot.ts";

function kickoff(topic: string, skill: string): string {
	const trimmed = topic.trim();
	const topicLine = trimmed
		? `Learning topic / mission: ${trimmed}`
		: "Resume or continue the current mission. If none exists, ask what they want to learn.";
	return `${skill}

---

The teach skill above is now in effect. ${topicLine}

Start by calling learner_snapshot. Then follow Probe → Plan → Teach → Verify → Persist.
Do not dump a textbook chapter. Teach one frontier concept at a time.
`;
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

			pi.sendUserMessage(kickoff(args, skill));
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
			ctx.ui.notify(snapshot.frontier.next ? `Next: ${snapshot.frontier.next.name}` : "No frontier yet", "info");
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
			ctx.ui.notify("Reset complete", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const { snapshot } = loadSnapshot(projectPaths(ctx.cwd), { recompute: false });
			const next = snapshot.frontier.next;
			if (!snapshot.mission && !next) return;
			const goal = snapshot.mission?.goal ?? "no mission";
			const line = next ? `next: ${next.id}` : "no frontier";
			ctx.ui.setWidget("teach", [`teach  ${goal.slice(0, 60)}  ·  ${line}`]);
		} catch {
			// ignore missing files on first run
		}
	});
}
