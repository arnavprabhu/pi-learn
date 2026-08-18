/**
 * Isolated researcher / verifier fallback.
 *
 * Prefer the globally installed `pi-subagents` `subagent` tool for researcher
 * work (it can use pi-web-access). This tool is a one-shot completion with
 * NO tutor transcript — used by quiz for verifier, and as a fallback if
 * subagent is not loaded.
 *
 * Agents are loaded only from <project>/.pi/agents/*.md
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readText } from "../../lib/fs.ts";
import { loadAgent } from "../../lib/agents.ts";
import { projectPaths } from "../../lib/paths.ts";

const MAX_FINDINGS = 4000;

export default function agentsExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "run_agent",
		label: "Run agent",
		description:
			"Lightweight isolated completion using .pi/agents/{researcher,verifier}.md with no tutor chat history. Prefer the subagent tool with agentScope=project for researcher (web search). Quiz already runs verifier internally.",
		parameters: Type.Object({
			agent: Type.Union([Type.Literal("researcher"), Type.Literal("verifier")]),
			task: Type.String({
				description: "Instructions and payload. The agent cannot see the tutor transcript.",
			}),
			files: Type.Optional(
				Type.Array(Type.String(), {
					description: "Optional project-relative files to attach as excerpts.",
				}),
			),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (!ctx.model) {
				return {
					content: [{ type: "text" as const, text: "No model selected; cannot run isolated agent." }],
					details: { agent: params.agent, error: "no_model" },
					isError: true,
				};
			}

			const paths = projectPaths(ctx.cwd);
			const def = loadAgent(paths, params.agent);
			const excerpts: string[] = [];
			for (const rel of params.files ?? []) {
				const abs = rel.startsWith("/") ? rel : `${ctx.cwd}/${rel}`;
				if (!abs.startsWith(ctx.cwd)) continue;
				const body = readText(abs);
				if (body) excerpts.push(`### ${rel}\n${body.slice(0, 8000)}`);
			}

			const user = excerpts.length
				? `${params.task}\n\n---\nAttached files:\n\n${excerpts.join("\n\n")}`
				: params.task;

			const response = await ctx.modelRegistry.complete(
				ctx.model,
				{
					systemPrompt: def.body,
					messages: [
						{
							role: "user",
							content: [{ type: "text", text: user }],
							timestamp: Date.now(),
						},
					],
				},
				{ signal },
			);

			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();

			const clipped = text.length > MAX_FINDINGS ? `${text.slice(0, MAX_FINDINGS)}\n…[truncated]` : text;
			const header = params.agent === "researcher"
				? "Researcher findings (isolated; not raw notes):\n\n"
				: "Verifier result (isolated):\n\n";

			return {
				content: [{ type: "text" as const, text: header + clipped }],
				details: { agent: params.agent, chars: clipped.length },
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("agent ")) + theme.fg("accent", String(args.agent ?? "")),
				0,
				0,
			);
		},
		renderResult(result, _opts, theme) {
			const details = result.details as { agent?: string } | undefined;
			return new Text(
				theme.fg("success", "✓ ") + theme.fg("muted", details?.agent ?? "agent"),
				0,
				0,
			);
		},
	});
}
