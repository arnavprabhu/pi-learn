import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { compactKnowledgeText, searchKnowledge, syncKnowledge } from "../lib/knowledge.ts";
import { projectPaths } from "../lib/paths.ts";
import { resetLearner } from "../lib/reset.ts";
import { makeTempProject, rmrf } from "./helpers.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmrf(root);
});

function project() {
	const root = makeTempProject();
	roots.push(root);
	return { root, paths: projectPaths(root) };
}

function simplePdf(text: string): Buffer {
	const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, "\\$&")}) Tj\nET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
	].map((body, index) => `${index + 1} 0 obj\n${body}\nendobj\n`);
	const header = "%PDF-1.4\n";
	const offsets: number[] = [];
	let offset = Buffer.byteLength(header);
	for (const object of objects) {
		offsets.push(offset);
		offset += Buffer.byteLength(object);
	}
	const xref = [
		`xref\n0 ${objects.length + 1}`,
		"0000000000 65535 f ",
		...offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n `),
	].join("\n");
	const trailer = `\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
	return Buffer.from(header + objects.join("") + xref + trailer, "ascii");
}

describe("knowledge sources", () => {
	it("does nothing when the folder has no sources", async () => {
		const { paths } = project();
		fs.writeFileSync(path.join(paths.knowledge, "README.md"), "# Knowledge\n", "utf8");
		const index = await syncKnowledge(paths);
		assert.equal(index.documents.length, 0);
		assert.equal(compactKnowledgeText(index), "# Knowledge\nSources: none");
		assert.equal(fs.existsSync(paths.knowledgeIndex), true);
	});

	it("indexes text and retrieves focused passages across reloads", async () => {
		const { paths } = project();
		fs.writeFileSync(
			path.join(paths.knowledge, "calculus-notes.md"),
			"# Riemann sums\n\nA partition divides an interval. Rectangle areas approximate the definite integral.",
			"utf8",
		);

		const first = await syncKnowledge(paths);
		assert.equal(first.documents[0].status, "ready");
		assert.equal(first.documents[0].path, "calculus-notes.md");
		assert.equal(searchKnowledge(paths, first, "rectangle definite integral").length, 1);

		const reloaded = await syncKnowledge(paths);
		assert.equal(reloaded.updatedAt, first.updatedAt);
		const matches = searchKnowledge(paths, reloaded, "partition");
		assert.equal(matches[0].path, "calculus-notes.md");
		assert.match(matches[0].excerpt, /partition divides an interval/);
	});

	it("refreshes changed files and reports unsupported files", async () => {
		const { paths } = project();
		const note = path.join(paths.knowledge, "notes.txt");
		fs.writeFileSync(note, "limits and continuity", "utf8");
		const first = await syncKnowledge(paths);
		fs.writeFileSync(note, "derivatives and tangent lines", "utf8");
		fs.writeFileSync(path.join(paths.knowledge, "slides.pptx"), "not a real deck", "utf8");

		const second = await syncKnowledge(paths);
		assert.notEqual(second.documents.find((doc) => doc.path === "notes.txt")?.hash, first.documents[0].hash);
		assert.equal(searchKnowledge(paths, second, "continuity").length, 0);
		assert.match(searchKnowledge(paths, second, "tangent")[0].excerpt, /tangent lines/);
		assert.equal(second.documents.find((doc) => doc.path === "slides.pptx")?.status, "unsupported");
	});

	it("extracts searchable text from a local PDF", async () => {
		const { paths } = project();
		fs.writeFileSync(path.join(paths.knowledge, "textbook.pdf"), simplePdf("Riemann sums use rectangles"));
		const index = await syncKnowledge(paths);
		assert.equal(index.documents[0].status, "ready");
		assert.equal(index.documents[0].pages, 1);
		const matches = searchKnowledge(paths, index, "Riemann rectangles");
		assert.equal(matches[0].path, "textbook.pdf");
		assert.equal(matches[0].page, 1);
		assert.match(matches[0].excerpt, /Riemann sums use rectangles/);
	});

	it("keeps knowledge sources and cache during a learner reset", async () => {
		const { paths } = project();
		const source = path.join(paths.knowledge, "course.md");
		fs.writeFileSync(source, "Course context survives learner resets.", "utf8");
		await syncKnowledge(paths);
		resetLearner(paths, { kind: "all" });
		assert.equal(fs.existsSync(source), true);
		assert.equal(fs.existsSync(paths.knowledgeIndex), true);
		const reloaded = await syncKnowledge(paths);
		assert.equal(searchKnowledge(paths, reloaded, "survives").length, 1);
	});
});
