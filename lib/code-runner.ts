/**
 * Runs a learner's code answer against tutor-written tests.
 *
 * The learner's code and the tests are joined into one file in a fresh
 * temporary directory and run with a time limit. Exit code 0 means pass.
 * This is not a sandbox: it runs with the user's permissions, like any
 * code the user runs locally.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodeLanguage } from "./types.ts";

export const CODE_TIMEOUT_MS = 10_000;
const MAX_OUTPUT = 4000;

export interface CodeRunResult {
	status: "passed" | "failed" | "unavailable";
	timedOut: boolean;
	exitCode: number | null;
	output: string;
}

export function buildProgram(language: CodeLanguage, code: string, tests: string): string {
	const divider = language === "python" ? "# --- tests ---" : "// --- tests ---";
	return `${code.trimEnd()}\n\n${divider}\n${tests.trim()}\n`;
}

export function interpreterFor(language: CodeLanguage): { command: string; file: string } {
	if (language === "python") return { command: process.env.PI_TEACH_PYTHON || "python3", file: "answer.py" };
	return { command: process.execPath, file: "answer.mjs" };
}

export async function runCodeQuiz(input: {
	language: CodeLanguage;
	code: string;
	tests: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}): Promise<CodeRunResult> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-teach-code-"));
	const { command, file } = interpreterFor(input.language);
	const target = path.join(dir, file);
	fs.writeFileSync(target, buildProgram(input.language, input.code, input.tests), "utf8");

	try {
		return await new Promise<CodeRunResult>((resolve) => {
			let output = "";
			let timedOut = false;
			let settled = false;
			const finish = (result: CodeRunResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				input.signal?.removeEventListener("abort", onAbort);
				resolve(result);
			};

			const child = spawn(command, [target], {
				cwd: dir,
				env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", NODE_OPTIONS: "" },
				stdio: ["ignore", "pipe", "pipe"],
			});
			const collect = (chunk: Buffer) => {
				output += chunk.toString("utf8");
				if (output.length > MAX_OUTPUT * 2) output = output.slice(-MAX_OUTPUT);
			};
			child.stdout.on("data", collect);
			child.stderr.on("data", collect);

			const timer = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, input.timeoutMs ?? CODE_TIMEOUT_MS);
			const onAbort = () => child.kill("SIGKILL");
			input.signal?.addEventListener("abort", onAbort, { once: true });

			child.on("error", (error: NodeJS.ErrnoException) => {
				finish({
					status: error.code === "ENOENT" ? "unavailable" : "failed",
					timedOut: false,
					exitCode: null,
					output: error.message,
				});
			});
			child.on("close", (code) => {
				const clipped = output.length > MAX_OUTPUT ? output.slice(-MAX_OUTPUT) : output;
				finish({
					status: code === 0 && !timedOut ? "passed" : "failed",
					timedOut,
					exitCode: code,
					output: clipped.split(dir).join("."),
				});
			});
		});
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}
