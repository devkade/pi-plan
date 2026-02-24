import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { selectPlanNextActionWithInlineNote } from "./plan-action-ui";
import {
	extractTodoItems,
	isSafeReadOnlyCommand,
	markCompletedSteps,
	normalizeArg,
	type TodoItem,
} from "./utils";

const STATUS_KEY = "pi-plan";
const TODO_WIDGET_KEY = "pi-plan-todos";

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

function getAssistantTextFromMessage(message: unknown): string {
	const candidate = message as {
		role?: unknown;
		content?: unknown;
	};

	if (candidate.role !== "assistant") {
		return "";
	}

	if (typeof candidate.content === "string") {
		return candidate.content;
	}

	if (!Array.isArray(candidate.content)) {
		return "";
	}

	return candidate.content
		.filter(
			(block): block is { type?: string; text?: string } =>
				typeof block === "object" &&
				block !== null &&
				(block as { type?: string }).type === "text" &&
				typeof (block as { text?: string }).text === "string",
		)
		.map((block) => block.text ?? "")
		.join("\n");
}

export default function planExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let restoreTools: string[] | null = null;
	let todoItems: TodoItem[] = [];

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

	const restoreNormalTools = (): void => {
		const toolsToRestore =
			restoreTools && restoreTools.length > 0
				? [...restoreTools]
				: [...getAllToolNames()];
		if (toolsToRestore.length > 0) {
			pi.setActiveTools(toolsToRestore);
		}
		restoreTools = null;
	};

	const updateTodoWidget = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) {
			return;
		}

		if (!executionMode || todoItems.length === 0) {
			ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
			return;
		}

		const lines = todoItems.map((item) => {
			if (item.completed) {
				return (
					ctx.ui.theme.fg("success", "☑ ") +
					ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
				);
			}
			return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
		});

		ctx.ui.setWidget(TODO_WIDGET_KEY, lines);
	};

	const setStatus = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) {
			return;
		}

		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((item) => item.completed).length;
			ctx.ui.setStatus(
				STATUS_KEY,
				ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`),
			);
			updateTodoWidget(ctx);
			return;
		}

		ctx.ui.setStatus(
			STATUS_KEY,
			planModeEnabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined,
		);
		updateTodoWidget(ctx);
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

		todoItems = [];
		executionMode = false;
		pi.setActiveTools(planTools);
		planModeEnabled = true;
		setStatus(ctx);
		notify(pi, ctx, `Plan mode enabled (read-only): ${planTools.join(", ")}`);
	};

	const exitPlanMode = (
		ctx: ExtensionContext,
		reason?: string,
		options: { resetProgress?: boolean } = {},
	): void => {
		if (!planModeEnabled) {
			if (reason) {
				notify(pi, ctx, reason);
			}
			if (options.resetProgress) {
				executionMode = false;
				todoItems = [];
				setStatus(ctx);
			}
			return;
		}

		planModeEnabled = false;
		restoreNormalTools();
		if (options.resetProgress) {
			executionMode = false;
			todoItems = [];
		}
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
					exitPlanMode(ctx, "Plan mode disabled. Back to YOLO mode.", {
						resetProgress: true,
					});
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
				exitPlanMode(ctx, "Plan mode disabled. Back to YOLO mode.", {
					resetProgress: true,
				});
				return;
			}

			if (["status", "state"].includes(command)) {
				notify(
					pi,
					ctx,
					planModeEnabled
						? "Plan mode: ON (read-only planning)"
						: executionMode
							? "Plan mode: OFF (executing approved plan)"
							: "Plan mode: OFF (default YOLO mode)",
				);
				return;
			}

			if (!planModeEnabled) {
				enterPlanMode(ctx);
			}

			pi.sendUserMessage(raw);
		},
	});

	pi.registerCommand("todos", {
		description: "Show current plan execution progress",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				notify(
					pi,
					ctx,
					"No tracked plan steps. Create a plan in /plan mode first.",
					"info",
				);
				return;
			}

			const completed = todoItems.filter((item) => item.completed).length;
			const progress = `${completed}/${todoItems.length}`;
			const list = todoItems
				.map((item) => `${item.step}. ${item.completed ? "✓" : "○"} ${item.text}`)
				.join("\n");
			notify(pi, ctx, `Plan progress ${progress}\n${list}`, "info");
		},
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) {
			return;
		}

		if (WRITE_LIKE_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason:
					"Plan mode is read-only. Approve execution first (choose 'Approve and execute now').",
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

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems
				.filter((item) => !item.completed)
				.map((item) => `${item.step}. ${item.text}`)
				.join("\n");
			const executionPrompt = remaining
				? `[APPROVED PLAN EXECUTION]\nComplete the remaining steps in order:\n${remaining}\n\nAfter each completed step, include a [DONE:n] marker.`
				: "[APPROVED PLAN EXECUTION]\nFinish implementation and verify results.";

			return {
				systemPrompt: `${event.systemPrompt}\n\n${YOLO_MODE_SYSTEM_PROMPT}\n\n${executionPrompt}`,
			};
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${YOLO_MODE_SYSTEM_PROMPT}`,
		};
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) {
			return;
		}

		const text = getAssistantTextFromMessage(event.message);
		if (!text) {
			return;
		}

		const completedCount = markCompletedSteps(text, todoItems);
		if (completedCount > 0) {
			setStatus(ctx);
		}

		if (todoItems.every((item) => item.completed)) {
			executionMode = false;
			setStatus(ctx);
			notify(pi, ctx, "All tracked plan steps are complete.", "info");
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!planModeEnabled || !ctx.hasUI) {
			return;
		}

		const lastAssistantText = [...event.messages]
			.reverse()
			.map(getAssistantTextFromMessage)
			.find((text) => text.length > 0);

		if (lastAssistantText) {
			const extracted = extractTodoItems(lastAssistantText);
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}
		setStatus(ctx);

		const selection = await selectPlanNextActionWithInlineNote(ctx.ui);
		if (selection.cancelled || !selection.action) {
			return;
		}

		if (selection.action === "approve") {
			executionMode = todoItems.length > 0;
			exitPlanMode(ctx, "Plan approved. Entering YOLO mode for execution.");

			const firstOpenStep = todoItems.find((item) => !item.completed);
			if (firstOpenStep) {
				pi.sendUserMessage(
					`${EXECUTION_TRIGGER_PROMPT} Start with step ${firstOpenStep.step}: ${firstOpenStep.text}`,
				);
			} else {
				pi.sendUserMessage(EXECUTION_TRIGGER_PROMPT);
			}
			return;
		}

		if (selection.action === "regenerate") {
			todoItems = [];
			setStatus(ctx);
			pi.sendUserMessage(
				"Regenerate the full plan from scratch. Re-check context and provide a refreshed Plan: section.",
			);
			return;
		}

		if (selection.action === "continue") {
			const continueNote = selection.continueNote?.trim() ?? "";
			if (continueNote.length === 0) {
				notify(
					pi,
					ctx,
					"Please enter the requested modifications, then send your message to continue planning. Waiting for your input.",
					"info",
				);
				return;
			}

			const firstOpenStep = todoItems.find((item) => !item.completed);
			if (firstOpenStep) {
				pi.sendUserMessage(
					`Continue planning from the proposed plan. User note: ${continueNote}. Focus on step ${firstOpenStep.step}: ${firstOpenStep.text}. Refine files, validation, and risks in read-only mode.`,
				);
			} else {
				pi.sendUserMessage(
					`Continue planning from the proposed plan. User note: ${continueNote}. Refine implementation details without regenerating the full plan.`,
				);
			}
			return;
		}

		if (selection.action === "exit") {
			exitPlanMode(ctx, "Exited plan mode without execution.", {
				resetProgress: true,
			});
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		setStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		executionMode = false;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
		}
	});
}
