import type { EvidenceType, GradeResult, QuizType, RecommendedAction } from "./types.ts";
import { EVIDENCE_TYPES, QUIZ_TYPES } from "./types.ts";
import { clamp01, strengthFor } from "./mastery.ts";

const DONT_KNOW = /^(i\s*(don't|do not|dont)\s*know|idk|unsure|no idea|\?+)\s*$/i;

export function isDontKnow(answer: string): boolean {
	return DONT_KNOW.test(answer.trim());
}

function normalizeLabel(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Bloom evidence labels only. Quiz formats such as free_response are not evidence types. */
export function coerceEvidenceType(value: unknown): EvidenceType | undefined {
	const normalized = normalizeLabel(value);
	if (normalized && (EVIDENCE_TYPES as readonly string[]).includes(normalized)) {
		return normalized as EvidenceType;
	}
	return undefined;
}

export function coerceQuizType(value: unknown): QuizType | undefined {
	const normalized = normalizeLabel(value);
	if (normalized && (QUIZ_TYPES as readonly string[]).includes(normalized)) {
		return normalized as QuizType;
	}
	return undefined;
}

/** Prefer `type`; if omitted, recover a quiz format mistakenly sent as evidenceType. */
export function resolveQuizType(input: {
	type?: unknown;
	evidenceType?: unknown;
	choices?: unknown;
}): QuizType {
	const fromType = coerceQuizType(input.type);
	if (fromType) return fromType;
	const misplaced = coerceQuizType(input.evidenceType);
	if (misplaced) return misplaced;
	if (Array.isArray(input.choices) && input.choices.filter((c) => typeof c === "string" && c.trim()).length >= 2) {
		return "multiple_choice";
	}
	return "free_response";
}

export function evidenceTypeForQuiz(quizType: QuizType, requested?: unknown): EvidenceType {
	const coerced = coerceEvidenceType(requested);
	if (coerced) return coerced;
	if (quizType === "multiple_choice" || quizType === "multi_select" || quizType === "matching") {
		return "recognition";
	}
	if (quizType === "numeric") return "recall";
	if (quizType === "derivation" || quizType === "code") return "application";
	return "recall";
}

export function gradeMultipleChoice(input: {
	answer: string;
	expectedAnswer: string;
	choices?: string[];
	evidenceType?: EvidenceType;
}): GradeResult {
	if (isDontKnow(input.answer)) return dontKnowResult(input.evidenceType ?? "recognition");

	const answer = normalize(input.answer);
	const expected = normalize(input.expectedAnswer);
	const choices = input.choices ?? [];

	let correct = answer === expected;
	if (!correct && choices.length > 0) {
		const expectedIndex = resolveChoiceIndex(choices, input.expectedAnswer);
		const answerIndex = resolveChoiceIndex(choices, input.answer);
		if (expectedIndex !== -1 && answerIndex !== -1) correct = expectedIndex === answerIndex;
		const letter = answer.match(/^([a-d])\b/);
		if (!correct && letter && expectedIndex !== -1) {
			correct = letter[1].charCodeAt(0) - 97 === expectedIndex;
		}
		if (!correct && /^\d+$/.test(answer) && expectedIndex !== -1) {
			correct = Number(answer) - 1 === expectedIndex;
		}
	}

	const type = input.evidenceType ?? "recognition";
	return {
		correct,
		score: correct ? 1 : 0,
		confidence: 0.95,
		evidenceStrength: strengthFor(type),
		evidenceType: type,
		misconceptions: [],
		missingIdeas: correct ? [] : ["selected a distractor or mismatched the expected choice"],
		recommendedAction: correct ? "advance" : "reteach",
		dontKnow: false,
	};
}

/** Return the selected choice for exact text, a letter, or a one-based number. */
export function resolveChoiceIndex(choices: string[], value: string): number {
	const normalized = normalize(value);
	const exact = choices.findIndex((choice) => normalize(choice) === normalized);
	if (exact !== -1) return exact;
	if (/^[a-z]$/.test(normalized)) {
		const index = normalized.charCodeAt(0) - 97;
		return index < choices.length ? index : -1;
	}
	if (/^\d+$/.test(normalized)) {
		const index = Number(normalized) - 1;
		return index >= 0 && index < choices.length ? index : -1;
	}
	return -1;
}

export function validateMultipleChoice(input: {
	choices?: string[];
	expectedAnswer?: string;
}): string | null {
	const choices = input.choices ?? [];
	if (choices.length < 2) return "Multiple-choice quizzes need at least two choices.";
	if (choices.some((choice) => !choice.trim())) return "Multiple-choice choices cannot be blank.";
	if (new Set(choices.map(normalize)).size !== choices.length) return "Multiple-choice choices must be unique.";
	if (!input.expectedAnswer?.trim()) return "Multiple-choice quizzes need expectedAnswer.";
	if (resolveChoiceIndex(choices, input.expectedAnswer) === -1) {
		return "expectedAnswer must match one choice exactly, or identify it by letter or one-based number.";
	}
	return null;
}

export function dontKnowResult(type: EvidenceType): GradeResult {
	return {
		correct: false,
		score: 0,
		confidence: 0.9,
		evidenceStrength: Math.min(0.35, strengthFor(type)),
		evidenceType: type,
		misconceptions: [],
		missingIdeas: [],
		recommendedAction: "probe_prerequisite",
		dontKnow: true,
		notes: "Learner chose I don't know — do not treat as a misconception.",
	};
}

export function parseGradeJson(text: string, fallbackType: EvidenceType): GradeResult {
	const json = extractJson(text);
	if (!json || typeof json !== "object") {
		throw new Error("Verifier did not return JSON");
	}
	const obj = json as Record<string, unknown>;
	const score = clamp01(Number(obj.score ?? (obj.correct ? 1 : 0)));
	const correct = obj.correct === null ? null : Boolean(obj.correct) || score >= 0.7;
	const action = parseAction(obj.recommendedAction);
	return {
		correct,
		score,
		confidence: clamp01(Number(obj.confidence ?? 0.7)),
		evidenceStrength: clamp01(Number(obj.evidenceStrength ?? strengthFor(fallbackType))),
		evidenceType: fallbackType,
		misconceptions: asStringArray(obj.misconceptions),
		missingIdeas: asStringArray(obj.missingIdeas),
		recommendedAction: action,
		dontKnow: false,
		notes: typeof obj.notes === "string" ? obj.notes : undefined,
	};
}

export function extractJson(text: string): unknown {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const raw = fence ? fence[1] : text;
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	if (start === -1 || end === -1) return null;
	return JSON.parse(raw.slice(start, end + 1));
}

function normalize(s: string): string {
	return s.trim().toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((v) => String(v)).filter((s) => s.trim());
}

function parseAction(value: unknown): RecommendedAction {
	const s = String(value ?? "");
	if (s === "advance" || s === "reteach" || s === "remediate" || s === "probe_prerequisite" || s === "continue") {
		return s;
	}
	return "continue";
}
