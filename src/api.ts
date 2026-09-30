import {
	decodeKittyPrintable,
	parseKey,
	stripTerminalSequences,
} from "@earendil-works/pi-tui";
import type { LineEditor as VipiEditorLineEditor, LineEditorOptions as VipiEditorLineEditorOptions } from "./line-editor.ts";
import type { FieldControl as VipiEditorFieldControl, TextareaEditorOptions as VipiEditorTextareaEditorOptions } from "./textarea-editor.ts";
import type { VipiEditorEventBus, VipiEditorExtensionApi, VipiEditorExtensionContext, VipiEditorTheme } from "./types.ts";
import type { VimBinding, VimCommandContext, VimModeDefinition, VimModeLabel } from "./vim-core.ts";

export { HardwareCursor, hardwareCursorForTerminal, hideHardwareCursorDuringRepaint, type HardwareCursorTerminal } from "./hardware-cursor.ts";
export { LineEditor, type LineEditorOptions, type LineEditorRenderOptions } from "./line-editor.ts";
export { OwnedCustomEditor, OwnedEditor, type TextChunk, wordWrapLine } from "./owned-editor.ts";
export { patchDroppedPathPasteInput } from "./paste-input.ts";
export { readSystemClipboard, writeSystemClipboard } from "./clipboard.ts";
export { TextareaEditor, type FieldControl, type TextareaEditorOptions } from "./textarea-editor.ts";
export { createFieldControls, type FieldControlOptions, type FieldControls } from "./fields.ts";
export {
	VimCore,
	charKind,
	clampPosition,
	comparePosition,
	indexToPosition,
	normalizeRange,
	nextPositionWithinLine,
	positionToIndex,
	rangeForMotion,
	registerDefaultVimEditing,
	repeatedMotionRange,
	replaceTextRange,
	textRange,
	wordEndExclusivePosition,
	wordLeftPosition,
	wordRightPosition,
	type DefaultVimServices,
	type VimBinding,
	type VimBufferAdapter,
	type VimBuiltinMode,
	type VimCommandContext,
	type VimCursorStyle,
	type RegisterDefaultVimOptions,
	type VimDispose,
	type VimHost,
	type VimModeDefinition,
	type VimModeId,
	type VimModeLabel,
	type VimMotion,
	type VimMotionId,
	type VimOperator,
	type VimPosition,
	type VimRegistration,
	type VimTextObject,
	type VimTextObjectScope,
	type VimTextRange,
} from "./vim-core.ts";

export const VIPI_EDITOR_API_VERSION = 1;
export const VIPI_EDITOR_READY = "vipi-editor:v1:ready";
export const VIPI_EDITOR_UNREADY = "vipi-editor:v1:unready";
export const VIPI_EDITOR_REGISTER = "vipi-editor:v1:register";
export const VIPI_EDITOR_RUNTIME_API_REQUEST = "vipi-editor:v1:runtime-api-request";

export type VipiEditorModeId = string;
export type VipiEditorCursorStyle = "thin" | "block";
export type VipiEditorDispose = () => void;
export type { VipiEditorEventBus, VipiEditorExtensionApi, VipiEditorExtensionContext, VipiEditorKeybindingsManager, VipiEditorKeySequence, VipiEditorTheme } from "./types.ts";

export type VipiEditorPosition = {
	line: number;
	col: number;
};

export type VipiEditorTextRange = {
	from: VipiEditorPosition;
	to: VipiEditorPosition;
	linewise?: boolean;
};

export type VipiEditorRenderedLineMap = {
	outputLine: number;
	logicalLine: number;
	startCol: number;
	endCol: number;
	lineStartCol: number;
};

export type VipiEditorSubmitTextOptions = {
	restoreText?: string;
};

export interface PromptEditor {
	getText(): string;
	getLines(): string[];
	getCursor(): VipiEditorPosition;
	getMode(): VipiEditorModeId;
	setMode(mode: VipiEditorModeId): void;
	requestRender(): void;
	submitText(text: string, options?: VipiEditorSubmitTextOptions): Promise<void>;
	runEditorInput(data: string): void;
	moveToPosition(position: VipiEditorPosition): void;
	getTheme(): VipiEditorTheme;
}

export type VipiEditorServices = {
	editor: PromptEditor;
	pi: VipiEditorExtensionApi;
	ctx: VipiEditorExtensionContext;
};

export type VipiEditorCommandContext = VimCommandContext<VipiEditorServices>;
export type VipiEditorModeLabel = VimModeLabel<VipiEditorServices>;
export type VipiEditorModeDefinition = VimModeDefinition<VipiEditorServices>;
export type VipiEditorBinding = VimBinding<VipiEditorServices>;
export type VipiEditorFocusedModeEditor = PromptEditor | VipiEditorLineEditor | VipiEditorFieldControl;
export type VipiEditorFocusedModeEvent = Omit<VipiEditorServices, "editor"> & {
	editor: VipiEditorFocusedModeEditor;
	mode: VipiEditorModeId;
};
export type VipiEditorFocusedModeHandler = (event: VipiEditorFocusedModeEvent) => void | Promise<void>;

