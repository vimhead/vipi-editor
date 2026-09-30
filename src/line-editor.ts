import type { VipirEditorTheme } from "./types.ts";
import type { EditorFocusCoordinator, FocusRegistration } from "./focus.ts";
import {
	CURSOR_MARKER,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type Component,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";

import { readSystemClipboard, writeSystemClipboard } from "./clipboard.ts";
import { hardwareCursorForTerminal, type HardwareCursor } from "./hardware-cursor.ts";
import {
	VimCore,
	clamp,
	registerDefaultVimEditing,
	clampPosition,
	normalizeRange,
	positionAfterReplacement,
	replaceTextRange,
	textRange,
	type VimBufferAdapter,
	type VimHost,
	type VimModeId,
	type VimPosition,
	type VimTextRange,
} from "./vim-core.ts";

export type LineEditorOptions = {
	text?: string;
	mode?: VimModeId;
	placeholder?: string;
	theme?: VipirEditorTheme;
	tui?: Pick<TUI, "terminal">;
	showModeBadge?: boolean;
	focused?: boolean;
	onChange?: (editor: LineEditor) => void;
	onModeChange?: (editor: LineEditor, previousMode: VimModeId, nextMode: VimModeId) => void;
	onFocusedModeChange?: (editor: LineEditor, mode: VimModeId) => void;
	onRequestRender?: () => void;
};

export type LineEditorRenderOptions = {
	placeholder?: string;
	theme?: VipirEditorTheme;
	focused?: boolean;
	showModeBadge?: boolean;
};

class SingleLineBuffer implements VimBufferAdapter {
	private text: string;
	private cursor = 0;

	constructor(text: string) {
		this.text = stripTerminalSequences(text).replace(/[\r\n]+/g, " ");
		this.cursor = this.text.length;
	}

	getText(): string {
		return this.text;
	}

	setText(text: string, cursor?: number): void {
		this.text = stripTerminalSequences(text).replace(/[\r\n]+/g, " ");
		this.cursor = clamp(cursor ?? this.text.length, 0, this.text.length);
	}

	getLines(): readonly string[] {
		return [this.text];
	}

	getCursor(): VimPosition {
		return { line: 0, col: this.cursor };
	}

	moveToPosition(position: VimPosition): void {
		this.cursor = clamp(position.col, 0, this.text.length);
	}

	replaceRange(range: VimTextRange, replacement: string): void {
		const sanitizedReplacement = stripTerminalSequences(replacement).replace(/[\r\n]+/g, " ");
		const currentLines = [this.text];
		const clampedRange = clampLineRange(range, this.text);
		const target = positionAfterReplacement(currentLines, clampedRange, sanitizedReplacement);
		const nextLines = replaceTextRange(currentLines, clampedRange, sanitizedReplacement);
		this.text = nextLines.join(" ");
		this.cursor = clamp(target.col, 0, this.text.length);
	}

	textForRange(range: VimTextRange): string {
		return textRange([this.text], clampLineRange(range, this.text));
	}
}

export class LineEditor implements Component, Focusable {
	private readonly focusRegistration: FocusRegistration;

	get focused(): boolean { return this.focusRegistration?.isFocused ?? false; }
	set focused(value: boolean) { this.focusRegistration?.setFocused(value); }
	private readonly options: LineEditorOptions;
	private readonly hardwareCursor: HardwareCursor | undefined;
	private readonly buffer: SingleLineBuffer;
	private readonly core: VimCore;
	private view = 0;
	private flashRange: VimTextRange | undefined;
	private flashToken = 0;
	private flashTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: LineEditorOptions, focus: EditorFocusCoordinator) {
		this.options = options;
		this.hardwareCursor = options.tui ? hardwareCursorForTerminal(options.tui.terminal) : undefined;
		this.buffer = new SingleLineBuffer(options.text ?? "");
		const host: VimHost = {
			requestRender: () => options.onRequestRender?.(),
			requestCursorStyle: (style) => this.requestCursorStyle(style),
			readClipboard: readSystemClipboard,
			writeClipboard: writeSystemClipboard,
			flashRange: (range) => this.flash(range),
			onChange: () => options.onChange?.(this),
			onModeChange: (previousMode, nextMode) => this.handleModeChange(previousMode, nextMode),
		};
		this.core = new VimCore(this.buffer, host, { mode: options.mode ?? "insert", services: {} });
		registerDefaultVimEditing(this.core, { handleInsertInput: true, multilineTextObjects: false, extraNormalBindings: false });
		this.focusRegistration = focus.register({
			editor: this,
			onFocusChange: () => {
				if (this.focused) {
					this.core.applyCursorStyle();
					this.options.onFocusedModeChange?.(this, this.getMode());
				}
				this.options.onRequestRender?.();
			},
			onDispose: () => this.dispose(),
		});
		this.setFocused(options.focused ?? true);
	}

	getText(): string {
		return this.buffer.getText();
	}

	setText(text: string, cursor?: number): void {
		this.buffer.setText(text, cursor);
		this.view = 0;
		this.options.onChange?.(this);
		this.options.onRequestRender?.();
	}

	getCursor(): number {
		return this.buffer.getCursor().col;
	}

	setCursor(cursor: number): void {
		this.buffer.moveToPosition({ line: 0, col: cursor });
		this.options.onRequestRender?.();
	}

	getMode(): VimModeId {
		return this.core.getMode();
	}

	setMode(mode: VimModeId): void {
		this.core.setMode(mode);
	}

	setFocused(isFocused: boolean): void {
		this.focusRegistration.setFocused(isFocused);
	}

	getPendingLabel(): string | undefined {
		return this.core.getPendingLabel();
	}

	handleInput(data: string): void {
		this.handleKey(data);
	}

	handleKey(data: string): boolean {
		return this.focused && this.core.handleInput(data);
	}

	render(width: number): string[] {
		return [truncateToWidth(this.renderInline(width, {}), width, "")];
	}

	renderInline(width: number, options?: LineEditorRenderOptions): string {
		const renderOptions = options ?? {};
		const isFocused = this.focused && renderOptions.focused !== false;
		if (isFocused) this.applyCursorStyle();
		const theme = renderOptions.theme ?? this.options.theme;
		const showModeBadge = renderOptions.showModeBadge ?? this.options.showModeBadge ?? true;
		const badge = showModeBadge ? this.renderModeBadge(theme) : "";
		const badgeWidth = badge ? visibleWidth(badge) + 1 : 0;
		const textWidth = Math.max(0, width - badgeWidth);
		const text = this.getText();
		const cursor = this.getCursor();
		const slice = this.windowText(Math.max(1, textWidth));
		const placeholder = renderOptions.placeholder ?? this.options.placeholder ?? "";
		const marker = isFocused ? CURSOR_MARKER : "";
		const body = text.length === 0 ? `${marker}${styleMuted(theme, placeholder)}` : this.renderTextSlice(slice, this.view, cursor, marker, theme);
		const left = padCell(truncateToWidth(body, textWidth, ""), textWidth);
		return badge ? `${left} ${badge}` : left;
	}

	renderModeBadge(theme = this.options.theme): string {
		const label = this.getMode() === "insert" ? "INSERT" : "NORMAL";
		const pending = this.getPendingLabel();
		return `${pending ? styleMuted(theme, `${pending} `) : ""}${styleAccent(theme, label)}`;
	}

	invalidate(): void {}

	dispose(): void {
		this.focusRegistration.dispose();
		if (this.flashTimer) clearTimeout(this.flashTimer);
	}

	private windowText(avail: number): string {
		const text = this.getText();
		const cursor = this.getCursor();
		if (text.length <= avail) {
			this.view = 0;
			return text;
		}
		if (cursor < this.view) this.view = cursor;
		if (cursor > this.view + avail - 1) this.view = cursor - avail + 1;
		this.view = clamp(this.view, 0, Math.max(0, text.length - avail));
		return text.slice(this.view, this.view + avail);
	}

	private renderTextSlice(slice: string, offset: number, cursor: number, marker: string, theme: VipirEditorTheme | undefined): string {
		const cursorInSlice = clamp(cursor - offset, 0, slice.length);
		return `${this.renderRange(slice, offset, 0, cursorInSlice, theme)}${marker}${this.renderRange(slice, offset, cursorInSlice, slice.length, theme)}`;
	}

	private renderRange(slice: string, offset: number, from: number, to: number, theme: VipirEditorTheme | undefined): string {
		const flash = this.flashRange;
		if (!flash) return safeText(slice.slice(from, to));
		const [flashStart, flashEnd] = normalizeRange(flash);
		const start = Math.max(from, flashStart.col - offset);
		const end = Math.min(to, flashEnd.col - offset);
		if (end <= start) return safeText(slice.slice(from, to));
		const before = safeText(slice.slice(from, start));
		const highlighted = safeText(slice.slice(start, end));
		const after = safeText(slice.slice(end, to));
		const styled = theme ? theme.inverse(theme.fg("accent", theme.bold(highlighted))) : highlighted;
		return `${before}${styled}${after}`;
	}

	private flash(range: VimTextRange): void {
		this.flashRange = clampLineRange(range, this.getText());
		const token = ++this.flashToken;
		if (this.flashTimer) clearTimeout(this.flashTimer);
		this.options.onRequestRender?.();
		this.flashTimer = setTimeout(() => {
			if (this.flashToken !== token) return;
			this.flashRange = undefined;
			this.options.onRequestRender?.();
		}, 180);
		this.flashTimer.unref?.();
	}

	private applyCursorStyle(): void {
		this.requestCursorStyle(this.getMode() === "insert" ? "thin" : "block");
	}

	private handleModeChange(previousMode: VimModeId, nextMode: VimModeId): void {
		this.options.onModeChange?.(this, previousMode, nextMode);
		if (this.focused) this.publishFocusedMode();
	}

	private publishFocusedMode(): void {
		this.options.onFocusedModeChange?.(this, this.getMode());
		this.focusRegistration.publishMode();
	}

	private requestCursorStyle(style: "thin" | "block"): void {
		if (this.focused) this.hardwareCursor?.requestStyle(style);
	}
}

function clampLineRange(range: VimTextRange, text: string): VimTextRange {
	return {
		from: clampPosition({ line: 0, col: range.from.col }, [text]),
		to: clampPosition({ line: 0, col: range.to.col }, [text]),
		linewise: range.linewise,
	};
}

function safeText(text: string): string {
	return stripTerminalSequences(text);
}

function styleMuted(theme: VipirEditorTheme | undefined, text: string): string {
	return theme ? theme.fg("muted", text) : text;
}

function styleAccent(theme: VipirEditorTheme | undefined, text: string): string {
	return theme ? theme.fg("accent", theme.bold(text)) : text;
}

function padCell(text: string, width: number): string {
	const cellWidth = Math.max(0, width);
	const truncated = truncateToWidth(text, cellWidth, "…");
	return `${truncated}${" ".repeat(Math.max(0, cellWidth - visibleWidth(truncated)))}`;
}
