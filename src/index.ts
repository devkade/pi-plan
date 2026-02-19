import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isSafeReadOnlyCommand, normalizeArg } from "./utils";

const STATUS_KEY = "pi-plan";

const PLAN_TOOL_CANDIDATES = [
	"read",
	"bash",
	"grep",
	"find",
	"ls",
	"lsp",
	"ast_search",
	"web_search",
	"fetch_content",
	"get_search_content",
] as const;

const WRITE_LIKE_TOOLS = new Set(["edit", "write", "ast_rewrite"]);

const PLAN_MODE_SYSTEM_PROMPT = `
[PLAN MODE ACTIVE - READ ONLY]
You are in planning mode.

Hard rules:
- Allowed actions: inspection, analysis, and plan creation only.
- Never perform any write/change action.
- Never use edit/write or mutating shell commands.

MANDATORY workflow:
1) Context gathering first
   - Inspect relevant files/symbols/config/tests before proposing a plan.
   - If external dependency behavior matters, gather official docs/reference evidence.
   - No evidence-free planning.
2) Requirement clarification
   - List uncertainties/assumptions explicitly.
   - If there is a blocking ambiguity, ask concise clarifying question(s) before finalizing.
3) Plan design
   - Build a concrete execution plan grounded in gathered evidence.

Output contract (use this structure):
1) Goal understanding (brief)
2) Evidence gathered
   - files/paths/symbols/docs checked
3) Uncertainties / assumptions
4) Plan:
   1. step objective
   2. target files/components
   3. validation method
5) Risks and rollback notes
6) End with: "Ready to execute when approved."
`.trim();

const YOLO_MODE_SYSTEM_PROMPT = `
[DEFAULT MODE: YOLO]
- Execute tasks directly unless the user explicitly asks for planning.
- Do NOT force a plan/approval gate in normal mode.
- The read-only plan/approval flow is only active when /plan mode is enabled.
`.trim();

const EXECUTION_TRIGGER_PROMPT =
	"Plan approved. Switch to implementation mode and execute the latest plan now.";

function notify(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, type);
		return;
	}

	pi.sendMessage({
		customType: "plan-mode-status",
		content: message,
		display: true,
	});
}

export default function planExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let restoreTools: string[] | null = null;

	const getAllToolNames = (): string[] => pi.getAllTools().map((tool) => tool.name);

	const getPlanTools = (): string[] => {
		const available = new Set(getAllToolNames());
		const planTools = PLAN_TOOL_CANDIDATES.filter((tool) => available.has(tool));
		if (planTools.length > 0) {
			return [...planTools];
		}

		const fallback = pi.getActiveTools().filter((tool) => !WRITE_LIKE_TOOLS.has(tool));
		return [...new Set(fallback)];
	};

	const setStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(
			STATUS_KEY,
			planModeEnabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined,
		);
	};

	const enterPlanMode = (ctx: ExtensionContext): void => {
		if (planModeEnabled) {
			notify(pi, ctx, "Plan mode is already enabled.");
			return;
		}

		const currentTools = pi.getActiveTools();
		restoreTools = currentTools.length > 0 ? [...currentTools] : null;

		const planTools = getPlanTools();
		if (planTools.length === 0) {
			notify(pi, ctx, "No read-only tool set could be resolved.", "error");
			return;
		}

		pi.setActiveTools(planTools);
		planModeEnabled = true;
		setStatus(ctx);
		notify(pi, ctx, `Plan mode enabled (read-only): ${planTools.join(", ")}`);
	};

	const exitPlanMode = (ctx: ExtensionContext, reason?: string): void => {
		if (!planModeEnabled) {
			if (reason) {
				notify(pi, ctx, reason);
			}
			return;
		}

		planModeEnabled = false;
		const toolsToRestore =
			restoreTools && restoreTools.length > 0 ? [...restoreTools] : [...getAllToolNames()];
		if (toolsToRestore.length > 0) {
			pi.setActiveTools(toolsToRestore);
		}
		restoreTools = null;

		setStatus(ctx);
		if (reason) {
			notify(pi, ctx, reason);
		}
	};

	pi.registerCommand("plan", {
		description:
			"Enable read-only planning mode. Usage: /plan, /plan on, /plan off, /plan status, /plan <task>",
		handler: async (args, ctx) => {
			const raw = args.trim();

			if (raw.length === 0) {
				if (planModeEnabled) {
					exitPlanMode(ctx, "Plan mode disabled. Back to YOLO mode.");
				} else {
					enterPlanMode(ctx);
				}
				return;
			}

			const command = normalizeArg(raw);
			if (["on", "enable", "start"].includes(command)) {
				enterPlanMode(ctx);
				return;
			}

			if (["off", "disable", "stop", "exit"].includes(command)) {
				exitPlanMode(ctx, "Plan mode disabled. Back to YOLO mode.");
				return;
			}

			if (["status", "state"].includes(command)) {
				notify(
					pi,
					ctx,
					planModeEnabled ? "Plan mode: ON (read-only planning)" : "Plan mode: OFF (default YOLO mode)",
				);
				return;
			}

			if (!planModeEnabled) {
				enterPlanMode(ctx);
			}

			pi.sendUserMessage(raw);
		},
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;

		if (WRITE_LIKE_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason: "Plan mode is read-only. Approve execution first (choose 'Approve and execute now').",
			};
		}

		if (event.toolName === "bash") {
			const input = event.input as { command?: unknown };
			const command = typeof input.command === "string" ? input.command : "";
			if (!isSafeReadOnlyCommand(command)) {
				return {
					block: true,
					reason: `Plan mode blocked a potentially mutating bash command: ${command}`,
				};
			}
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (planModeEnabled) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`,
			};
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${YOLO_MODE_SYSTEM_PROMPT}`,
		};
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!planModeEnabled || !ctx.hasUI) return;

		const choice = await ctx.ui.select("Plan mode: next action", [
			"Approve and execute now",
			"Keep planning (read-only)",
			"Exit plan mode",
		]);

		if (choice === "Approve and execute now") {
			exitPlanMode(ctx, "Plan approved. Entering YOLO mode for execution.");
			pi.sendUserMessage(EXECUTION_TRIGGER_PROMPT);
			return;
		}

		if (choice === "Exit plan mode") {
			exitPlanMode(ctx, "Exited plan mode without execution.");
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		setStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	});
}
