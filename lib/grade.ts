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
	correctChoices?: unknown;
	tests?: unknown;
}): QuizType {
	const fromType = coerceQuizType(input.type);
	if (fromType) return fromType;
	const misplaced = coerceQuizType(input.evidenceType);
	if (misplaced) return misplaced;
	if (typeof input.tests === "string" && input.tests.trim()) return "code";
	if (Array.isArray(input.correctChoices) && input.correctChoices.length > 0) return "multi_select";
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

// ---------------------------------------------------------------------------
// Numeric

/**
 * Parse the first number in a free-text answer. Accepts signs, decimals,
 * thousands separators, scientific notation, simple fractions (1/3), and a
 * trailing percent sign. Units and words around the number are ignored.
 */
export function parseNumber(value: string): number | null {
	const text = value
		.replace(/[\u2212\u2013]/g, "-")
		.replace(/(\d),(?=\d{3}(\D|$))/g, "$1")
		.replace(/\s*[x×]\s*10\^?\s*(-?\d+)/i, "e$1");
	const fraction = text.match(/([-+]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
	if (fraction) {
		const denominator = Number(fraction[2]);
		if (denominator === 0) return null;
		return Number(fraction[1]) / denominator;
	}
	const match = text.match(/([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(%)?/i);
	if (!match) return null;
	const n = Number(match[1]);
	if (!Number.isFinite(n)) return null;
	return match[2] ? n / 100 : n;
}

/** Default tolerance: 1% of the expected value, or 1e-9 when it is zero. */
export function numericTolerance(expected: number, tolerance?: number): number {
	if (tolerance !== undefined && Number.isFinite(tolerance) && tolerance >= 0) return tolerance;
	return Math.max(Math.abs(expected) * 0.01, 1e-9);
}

export function validateNumeric(input: { expectedAnswer?: string; tolerance?: number }): string | null {
	if (!input.expectedAnswer?.trim()) return "Numeric quizzes need expectedAnswer.";
	if (parseNumber(input.expectedAnswer) === null) return "expectedAnswer must contain a number for a numeric quiz.";
	if (input.tolerance !== undefined && (!Number.isFinite(input.tolerance) || input.tolerance < 0)) {
		return "tolerance must be a non-negative number.";
	}
	return null;
}

export function gradeNumeric(input: {
	answer: string;
	expectedAnswer: string;
	tolerance?: number;
	evidenceType?: EvidenceType;
}): GradeResult {
	const type = input.evidenceType ?? "recall";
	if (isDontKnow(input.answer)) return dontKnowResult(type);
	const expected = parseNumber(input.expectedAnswer);
	const answer = parseNumber(input.answer);
	if (expected === null) throw new Error("Numeric quiz is missing a numeric expectedAnswer");
	if (answer === null) {
		return {
			correct: false,
			score: 0,
			confidence: 0.9,
			evidenceStrength: strengthFor(type),
			evidenceType: type,
			misconceptions: [],
			missingIdeas: ["answer did not contain a number"],
			recommendedAction: "reteach",
			dontKnow: false,
		};
	}
	const tolerance = numericTolerance(expected, input.tolerance);
	const error = Math.abs(answer - expected);
	const correct = error <= tolerance;
	const signFlip = !correct && expected !== 0 && Math.abs(answer + expected) <= tolerance;
	const scale = !correct && expected !== 0 && answer !== 0 && isPowerOfTen(answer / expected);
	return {
		correct,
		score: correct ? 1 : 0,
		confidence: 0.98,
		evidenceStrength: strengthFor(type),
		evidenceType: type,
		misconceptions: [],
		missingIdeas: correct
			? []
			: [signFlip ? "sign error: magnitude is right, sign is wrong" : scale ? "off by a power of ten (check units or scale)" : "numeric result outside tolerance"],
		recommendedAction: correct ? "advance" : signFlip || scale ? "remediate" : "reteach",
		dontKnow: false,
		notes: correct ? undefined : `answer=${answer} expected within ±${tolerance}`,
	};
}

function isPowerOfTen(ratio: number): boolean {
	const exponent = Math.log10(Math.abs(ratio));
	return Math.abs(exponent - Math.round(exponent)) < 1e-6 && Math.round(exponent) !== 0;
}

// ---------------------------------------------------------------------------
// Multi-select

/** Resolve each listed choice reference to a choice index. Unknown references are dropped. */
export function resolveChoiceSet(choices: string[], refs: string[]): Set<number> {
	const out = new Set<number>();
	for (const ref of refs) {
		const index = resolveChoiceIndex(choices, ref);
		if (index !== -1) out.add(index);
	}
	return out;
}

/** Split a learner's multi-select answer ("A, C", "1 3", or one choice text per line). */
export function parseSelections(choices: string[], answer: string): Set<number> {
	const lines = answer.split(/\n+/).map((line) => line.trim()).filter(Boolean);
	const byText = resolveChoiceSet(choices, lines);
	if (byText.size === lines.length && byText.size > 0) return byText;
	const tokens = answer.split(/[\s,;/]+|\band\b/i).map((t) => t.replace(/[.)\]]$/, "").trim()).filter(Boolean);
	return resolveChoiceSet(choices, tokens);
}

export function validateMultiSelect(input: { choices?: string[]; correctChoices?: string[] }): string | null {
	const choices = input.choices ?? [];
	if (choices.length < 2) return "Multi-select quizzes need at least two choices.";
	if (choices.some((choice) => !choice.trim())) return "Multi-select choices cannot be blank.";
	if (new Set(choices.map(normalize)).size !== choices.length) return "Multi-select choices must be unique.";
	const correct = input.correctChoices ?? [];
	if (correct.length === 0) return "Multi-select quizzes need correctChoices.";
	if (correct.some((ref) => resolveChoiceIndex(choices, ref) === -1)) {
		return "Every correctChoices entry must match a choice exactly, or identify it by letter or one-based number.";
	}
	return null;
}

/**
 * Score = (correct picks - wrong picks) / number of correct choices, floored at 0.
 * Only an exact match counts as correct.
 */
export function gradeMultiSelect(input: {
	answer: string;
	choices: string[];
	correctChoices: string[];
	evidenceType?: EvidenceType;
}): GradeResult {
	const type = input.evidenceType ?? "recognition";
	if (isDontKnow(input.answer)) return dontKnowResult(type);
	const expected = resolveChoiceSet(input.choices, input.correctChoices);
	const picked = parseSelections(input.choices, input.answer);
	let hits = 0;
	let wrong = 0;
	for (const index of picked) {
		if (expected.has(index)) hits += 1;
		else wrong += 1;
	}
	const missed = expected.size - hits;
	const correct = wrong === 0 && missed === 0;
	const score = clamp01((hits - wrong) / Math.max(1, expected.size));
	const missingIdeas: string[] = [];
	if (missed > 0) missingIdeas.push(`missed ${missed} correct choice${missed === 1 ? "" : "s"}`);
	if (wrong > 0) missingIdeas.push(`selected ${wrong} incorrect choice${wrong === 1 ? "" : "s"}`);
	return {
		correct,
		score,
		confidence: 0.95,
		evidenceStrength: strengthFor(type),
		evidenceType: type,
		misconceptions: [],
		missingIdeas,
		recommendedAction: correct ? "advance" : score >= 0.5 ? "continue" : "reteach",
		dontKnow: false,
	};
}

// ---------------------------------------------------------------------------
// Code

export function validateCode(input: { tests?: string; language?: string }): string | null {
	if (!input.tests?.trim()) return "Code quizzes need tests: code that throws or exits non-zero when the learner's answer is wrong.";
	if (input.language && input.language !== "javascript" && input.language !== "python") {
		return 'language must be "javascript" or "python".';
	}
	return null;
}

export function gradeCodeRun(input: {
	passed: boolean;
	timedOut: boolean;
	output: string;
	evidenceType?: EvidenceType;
}): GradeResult {
	const type = input.evidenceType ?? "application";
	return {
		correct: input.passed,
		score: input.passed ? 1 : 0,
		confidence: 0.95,
		evidenceStrength: strengthFor(type),
		evidenceType: type,
		misconceptions: [],
		missingIdeas: input.passed ? [] : [input.timedOut ? "code did not finish within the time limit" : "tests failed"],
		recommendedAction: input.passed ? "advance" : "reteach",
		dontKnow: false,
		notes: input.passed ? undefined : input.output.slice(-1500),
	};
}
