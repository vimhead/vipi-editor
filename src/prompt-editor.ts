import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, stripTerminalSequences, truncateToWidth, visibleWidth, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import {
	buildRenderedLineMaps, isPrintableInput, OwnedCustomEditor, VimCore,
	hardwareCursorForTerminal, hideHardwareCursorDuringRepaint, normalizeRange,
	patchDroppedPathPasteInput, readSystemClipboard, registerDefaultVimEditing, writeSystemClipboard,
	type PromptEditor, type VipirEditorModeId, type VipirEditorRenderedLineMap,
	type VipirEditorServices, type VipirEditorSubmitTextOptions, type VipirEditorTextRange,
	type DefaultVimServices, type HardwareCursor, type VimBufferAdapter, type VimHost,
} from "./api.ts";
import { VipirEditorSessionRuntime } from "./session-runtime.ts";
import type { FocusRegistration } from "./focus.ts";

const ESC_UP = "\x1b[A";
const ESC_DOWN = "\x1b[B";
const LINE_START = "\x01";
const LINE_END = "\x05";
const UNDO = "\x1f";
const RESTORE_DRAFT_KEY = Symbol.for("vipi-editor.pendingRestoreDraft");
let restoreDraftToken = 0;

type PendingRestoreDraft = {
	token: number;
	text: string;
};

type ModalEditorServices = VipirEditorServices & DefaultVimServices;

export class ModalEditor extends OwnedCustomEditor implements PromptEditor, VimBufferAdapter {
	readonly core: VimCore<ModalEditorServices>;
	private readonly hardwareCursor: HardwareCursor;
	private readonly focusRegistration: FocusRegistration;

	get focused(): boolean { return this.focusRegistration?.isFocused ?? false; }
	set focused(value: boolean) { this.focusRegistration?.setFocused(value); }
	private yankFlashRange: VipirEditorTextRange | undefined;
	private yankFlashToken = 0;
	private yankFlashTimer: ReturnType<typeof setTimeout> | undefined;
	private visibleEditorBodyRows = 1;
	private isHandlingBracketedPaste = false;

	private get runtime(): VipirEditorSessionRuntime { return this.options.runtime; }
	private get appTheme(): Theme { return this.options.appTheme; }
	private get appKeybindings(): KeybindingsManager { return this.options.keybindings; }

	constructor(private readonly options: {
		tui: TUI;
		theme: EditorTheme;
		keybindings: KeybindingsManager;
		runtime: VipirEditorSessionRuntime;
		appTheme: Theme;
	}) {
		const { tui, theme, keybindings, runtime } = options;
		super(tui, theme, keybindings);
		hideHardwareCursorDuringRepaint(tui.terminal);
		patchDroppedPathPasteInput(tui.terminal);
		this.hardwareCursor = hardwareCursorForTerminal(tui.terminal);
		const host: VimHost = {
			requestRender: () => this.tui.requestRender(),
			requestCursorStyle: (style) => this.requestCursorStyle(style),
			readClipboard: readSystemClipboard,
			writeClipboard: writeSystemClipboard,
			flashRange: (range) => this.flashYankRange(range),
			onModeChange: () => this.focusRegistration?.publishMode(),
			notifyError: (message) => this.runtime.ctx.ui.notify(`vipir-editor binding failed: ${message}`, "error"),
		};
		this.core = new VimCore<ModalEditorServices>(this, host, {
			mode: "insert",
			services: {
				editor: this,
				pi: runtime.pi,
				ctx: runtime.ctx,
				openLineBelow: () => this.openLineBelow(),
				openLineAbove: () => this.openLineAbove(),
				scrollHalfPage: (direction) => this.scrollHalfPage(direction),
			},
		});
		registerDefaultVimEditing(this.core, {
			handleInsertInput: false,
			multilineTextObjects: true,
			extraNormalBindings: true,
		});
		this.registerModalEditorBindings();
		this.focusRegistration = runtime.focus.register({
			editor: this,
			onFocusChange: () => {
				if (this.focused) this.core.applyCursorStyle();
				this.requestRender();
			},
			onDispose: () => this.dispose(),
		});
		this.runtime.setEditor(this);
	}

