/**
 * Misconceptions as first-class learner state, derived from evidence.jsonl.
 *
 * Lifecycle:
 *   open       recorded by a grade or by learner_record_evidence
 *   resolved   a later item targeting it was answered correctly
 *   confirmed  another correct targeted item at least 2 days after resolution
 *
 * Seeing the same misconception again reopens it. Open misconceptions and
 * resolved ones that are at least 2 days old are surfaced for re-checking.
 */

import { createHash } from "node:crypto";
import type { EvidenceEvent, MisconceptionRecord } from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
export const CONFIRM_AFTER_DAYS = 2;

export function normalizeMisconception(text: string): string {
	return text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ");
}

export function misconceptionId(concept: string, text: string): string {
	const hash = createHash("sha1").update(`${concept}|${normalizeMisconception(text)}`).digest("hex");
	return `m-${hash.slice(0, 6)}`;
}

/** Find a misconception by id, exact normalized text, or unambiguous substring. */
export function matchMisconception(
	records: MisconceptionRecord[],
	concept: string,
	ref: string,
): MisconceptionRecord | null {
	const trimmed = ref.trim();
	if (!trimmed) return null;
	const byId = records.find((r) => r.id === trimmed.toLowerCase());
	if (byId) return byId;
	const own = records.filter((r) => r.concept === concept);
	const normalized = normalizeMisconception(trimmed);
	const exact = own.find((r) => normalizeMisconception(r.text) === normalized);
	if (exact) return exact;
	if (normalized.length < 8) return null;
	const partial = own.filter((r) => {
		const text = normalizeMisconception(r.text);
		return text.includes(normalized) || normalized.includes(text);
	});
	return partial.length === 1 ? partial[0] : null;
}

export function deriveMisconceptions(events: EvidenceEvent[]): MisconceptionRecord[] {
	const records = new Map<string, MisconceptionRecord>();

	for (const event of events) {
		for (const text of event.misconceptions ?? []) {
			const clean = text.trim();
			if (!clean) continue;
			const id = misconceptionId(event.concept, clean);
			const existing = records.get(id);
			if (!existing) {
				records.set(id, {
					id,
					concept: event.concept,
					text: clean,
					status: "open",
					count: 1,
					firstSeen: event.ts,
					lastSeen: event.ts,
				});
				continue;
			}
			existing.count += 1;
			existing.lastSeen = event.ts;
			if (existing.status !== "open") {
				existing.status = "open";
				delete existing.resolvedAt;
				delete existing.confirmedAt;
			}
		}

		for (const ref of event.resolvedMisconceptions ?? []) {
			const record = matchMisconception([...records.values()], event.concept, ref);
			if (!record) continue;
			if (record.status === "open") {
				record.status = "resolved";
				record.resolvedAt = event.ts;
			} else if (
				record.status === "resolved" &&
				record.resolvedAt &&
				Date.parse(event.ts) - Date.parse(record.resolvedAt) >= CONFIRM_AFTER_DAYS * DAY_MS
			) {
				record.status = "confirmed";
				record.confirmedAt = event.ts;
			}
		}
	}

	return [...records.values()];
}

export function openMisconceptionTexts(records: MisconceptionRecord[], concept: string): string[] {
	return records.filter((r) => r.concept === concept && r.status === "open").map((r) => r.text);
}

/** Open misconceptions, then resolved ones old enough to confirm. Most-seen first. */
export function misconceptionsToRecheck(records: MisconceptionRecord[], now: Date = new Date()): MisconceptionRecord[] {
	const open = records.filter((r) => r.status === "open");
	const ripe = records.filter(
		(r) => r.status === "resolved" && r.resolvedAt && now.getTime() - Date.parse(r.resolvedAt) >= CONFIRM_AFTER_DAYS * DAY_MS,
	);
	const byWeight = (a: MisconceptionRecord, b: MisconceptionRecord) =>
		b.count - a.count || a.firstSeen.localeCompare(b.firstSeen);
	return [...open.sort(byWeight), ...ripe.sort(byWeight)];
}
