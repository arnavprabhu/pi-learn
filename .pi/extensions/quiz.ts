/**
 * Assessment tools. Expected answers are stored in pending state / tool
 * args but redacted from TUI renderers and from the model-visible result.
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadAgent } from "../../lib/agents.ts";
import { loadConcepts, saveConcepts } from "../../lib/concepts.ts";
import { recordAndUpdate } from "../../lib/evidence.ts";
import { nowIso } from "../../lib/fs.ts";
import {
	dontKnowResult,
	evidenceTypeForQuiz,
	gradeMultipleChoice,
	isDontKnow,
	parseGradeJson,
} from "../../lib/grade.ts";
import { projectPaths } from "../../lib/paths.ts";
import { clearPendingQuiz, loadPendingQuiz, savePendingQuiz } from "../../lib/pending.ts";
import type { EvidenceType, GradeResult, PendingQuiz, QuizType } from "../../lib/types.ts";
import { QUIZ_TYPES } from "../../lib/types.ts";

const QuizTypeSchema = Type.Union(QUIZ_TYPES.map((t) => Type.Literal(t)));

const EvidenceTypeSchema = Type.Union([
	Type.Literal("recognition"),
	Type.Literal("recall"),
	Type.Literal("explanation"),
	Type.Literal("application"),
	Type.Literal("transfer"),
]);

const QuizParams = Type.Object({
	concept: Type.String({ description: "Concept id being tested" }),
	type: QuizTypeSchema,
	question: Type.String(),
	choices: Type.Optional(Type.Array(Type.String(), { description: "For multiple_choice" })),
	expectedAnswer: Type.Optional(
		Type.String({ description: "Answer key. Never shown to the learner in the UI." }),
	),
	expectedUnderstanding: Type.Optional(
		Type.String({ description: "What a good free response must demonstrate." }),
	),
	rubric: Type.Optional(Type.String()),
	difficulty: Type.Optional(Type.Number({ description: "0–1, informational" })),
	evidenceType: Type.Optional(EvidenceTypeSchema),
});

function publicGrade(grade: GradeResult, extra: Record<string, unknown> = {}) {
	return {
		correct: grade.correct,
		score: grade.score,
		confidence: grade.confidence,
		evidenceStrength: grade.evidenceStrength,
		evidenceType: grade.evidenceType,
		misconceptions: grade.misconceptions,
		missingIdeas: grade.missingIdeas,
		recommendedAction: grade.recommendedAction,
		dontKnow: grade.dontKnow,
		notes: grade.notes,
		...extra,
	};
}

function renderQuizCall(args: Record<string, unknown>, theme: { fg: (c: string, t: string) => string; bold: (t: string) => string }) {
	const concept = String(args.concept ?? "");
	const type = String(args.type ?? "");
	const question = String(args.question ?? "");
	return new Text(
		theme.fg("toolTitle", theme.bold("quiz ")) +
			theme.fg("accent", concept) +
			theme.fg("dim", ` [${type}]`) +
			"\n" +
			theme.fg("muted", question.slice(0, 200)),
		0,
		0,
	);
}

async function collectAnswer(
	ctx: ExtensionContext,
	pending: PendingQuiz,
): Promise<string | null> {
	const simulated = process.env.PI_TEACH_ANSWER;
	if (simulated !== undefined && simulated !== "") return simulated;

	if (ctx.hasUI) {
		if (pending.quizType === "multiple_choice" && pending.choices?.length) {
			const options = [...pending.choices, "I don't know"];
			const picked = await ctx.ui.select(pending.question, options);
			return picked ?? null;
		}
		const text = await ctx.ui.editor(`${pending.question}\n\n(You may answer "I don't know".)`, "");
		return text ?? null;
	}

	return null;
}

async function gradePending(
	ctx: ExtensionContext,
	pending: PendingQuiz,
	answer: string,
	signal?: AbortSignal,
): Promise<GradeResult> {
	const type = evidenceTypeForQuiz(pending.quizType, pending.evidenceType);

	if (isDontKnow(answer)) return dontKnowResult(type);

	if (pending.quizType === "multiple_choice") {
		if (!pending.expectedAnswer) {
			return {
				correct: null,
				score: 0,
				confidence: 0.2,
				evidenceStrength: type === "recognition" ? 0.25 : 0.5,
				evidenceType: type,
				misconceptions: [],
				missingIdeas: ["quiz was missing an expected answer"],
				recommendedAction: "continue",
				dontKnow: false,
			};
		}
		return gradeMultipleChoice({
			answer,
			expectedAnswer: pending.expectedAnswer,
			choices: pending.choices,
			evidenceType: type,
		});
	}

	return verifyFreeResponse(ctx, pending, answer, type, signal);
}

async function verifyFreeResponse(
	ctx: ExtensionContext,
	pending: PendingQuiz,
	answer: string,
	type: EvidenceType,
	signal?: AbortSignal,
): Promise<GradeResult> {
	if (!ctx.model) {
		throw new Error("No model selected; cannot run isolated verifier");
	}
	const paths = projectPaths(ctx.cwd);
	const agent = loadAgent(paths, "verifier");
	const payload = [
		`concept: ${pending.concept}`,
		`question: ${pending.question}`,
		`expected understanding: ${pending.expectedUnderstanding || pending.expectedAnswer || "(not provided)"}`,
		`rubric: ${pending.rubric || "(none)"}`,
		`evidence type: ${type}`,
		`learner response: ${answer}`,
	].join("\n");

	const response = await ctx.modelRegistry.complete(
		ctx.model,
		{
			systemPrompt: agent.body,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: payload }],
					timestamp: Date.now(),
				},
			],
		},
		{ signal },
	);

	const text = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return parseGradeJson(text, type);
}

function persistGrade(
	ctx: ExtensionContext,
	pending: PendingQuiz,
	grade: GradeResult,
) {
	const paths = projectPaths(ctx.cwd);
	const { store, event } = recordAndUpdate(paths, loadConcepts(paths), {
		concept: pending.concept,
		type: grade.evidenceType,
		score: grade.score,
		correct: grade.correct,
		source: "quiz",
		quizType: pending.quizType,
		misconceptions: grade.misconceptions,
		notes: grade.dontKnow ? "dont_know" : grade.notes,
		strength: grade.evidenceStrength,
	});
	saveConcepts(paths, store);
	clearPendingQuiz(paths);
	const concept = store.concepts[pending.concept];
	return { event, concept };
}

export default function quizExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "Quiz",
		description:
			"Present an assessment for one concept. Supports multiple_choice and free_response (other types are stored for later). Never reveal expectedAnswer to the learner. Collects the answer when UI is available, runs isolated verification for free response, and records evidence.",
		parameters: QuizParams,
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const quizType = (params.type ?? "free_response") as QuizType;
			const implemented = quizType === "multiple_choice" || quizType === "free_response";
			const pending: PendingQuiz = {
				id: randomUUID(),
				concept: params.concept,
				quizType: implemented ? quizType : "free_response",
				question: params.question,
				choices: params.choices,
				expectedAnswer: params.expectedAnswer,
				expectedUnderstanding: params.expectedUnderstanding,
				rubric: params.rubric,
				difficulty: params.difficulty,
				evidenceType: evidenceTypeForQuiz(implemented ? quizType : "free_response", params.evidenceType),
				createdAt: nowIso(),
			};

			const paths = projectPaths(ctx.cwd);
			savePendingQuiz(paths, pending);

			const answer = await collectAnswer(ctx, pending);
			if (answer === null) {
				const choices = pending.choices?.map((c, i) => `${i + 1}. ${c}`).join("\n") ?? "";
				return {
					content: [
						{
							type: "text" as const,
							text: [
								"Quiz pending. Present this question to the learner (do not reveal the answer key).",
								`Concept: ${pending.concept}`,
								`Type: ${pending.quizType}`,
								`Question: ${pending.question}`,
								choices ? `Choices:\n${choices}\n(also allow: I don't know)` : 'Allow "I don\'t know".',
								"When they answer, call grade_response with their exact text.",
							].join("\n"),
						},
					],
					details: {
						pendingId: pending.id,
						concept: pending.concept,
						quizType: pending.quizType,
						question: pending.question,
						choices: pending.choices,
					},
				};
			}

			try {
				const grade = await gradePending(ctx, pending, answer, signal);
				const { concept } = persistGrade(ctx, pending, grade);
				const payload = publicGrade(grade, {
					concept: pending.concept,
					mastery: concept.mastery,
					confidence: concept.confidence,
					status: concept.status,
					learnerAnswer: answer,
				});
				return {
					content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
					details: payload,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Could not grade yet: ${(err as Error).message}. Pending quiz kept. Call grade_response after the learner answers, or retry.`,
						},
					],
					details: { pendingId: pending.id, error: (err as Error).message },
					isError: true,
				};
			}
		},
		renderCall(args, theme) {
			return renderQuizCall(args as Record<string, unknown>, theme);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as { score?: number; dontKnow?: boolean; correct?: boolean } | undefined;
			if (!details || details.score === undefined) {
				return new Text(theme.fg("warning", "pending learner answer"), 0, 0);
			}
			if (details.dontKnow) return new Text(theme.fg("muted", "I don't know"), 0, 0);
			const label = details.correct ? "correct" : "incorrect";
			const color = details.correct ? "success" : "warning";
			return new Text(theme.fg(color, `${label}  score=${Number(details.score).toFixed(2)}`), 0, 0);
		},
	});

	pi.registerTool({
		name: "grade_response",
		label: "Grade response",
		description:
			"Grade the learner's answer to the pending quiz. Use when the answer arrived as chat text instead of the quiz UI. Do not pass the expected answer.",
		parameters: Type.Object({
			answer: Type.String({ description: "Learner's exact response" }),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const paths = projectPaths(ctx.cwd);
			const pending = loadPendingQuiz(paths);
			if (!pending) {
				return {
					content: [{ type: "text" as const, text: "No pending quiz. Call quiz first." }],
					details: {},
					isError: true,
				};
			}
			const grade = await gradePending(ctx, pending, params.answer, signal);
			const { concept } = persistGrade(ctx, pending, grade);
			const payload = publicGrade(grade, {
				concept: pending.concept,
				mastery: concept.mastery,
				confidence: concept.confidence,
				status: concept.status,
				learnerAnswer: params.answer,
			});
			return {
				content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
				details: payload,
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("grade_response")), 0, 0);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as { score?: number; correct?: boolean } | undefined;
			if (details?.score === undefined) return new Text(theme.fg("warning", "no grade"), 0, 0);
			return new Text(
				theme.fg(details.correct ? "success" : "warning", `score=${Number(details.score).toFixed(2)}`),
				0,
				0,
			);
		},
	});
}
