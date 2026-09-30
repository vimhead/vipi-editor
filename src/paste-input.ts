import { existsSync } from "node:fs";

const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";
const PATCHED_STDIN_BUFFER_REGISTRY_KEY = Symbol.for("vipi-editor.patchedDroppedPathStdinBufferRegistry");

type StdinBufferInput = string | Buffer;

type PatchableStdinBuffer = {
	process(data: StdinBufferInput): void;
};

type TerminalWithStdinBuffer = {
	stdinBuffer?: PatchableStdinBuffer;
};

type PatchedStdinBufferRegistry = WeakSet<PatchableStdinBuffer>;

export function patchDroppedPathPasteInput(terminal: object): void {
	const stdinBuffer = (terminal as TerminalWithStdinBuffer).stdinBuffer;
	if (!stdinBuffer || patchedStdinBufferRegistry().has(stdinBuffer)) return;

	const processInput = stdinBuffer.process.bind(stdinBuffer);
	stdinBuffer.process = (data: StdinBufferInput) => {
		const text = Buffer.isBuffer(data) ? data.toString() : data;
		if (isRawDroppedPathText(text)) {
			processInput(`${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`);
			return;
		}
		processInput(data);
	};
	patchedStdinBufferRegistry().add(stdinBuffer);
}

function isRawDroppedPathText(text: string): boolean {
	if (text.length < 2 || text.includes("\x1b")) return false;
	const paths = text.split(/\r?\n/).filter(Boolean);
	return paths.length > 0 && paths.every(isExistingAbsolutePath);
}

function isExistingAbsolutePath(path: string): boolean {
	return path.startsWith("/") && existsSync(path);
}

function patchedStdinBufferRegistry(): PatchedStdinBufferRegistry {
	const globalState = globalThis as Record<symbol, PatchedStdinBufferRegistry | undefined>;
	globalState[PATCHED_STDIN_BUFFER_REGISTRY_KEY] ??= new WeakSet();
	return globalState[PATCHED_STDIN_BUFFER_REGISTRY_KEY];
}
