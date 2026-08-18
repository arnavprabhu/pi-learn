/**
 * Learner-state tools: snapshot, graph, evidence, mission, records.
 * All files live in this repository. Nothing is written under ~/.pi/.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadConcepts, saveConcepts, upsertConcepts } from "../../lib/concepts.ts";
import { loadEvidence, recordAndUpdate } from "../../lib/evidence.ts";
import { compactKnowledgeText, syncKnowledge } from "../../lib/knowledge.ts";
import { EVIDENCE_TYPES } from "../../lib/types.ts";
import { writeMission } from "../../lib/mission.ts";
import { projectPaths } from "../../lib/paths.ts";
import { writeLearningRecord } from "../../lib/records.ts";
import { compactSnapshotText, loadSnapshot } from "../../lib/snapshot.ts";

function toolText(text: string, details: unknown = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

export default function learningStateExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "learner_snapshot",
		label: "Learner snapshot",
		description:
			"Load compact persistent learner state and the knowledge/ source inventory for this project. Call this before teaching. Does not include full history or full source text.",
		parameters: Type.Object({
			focus: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional concept ids. When set, only that subgraph (plus prerequisites) is returned.",
				}),
			),
			recompute: Type.Optional(
				Type.Boolean({
					description: "Rebuild mastery from evidence.jsonl (default true).",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const paths = projectPaths(ctx.cwd);
			const [{ snapshot }, knowledge] = await Promise.all([loadSnapshot(paths, {
				focus: params.focus,
				recompute: params.recompute,
			}), syncKnowledge(paths)]);
			const text = `${compactSnapshotText(snapshot)}\n\n${compactKnowledgeText(knowledge)}`;
			return toolText(text, {
				next: snapshot.frontier.next?.id ?? null,
				conceptCount: snapshot.concepts.length,
				knowledgeCount: knowledge.documents.filter((doc) => doc.status === "ready").length,
			});
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("learner_snapshot")), 0, 0);
		},
	});

	pi.registerTool({
		name: "learner_set_mission",
		label: "Set mission",
		description: "Write or update MISSION.md for the current learning goal. Use at the start of a topic.",
		parameters: Type.Object({
			goal: Type.String({ description: "What done looks like." }),
			desiredDepth: Type.Optional(Type.String({ description: "How deep to go." })),
			constraints: Type.Optional(Type.Array(Type.String())),
			topic: Type.Optional(Type.String({ description: "Short topic slug, e.g. closures" })),
			status: Type.Optional(
				Type.Union([
					Type.Literal("active"),
					Type.Literal("paused"),
					Type.Literal("complete"),
				]),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const mission = writeMission(projectPaths(ctx.cwd), params);
			return toolText(`Mission saved.\nGoal: ${mission.goal}\nDepth: ${mission.desiredDepth}\nStatus: ${mission.status}`, {
				goal: mission.goal,
			});
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("mission ")) + theme.fg("accent", String(args.goal ?? "")),
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "learner_update_graph",
		label: "Update graph",
		description:
			"Create or update nodes in the prerequisite graph stored in learner/concepts.json. Only add nodes needed for the current mission.",
		parameters: Type.Object({
			concepts: Type.Array(
				Type.Object({
					id: Type.String({ description: "Kebab-case id" }),
					name: Type.String(),
					prerequisites: Type.Optional(Type.Array(Type.String())),
					description: Type.Optional(Type.String()),
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const paths = projectPaths(ctx.cwd);
			const store = upsertConcepts(loadConcepts(paths), params.concepts);
			saveConcepts(paths, store);
			const ids = params.concepts.map((c) => c.id).join(", ");
			return toolText(`Graph updated (${Object.keys(store.concepts).length} nodes). Upserted: ${ids}`, {
				ids: Object.keys(store.concepts),
			});
		},
		renderCall(args, theme) {
			const ids = Array.isArray(args.concepts)
				? args.concepts.map((c: { id?: string }) => c.id).filter(Boolean).join(", ")
				: "";
			return new Text(theme.fg("toolTitle", theme.bold("graph ")) + theme.fg("muted", ids), 0, 0);
		},
	});

	pi.registerTool({
		name: "learner_record_evidence",
		label: "Record evidence",
		description:
			"Append a non-quiz evidence event (self-report, conversation demonstration) and update mastery. Prefer the quiz tool for assessments.",
		parameters: Type.Object({
			concept: Type.String(),
			type: Type.Union(EVIDENCE_TYPES.map((t) => Type.Literal(t))),
			score: Type.Number({ description: "0–1" }),
			correct: Type.Optional(Type.Boolean()),
			notes: Type.Optional(Type.String()),
			misconceptions: Type.Optional(Type.Array(Type.String())),
			source: Type.Optional(
				Type.Union([
					Type.Literal("self_report"),
					Type.Literal("conversation"),
					Type.Literal("probe"),
				]),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const paths = projectPaths(ctx.cwd);
			const { event, store } = recordAndUpdate(paths, loadConcepts(paths), {
				concept: params.concept,
				type: params.type,
				score: params.score,
				correct: params.correct ?? params.score >= 0.7,
				source: params.source ?? "conversation",
				misconceptions: params.misconceptions,
				notes: params.notes,
			});
			saveConcepts(paths, store);
			const concept = store.concepts[params.concept];
			return toolText(
				`Evidence recorded for ${params.concept}. mastery=${concept.mastery.toFixed(2)} conf=${concept.confidence.toFixed(2)} status=${concept.status}`,
				{ concept: concept.id, mastery: concept.mastery, status: concept.status, eventId: event.id },
			);
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("evidence ")) +
					theme.fg("accent", String(args.concept ?? "")) +
					theme.fg("dim", ` ${args.type ?? ""}`),
				0,
				0,
			);
		},
	});

	pi.registerTool({
		name: "learner_write_record",
		label: "Learning record",
		description:
			"Write a compact learning-records/*.md file for this segment. Call at the end of a meaningful session. This is durable memory — not the chat log.",
		parameters: Type.Object({
			learnerQuestions: Type.Optional(Type.Array(Type.String())),
			notes: Type.Optional(Type.String()),
			topic: Type.Optional(Type.String()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const paths = projectPaths(ctx.cwd);
			const { snapshot, store } = loadSnapshot(paths);
			const file = writeLearningRecord(paths, {
				mission: snapshot.mission,
				store,
				events: loadEvidence(paths),
				learnerQuestions: params.learnerQuestions,
				notes: params.notes,
				topic: params.topic ?? snapshot.mission?.topic,
			});
			return toolText(`Wrote learning record: ${file}`, { file });
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("learning_record")), 0, 0);
		},
	});
}