	dispose(): void {
		this.cancelAutocomplete();
		this.focusRegistration.dispose();
		if (this.yankFlashTimer) clearTimeout(this.yankFlashTimer);
	}

	getMode(): VipirEditorModeId {
		return this.core.getMode();
	}

	getTheme(): Theme {
		return this.appTheme;
	}

	setMode(mode: VipirEditorModeId): void {
		this.core.setMode(mode);
	}

	requestRender(): void {
		this.tui.requestRender();
	}

	async submitText(text: string, options?: VipirEditorSubmitTextOptions): Promise<void> {
		const submittedText = text.trim();
		const restoreText = options?.restoreText;
		const token = restoreText !== undefined ? setPendingRestoreDraft(restoreText) : undefined;

		this.setText("");
		await Promise.resolve(this.onSubmit?.(submittedText));
		if (token !== undefined) clearPendingRestoreDraft(token);
		if (restoreText !== undefined && this.getText().length === 0) {
			this.setText(restoreText);
			this.tui.requestRender();
		}
	}

	runEditorInput(data: string): void {
		super.handleInput(data);
	}

	openLineBelow(): void {
		this.runEditorInput(LINE_END);
		this.runEditorInput("\n");
		this.setMode("insert");
	}

	openLineAbove(): void {
		this.runEditorInput(LINE_START);
		this.runEditorInput("\n");
		this.runEditorInput(ESC_UP);
		this.setMode("insert");
	}

	scrollHalfPage(direction: -1 | 1): void {
		const steps = Math.max(1, Math.floor(this.visibleEditorBodyRows / 2));
		const input = direction < 0 ? ESC_UP : ESC_DOWN;
		for (let step = 0; step < steps; step++) this.runEditorInput(input);
	}

	private registerModalEditorBindings(): void {
		this.core.registerBinding("normal", { keys: ["j"], run: () => this.runEditorInput(ESC_DOWN) });
		this.core.registerBinding("normal", { keys: ["down"], run: () => this.runEditorInput(ESC_DOWN) });
		this.core.registerBinding("normal", { keys: ["k"], run: () => this.runEditorInput(ESC_UP) });
		this.core.registerBinding("normal", { keys: ["up"], run: () => this.runEditorInput(ESC_UP) });
		this.core.registerBinding("normal", { keys: ["u"], run: () => this.undoEditorChange() });
	}

	private undoEditorChange(): void {
		this.runEditorInput(UNDO);
	}

	handleInput(data: string): void {
		if (this.handleBracketedPasteInput(data)) return;
		if (this.shouldDelegateInterruptToPi(data)) {
			super.handleInput(data);
			return;
		}
		if (this.core.handleInput(data)) return;
		if (this.getMode() === "normal" && isPrintableInput(data)) return;
		super.handleInput(data);
	}

	private handleBracketedPasteInput(data: string): boolean {
		const startsBracketedPaste = data.includes("\x1b[200~");
		if (!startsBracketedPaste && !this.isHandlingBracketedPaste) return false;

		if (startsBracketedPaste) {
			this.isHandlingBracketedPaste = true;
			this.setMode("insert");
		}
		super.handleInput(data);
		if (data.includes("\x1b[201~")) this.isHandlingBracketedPaste = false;
		return true;
	}

	private shouldDelegateInterruptToPi(data: string): boolean {
		return !this.runtime.ctx.isIdle() && this.appKeybindings.matches(data, "app.interrupt") && !this.core.hasCurrentInputRegistration(data);
	}

	render(width: number): string[] {
		if (this.focused) this.core.applyCursorStyle();
		const lines = super.render(width);
		if (lines.length === 0) return lines;

		this.visibleEditorBodyRows = Math.max(1, lines.length - 2);
		const renderedLines = this.core.render(this.renderYankFlashOverlay(lines), width);
		return this.renderModeLabel(renderedLines, width, this.modeLabel());
	}

