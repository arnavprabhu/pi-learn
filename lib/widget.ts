import { projectPaths } from "./paths.ts";
import { loadSnapshot } from "./snapshot.ts";

interface WidgetContext {
	cwd: string;
	ui: {
		setWidget: (id: string, lines: string[] | undefined) => void;
	};
}

/** Keep the tutoring footer aligned with file-backed state. */
export function refreshTeachWidget(ctx: WidgetContext): void {
	try {
		const { snapshot } = loadSnapshot(projectPaths(ctx.cwd), { recompute: false });
		const next = snapshot.frontier.next;
		if (!snapshot.mission && !next) {
			ctx.ui.setWidget("teach", undefined);
			return;
		}
		const goal = snapshot.mission?.goal ?? "no mission";
		const line = next ? `next: ${next.id}` : "no frontier";
		ctx.ui.setWidget("teach", [`teach  ${goal.slice(0, 60)}  ·  ${line}`]);
	} catch {
		ctx.ui.setWidget("teach", undefined);
	}
}
