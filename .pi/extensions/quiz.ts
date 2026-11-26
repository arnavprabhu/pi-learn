/**
 * Assessment tools. Answer keys (expectedAnswer, correctChoices, tests) are
 * stored in pending state / tool args but redacted from TUI renderers and
 * from the model-visible result.
 *
 * Grading:
 *   multiple_choice, numeric, multi_select  graded locally by script
 *   code                                    learner code run against tutor tests
 *   free_response (and other formats)       isolated verifier agent
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { loadAgent } from "../../lib/agents.ts";
import { runCodeQuiz } from "../../lib/code-runner.ts";
import { loadConcepts, normalizeConceptId, saveConcepts } from "../../lib/concepts.ts";
import { loadEvidence, recordAndUpdate } from "../../lib/evidence.ts";
import { nowIso } from "../../lib/fs.ts";
import {
	dontKnowResult,
	evidenceTypeForQuiz,
	gradeCodeRun,
	gradeMultiSelect,
	gradeMultipleChoice,
	gradeNumeric,
	isDontKnow,
	parseGradeJson,
	resolveQuizType,
	validateCode,
	validateMultiSelect,
	validateMultipleChoice,
	validateNumeric,
} from "../../lib/grade.ts";
import { deriveMisconceptions, matchMisconception } from "../../lib/misconceptions.ts";
import { projectPaths } from "../../lib/paths.ts";
import { clearPendingQuiz, loadPendingQuiz, savePendingQuiz } from "../../lib/pending.ts";
import { tryWriteAutomaticLearningRecord } from "../../lib/records.ts";
import type { CodeLanguage, EvidenceType, GradeResult, PendingQuiz, QuizType } from "../../lib/types.ts";
import { IMPLEMENTED_QUIZ_TYPES, QUIZ_TYPES } from "../../lib/types.ts";
import { refreshTeachWidget } from "../../lib/widget.ts";

const QuizTypeSchema = Type.Union(QUIZ_TYPES.map((t) => Type.Literal(t)));
const DONT_KNOW = "I don't know";

const QuizParams = Type.Object({
	concept: Type.String({ description: "Concept id being tested" }),
	// Optional: execute already defaults missing type. Weak models often put the
	// format in evidenceType instead (e.g. evidenceType: "free_response").
	type: Type.Optional(QuizTypeSchema),
	question: Type.String(),
	choices: Type.Optional(Type.Array(Type.String(), { description: "For multiple_choice and multi_select" })),
	expectedAnswer: Type.Optional(
		Type.String({ description: "Answer key. For numeric, the number. Never shown to the learner in the UI." }),
	),
	correctChoices: Type.Optional(
		Type.Array(Type.String(), {
			description: "multi_select answer key: every correct choice (text, letter, or one-based number). Never shown.",
		}),
	),
	tolerance: Type.Optional(
		Type.Number({ description: "numeric: accepted absolute error. Default 1% of expectedAnswer." }),
	),
	language: Type.Optional(
		Type.String({ description: 'code: "javascript" (default) or "python".' }),
	),
	tests: Type.Optional(
		Type.String({
			description:
				"code: test code appended after the learner's code. Must throw or exit non-zero when the answer is wrong (use assert). Never shown.",
		}),
	),
	expectedUnderstanding: Type.Optional(
		Type.String({ description: "What a good free response must demonstrate." }),
	),
	rubric: Type.Optional(Type.String()),
	difficulty: Type.Optional(Type.Number({ description: "0–1, informational" })),
	targetMisconception: Type.Optional(
		Type.String({
			description:
				"Misconception id (e.g. m-3fa21c) or text this item re-checks. A correct answer marks it resolved; a wrong one keeps it open.",
		}),
	),
	// String, not an enum: weak models confuse this with quiz `type` (e.g. free_response).
	// Invalid values are coerced via evidenceTypeForQuiz rather than failing the whole call.
	evidenceType: Type.Optional(
		Type.String({
			description:
				"Optional Bloom evidence: recognition, recall, explanation, application, or transfer. Inferred from type if omitted or invalid. Do not pass a quiz type here.",
		}),
	),
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

function renderQuizCall(args: Record<string, unknown>, theme: Theme) {
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

function coerceLanguage(value: unknown): CodeLanguage {
	const text = String(value ?? "").trim().toLowerCase();
	if (text === "python" || text === "py" || text === "python3") return "python";
	return "javascript";
}

function isImplemented(type: QuizType): boolean {
	return (IMPLEMENTED_QUIZ_TYPES as readonly string[]).includes(type);
}

/** Checklist for multi-select: up/down move, space toggles, enter submits, escape cancels. */
async function pickMany(ctx: ExtensionContext, question: string, choices: string[]): Promise<string | null> {
	return ctx.ui.custom<string | null>(
		(tui, theme, keybindings, done) => {
			const items = [...choices, DONT_KNOW];
			const checked = new Set<number>();
			let cursor = 0;
			let cache: { width: number; lines: string[] } | undefined;
			const invalidate = () => {
				cache = undefined;
			};
			return {
				render(width: number): string[] {
					if (cache?.width === width) return cache.lines;
					const lines = [
						theme.fg("accent", theme.bold(question)),
						theme.fg("dim", "Select every correct choice."),
						"",
						...items.map((item, index) => {
							const box = index === items.length - 1 ? "   " : checked.has(index) ? "[x]" : "[ ]";
							const label = `${String.fromCharCode(65 + index)}. ${item}`;
							const line = `${index === cursor ? "›" : " "} ${box} ${index === items.length - 1 ? item : label}`;
							return index === cursor ? theme.fg("accent", line) : line;
						}),
						"",
						theme.fg("dim", "↑/↓ move · space toggle · enter submit · esc cancel"),
					].map((line) => truncateToWidth(line, width));
					cache = { width, lines };
					return lines;
				},
				handleInput(data: string): void {
					if (keybindings.matches(data, "tui.select.up")) cursor = (cursor - 1 + items.length) % items.length;
					else if (keybindings.matches(data, "tui.select.down")) cursor = (cursor + 1) % items.length;
					else if (data === " " && cursor < choices.length) {
						if (checked.has(cursor)) checked.delete(cursor);
						else checked.add(cursor);
					} else if (keybindings.matches(data, "tui.select.confirm")) {
						if (cursor === items.length - 1) return done(DONT_KNOW);
						if (checked.size === 0) checked.add(cursor);
						return done([...checked].sort((a, b) => a - b).map((i) => String.fromCharCode(65 + i)).join(", "));
					} else if (keybindings.matches(data, "tui.select.cancel")) return done(null);
					else return;
					invalidate();
					tui.requestRender();
				},
				invalidate,
			};
		},
		{ blocked: { kind: "question", message: question.split("\n")[0] } },
	);
}

