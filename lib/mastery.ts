/**
 * Transparent V1 mastery heuristic.
 *
 * This is intentionally simple and replaceable. `evidence.jsonl` is the
 * source of truth; `concepts.json` is a derived cache.
 *
 * Evidence strength (how much one item can move mastery):
 *   recognition / MCQ     0.25  weak — recognition is not recall
 *   recall                0.50  medium
 *   explanation           0.65  medium/strong
 *   application           0.85  strong
 *   transfer              1.00  very strong
 *
 * Update:
 *   signed   = (score - 0.5) * 2          // -1 wrong, +1 perfect
 *   delta    = signed * strength * (1 - 0.35 * mastery)
 *   mastery  = clip(mastery + delta, 0, 1)
 *
 * The (1 - 0.35 * mastery) term shrinks gains as mastery rises so a
 * single lucky MCQ cannot push a concept to "mastered".
 *
 * Confidence grows with both count and strength of evidence, and drops
 * slightly on contradictions (a miss after several hits).
 *
 * Status:
 *   mastered if mastery >= 0.70 (confidence is shown but does not block routing)
 *   blocked  if a prerequisite is below the prereq threshold
 *   learning if evidence exists but not mastered
 *   probing  if we have asked but have little evidence
 *   unknown  otherwise
 */

import type { Concept, ConceptStatus, EvidenceEvent, EvidenceType } from "./types.ts";
import { emptyEvidenceCounts } from "./types.ts";

export const EVIDENCE_STRENGTH: Record<EvidenceType, number> = {
	recognition: 0.25,
	recall: 0.5,
	explanation: 0.65,
	application: 0.85,
	transfer: 1.0,
};

export const MASTERY_THRESHOLD = 0.7;
export const CONFIDENCE_THRESHOLD = 0.45;
export const PREREQ_THRESHOLD = 0.65;
export const PRIOR_MASTERY = 0.25;
export const PRIOR_CONFIDENCE = 0.15;

export function strengthFor(type: EvidenceType): number {
	return EVIDENCE_STRENGTH[type];
}

export function clamp01(n: number): number {
	if (Number.isNaN(n)) return 0;
	return Math.min(1, Math.max(0, n));
}

export function applyEvidence(concept: Concept, event: EvidenceEvent): Concept {
	const signed = (clamp01(event.score) - 0.5) * 2;
	const delta = signed * event.strength * (1 - 0.35 * concept.mastery);
	const mastery = clamp01(concept.mastery + delta);

	const n = concept.evidenceCount + 1;
	let confidence = clamp01(1 - Math.exp(-(n * (0.35 + event.strength)) / 3.2));
	if (event.correct === false && concept.evidence.correct > concept.evidence.incorrect) {
		confidence = clamp01(confidence - 0.08);
	}

	const evidence = { ...concept.evidence };
	if (event.correct === true) evidence.correct += 1;
	if (event.correct === false) evidence.incorrect += 1;
	evidence[event.type] += 1;

	const misconceptions = mergeMisconceptions(concept.misconceptions, event.misconceptions);

	const next: Concept = {
		...concept,
		mastery,
		confidence,
		evidenceCount: n,
		lastReviewed: event.ts,
		evidence,
		misconceptions,
		status: concept.status === "blocked" ? "blocked" : "learning",
	};
	return next;
}

export function recomputeConcept(base: Concept, events: EvidenceEvent[]): Concept {
	let current: Concept = {
		...base,
		mastery: PRIOR_MASTERY,
		confidence: PRIOR_CONFIDENCE,
		evidenceCount: 0,
		evidence: emptyEvidenceCounts(),
		misconceptions: [],
		lastReviewed: null,
		status: "unknown",
	};

	for (const event of events.filter((e) => e.concept === base.id)) {
		current = applyEvidence(current, event);
	}
	return current;
}

export function deriveStatus(
	concept: Concept,
	concepts: Record<string, Concept>,
): ConceptStatus {
	const prereqs = concept.prerequisites
		.map((id) => concepts[id])
		.filter((c): c is Concept => Boolean(c));
	const missingPrereq = prereqs.some(
		(p) => p.mastery < PREREQ_THRESHOLD || p.status === "blocked",
	);
	if (missingPrereq && concept.mastery < MASTERY_THRESHOLD) return "blocked";
	if (concept.mastery >= MASTERY_THRESHOLD) {
		return "mastered";
	}
	if (concept.evidenceCount === 0) return "unknown";
	if (concept.evidenceCount <= 1 && concept.confidence < 0.35) return "probing";
	return "learning";
}

export function refreshStatuses(concepts: Record<string, Concept>): Record<string, Concept> {
	const next: Record<string, Concept> = {};
	for (const [id, concept] of Object.entries(concepts)) {
		next[id] = { ...concept };
	}
	// Two passes so blocked status can propagate along short chains.
	for (let pass = 0; pass < 2; pass++) {
		for (const [id, concept] of Object.entries(next)) {
			next[id] = { ...concept, status: deriveStatus(concept, next) };
		}
	}
	return next;
}

function mergeMisconceptions(existing: string[], incoming?: string[]): string[] {
	if (!incoming || incoming.length === 0) return existing;
	const seen = new Set(existing.map((m) => m.toLowerCase()));
	const out = [...existing];
	for (const item of incoming) {
		const key = item.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(item.trim());
	}
	return out.slice(-12);
}
