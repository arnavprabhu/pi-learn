/** Layout for the /map concept view: prerequisite order, depth, and markers. No TUI code here. */

import { computeFrontier, topoSort } from "./graph.ts";
import { isDue } from "./review.ts";
import type { Concept, ConceptStatus } from "./types.ts";

export interface MapRow {
	id: string;
	name: string;
	description?: string;
	depth: number;
	status: ConceptStatus;
	mastery: number;
	confidence: number;
	prerequisites: string[];
	isNext: boolean;
	due: boolean;
	reviewDue: string | null;
	openMisconceptions: string[];
	evidenceCount: number;
}

/** Rows in prerequisite order; depth is the longest prerequisite chain below the concept. */
export function buildMapRows(concepts: Record<string, Concept>, now: Date = new Date()): MapRow[] {
	let order: string[];
	try {
		order = topoSort(concepts);
	} catch {
		order = Object.keys(concepts).sort();
	}
	const depth = new Map<string, number>();
	for (const id of order) {
		const pres = concepts[id].prerequisites.filter((p) => concepts[p]);
		depth.set(id, pres.length ? Math.max(...pres.map((p) => (depth.get(p) ?? 0) + 1)) : 0);
	}
	const next = computeFrontier(concepts).next?.id ?? null;
	return order.map((id) => {
		const c = concepts[id];
		return {
			id,
			name: c.name,
			description: c.description,
			depth: depth.get(id) ?? 0,
			status: c.status,
			mastery: c.mastery,
			confidence: c.confidence,
			prerequisites: c.prerequisites,
			isNext: id === next,
			due: isDue(c, now),
			reviewDue: c.review && c.review.stability > 0 ? c.review.due : null,
			openMisconceptions: c.misconceptions,
			evidenceCount: c.evidenceCount,
		};
	});
}

export function masteryBar(mastery: number, width = 10): string {
	const filled = Math.round(Math.max(0, Math.min(1, mastery)) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Plain-text map for print mode and the transcript fallback. */
export function mapText(rows: MapRow[]): string {
	if (rows.length === 0) return "# Concept map\n(empty graph)";
	const lines = ["# Concept map", "▶ next  ↻ review due  ! open misconception", ""];
	for (const row of rows) {
		const marks = [row.isNext ? "▶" : " ", row.due ? "↻" : " ", row.openMisconceptions.length ? "!" : " "].join("");
		lines.push(`${marks} ${"  ".repeat(row.depth)}${row.name} (${row.id})  ${masteryBar(row.mastery)} ${row.mastery.toFixed(2)} ${row.status}`);
	}
	return lines.join("\n");
}
