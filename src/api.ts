import {
	decodeKittyPrintable,
	parseKey,
	stripTerminalSequences,
} from "@earendil-works/pi-tui";
import type { LineEditor as VipirEditorLineEditor, LineEditorOptions as VipirEditorLineEditorOptions } from "./line-editor.ts";
import type { FieldControl as VipirEditorFieldControl, TextareaEditorOptions as VipirEditorTextareaEditorOptions } from "./textarea-editor.ts";
import type { VipirEditorEventBus, VipirEditorExtensionApi, VipirEditorExtensionContext, VipirEditorTheme } from "./types.ts";
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

// Keep v1 wire channels stable for clients loaded from older package versions.
export const VIPIR_EDITOR_API_VERSION = 1;
export const VIPIR_EDITOR_READY = "vipi-editor:v1:ready";
export const VIPIR_EDITOR_UNREADY = "vipi-editor:v1:unready";
export const VIPIR_EDITOR_REGISTER = "vipi-editor:v1:register";
export const VIPIR_EDITOR_RUNTIME_API_REQUEST = "vipi-editor:v1:runtime-api-request";

export type VipirEditorModeId = string;
export type VipirEditorCursorStyle = "thin" | "block";
export type VipirEditorDispose = () => void;
export type { VipirEditorEventBus, VipirEditorExtensionApi, VipirEditorExtensionContext, VipirEditorKeybindingsManager, VipirEditorKeySequence, VipirEditorTheme } from "./types.ts";

export type VipirEditorPosition = {
	line: number;
	col: number;
};

export type VipirEditorTextRange = {
	from: VipirEditorPosition;
	to: VipirEditorPosition;
	linewise?: boolean;
};

export type VipirEditorRenderedLineMap = {
	outputLine: number;
	logicalLine: number;
	startCol: number;
	endCol: number;
	lineStartCol: number;
};

export type VipirEditorSubmitTextOptions = {
	restoreText?: string;
};

export interface PromptEditor {
	getText(): string;
	getLines(): string[];
	getCursor(): VipirEditorPosition;
	getMode(): VipirEditorModeId;
	setMode(mode: VipirEditorModeId): void;
	requestRender(): void;
	submitText(text: string, options?: VipirEditorSubmitTextOptions): Promise<void>;
	runEditorInput(data: string): void;
	moveToPosition(position: VipirEditorPosition): void;
	getTheme(): VipirEditorTheme;
}

export type VipirEditorServices = {
	editor: PromptEditor;
	pi: VipirEditorExtensionApi;
	ctx: VipirEditorExtensionContext;
};

export type VipirEditorCommandContext = VimCommandContext<VipirEditorServices>;
export type VipirEditorModeLabel = VimModeLabel<VipirEditorServices>;
export type VipirEditorModeDefinition = VimModeDefinition<VipirEditorServices>;
export type VipirEditorBinding = VimBinding<VipirEditorServices>;
export type VipirEditorFocusedModeEditor = PromptEditor | VipirEditorLineEditor | VipirEditorFieldControl;
export type VipirEditorFocusedModeEvent = Omit<VipirEditorServices, "editor"> & {
	editor: VipirEditorFocusedModeEditor;
	mode: VipirEditorModeId;
};
export type VipirEditorFocusedModeHandler = (event: VipirEditorFocusedModeEvent) => void | Promise<void>;

export type VipirEditorApi = {
	readonly version: typeof VIPIR_EDITOR_API_VERSION;
	onDispose(action: VipirEditorDispose): void;
	vim: {
		registerMode(mode: VipirEditorModeDefinition): VipirEditorDispose;
		registerBinding(modeId: VipirEditorModeId, binding: VipirEditorBinding): VipirEditorDispose;
		createLineEditor(options: VipirEditorLineEditorOptions): VipirEditorLineEditor;
		createTextareaEditor(options: VipirEditorTextareaEditorOptions): VipirEditorFieldControl;
		focusEditor(editor: VipirEditorFocusedModeEditor): void;
		onFocusedModeChange(handler: VipirEditorFocusedModeHandler): VipirEditorDispose;
	};
};

export type VipirEditorRegistration = {
	extensionId: string;
	setup: (api: VipirEditorApi) => void;
};

export type VipirEditorRuntimeApi = {
	readonly version: typeof VIPIR_EDITOR_API_VERSION;
	vim: {
		createLineEditor(options: VipirEditorLineEditorOptions): VipirEditorLineEditor;
		createTextareaEditor(options: VipirEditorTextareaEditorOptions): VipirEditorFieldControl;
		focusEditor(editor: VipirEditorFocusedModeEditor): void;
		onFocusedModeChange(handler: VipirEditorFocusedModeHandler): VipirEditorDispose;
	};
};

