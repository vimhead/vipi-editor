import { visibleWidth } from "@earendil-works/pi-tui";

import type { VimCursorStyle } from "./vim-core.ts";

const HARDWARE_CURSOR_BLOCK = "\x1b[2 q";
const HARDWARE_CURSOR_THIN = "\x1b[6 q";
const HIDE_HARDWARE_CURSOR = "\x1b[?25l";
const BEGIN_SYNCHRONIZED_OUTPUT = "\x1b[?2026h";
const END_SYNCHRONIZED_OUTPUT = "\x1b[?2026l";
const CLEAR_LINE = "\x1b[2K";

export type HardwareCursorTerminal = {
	write(data: string): void;
	readonly columns?: number;
};

type HardwareCursorRegistry = WeakMap<HardwareCursorTerminal, HardwareCursor>;
type PatchedTerminalRegistry = WeakSet<HardwareCursorTerminal>;

const HARDWARE_CURSOR_REGISTRY_KEY = Symbol.for("vipir-editor.hardwareCursorRegistry");
const PATCHED_TERMINAL_REGISTRY_KEY = Symbol.for("vipir-editor.patchedTerminalRegistry");

export class HardwareCursor {
	private currentStyle: VimCursorStyle | undefined;

	constructor(private readonly terminal: HardwareCursorTerminal) {}

	requestStyle(style: VimCursorStyle): void {
		if (this.currentStyle === style) return;
		this.currentStyle = style;
		this.terminal.write(`${HIDE_HARDWARE_CURSOR}${style === "thin" ? HARDWARE_CURSOR_THIN : HARDWARE_CURSOR_BLOCK}`);
	}

	forgetStyle(): void {
		this.currentStyle = undefined;
	}
}

export function hideHardwareCursorDuringRepaint(terminal: HardwareCursorTerminal): void {
	const patchedTerminals = patchedTerminalRegistry();
	if (patchedTerminals.has(terminal)) return;

	const writeToTerminal = terminal.write.bind(terminal);
	terminal.write = (data: string) => {
		const output = data.includes(BEGIN_SYNCHRONIZED_OUTPUT) ? removeRedundantLineClears(data, terminal.columns) : data;
		writeToTerminal(data.includes(BEGIN_SYNCHRONIZED_OUTPUT) ? `${HIDE_HARDWARE_CURSOR}${output}` : output);
	};
	patchedTerminals.add(terminal);
}

export function hardwareCursorForTerminal(terminal: HardwareCursorTerminal): HardwareCursor {
	const cursorsByTerminal = hardwareCursorRegistry();
	const existingCursor = cursorsByTerminal.get(terminal);
	if (existingCursor) return existingCursor;

	const cursor = new HardwareCursor(terminal);
	cursorsByTerminal.set(terminal, cursor);
	return cursor;
}

function removeRedundantLineClears(data: string, terminalColumns: number | undefined): string {
	const width = terminalColumns ?? 0;
	if (width <= 0 || !data.includes(CLEAR_LINE)) return data;

	let result = "";
	let cursor = 0;
	while (cursor < data.length) {
		const clearIndex = data.indexOf(CLEAR_LINE, cursor);
		if (clearIndex === -1) return result + data.slice(cursor);

		const lineStart = clearIndex + CLEAR_LINE.length;
		const lineEnd = nextRenderedLineBoundary(data, lineStart);
		const renderedLine = data.slice(lineStart, lineEnd);
		result += data.slice(cursor, clearIndex);
		if (visibleWidth(renderedLine) < width) result += CLEAR_LINE;
		cursor = lineStart;
	}
	return result;
}

function nextRenderedLineBoundary(data: string, start: number): number {
	const newlineIndex = data.indexOf("\r\n", start);
	const syncEndIndex = data.indexOf(END_SYNCHRONIZED_OUTPUT, start);
	if (newlineIndex === -1) return syncEndIndex === -1 ? data.length : syncEndIndex;
	if (syncEndIndex === -1) return newlineIndex;
	return Math.min(newlineIndex, syncEndIndex);
}

function hardwareCursorRegistry(): HardwareCursorRegistry {
	const globalState = globalThis as Record<symbol, HardwareCursorRegistry | undefined>;
	globalState[HARDWARE_CURSOR_REGISTRY_KEY] ??= new WeakMap();
	return globalState[HARDWARE_CURSOR_REGISTRY_KEY];
}

function patchedTerminalRegistry(): PatchedTerminalRegistry {
	const globalState = globalThis as Record<symbol, PatchedTerminalRegistry | undefined>;
	globalState[PATCHED_TERMINAL_REGISTRY_KEY] ??= new WeakSet();
	return globalState[PATCHED_TERMINAL_REGISTRY_KEY];
}
