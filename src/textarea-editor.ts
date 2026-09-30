import type { VipirEditorTheme } from "./types.ts";
import type { EditorFocusCoordinator, FocusRegistration } from "./focus.ts";
import {
	decodeKittyPrintable,
	parseKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type EditorTheme,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";

import { readSystemClipboard, writeSystemClipboard } from "./clipboard.ts";
import { hardwareCursorForTerminal, type HardwareCursor } from "./hardware-cursor.ts";
import { OwnedEditor } from "./owned-editor.ts";
import {
	VimCore,
	registerDefaultVimEditing,
	type DefaultVimServices,
	type VimBufferAdapter,
	type VimHost,
	type VimModeId,
} from "./vim-core.ts";

const ESC_UP = "\x1b[A";
const ESC_DOWN = "\x1b[B";
const LINE_START = "\x01";
const LINE_END = "\x05";
const UNDO = "\x1f";

export type FieldControl = Component & Focusable & {
	getValue(): string;
	getMode(): VimModeId;
	capturesInput?(data: string): boolean;
	dispose?(): void;
};

export type TextareaEditorOptions = {
	text: string;
	mode: VimModeId;
	tui: TUI;
	editorTheme: EditorTheme;
	theme: VipirEditorTheme;
	showModeBadge: boolean;
	focused: boolean;
	onChange: ((editor: TextareaEditor) => void) | undefined;
	onModeChange: ((editor: TextareaEditor, previousMode: VimModeId, nextMode: VimModeId) => void) | undefined;
	onFocusedModeChange: ((editor: TextareaEditor, mode: VimModeId) => void) | undefined;
	onRequestRender: (() => void) | undefined;
};

type TextareaEditorServices = DefaultVimServices & {
	editor: TextareaEditor;
};

export class TextareaEditor extends OwnedEditor implements FieldControl, VimBufferAdapter {
	readonly core: VimCore<TextareaEditorServices>;
	private readonly hardwareCursor: HardwareCursor;
	private readonly focusRegistration: FocusRegistration;

	get focused(): boolean { return this.focusRegistration?.isFocused ?? false; }
	set focused(value: boolean) { this.focusRegistration?.setFocused(value); }
	private visibleEditorBodyRows = 1;
	private isHandlingBracketedPaste = false;

	constructor(private readonly options: TextareaEditorOptions, focus: EditorFocusCoordinator) {
		super(options.tui, options.editorTheme, { paddingX: 0 });
		this.hardwareCursor = hardwareCursorForTerminal(options.tui.terminal);
		const host: VimHost = {
			requestRender: () => this.requestRender(),
			requestCursorStyle: (style) => { if (this.focused) this.hardwareCursor.requestStyle(style); },
			readClipboard: readSystemClipboard,
			writeClipboard: writeSystemClipboard,
			flashRange: () => undefined,
			onChange: () => options.onChange?.(this),
			onModeChange: (previousMode, nextMode) => this.handleModeChange(previousMode, nextMode),
		};
		this.core = new VimCore<TextareaEditorServices>(this, host, {
			mode: options.mode,
			services: {
				editor: this,
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
		this.registerTextareaBindings();
		this.disableSubmit = true;
		this.setText(options.text);
		this.focusRegistration = focus.register({
			editor: this,
			onFocusChange: () => {
				if (this.focused) {
					this.core.applyCursorStyle();
					this.options.onFocusedModeChange?.(this, this.getMode());
				}
				this.requestRender();
			},
			onDispose: () => this.dispose(),
		});
		this.setFocused(options.focused);
	}

	getValue(): string {
		return this.getExpandedText();
	}

	getMode(): VimModeId {
		return this.core.getMode();
	}

	setMode(mode: VimModeId): void {
		this.core.setMode(mode);
	}

	getPendingLabel(): string | undefined {
		return this.core.getPendingLabel();
	}

	setFocused(isFocused: boolean): void {
		this.focusRegistration.setFocused(isFocused);
	}

	requestRender(): void {
		this.options.onRequestRender?.();
	}

	capturesInput(data: string): boolean {
		return Boolean(this.getPendingLabel()) || (this.getMode() === "insert" && data === "\x1b");
	}

	handleInput(data: string): void {
		this.handleKey(data);
	}

	handleKey(data: string): boolean {
		if (!this.focused) return false;
		if (this.handleBracketedPasteInput(data)) return true;
		if (this.core.handleInput(data)) return true;
		if (this.getMode() === "normal" && isPrintableInput(data)) return true;
		super.handleInput(data);
		return true;
	}

	render(width: number): string[] {
		if (this.focused) this.core.applyCursorStyle();
		const lines = super.render(width);
		if (lines.length === 0) return lines;

		this.visibleEditorBodyRows = Math.max(1, lines.length - 2);
		const renderedLines = this.core.render(lines, width);
		return this.renderModeLabel(renderedLines, width, this.modeLabel());
	}

	dispose(): void {
		this.cancelAutocomplete();
		this.focusRegistration.dispose();
	}

	private registerTextareaBindings(): void {
		this.core.registerBinding("normal", { keys: ["j"], run: () => this.runEditorInput(ESC_DOWN) });
		this.core.registerBinding("normal", { keys: ["down"], run: () => this.runEditorInput(ESC_DOWN) });
		this.core.registerBinding("normal", { keys: ["k"], run: () => this.runEditorInput(ESC_UP) });
		this.core.registerBinding("normal", { keys: ["up"], run: () => this.runEditorInput(ESC_UP) });
		this.core.registerBinding("normal", { keys: ["u"], run: () => this.runEditorInput(UNDO) });
	}

	private runEditorInput(data: string): void {
		super.handleInput(data);
	}

	private openLineBelow(): void {
		this.runEditorInput(LINE_END);
		this.runEditorInput("\n");
		this.setMode("insert");
	}

	private openLineAbove(): void {
		this.runEditorInput(LINE_START);
		this.runEditorInput("\n");
		this.runEditorInput(ESC_UP);
		this.setMode("insert");
	}

	private scrollHalfPage(direction: -1 | 1): void {
		const steps = Math.max(1, Math.floor(this.visibleEditorBodyRows / 2));
		const input = direction < 0 ? ESC_UP : ESC_DOWN;
		for (let step = 0; step < steps; step++) this.runEditorInput(input);
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

	private handleModeChange(previousMode: VimModeId, nextMode: VimModeId): void {
		this.options.onModeChange?.(this, previousMode, nextMode);
		if (this.focused) this.publishFocusedMode();
	}

	private publishFocusedMode(): void {
		this.options.onFocusedModeChange?.(this, this.getMode());
		this.focusRegistration.publishMode();
	}

	private modeLabel(): string {
		const pending = this.core.getPendingLabel();
		const label = this.core.getModeLabel();
		const mode = pending && label.startsWith(`${pending} `) ? label.slice(pending.length + 1) : label;
		const styledMode = this.options.theme.fg("accent", this.options.theme.bold(mode));
		return pending ? `${this.options.theme.fg("muted", pending)} ${styledMode}` : styledMode;
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

function isPrintableInput(data: string): boolean {
	return getPrintableInput(data) !== undefined;
}

function getPrintableInput(data: string): string | undefined {
	if (data.length === 1 && data.charCodeAt(0) >= 32) return data;
	const decoded = decodeKittyPrintable(data);
	if (decoded) return decoded;
	const parsed = parseKey(data);
	return parsed?.length === 1 ? parsed : undefined;
}
