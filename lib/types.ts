/** Shared types for the project-local adaptive learning system. */

export const EVIDENCE_TYPES = [
	"recognition",
	"recall",
	"explanation",
	"application",
	"transfer",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const QUIZ_TYPES = [
	"multiple_choice",
	"free_response",
	"numeric",
	"multi_select",
	"confidence_rating",
	"code",
	"derivation",
	"matching",
] as const;

export type QuizType = (typeof QUIZ_TYPES)[number];

export const CONCEPT_STATUSES = [
	"unknown",
	"probing",
	"learning",
	"mastered",
	"blocked",
] as const;

export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

export const RECOMMENDED_ACTIONS = [
	"advance",
	"reteach",
	"remediate",
	"probe_prerequisite",
	"continue",
] as const;

export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];

export interface Concept {
	id: string;
	name: string;
	description?: string;
	prerequisites: string[];
	/** Estimated P(learner can use this concept independently). 0–1. */
	mastery: number;
	/** How much we trust the mastery estimate. 0–1. */
	confidence: number;
	status: ConceptStatus;
	lastReviewed: string | null;
	evidenceCount: number;
	/** Open misconception texts. Resolved ones are tracked in lib/misconceptions.ts. */
	misconceptions: string[];
	evidence: EvidenceCounts;
	/** Spaced-review schedule derived from graded evidence. Missing on caches written before v2. */
	review?: ReviewState;
}

export interface ReviewState {
	/** Days until predicted recall drops to 90%. 0 means never successfully recalled. */
	stability: number;
	/** Timestamp of the last evidence that changed the schedule. */
	lastReview: string | null;
	due: string | null;
	reps: number;
	lapses: number;
}

export interface DueReview {
	id: string;
	name: string;
	due: string;
	overdueDays: number;
	retrievability: number;
}

export type MisconceptionStatus = "open" | "resolved" | "confirmed";

export interface MisconceptionRecord {
	/** Stable id derived from concept and normalized text, e.g. m-3fa21c. */
	id: string;
	concept: string;
	text: string;
	status: MisconceptionStatus;
	count: number;
	firstSeen: string;
	lastSeen: string;
	resolvedAt?: string;
	confirmedAt?: string;
}

export interface EvidenceCounts {
	correct: number;
	incorrect: number;
	recognition: number;
	recall: number;
	explanation: number;
	application: number;
	transfer: number;
}

export interface EvidenceEvent {
	id: string;
	ts: string;
	concept: string;
	/** Quiz/item type if this came from an assessment. */
	quizType?: QuizType;
	type: EvidenceType;
	score: number;
	strength: number;
	correct: boolean | null;
	source: "quiz" | "probe" | "conversation" | "self_report";
	misconceptions?: string[];
	/** Misconception ids (or texts) this evidence showed are corrected. */
	resolvedMisconceptions?: string[];
	notes?: string;
}

export interface ConceptStore {
	version: 1;
	updatedAt: string;
	concepts: Record<string, Concept>;
}

export interface Mission {
	goal: string;
	desiredDepth: string;
	constraints: string[];
	status: "active" | "paused" | "complete";
	topic?: string;
	raw: string;
}

export interface GradeResult {
	correct: boolean | null;
	score: number;
	confidence: number;
	evidenceStrength: number;
	evidenceType: EvidenceType;
	misconceptions: string[];
	missingIdeas: string[];
	recommendedAction: RecommendedAction;
	dontKnow: boolean;
	notes?: string;
}

export interface FrontierSnapshot {
	ready: Concept[];
	blocked: Concept[];
	mastered: Concept[];
	unknown: Concept[];
	next: Concept | null;
}

export interface LearnerSnapshot {
	mission: Mission | null;
	frontier: FrontierSnapshot;
	concepts: Concept[];
	recentEvidence: EvidenceEvent[];
	pendingQuiz: PendingQuiz | null;
	dueReviews: DueReview[];
	misconceptions: MisconceptionRecord[];
}

export interface PendingQuiz {
	id: string;
	concept: string;
	quizType: QuizType;
	question: string;
	choices?: string[];
	expectedAnswer?: string;
	expectedUnderstanding?: string;
	rubric?: string;
	difficulty?: number;
	evidenceType: EvidenceType;
	/** numeric: accepted absolute error. */
	tolerance?: number;
	/** multi_select: every correct choice (text, letter, or one-based number). */
	correctChoices?: string[];
	/** code: language the learner writes and the tests run in. */
	language?: CodeLanguage;
	/** code: test code appended after the learner's code. Must fail (throw / non-zero exit) on a wrong answer. */
	tests?: string;
	/** Misconception id or text this item re-checks. */
	targetMisconception?: string;
	createdAt: string;
}

export const CODE_LANGUAGES = ["javascript", "python"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Quiz formats with dedicated collection and grading. Others are graded as free response. */
export const IMPLEMENTED_QUIZ_TYPES = ["multiple_choice", "free_response", "numeric", "multi_select", "code"] as const;

export function emptyEvidenceCounts(): EvidenceCounts {
	return {
		correct: 0,
		incorrect: 0,
		recognition: 0,
		recall: 0,
		explanation: 0,
		application: 0,
		transfer: 0,
	};
}

export function defaultConcept(partial: {
	id: string;
	name: string;
	prerequisites?: string[];
	description?: string;
}): Concept {
	return {
		id: partial.id,
		name: partial.name,
		description: partial.description,
		prerequisites: partial.prerequisites ?? [],
		mastery: 0.25,
		confidence: 0.15,
		status: "unknown",
		lastReviewed: null,
		evidenceCount: 0,
		misconceptions: [],
		evidence: emptyEvidenceCounts(),
		review: emptyReview(),
	};
}

export function emptyReview(): ReviewState {
	return { stability: 0, lastReview: null, due: null, reps: 0, lapses: 0 };
}