export type VipiEditorApi = {
	readonly version: typeof VIPI_EDITOR_API_VERSION;
	onDispose(action: VipiEditorDispose): void;
	vim: {
		registerMode(mode: VipiEditorModeDefinition): VipiEditorDispose;
		registerBinding(modeId: VipiEditorModeId, binding: VipiEditorBinding): VipiEditorDispose;
		createLineEditor(options: VipiEditorLineEditorOptions): VipiEditorLineEditor;
		createTextareaEditor(options: VipiEditorTextareaEditorOptions): VipiEditorFieldControl;
		focusEditor(editor: VipiEditorFocusedModeEditor): void;
		onFocusedModeChange(handler: VipiEditorFocusedModeHandler): VipiEditorDispose;
	};
};

export type VipiEditorRegistration = {
	extensionId: string;
	setup: (api: VipiEditorApi) => void;
};

export type VipiEditorRuntimeApi = {
	readonly version: typeof VIPI_EDITOR_API_VERSION;
	vim: {
		createLineEditor(options: VipiEditorLineEditorOptions): VipiEditorLineEditor;
		createTextareaEditor(options: VipiEditorTextareaEditorOptions): VipiEditorFieldControl;
		focusEditor(editor: VipiEditorFocusedModeEditor): void;
		onFocusedModeChange(handler: VipiEditorFocusedModeHandler): VipiEditorDispose;
	};
};

export type VipiEditorRuntimeApiRequest = {
	version: typeof VIPI_EDITOR_API_VERSION;
	receive: (api: VipiEditorRuntimeApi) => void;
};

export type VipiEditorReadyEvent = {
	version: typeof VIPI_EDITOR_API_VERSION;
};

export function defineVipiEditorExtension(registration: VipiEditorRegistration): VipiEditorRegistration {
	return registration;
}

export function registerVipiEditorExtension(pi: { events: VipiEditorEventBus }, registration: VipiEditorRegistration): VipiEditorDispose {
	const emit = () => pi.events.emit(VIPI_EDITOR_REGISTER, registration);
	emit();
	const offReady = pi.events.on(VIPI_EDITOR_READY, emit);
	return () => offReady();
}

export function isVipiEditorRegistration(value: unknown): value is VipiEditorRegistration {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { extensionId?: unknown; setup?: unknown };
	return typeof candidate.extensionId === "string" && candidate.extensionId.length > 0 && typeof candidate.setup === "function";
}

export function isVipiEditorRuntimeApiRequest(value: unknown): value is VipiEditorRuntimeApiRequest {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { version?: unknown; receive?: unknown };
	return candidate.version === VIPI_EDITOR_API_VERSION && typeof candidate.receive === "function";
}

export function isPrintableInput(data: string): boolean {
	return getPrintableInput(data) !== undefined;
}

export function getPrintableInput(data: string): string | undefined {
	if (data.length === 1 && data.charCodeAt(0) >= 32) return data;
	const decoded = decodeKittyPrintable(data);
	if (decoded) return decoded;
	const parsed = parseKey(data);
	return parsed?.length === 1 ? parsed : undefined;
}

export function buildRenderedLineMaps(bodyLines: string[], logicalLines: string[]): VipiEditorRenderedLineMap[] {
	const maps: VipiEditorRenderedLineMap[] = [];
	const nextSearchCol = new Map<number, number>();

	for (const [bodyIndex, bodyLine] of bodyLines.entries()) {
		const stripped = stripTerminalSequences(bodyLine).trimEnd();
		const content = findRenderedContent(stripped, logicalLines, nextSearchCol);
		if (!content) continue;

		maps.push({
			outputLine: bodyIndex + 1,
			logicalLine: content.logicalLine,
			startCol: content.startCol,
			endCol: content.endCol,
			lineStartCol: content.lineStartCol,
		});
		nextSearchCol.set(content.logicalLine, content.endCol);
	}

	return maps;
}

function findRenderedContent(
	strippedBodyLine: string,
	logicalLines: string[],
	nextSearchCol: Map<number, number>,
): Omit<VipiEditorRenderedLineMap, "outputLine"> | undefined {
	let best: Omit<VipiEditorRenderedLineMap, "outputLine"> | undefined;
	for (const [logicalLine, logicalText] of logicalLines.entries()) {
		const from = nextSearchCol.get(logicalLine) ?? 0;
		for (let startCol = from; startCol <= logicalText.length; startCol++) {
			const suffix = logicalText.slice(startCol);
			if (suffix.length === 0) continue;

			const candidate = longestPrefixInLine(suffix, strippedBodyLine);
			if (!candidate || (best && candidate.text.length <= best.endCol - best.startCol)) continue;

			best = {
				logicalLine,
				startCol,
				endCol: startCol + candidate.text.length,
				lineStartCol: candidate.lineStartCol,
			};
		}
	}
	return best;
}

function longestPrefixInLine(text: string, line: string): { text: string; lineStartCol: number } | undefined {
	for (let length = text.length; length > 0; length--) {
		const prefix = text.slice(0, length).trimEnd();
		if (!prefix) continue;

		const lineStartCol = line.indexOf(prefix);
		if (lineStartCol !== -1) return { text: prefix, lineStartCol };
	}
	return undefined;
}