	private flashYankRange(range: VipirEditorTextRange): void {
		this.yankFlashRange = range;
		const token = ++this.yankFlashToken;
		if (this.yankFlashTimer) clearTimeout(this.yankFlashTimer);
		this.tui.requestRender();
		this.yankFlashTimer = setTimeout(() => {
			if (this.yankFlashToken !== token) return;
			this.yankFlashRange = undefined;
			this.tui.requestRender();
		}, 180);
		this.yankFlashTimer.unref?.();
	}

	private requestCursorStyle(style: "thin" | "block"): void {
		if (this.focused) this.hardwareCursor.requestStyle(style);
	}

	private modeLabel(): string {
		const pending = this.core.getPendingLabel();
		const label = this.core.getModeLabel();
		const mode = pending && label.startsWith(`${pending} `) ? label.slice(pending.length + 1) : label;
		const thinkingColor = this.appTheme.getThinkingBorderColor(this.runtime.ctx.thinkingLevel ?? "off");
		const styledMode = thinkingColor(this.appTheme.bold(mode));
		return pending ? `${this.appTheme.fg("muted", pending)} ${styledMode}` : styledMode;
	}

	private renderYankFlashOverlay(lines: string[]): string[] {
		const range = this.yankFlashRange;
		if (!range) return lines;

		const result = [...lines];
		const logicalLines = this.getLines();
		const maps = buildRenderedLineMaps(result.slice(1, -1), logicalLines);
		for (const map of maps) {
			const segment = rangeSegmentForRenderedLine(range, map, logicalLines[map.logicalLine] ?? "");
			if (!segment) continue;

			const line = result[map.outputLine] ?? "";
			const startCol = map.lineStartCol + segment.startCol - map.startCol;
			const endCol = map.lineStartCol + segment.endCol - map.startCol;
			const before = sliceByColumn(line, 0, startCol, true);
			const highlighted = stripTerminalSequences(sliceByColumn(line, startCol, endCol - startCol, true));
			const after = sliceByColumn(line, endCol, Math.max(0, visibleWidth(line) - endCol), true);
			result[map.outputLine] = `${before}${this.appTheme.inverse(this.appTheme.fg("accent", this.appTheme.bold(highlighted)))}${after}`;
		}

		return result;
	}

	private renderModeLabel(lines: string[], width: number, label: string): string[] {
		const result = [...lines];
		const lastIndex = result.length - 1;
		const rawLabel = ` ${label} `;
		if (width <= visibleWidth(rawLabel)) return result;

		result[lastIndex] = `${truncateToWidth(result[lastIndex] ?? "", width - visibleWidth(rawLabel), "")}${rawLabel}`;
		return result;
	}
}

function rangeSegmentForRenderedLine(
	range: VipirEditorTextRange,
	map: VipirEditorRenderedLineMap,
	logicalLineText: string,
): { startCol: number; endCol: number } | undefined {
	const [rangeStart, rangeEnd] = normalizeRange(range);
	if (map.logicalLine < rangeStart.line || map.logicalLine > rangeEnd.line) return undefined;

	let startCol = map.logicalLine === rangeStart.line ? rangeStart.col : 0;
	let endCol = map.logicalLine === rangeEnd.line ? rangeEnd.col : logicalLineText.length;
	if (range.linewise) {
		startCol = 0;
		endCol = logicalLineText.length;
	}

	const segmentStart = Math.max(startCol, map.startCol);
	const segmentEnd = Math.min(endCol, map.endCol);
	return segmentEnd > segmentStart ? { startCol: segmentStart, endCol: segmentEnd } : undefined;
}

function setPendingRestoreDraft(text: string): number {
	const token = ++restoreDraftToken;
	(globalThis as Record<symbol, PendingRestoreDraft | undefined>)[RESTORE_DRAFT_KEY] = { token, text };
	return token;
}

function clearPendingRestoreDraft(token: number): void {
	const store = globalThis as Record<symbol, PendingRestoreDraft | undefined>;
	if (store[RESTORE_DRAFT_KEY]?.token === token) delete store[RESTORE_DRAFT_KEY];
}

export function takePendingRestoreDraft(): string | undefined {
	const store = globalThis as Record<symbol, PendingRestoreDraft | undefined>;
	const draft = store[RESTORE_DRAFT_KEY];
	delete store[RESTORE_DRAFT_KEY];
	return draft?.text;
}