async function collectAnswer(ctx: ExtensionContext, pending: PendingQuiz): Promise<string | null> {
	const simulated = process.env.PI_TEACH_ANSWER;
	if (simulated !== undefined && simulated !== "") return simulated;
	if (!ctx.hasUI) return null;

	if (pending.quizType === "multiple_choice" && pending.choices?.length) {
		const picked = await ctx.ui.select(pending.question, [...pending.choices, DONT_KNOW]);
		return picked ?? null;
	}
	if (pending.quizType === "multi_select" && pending.choices?.length) {
		if (ctx.mode === "tui") return pickMany(ctx, pending.question, pending.choices);
		const listed = pending.choices.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n");
		const text = await ctx.ui.editor(
			`${pending.question}\n\n${listed}\n\nType the letters of every correct choice, e.g. A, C. (Or "I don't know".)`,
			"",
		);
		return text ?? null;
	}
	if (pending.quizType === "numeric") {
		const text = await ctx.ui.input(`${pending.question}  (number, or "I don't know")`, "");
		return text ?? null;
	}
	if (pending.quizType === "code") {
		const language = pending.language === "python" ? "Python" : "JavaScript";
		const text = await ctx.ui.editor(
			`${pending.question}\n\nWrite ${language}. Your code is run against hidden tests. (You may answer "I don't know".)`,
			"",
		);
		return text ?? null;
	}
	const text = await ctx.ui.editor(`${pending.question}\n\n(You may answer "I don't know".)`, "");
	return text ?? null;
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

	if (pending.quizType === "numeric" && pending.expectedAnswer) {
		return gradeNumeric({ answer, expectedAnswer: pending.expectedAnswer, tolerance: pending.tolerance, evidenceType: type });
	}

	if (pending.quizType === "multi_select" && pending.choices && pending.correctChoices) {
		return gradeMultiSelect({ answer, choices: pending.choices, correctChoices: pending.correctChoices, evidenceType: type });
	}

	if (pending.quizType === "code" && pending.tests) {
		const run = await runCodeQuiz({
			language: pending.language ?? "javascript",
			code: answer,
			tests: pending.tests,
			signal,
		});
		if (run.status !== "unavailable") {
			return gradeCodeRun({ passed: run.status === "passed", timedOut: run.timedOut, output: run.output, evidenceType: type });
		}
		// Interpreter missing: fall back to the verifier reading the code.
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
		pending.targetMisconception ? `misconception being re-checked: ${pending.targetMisconception}` : "",
		`learner response: ${answer}`,
	].filter(Boolean).join("\n");

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

/** Turn a targeted misconception into resolve / reinforce evidence. */
function misconceptionEffects(pending: PendingQuiz, grade: GradeResult): {
	misconceptions: string[];
	resolvedMisconceptions?: string[];
} {
	const misconceptions = [...grade.misconceptions];
	if (!pending.targetMisconception || grade.dontKnow) return { misconceptions };
	if (grade.correct === true) return { misconceptions, resolvedMisconceptions: [pending.targetMisconception] };
	if (grade.correct === false && !misconceptions.some((m) => m.trim().toLowerCase() === pending.targetMisconception!.trim().toLowerCase())) {
		misconceptions.push(pending.targetMisconception);
	}
	return { misconceptions };
}

function persistGrade(ctx: ExtensionContext, pending: PendingQuiz, grade: GradeResult) {
	const paths = projectPaths(ctx.cwd);
	const effects = misconceptionEffects(pending, grade);
	const { store, event } = recordAndUpdate(paths, loadConcepts(paths), {
		concept: pending.concept,
		type: grade.evidenceType,
		score: grade.score,
		correct: grade.correct,
		source: "quiz",
		quizType: pending.quizType,
		misconceptions: effects.misconceptions,
		resolvedMisconceptions: effects.resolvedMisconceptions,
		notes: grade.dontKnow ? "dont_know" : grade.notes,
		strength: grade.evidenceStrength,
	});
	saveConcepts(paths, store);
	clearPendingQuiz(paths);
	const record = tryWriteAutomaticLearningRecord(paths, store);
	refreshTeachWidget(ctx);
	const concept = store.concepts[pending.concept];
	return { event, concept, record, resolved: effects.resolvedMisconceptions ?? [] };
}

/** Resolve a targetMisconception reference to its stored text, keeping unknown text as-is. */
function resolveTarget(ctx: ExtensionContext, concept: string, ref?: string): string | undefined {
	if (!ref?.trim()) return undefined;
	const records = deriveMisconceptions(loadEvidence(projectPaths(ctx.cwd)));
	return matchMisconception(records, concept, ref)?.text ?? ref.trim();
}

function validationError(quizType: QuizType, params: Record<string, unknown>): string | null {
	if (quizType === "multiple_choice") return validateMultipleChoice(params as { choices?: string[]; expectedAnswer?: string });
	if (quizType === "numeric") return validateNumeric(params as { expectedAnswer?: string; tolerance?: number });
	if (quizType === "multi_select") return validateMultiSelect(params as { choices?: string[]; correctChoices?: string[] });
	if (quizType === "code") return validateCode({ tests: params.tests as string | undefined, language: coerceLanguage(params.language) });
	return null;
}

function gradedPayload(pending: PendingQuiz, grade: GradeResult, answer: string, persisted: ReturnType<typeof persistGrade>) {
	return publicGrade(grade, {
		concept: pending.concept,
		mastery: persisted.concept.mastery,
		confidence: persisted.concept.confidence,
		status: persisted.concept.status,
		nextReview: persisted.concept.review?.due ?? null,
		resolvedMisconceptions: persisted.resolved.length ? persisted.resolved : undefined,
		learnerAnswer: answer,
		record: persisted.record,
	});
}

export default function quizExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "Quiz",
		description:
			"Present an assessment for one concept. Formats: multiple_choice, multi_select, numeric, code, free_response. Script-graded formats (multiple_choice, multi_select, numeric, code) are more reliable than free_response; prefer them when the answer has one checkable form. Never reveal answer keys to the learner. Collects the answer when UI is available, grades it, and records evidence.",
		parameters: QuizParams,
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const quizType = resolveQuizType(params);
			const effectiveType: QuizType = isImplemented(quizType) ? quizType : "free_response";
			const error = validationError(effectiveType, params as Record<string, unknown>);
			if (error) {
				return {
					content: [{ type: "text" as const, text: `${error} Fix the quiz arguments and call quiz again.` }],
					details: { error },
					isError: true,
				};
			}
			const concept = normalizeConceptId(params.concept);
			const pending: PendingQuiz = {
				id: randomUUID(),
				concept,
				quizType: effectiveType,
				question: params.question,
				choices: params.choices,
				expectedAnswer: params.expectedAnswer,
				expectedUnderstanding: params.expectedUnderstanding,
				rubric: params.rubric,
				difficulty: params.difficulty,
				evidenceType: evidenceTypeForQuiz(effectiveType, params.evidenceType),
				tolerance: params.tolerance,
				correctChoices: params.correctChoices,
				language: effectiveType === "code" ? coerceLanguage(params.language) : undefined,
				tests: params.tests,
				targetMisconception: resolveTarget(ctx, concept, params.targetMisconception),
				createdAt: nowIso(),
			};

			const paths = projectPaths(ctx.cwd);
			savePendingQuiz(paths, pending);

			const answer = await collectAnswer(ctx, pending);
			if (answer === null) {
				const choices = pending.choices?.map((c, i) => `${String.fromCharCode(65 + i)}. ${c}`).join("\n") ?? "";
				const hint = pending.quizType === "multi_select"
					? "(more than one choice may be correct; also allow: I don't know)"
					: "(also allow: I don't know)";
				return {
					content: [
						{
							type: "text" as const,
							text: [
								"Quiz pending. Present this question to the learner (do not reveal the answer key).",
								`Concept: ${pending.concept}`,
								`Type: ${pending.quizType}`,
								`Question: ${pending.question}`,
								choices ? `Choices:\n${choices}\n${hint}` : 'Allow "I don\'t know".',
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
				const persisted = persistGrade(ctx, pending, grade);
				const payload = gradedPayload(pending, grade, answer, persisted);
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
			const persisted = persistGrade(ctx, pending, grade);
			const payload = gradedPayload(pending, grade, params.answer, persisted);
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
