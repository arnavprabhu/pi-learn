import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./fs.ts";
import type { ProjectPaths } from "./paths.ts";

const INDEX_VERSION = 1 as const;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 200;
const GUIDE_FILE = "README.md";

const TEXT_EXTENSIONS = new Set([
	".md",
	".mdx",
	".txt",
	".rst",
	".adoc",
	".html",
	".htm",
	".json",
	".jsonl",
	".csv",
	".tsv",
	".js",
	".jsx",
	".ts",
	".tsx",
	".py",
	".java",
	".c",
	".cc",
	".cpp",
	".h",
	".hpp",
	".rs",
	".go",
	".rb",
	".sh",
	".sql",
]);

export type KnowledgeStatus = "ready" | "empty" | "unsupported" | "error";

export interface KnowledgeDocument {
	path: string;
	kind: "text" | "pdf" | "unsupported";
	status: KnowledgeStatus;
	hash?: string;
	bytes: number;
	modifiedAt: string;
	chars?: number;
	pages?: number;
	error?: string;
}

export interface KnowledgeIndex {
	version: typeof INDEX_VERSION;
	updatedAt: string;
	documents: KnowledgeDocument[];
}

interface CachedKnowledge {
	version: typeof INDEX_VERSION;
	path: string;
	hash: string;
	pages: string[];
}

export interface KnowledgeMatch {
	path: string;
	page?: number;
	score: number;
	excerpt: string;
}

