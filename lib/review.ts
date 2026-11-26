/**
 * Spaced review schedule, derived from graded evidence.
 *
 * Each concept keeps a stability S: the number of days after a successful
 * recall at which predicted recall drops to 90%. Predicted recall after t
 * days uses the FSRS power curve:
 *
 *   R(t) = (1 + t / (9 * S)) ^ -1        so R(S) = 0.9
 *
 * Update (only graded quiz, probe, and conversation evidence; self-reports
 * and ungraded items do not move the schedule):
 *
 *   first success      S = 1 + strength                 (1.25 to 2 days)
 *   spaced success     S = S * (1.5 + 1.5 * strength)   when at least half of S has elapsed
 *   massed success     no change; reviewing early does not earn a longer interval
 *   failure            S = max(0.5, S * 0.3), lapses += 1   (only after a first success)
 *
 *   due = last schedule change + S days, S capped at 365.
 *
 * A concept is due for review when it is mastered and its due date has passed.
 * Concepts still being learned are handled by the frontier instead.
 */

import type { Concept, DueReview, EvidenceEvent, ReviewState } from "./types.ts";
import { emptyReview } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_STABILITY_DAYS = 365;
export const MIN_LAPSE_STABILITY_DAYS = 0.5;

export function scheduleReview(state: ReviewState | undefined, event: EvidenceEvent): ReviewState {
	const current = state ?? emptyReview();
	if (event.source === "self_report" || event.correct === null) return current;
	const at = Date.parse(event.ts);
	if (Number.isNaN(at)) return current;

	if (event.correct === true) {
		if (current.stability === 0) {
			return withDue({ ...current, stability: 1 + event.strength, reps: 1 }, at);
		}
		const elapsed = current.lastReview ? (at - Date.parse(current.lastReview)) / DAY_MS : Infinity;
		if (elapsed < current.stability / 2) return current;
		const stability = Math.min(MAX_STABILITY_DAYS, current.stability * (1.5 + 1.5 * event.strength));
		return withDue({ ...current, stability, reps: current.reps + 1 }, at);
	}

	if (current.stability === 0) return current;
	const stability = Math.max(MIN_LAPSE_STABILITY_DAYS, current.stability * 0.3);
	return withDue({ ...current, stability, lapses: current.lapses + 1 }, at);
}

function withDue(state: ReviewState, at: number): ReviewState {
	return {
		...state,
		lastReview: new Date(at).toISOString(),
		due: new Date(at + state.stability * DAY_MS).toISOString(),
	};
}

/** Predicted probability of recall now, or null when the concept was never recalled. */
export function retrievability(state: ReviewState | undefined, now: Date = new Date()): number | null {
	if (!state || state.stability === 0 || !state.lastReview) return null;
	const elapsedDays = Math.max(0, (now.getTime() - Date.parse(state.lastReview)) / DAY_MS);
	return 1 / (1 + elapsedDays / (9 * state.stability));
}

export function isDue(concept: Concept, now: Date = new Date()): boolean {
	const review = concept.review;
	if (concept.status !== "mastered" || !review?.due || review.stability === 0) return false;
	return Date.parse(review.due) <= now.getTime();
}

/** Mastered concepts whose review date has passed, most forgotten first. */
export function dueReviews(concepts: Record<string, Concept> | Concept[], now: Date = new Date(), limit?: number): DueReview[] {
	const list = Array.isArray(concepts) ? concepts : Object.values(concepts);
	const due = list
		.filter((concept) => isDue(concept, now))
		.map((concept) => ({
			id: concept.id,
			name: concept.name,
			due: concept.review!.due!,
			overdueDays: (now.getTime() - Date.parse(concept.review!.due!)) / DAY_MS,
			retrievability: retrievability(concept.review, now) ?? 0,
		}))
		.sort((a, b) => a.retrievability - b.retrievability || a.id.localeCompare(b.id));
	return limit === undefined ? due : due.slice(0, limit);
}

/** Next scheduled review among mastered concepts, for "nothing due" messages. */
export function nextReview(concepts: Record<string, Concept> | Concept[], now: Date = new Date()): DueReview | null {
	const list = Array.isArray(concepts) ? concepts : Object.values(concepts);
	const upcoming = list
		.filter((c) => c.status === "mastered" && c.review?.due && c.review.stability > 0 && Date.parse(c.review.due) > now.getTime())
		.sort((a, b) => Date.parse(a.review!.due!) - Date.parse(b.review!.due!));
	const concept = upcoming[0];
	if (!concept) return null;
	return {
		id: concept.id,
		name: concept.name,
		due: concept.review!.due!,
		overdueDays: (now.getTime() - Date.parse(concept.review!.due!)) / DAY_MS,
		retrievability: retrievability(concept.review, now) ?? 0,
	};
}

export function formatDays(days: number): string {
	const abs = Math.abs(days);
	if (abs < 1 / 24) return "now";
	if (abs < 1) return `${Math.round(abs * 24)}h`;
	return `${Math.round(abs)}d`;
}
