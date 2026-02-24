import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

export type PlanNextAction = "approve" | "continue" | "regenerate" | "exit";

export interface PlanNextActionResult {
	cancelled: boolean;
	action?: PlanNextAction;
	continueNote?: string;
}

const ACTION_OPTIONS: ReadonlyArray<{ label: string; value: PlanNextAction }> = [
	{ label: "Approve and execute now", value: "approve" },
	{ label: "Continue from proposed plan", value: "continue" },
	{ label: "Regenerate plan", value: "regenerate" },
	{ label: "Exit plan mode", value: "exit" },
];

const CONTINUE_OPTION_INDEX = ACTION_OPTIONS.findIndex((option) => option.value === "continue");

function normalizeContinueNote(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}

function buildContinueOptionLabel(
	baseLabel: string,
	note: string,
	isEditing: boolean,
	maxLength: number,
): string {
	const normalized = normalizeContinueNote(note);
	if (normalized.length === 0 && !isEditing) {
		return baseLabel;
	}

	const suffix = isEditing ? `${normalized}▍` : normalized;
	const inline = `${baseLabel} — note: ${suffix}`;
	if (inline.length <= maxLength) {
		return inline;
	}

	if (maxLength <= 1) {
		return "…";
	}
	return `${inline.slice(0, maxLength - 1)}…`;
}

export async function selectPlanNextActionWithInlineNote(
	ui: ExtensionUIContext,
): Promise<PlanNextActionResult> {
	return ui.custom<PlanNextActionResult>((tui, theme, _keybindings, done) => {
		let cursorIndex = 0;
		let isContinueNoteEditorOpen = false;
		let continueNote = "";
		let cachedRenderedLines: string[] | undefined;

		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		const noteEditor = new Editor(tui, editorTheme);

		const requestUiRerender = () => {
			cachedRenderedLines = undefined;
			tui.requestRender();
		};

		const getNormalizedContinueNote = (): string => normalizeContinueNote(continueNote);

		const openContinueEditor = () => {
			if (cursorIndex !== CONTINUE_OPTION_INDEX) {
				return;
			}
			isContinueNoteEditorOpen = true;
			noteEditor.setText(continueNote);
			requestUiRerender();
		};

		noteEditor.onChange = (value) => {
			continueNote = value;
			requestUiRerender();
		};

		noteEditor.onSubmit = (value) => {
			continueNote = value;
			const normalized = getNormalizedContinueNote();
			if (normalized.length === 0) {
				isContinueNoteEditorOpen = false;
				requestUiRerender();
				return;
			}

			done({
				cancelled: false,
				action: "continue",
				continueNote: normalized,
			});
		};

		const render = (width: number): string[] => {
			if (cachedRenderedLines) {
				return cachedRenderedLines;
			}

			const renderedLines: string[] = [];
			const addLine = (line: string) => renderedLines.push(truncateToWidth(line, width));

			addLine(theme.fg("accent", "─".repeat(width)));
			addLine(theme.fg("text", " Plan mode: next action"));
			renderedLines.push("");

			const maxInlineLabelLength = Math.max(20, width - 8);
			for (let optionIndex = 0; optionIndex < ACTION_OPTIONS.length; optionIndex++) {
				const option = ACTION_OPTIONS[optionIndex];
				const isCursorOption = optionIndex === cursorIndex;
				const isContinueOption = optionIndex === CONTINUE_OPTION_INDEX;
				const optionLabel = isContinueOption
					? buildContinueOptionLabel(
							option.label,
							continueNote,
							isContinueNoteEditorOpen && isCursorOption,
							maxInlineLabelLength,
						)
					: option.label;
				const cursorPrefix = isCursorOption ? theme.fg("accent", "→ ") : "  ";
				const bullet = isCursorOption ? "●" : "○";
				const optionColor = isCursorOption ? "accent" : "text";
				addLine(`${cursorPrefix}${theme.fg(optionColor, `${bullet} ${optionLabel}`)}`);
			}

			renderedLines.push("");
			if (isContinueNoteEditorOpen) {
				addLine(theme.fg("dim", " Typing note inline • Enter continue • Tab/Esc stop editing"));
			} else if (cursorIndex === CONTINUE_OPTION_INDEX) {
				if (getNormalizedContinueNote().length > 0) {
					addLine(theme.fg("dim", " ↑↓ move • Enter continue • Tab edit note • Esc cancel"));
				} else {
					addLine(theme.fg("dim", " ↑↓ move • Enter continue • Tab add note • Esc cancel"));
				}
			} else {
				addLine(theme.fg("dim", " ↑↓ move • Enter select • Esc cancel"));
			}

			addLine(theme.fg("accent", "─".repeat(width)));
			cachedRenderedLines = renderedLines;
			return renderedLines;
		};

		const handleInput = (data: string) => {
			if (isContinueNoteEditorOpen) {
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
					isContinueNoteEditorOpen = false;
					requestUiRerender();
					return;
				}
				noteEditor.handleInput(data);
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.up)) {
				cursorIndex = Math.max(0, cursorIndex - 1);
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.down)) {
				cursorIndex = Math.min(ACTION_OPTIONS.length - 1, cursorIndex + 1);
				requestUiRerender();
				return;
			}

			if (matchesKey(data, Key.tab)) {
				if (cursorIndex === CONTINUE_OPTION_INDEX) {
					openContinueEditor();
				}
				return;
			}

			if (matchesKey(data, Key.enter)) {
				const selected = ACTION_OPTIONS[cursorIndex];
				if (selected.value === "continue") {
					const normalized = getNormalizedContinueNote();
					done({
						cancelled: false,
						action: "continue",
						continueNote: normalized.length > 0 ? normalized : undefined,
					});
					return;
				}

				done({ cancelled: false, action: selected.value });
				return;
			}

			if (matchesKey(data, Key.escape)) {
				done({ cancelled: true });
			}
		};

		return {
			render,
			invalidate: () => {
				cachedRenderedLines = undefined;
			},
			handleInput,
		};
	});
}
