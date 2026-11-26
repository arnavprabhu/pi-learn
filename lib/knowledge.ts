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

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const STOPWORDS = new Set(
	"a an and are as at be but by for from has have how i if in into is it its of on or so that the their then there these this to was what when where which while who why will with you your".split(" "),
);

interface IndexedChunk {
	path: string;
	page?: number;
	excerpt: string;
	lower: string;
	terms: Map<string, number>;
	length: number;
	pathTerms: Set<string>;
}

/** Chunked, tokenized documents, cached per content hash for the life of the process. */
const chunkCache = new Map<string, IndexedChunk[]>();

/** Lowercase word tokens with light plural folding, so "rectangles" matches "rectangle". */
export function tokenize(text: string): string[] {
	const out: string[] = [];
	for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+(?:[+#]{1,2})?/gu) ?? []) {
		if (raw.length < 2 && !/\d/.test(raw)) continue;
		if (STOPWORDS.has(raw)) continue;
		out.push(stem(raw));
	}
	return out;
}

function stem(word: string): string {
	if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
	if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
	if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
	return word;
}

function indexDocument(paths: ProjectPaths, document: KnowledgeDocument): IndexedChunk[] {
	if (!document.hash) return [];
	const cached = chunkCache.get(document.hash);
	if (cached && cached[0]?.path === document.path) return cached;
	const cache = readJson<CachedKnowledge>(knowledgeCacheFile(paths, document.hash));
	if (!cache || cache.hash !== document.hash) return [];
	const pathTerms = new Set(tokenize(document.path.replace(/[/_.-]+/g, " ")));
	const chunks: IndexedChunk[] = [];
	for (let pageIndex = 0; pageIndex < cache.pages.length; pageIndex++) {
		for (const excerpt of chunkText(cache.pages[pageIndex])) {
			const tokens = tokenize(excerpt);
			const terms = new Map<string, number>();
			for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
			chunks.push({
				path: document.path,
				page: document.kind === "pdf" ? pageIndex + 1 : undefined,
				excerpt,
				lower: excerpt.toLowerCase().replace(/\s+/g, " "),
				terms,
				length: tokens.length,
				pathTerms,
			});
		}
	}
	chunkCache.set(document.hash, chunks);
	return chunks;
}

/**
 * Rank passages with Okapi BM25 (k1=1.2, b=0.75) over all chunks of ready
 * sources, plus a bonus when the whole query appears as a phrase and a small
 * bonus for query terms in the file path.
 */
export function searchKnowledge(
	paths: ProjectPaths,
	index: KnowledgeIndex,
	query: string,
	limit = 5,
): KnowledgeMatch[] {
	const max = Math.max(1, Math.min(limit, 8));
	const chunks = index.documents
		.filter((document) => document.status === "ready")
		.flatMap((document) => indexDocument(paths, document));
	if (chunks.length === 0) return [];

	const queryTerms = Array.from(new Set(tokenize(query)));
	if (queryTerms.length === 0) {
		return chunks.slice(0, max).map((chunk) => ({ path: chunk.path, page: chunk.page, score: 0, excerpt: chunk.excerpt }));
	}

	const total = chunks.length;
	const avgLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0) / total || 1;
	const idf = new Map<string, number>();
	for (const term of queryTerms) {
		const df = chunks.reduce((n, chunk) => n + (chunk.terms.has(term) ? 1 : 0), 0);
		idf.set(term, Math.log(1 + (total - df + 0.5) / (df + 0.5)));
	}
	const phrase = query.trim().toLowerCase().replace(/\s+/g, " ");
	const idfSum = [...idf.values()].reduce((a, b) => a + b, 0);

	const matches: KnowledgeMatch[] = [];
	for (const chunk of chunks) {
		let score = 0;
		let matched = 0;
		for (const term of queryTerms) {
			const tf = chunk.terms.get(term) ?? 0;
			if (tf > 0) {
				matched += 1;
				const norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / avgLength));
				score += idf.get(term)! * ((tf * (BM25_K1 + 1)) / norm);
			}
			if (chunk.pathTerms.has(term)) score += 0.25 * idf.get(term)!;
		}
		if (matched === 0) continue;
		if (queryTerms.length > 1 && phrase.length > 3 && chunk.lower.includes(phrase)) score += 0.5 * idfSum;
		matches.push({ path: chunk.path, page: chunk.page, score, excerpt: chunk.excerpt });
	}

	return matches
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || (a.page ?? 0) - (b.page ?? 0))
		.slice(0, max);
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