export async function syncKnowledge(paths: ProjectPaths): Promise<KnowledgeIndex> {
	fs.mkdirSync(paths.knowledge, { recursive: true });
	fs.mkdirSync(paths.knowledgeCache, { recursive: true });

	const previous = readJson<KnowledgeIndex>(paths.knowledgeIndex);
	const previousByPath = new Map((previous?.documents ?? []).map((doc) => [doc.path, doc]));
	const documents: KnowledgeDocument[] = [];

	for (const absolutePath of listKnowledgeFiles(paths.knowledge)) {
		const relativePath = path.relative(paths.knowledge, absolutePath).split(path.sep).join("/");
		if (relativePath === GUIDE_FILE) continue;

		const stat = fs.statSync(absolutePath);
		const modifiedAt = stat.mtime.toISOString();
		const kind = knowledgeKind(relativePath);
		if (kind === "unsupported") {
			documents.push({
				path: relativePath,
				kind,
				status: "unsupported",
				bytes: stat.size,
				modifiedAt,
				error: "Unsupported file type",
			});
			continue;
		}

		if (stat.size > MAX_FILE_BYTES) {
			documents.push({
				path: relativePath,
				kind,
				status: "error",
				bytes: stat.size,
				modifiedAt,
				error: "File exceeds the 50 MB local ingestion limit",
			});
			continue;
		}

		try {
			const buffer = fs.readFileSync(absolutePath);
			const hash = createHash("sha256").update(buffer).digest("hex");
			const cacheFile = knowledgeCacheFile(paths, hash);
			const old = previousByPath.get(relativePath);
			if (old?.hash === hash && fs.existsSync(cacheFile)) {
				documents.push({ ...old, bytes: stat.size, modifiedAt });
				continue;
			}

			const pages = kind === "pdf"
				? await extractPdfPages(buffer)
				: [normalizeText(buffer.toString("utf8"), kind, relativePath)];
			const chars = pages.reduce((sum, pageText) => sum + pageText.length, 0);
			const status: KnowledgeStatus = chars > 0 ? "ready" : "empty";
			const cache: CachedKnowledge = {
				version: INDEX_VERSION,
				path: relativePath,
				hash,
				pages,
			};
			writeJson(cacheFile, cache);
			documents.push({
				path: relativePath,
				kind,
				status,
				hash,
				bytes: stat.size,
				modifiedAt,
				chars,
				pages: kind === "pdf" ? pages.length : undefined,
			});
		} catch (error) {
			documents.push({
				path: relativePath,
				kind,
				status: "error",
				bytes: stat.size,
				modifiedAt,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	documents.sort((a, b) => a.path.localeCompare(b.path));
	if (previous && JSON.stringify(previous.documents) === JSON.stringify(documents)) return previous;

	const index: KnowledgeIndex = {
		version: INDEX_VERSION,
		updatedAt: new Date().toISOString(),
		documents,
	};
	writeJson(paths.knowledgeIndex, index);
	return index;
}

export function searchKnowledge(
	paths: ProjectPaths,
	index: KnowledgeIndex,
	query: string,
	limit = 5,
): KnowledgeMatch[] {
	const normalizedQuery = query.trim().toLowerCase();
	const terms = Array.from(new Set(normalizedQuery.match(/[\p{L}\p{N}+#.]{2,}/gu) ?? []));
	const matches: KnowledgeMatch[] = [];

	for (const document of index.documents) {
		if (document.status !== "ready" || !document.hash) continue;
		const cache = readJson<CachedKnowledge>(knowledgeCacheFile(paths, document.hash));
		if (!cache || cache.hash !== document.hash) continue;

		for (let pageIndex = 0; pageIndex < cache.pages.length; pageIndex++) {
			for (const excerpt of chunkText(cache.pages[pageIndex])) {
				const haystack = `${document.path}\n${excerpt}`.toLowerCase();
				let score = normalizedQuery ? 0 : 1;
				if (normalizedQuery && haystack.includes(normalizedQuery)) score += 8;
				for (const term of terms) score += countOccurrences(haystack, term);
				if (score === 0) continue;
				matches.push({
					path: document.path,
					page: document.kind === "pdf" ? pageIndex + 1 : undefined,
					score,
					excerpt,
				});
			}
		}
	}

	return matches
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || (a.page ?? 0) - (b.page ?? 0))
		.slice(0, Math.max(1, Math.min(limit, 8)));
}

export function compactKnowledgeText(index: KnowledgeIndex): string {
	if (index.documents.length === 0) return "# Knowledge\nSources: none";

	const ready = index.documents.filter((doc) => doc.status === "ready");
	const issues = index.documents.filter((doc) => doc.status === "error" || doc.status === "unsupported");
	const lines = ["# Knowledge", `Sources: ${ready.length} ready, ${issues.length} unavailable`];
	for (const document of index.documents.slice(0, 20)) {
		const detail = document.status === "ready"
			? `${document.kind}${document.pages ? `, ${document.pages} pages` : ""}`
			: `${document.status}: ${document.error ?? "no extractable text"}`;
		lines.push(`- ${document.path} (${detail})`);
	}
	if (index.documents.length > 20) lines.push(`- ${index.documents.length - 20} more source files`);
	return lines.join("\n");
}

function listKnowledgeFiles(root: string): string[] {
	const files: string[] = [];
	const visit = (directory: string) => {
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const absolutePath = path.join(directory, entry.name);
			if (entry.isDirectory()) visit(absolutePath);
			else if (entry.isFile()) files.push(absolutePath);
		}
	};
	visit(root);
	return files.sort();
}

function knowledgeKind(file: string): KnowledgeDocument["kind"] {
	const extension = path.extname(file).toLowerCase();
	if (extension === ".pdf") return "pdf";
	if (TEXT_EXTENSIONS.has(extension)) return "text";
	return "unsupported";
}

function knowledgeCacheFile(paths: ProjectPaths, hash: string): string {
	return path.join(paths.knowledgeCache, `${hash}.json`);
}

function normalizeText(text: string, kind: KnowledgeDocument["kind"], file: string): string {
	if (text.includes("\0")) throw new Error("File appears to be binary");
	let normalized = text.replace(/\r\n?/g, "\n");
	if (kind === "text" && [".html", ".htm"].includes(path.extname(file).toLowerCase())) {
		normalized = normalized
			.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
			.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
			.replace(/<[^>]+>/g, " ");
	}
	return normalized.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPdfPages(buffer: Buffer): Promise<string[]> {
	const promiseWithTry = Promise as unknown as {
		try?: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown>;
	};
	if (typeof promiseWithTry.try !== "function") {
		promiseWithTry.try = (callback, ...args) => new Promise((resolve) => resolve(callback(...args)));
	}
	const { extractText } = await import("unpdf");
	const result = await extractText(new Uint8Array(buffer), { mergePages: false });
	return result.text.map((pageText) => normalizeText(pageText, "pdf", "source.pdf"));
}

function chunkText(text: string): string[] {
	if (!text) return [];
	if (text.length <= CHUNK_CHARS) return [text];
	const chunks: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = Math.min(start + CHUNK_CHARS, text.length);
		if (end < text.length) {
			const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
			if (boundary > start + CHUNK_CHARS / 2) end = boundary;
		}
		chunks.push(text.slice(start, end).trim());
		if (end >= text.length) break;
		start = Math.max(start + 1, end - CHUNK_OVERLAP);
	}
	return chunks.filter(Boolean);
}

function countOccurrences(text: string, term: string): number {
	let count = 0;
	let offset = 0;
	while ((offset = text.indexOf(term, offset)) !== -1) {
		count += 1;
		offset += term.length;
	}
	return count;
}
