import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEvidence, recomputeConcept, refreshStatuses, strengthFor } from "../lib/mastery.ts";
import { dueReviews, retrievability, scheduleReview } from "../lib/review.ts";
import { defaultConcept, emptyReview, type EvidenceEvent } from "../lib/types.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");

function at(days: number): string {
	return new Date(T0 + days * DAY).toISOString();
}

function event(days: number, correct: boolean | null, partial: Partial<EvidenceEvent> = {}): EvidenceEvent {
	const type = partial.type ?? "application";
	return {
		id: `e${days}`,
		ts: at(days),
		concept: "closures",
		type,
		score: correct ? 1 : 0,
		strength: strengthFor(type),
		correct,
		source: "quiz",
		...partial,
	};
}

describe("spaced review schedule", () => {
	it("schedules the first review one to two days after the first success", () => {
		const state = scheduleReview(emptyReview(), event(0, true));
		assert.ok(state.stability >= 1.25 && state.stability <= 2);
		assert.equal(Date.parse(state.due!), T0 + state.stability * DAY);
	});

	it("grows the interval after a spaced success but not after massed practice", () => {
		const first = scheduleReview(emptyReview(), event(0, true));
		const massed = scheduleReview(first, event(0.1, true));
		assert.deepEqual(massed, first);
		const spaced = scheduleReview(first, event(first.stability, true));
		assert.ok(spaced.stability > first.stability * 2);
		assert.equal(spaced.reps, 2);
	});

	it("shortens the interval and counts a lapse after forgetting", () => {
		let state = scheduleReview(emptyReview(), event(0, true));
		state = scheduleReview(state, event(2, true));
		const before = state.stability;
		state = scheduleReview(state, event(20, false));
		assert.equal(state.lapses, 1);
		assert.ok(state.stability < before);
		assert.ok(state.stability >= 0.5);
	});

	it("ignores self-reports, ungraded items, and failures before any success", () => {
		const base = emptyReview();
		assert.deepEqual(scheduleReview(base, event(0, true, { source: "self_report" })), base);
		assert.deepEqual(scheduleReview(base, event(0, null)), base);
		assert.deepEqual(scheduleReview(base, event(0, false)), base);
	});

	it("predicts 90% recall when a review falls due", () => {
		const state = scheduleReview(emptyReview(), event(0, true));
		const r = retrievability(state, new Date(Date.parse(state.due!)));
		assert.ok(Math.abs(r! - 0.9) < 1e-9);
	});

	it("replays to the same schedule from the evidence log", () => {
		const base = defaultConcept({ id: "closures", name: "Closures" });
		const events = [event(0, true), event(3, true), event(30, false), event(31, true)];
		let streamed = base;
		for (const e of events) streamed = applyEvidence(streamed, e);
		assert.deepEqual(recomputeConcept(base, events).review, streamed.review);
	});

	it("lists only mastered concepts whose review date has passed", () => {
		const base = defaultConcept({ id: "closures", name: "Closures" });
		let mastered = base;
		for (const e of [event(0, true), event(2, true), event(6, true, { type: "transfer" })]) mastered = applyEvidence(mastered, e);
		const learning = applyEvidence(defaultConcept({ id: "scope", name: "Scope" }), { ...event(0, true, { type: "recognition" }), concept: "scope" });
		const concepts = refreshStatuses({ closures: mastered, scope: learning });
		assert.equal(concepts.closures.status, "mastered");
		const due = Date.parse(concepts.closures.review!.due!);
		assert.deepEqual(dueReviews(concepts, new Date(due - DAY)), []);
		const list = dueReviews(concepts, new Date(due + DAY));
		assert.deepEqual(list.map((r) => r.id), ["closures"]);
		assert.ok(list[0].retrievability < 0.9);
	});
});