export type VipirEditorRuntimeApiRequest = {
	version: typeof VIPIR_EDITOR_API_VERSION;
	receive: (api: VipirEditorRuntimeApi) => void;
};

export type VipirEditorReadyEvent = {
	version: typeof VIPIR_EDITOR_API_VERSION;
};

export function defineVipirEditorExtension(registration: VipirEditorRegistration): VipirEditorRegistration {
	return registration;
}

export function registerVipirEditorExtension(pi: { events: VipirEditorEventBus }, registration: VipirEditorRegistration): VipirEditorDispose {
	const emit = () => pi.events.emit(VIPIR_EDITOR_REGISTER, registration);
	emit();
	const offReady = pi.events.on(VIPIR_EDITOR_READY, emit);
	return () => offReady();
}

export function isVipirEditorRegistration(value: unknown): value is VipirEditorRegistration {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { extensionId?: unknown; setup?: unknown };
	return typeof candidate.extensionId === "string" && candidate.extensionId.length > 0 && typeof candidate.setup === "function";
}

export function isVipirEditorRuntimeApiRequest(value: unknown): value is VipirEditorRuntimeApiRequest {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { version?: unknown; receive?: unknown };
	return candidate.version === VIPIR_EDITOR_API_VERSION && typeof candidate.receive === "function";
}

export {
	VIPIR_EDITOR_API_VERSION as VIPI_EDITOR_API_VERSION,
	VIPIR_EDITOR_READY as VIPI_EDITOR_READY,
	VIPIR_EDITOR_UNREADY as VIPI_EDITOR_UNREADY,
	VIPIR_EDITOR_REGISTER as VIPI_EDITOR_REGISTER,
	VIPIR_EDITOR_RUNTIME_API_REQUEST as VIPI_EDITOR_RUNTIME_API_REQUEST,
	defineVipirEditorExtension as defineVipiEditorExtension,
	registerVipirEditorExtension as registerVipiEditorExtension,
	isVipirEditorRegistration as isVipiEditorRegistration,
	isVipirEditorRuntimeApiRequest as isVipiEditorRuntimeApiRequest,
};
export type {
	VipirEditorModeId as VipiEditorModeId,
	VipirEditorCursorStyle as VipiEditorCursorStyle,
	VipirEditorDispose as VipiEditorDispose,
	VipirEditorPosition as VipiEditorPosition,
	VipirEditorTextRange as VipiEditorTextRange,
	VipirEditorRenderedLineMap as VipiEditorRenderedLineMap,
	VipirEditorSubmitTextOptions as VipiEditorSubmitTextOptions,
	VipirEditorServices as VipiEditorServices,
	VipirEditorCommandContext as VipiEditorCommandContext,
	VipirEditorModeLabel as VipiEditorModeLabel,
	VipirEditorModeDefinition as VipiEditorModeDefinition,
	VipirEditorBinding as VipiEditorBinding,
	VipirEditorFocusedModeEditor as VipiEditorFocusedModeEditor,
	VipirEditorFocusedModeEvent as VipiEditorFocusedModeEvent,
	VipirEditorFocusedModeHandler as VipiEditorFocusedModeHandler,
	VipirEditorApi as VipiEditorApi,
	VipirEditorRegistration as VipiEditorRegistration,
	VipirEditorRuntimeApi as VipiEditorRuntimeApi,
	VipirEditorRuntimeApiRequest as VipiEditorRuntimeApiRequest,
	VipirEditorReadyEvent as VipiEditorReadyEvent,
};
export type {
	VipirEditorTheme as VipiEditorTheme,
	VipirEditorEventBus as VipiEditorEventBus,
	VipirEditorExtensionApi as VipiEditorExtensionApi,
	VipirEditorExtensionContext as VipiEditorExtensionContext,
	VipirEditorKeybindingsManager as VipiEditorKeybindingsManager,
	VipirEditorKeySequence as VipiEditorKeySequence,
} from "./types.ts";

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

export function buildRenderedLineMaps(bodyLines: string[], logicalLines: string[]): VipirEditorRenderedLineMap[] {
	const maps: VipirEditorRenderedLineMap[] = [];
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
): Omit<VipirEditorRenderedLineMap, "outputLine"> | undefined {
	let best: Omit<VipirEditorRenderedLineMap, "outputLine"> | undefined;
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
