import fs from "node:fs";
import path from "node:path";

export function readText(file: string): string | null {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
}

export function writeText(file: string, contents: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents, "utf8");
}

export function writeJson(file: string, value: unknown): void {
	writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(file: string): T | null {
	const text = readText(file);
	if (text === null || text.trim() === "") return null;
	return JSON.parse(text) as T;
}

export function appendLine(file: string, line: string): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`, "utf8");
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "topic";
}
