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
	misconceptions: string[];
	evidence: EvidenceCounts;
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
	createdAt: string;
}

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
	};
}
