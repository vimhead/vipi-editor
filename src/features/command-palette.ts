import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	type AutocompleteItem,
	type AutocompleteProvider,
	type Component,
	type Focusable,
	type TUI,
} from "@earendil-works/pi-tui";
import { defineVipiEditorExtension, type LineEditor, type VipiEditorApi, type PromptEditor } from "../api.ts";

type ExtensionCommandInfo = ReturnType<ExtensionAPI["getCommands"]>[number];
type PaletteCommandSource = ExtensionCommandInfo["source"] | "builtin";
type CommandInfo = {
	name: string;
	description?: string;
	source: PaletteCommandSource;
	argumentHint?: string;
};
type AppKeybindingName = Parameters<KeybindingsManager["getKeys"]>[0];
type SizeValue = number | `${number}%`;
type OverlayMargin = number | { top?: number; right?: number; bottom?: number; left?: number } | undefined;
type OverlayRowBudgetOptions = { maxHeight: SizeValue | undefined; margin: OverlayMargin };

type PaletteResult = { command: CommandInfo; args: string } | { cancel: true };
type ExecuteCommandOptions = { command: CommandInfo; args: string; editor: PromptEditor };
type PaletteStage = "select" | "args";
type RankedCommand = {
	command: CommandInfo;
	score: number;
};

type CommandPaletteOptions = {
	tui: TUI;
	theme: Theme;
	keybindings: KeybindingsManager;
	finish: (result: PaletteResult) => void;
	commands: CommandInfo[];
	createLineEditor: VipiEditorApi["vim"]["createLineEditor"];
};

type BoxSections = {
	maxRows: number;
	title: string;
	input: string;
	hint: string | undefined;
	body: string[];
	separator: string;
	footer: string;
	bottom: string;
};

type ScrollWindowOptions<T> = {
	items: readonly T[];
	selectedIndex: number;
	previousOffset: number;
	visibleRows: number;
};

type PaletteInputLineOptions = {
	label: string;
	line: LineEditor;
	placeholder: string;
	boxWidth: number;
};

type CommandRowsOptions = {
	items: RankedCommand[];
	offset: number;
	total: number;
	bodyRows: number;
	boxWidth: number;
};

type SuggestionRowsOptions = {
	items: AutocompleteItem[];
	offset: number;
	bodyRows: number;
	boxWidth: number;
};

const COMMAND_ICON = "󰍉";
const BUILTIN_COMMANDS: readonly CommandInfo[] = [
	{ name: "settings", description: "Open settings menu", source: "builtin" },
	{ name: "model", description: "Select model", argumentHint: "<provider/model>", source: "builtin" },
	{ name: "scoped-models", description: "Enable or disable models for Ctrl+P cycling", source: "builtin" },
	{ name: "export", description: "Export session", source: "builtin" },
	{ name: "import", description: "Import and resume a session from JSONL", source: "builtin" },
	{ name: "share", description: "Share session as a secret GitHub gist", source: "builtin" },
	{ name: "copy", description: "Copy last agent message to clipboard", source: "builtin" },
	{ name: "name", description: "Set session display name", argumentHint: "<name>", source: "builtin" },
	{ name: "session", description: "Show session info and stats", source: "builtin" },
	{ name: "changelog", description: "Show changelog entries", source: "builtin" },
	{ name: "hotkeys", description: "Show keyboard shortcuts", source: "builtin" },
	{ name: "fork", description: "Create a new fork from a previous user message", source: "builtin" },
	{ name: "clone", description: "Duplicate current session", source: "builtin" },
	{ name: "tree", description: "Navigate session tree", source: "builtin" },
	{ name: "trust", description: "Save project trust decision", source: "builtin" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>", source: "builtin" },
	{ name: "logout", description: "Remove provider authentication", source: "builtin" },
	{ name: "new", description: "Start a new session", source: "builtin" },
	{ name: "compact", description: "Manually compact session context", source: "builtin" },
	{ name: "resume", description: "Resume a different session", source: "builtin" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files", source: "builtin" },
	{ name: "quit", description: "Quit Pi", source: "builtin" },
];
const OVERLAY_OPTIONS = {
	width: "80%",
	minWidth: 56,
	maxHeight: "70%",
	margin: 1,
} as const;

const SPECIAL_KEYCAPS: Record<string, string> = {
	up: "󰁝",
	down: "󰁅",
	left: "󰁍",
	right: "󰁔",
	enter: "Enter",
	return: "Enter",
	escape: "Esc",
	esc: "Esc",
	space: "Space",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	pageUp: "PgUp",
	pageDown: "PgDn",
	pageup: "PgUp",
	pagedown: "PgDn",
	home: "Home",
	end: "End",
};

const MODIFIER_KEYCAPS: Record<string, string> = {
	ctrl: "C",
	shift: "S",
	alt: "A",
	option: "A",
	super: "Super",
};

let capturedAutocompleteProvider: AutocompleteProvider | undefined;
let autocompleteCaptureContext: ExtensionContext | undefined;

function captureAutocompleteProvider(ctx: ExtensionContext): void {
	if (autocompleteCaptureContext === ctx) return;
	autocompleteCaptureContext = ctx;
	capturedAutocompleteProvider = undefined;
	ctx.ui.addAutocompleteProvider((current) => {
		capturedAutocompleteProvider = current;
		return current;
	});
}

async function fetchArgumentSuggestions(
	command: CommandInfo,
	argText: string,
	signal: AbortSignal,
): Promise<AutocompleteItem[] | null> {
	const provider = capturedAutocompleteProvider;
	if (!provider) return null;
	const line = `/${command.name} ${argText}`;
	try {
		const result = await provider.getSuggestions([line], 0, line.length, { signal });
		return result && result.items.length > 0 ? result.items : null;
	} catch {
		return null;
	}
}

export const registration = defineVipiEditorExtension({
	extensionId: "command-palette",
	setup(api) {
		api.vim.registerBinding("normal", {
			keys: ["space", "space"],
			label: "SPC SPC",
			async run({ editor, pi, ctx }) {
				captureAutocompleteProvider(ctx);
				const result = await openCommandPalette({
					api,
					pi,
					ctx,
				});
				if ("command" in result) await executeCommand({ command: result.command, args: result.args, editor });
			},
		});
	},
});


function allCommands(pi: ExtensionAPI): CommandInfo[] {
	const extensionCommands = pi.getCommands().map((command) => ({
		name: command.name,
		description: command.description,
		source: command.source,
	}));
	const seen = new Set<string>();
	return [...BUILTIN_COMMANDS, ...extensionCommands].filter((command) => {
		if (seen.has(command.name)) return false;
		seen.add(command.name);
		return true;
	});
}

async function executeCommand(options: ExecuteCommandOptions): Promise<void> {
	const invocation = `/${options.command.name}${options.args ? ` ${options.args}` : ""}`;
	if (shouldRestoreDraftAfterCommand(options.command)) {
		await options.editor.submitText(invocation, { restoreText: options.editor.getText() });
		return;
	}
	await options.editor.submitText(invocation);
}

function shouldRestoreDraftAfterCommand(command: CommandInfo): boolean {
	return command.source === "builtin";
}

async function openCommandPalette(options: { api: VipiEditorApi; pi: ExtensionAPI; ctx: ExtensionContext }): Promise<PaletteResult> {
	const commands = allCommands(options.pi).sort(compareCommands);
		const result = await options.ctx.ui.custom<PaletteResult>((tui, theme, keybindings, finish) => {
			return new CommandPalette({ tui, theme, keybindings, finish, commands, createLineEditor: options.api.vim.createLineEditor });
		}, {
			overlay: true,
			overlayOptions: OVERLAY_OPTIONS,
		});

		return result ?? { cancel: true };
}

export class CommandPalette implements Component, Focusable {
	private isPaletteFocused = true;

	get focused(): boolean { return this.isPaletteFocused; }
	set focused(value: boolean) {
		this.isPaletteFocused = value;
		this.activeLine().setFocused(value);
	}
	private stage: PaletteStage = "select";
	private query: LineEditor;
	private args: LineEditor;
	private selectedIndex = 0;
	private scrollOffset = 0;
	private argsCommand: CommandInfo | undefined;
	private suggestions: AutocompleteItem[] = [];
	private suggestionSelected = 0;
	private suggestionOffset = 0;
	private suggestionToken = 0;
	private abortController: AbortController | undefined;
	private busyEnter = false;
	private closed = false;

	constructor(private readonly options: CommandPaletteOptions) {
		this.query = this.createLineEditor({ placeholder: "type to fuzzy search", isFocused: true });
		this.args = this.createLineEditor({ placeholder: "arguments", isFocused: false });
	}

	private get tui(): TUI {
		return this.options.tui;
	}

	private get theme(): Theme {
		return this.options.theme;
	}

	private get keybindings(): KeybindingsManager {
		return this.options.keybindings;
	}

	private get commands(): CommandInfo[] {
		return this.options.commands;
	}

	private createLineEditor(options: { placeholder: string; isFocused: boolean }): LineEditor {
		return this.options.createLineEditor({
			tui: this.tui,
			theme: this.theme,
			placeholder: options.placeholder,
			focused: options.isFocused,
			mode: "insert",
			onChange: () => this.onLineEdited(),
			onRequestRender: () => this.tui.requestRender(),
		});
	}

	dispose(): void {
		this.close();
	}

	render(width: number): string[] {
		return this.stage === "args" ? this.renderArgs(width) : this.renderSelect(width);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "escape")) this.escape();
		else if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.confirm();
			return;
		} else if (matchesKey(data, "tab")) this.tab();
		else if (this.handleListNavigation(data)) {
			this.tui.requestRender();
			return;
		} else this.activeLine().handleKey(data);

		this.tui.requestRender();
	}

	invalidate(): void {}

	private renderSelect(width: number): string[] {
		const boxWidth = Math.max(2, width);
		const maxRows = overlayRowBudget(this.tui, OVERLAY_OPTIONS);
		const ranked = this.filteredCommands();
		this.selectedIndex = clamp(this.selectedIndex, 0, Math.max(0, ranked.length - 1));

		const stickyRows = 5;
		const bodyRows = Math.max(0, maxRows - stickyRows);
		const window = scrollWindow({
			items: ranked,
			selectedIndex: this.selectedIndex,
			previousOffset: this.scrollOffset,
			visibleRows: Math.max(1, bodyRows),
		});
		this.scrollOffset = window.offset;

		const title = `${COMMAND_ICON} Commands${window.position ? ` ${window.position}` : ""}`;
		return assembleBox({
			maxRows,
			title: topBorder(title, boxWidth, this.theme),
			input: this.inputLine({
				label: this.theme.fg("muted", "Query: "),
				line: this.query,
				placeholder: "type to fuzzy search",
				boxWidth,
			}),
			hint: undefined,
			body: this.commandRows({ items: window.visibleItems, offset: window.offset, total: ranked.length, bodyRows, boxWidth }),
			separator: separator(boxWidth, this.theme),
			footer: boxRawLine(this.selectFooter(window.overflow, boxWidth), boxWidth, this.theme),
			bottom: bottomBorder(boxWidth, this.theme),
		}).map((line) => truncateToWidth(line, width, ""));
	}

	private renderArgs(width: number): string[] {
		const command = this.argsCommand;
		if (!command) return this.renderSelect(width);

		const boxWidth = Math.max(2, width);
		const maxRows = overlayRowBudget(this.tui, OVERLAY_OPTIONS);
		const showHint = Boolean(command.argumentHint) && maxRows >= 7;
		const stickyRows = showHint ? 6 : 5;
		const bodyRows = Math.max(0, maxRows - stickyRows);
		const window = scrollWindow({
			items: this.suggestions,
			selectedIndex: this.suggestionSelected,
			previousOffset: this.suggestionOffset,
			visibleRows: Math.max(1, bodyRows),
		});
		this.suggestionOffset = window.offset;

		const title = `${COMMAND_ICON} /${command.name}${window.position ? ` ${window.position}` : ""}`;
		const lines = assembleBox({
			maxRows,
			title: topBorder(title, boxWidth, this.theme),
			input: this.inputLine({
				label: this.theme.fg("muted", `/${command.name} `),
				line: this.args,
				placeholder: "arguments",
				boxWidth,
			}),
			hint: showHint ? boxLine(this.theme.fg("muted", command.argumentHint ?? ""), boxWidth, this.theme) : undefined,
			body: this.suggestionRows({ items: window.visibleItems, offset: window.offset, bodyRows, boxWidth }),
			separator: separator(boxWidth, this.theme),
			footer: boxRawLine(this.argsFooter(window.overflow, boxWidth), boxWidth, this.theme),
			bottom: bottomBorder(boxWidth, this.theme),
		});

		return lines.map((line) => truncateToWidth(line, width, ""));
	}

	private inputLine(options: PaletteInputLineOptions): string {
		const isLineFocused = this.focused && options.line.focused;
		const badge = options.line.renderModeBadge(this.theme);
		const inner = Math.max(2, options.boxWidth - 2);
		const leftWidth = Math.max(1, inner - visibleWidth(badge) - 1);
		const labelWidth = visibleWidth(stripTerminalSequences(options.label));
		const editorWidth = Math.max(1, leftWidth - 1 - labelWidth);
		const editor = options.line.renderInline(editorWidth, {
			theme: this.theme,
			placeholder: options.placeholder,
			focused: isLineFocused,
			showModeBadge: false,
		});
		const left = padCell(truncateToWidth(` ${options.label}${editor}`, leftWidth, ""), leftWidth);
		return `${this.theme.fg("border", "│")}${left}${badge} ${this.theme.fg("border", "│")}`;
	}

	private commandRows(options: CommandRowsOptions): string[] {
		const rows =
			options.total === 0
				? [this.emptyText()]
				: options.items.map((item, index) => this.commandRow(item.command, options.offset + index === this.selectedIndex, options.boxWidth));

		while (rows.length < options.bodyRows) rows.push("");
		return rows.slice(0, options.bodyRows).map((row) => boxLine(row, options.boxWidth, this.theme));
	}

	private suggestionRows(options: SuggestionRowsOptions): string[] {
		const rows =
			this.suggestions.length === 0
				? [this.theme.fg("muted", "no fixed suggestions")]
				: options.items.map((item, index) => this.suggestionRow(item, options.offset + index === this.suggestionSelected, options.boxWidth));

		while (rows.length < options.bodyRows) rows.push("");
		return rows.slice(0, options.bodyRows).map((row) => boxLine(row, options.boxWidth, this.theme));
	}

	private suggestionRow(item: AutocompleteItem, selected: boolean, width: number): string {
		const pointer = selected ? this.theme.fg("accent", "▸") : " ";
		const labelWidth = Math.min(32, Math.max(12, Math.floor(width * 0.4)));
		const base = `${pointer} ${padCell(safeText(item.label), labelWidth)}`;
		if (width < 68 || !item.description) return base;

		const descriptionWidth = Math.max(0, width - visibleWidth(base) - 5);
		const description = this.theme.fg("muted", truncateToWidth(safeText(item.description), descriptionWidth, "…"));
		return `${base} ${description}`;
	}

	private emptyText(): string {
		return this.theme.fg("muted", this.query.getText().trim() ? "No commands match this query" : "No commands available");
	}

	private commandRow(command: CommandInfo, selected: boolean, width: number): string {
		const pointer = selected ? this.theme.fg("accent", "▸") : " ";
		const source = this.theme.fg("muted", command.source);
		const nameWidth = Math.min(30, Math.max(12, Math.floor(width * 0.4)));
		const sourceWidth = 10;
		const base = `${pointer} ${padCell(safeText(command.name), nameWidth)} ${padCell(source, sourceWidth)}`;
		if (width < 76 || !command.description) return base;

		const descriptionWidth = Math.max(0, width - visibleWidth(base) - 5);
		const description = this.theme.fg("muted", truncateToWidth(safeText(command.description), descriptionWidth, "…"));
		return `${base} ${description}`;
	}

	private selectFooter(overflow: boolean, boxWidth: number): string {
		const mode = this.query.getMode();
		const move = mode === "insert" ? textEntryMoveHint(this.keybindings) : "j/k move";
		const actions = [
			"Type search",
			...(move ? [move] : []),
			...(overflow ? [pageHint(this.keybindings)] : []),
			"Enter run",
			"Tab args",
			...(mode === "normal" ? ["i insert"] : []),
		];
		const escape = mode === "insert" ? "Esc NORMAL" : "Esc close";
		return keybarLine(actions, [escape], Math.max(0, boxWidth - 2));
	}

	private argsFooter(overflow: boolean, boxWidth: number): string {
		const mode = this.args.getMode();
		const pick = mode === "insert" ? textEntryPickHint(this.keybindings) : "j/k pick";
		const actions = ["Type args", ...(pick ? [pick] : []), ...(overflow ? [pageHint(this.keybindings)] : []), "Tab accept", "Enter run"];
		const escape = mode === "insert" ? "Esc NORMAL" : "Esc back";
		return keybarLine(actions, [escape], Math.max(0, boxWidth - 2));
	}

	private escape(): void {
		const line = this.activeLine();
		if (line.getMode() === "insert") {
			line.setMode("normal");
			return;
		}
		if (line.getPendingLabel()) {
			line.handleKey("\x1b");
			return;
		}
		if (this.stage === "args") {
			this.leaveArgs();
			return;
		}
		this.finish({ cancel: true });
	}

	private tab(): void {
		if (this.stage === "args") {
			this.acceptSuggestion();
			return;
		}
		const command = this.filteredCommands()[this.selectedIndex]?.command;
		if (command) this.enterArgs(command);
	}

	private confirm(): void {
		if (this.busyEnter || this.closed) return;
		if (this.stage === "args") {
			const command = this.argsCommand;
			if (command) this.finish({ command, args: this.selectedArgsText() });
			return;
		}

		const command = this.filteredCommands()[this.selectedIndex]?.command;
		if (!command) return;

		if (command.source === "builtin") {
			if (command.argumentHint) this.enterArgs(command);
			else this.finish({ command, args: "" });
			return;
		}
		if (command.source === "prompt" || command.source === "skill") {
			this.enterArgs(command);
			return;
		}

		this.finishExtensionCommandAfterArgumentDiscovery(command);
	}

	private finishExtensionCommandAfterArgumentDiscovery(command: CommandInfo): void {
		this.busyEnter = true;
		const token = ++this.suggestionToken;
		const controller = new AbortController();
		this.abortController?.abort();
		this.abortController = controller;
		fetchArgumentSuggestions(command, "", controller.signal)
			.then((items) => {
				if (this.closed || token !== this.suggestionToken || this.stage !== "select") return;
				if (items) this.enterArgs(command);
				else this.finish({ command, args: "" });
			})
			.finally(() => {
				this.busyEnter = false;
			});
	}

	private enterArgs(command: CommandInfo): void {
		this.query.setFocused(false);
		this.stage = "args";
		this.argsCommand = command;
		this.args.dispose();
		this.args = this.createLineEditor({ placeholder: "arguments", isFocused: true });
		this.suggestions = [];
		this.suggestionSelected = 0;
		this.suggestionOffset = 0;
		this.refreshSuggestions();
	}

	private leaveArgs(): void {
		this.args.setFocused(false);
		this.stage = "select";
		this.argsCommand = undefined;
		this.suggestions = [];
		this.suggestionSelected = 0;
		this.suggestionOffset = 0;
		this.query.setFocused(true);
	}

	private acceptSuggestion(): void {
		const item = this.suggestions[this.suggestionSelected];
		if (!item) return;
		this.args.setText(safeText(item.value));
		this.refreshSuggestions();
	}

	private selectedArgsText(): string {
		const selected = this.suggestions[this.suggestionSelected];
		return safeText(selected?.value ?? this.args.getText()).trim();
	}

	private refreshSuggestions(): void {
		const command = this.argsCommand;
		if (!command) return;
		const token = ++this.suggestionToken;
		const controller = new AbortController();
		this.abortController?.abort();
		this.abortController = controller;
		fetchArgumentSuggestions(command, this.args.getText(), controller.signal).then((items) => {
			if (this.closed || token !== this.suggestionToken || this.stage !== "args") return;
			this.suggestions = items ?? [];
			this.suggestionSelected = 0;
			this.suggestionOffset = 0;
			this.tui.requestRender();
		});
	}

	private handleListNavigation(data: string): boolean {
		const listLength = this.stage === "args" ? this.suggestions.length : this.filteredCommands().length;
		if (listLength === 0) return false;

		const mode = this.activeLine().getMode();
		const safeOnly = mode === "insert";
		const matchesBinding = (binding: AppKeybindingName) =>
			safeOnly ? isSafeTextEntryNavigationInput(data, this.keybindings, binding) : this.keybindings.matches(data, binding);

		if (matchesBinding("tui.select.up")) this.move(-1);
		else if (matchesBinding("tui.select.down")) this.move(1);
		else if (matchesBinding("tui.select.pageUp")) this.page(-1);
		else if (matchesBinding("tui.select.pageDown")) this.page(1);
		else if (mode === "normal" && matchesKey(data, "j")) this.move(1);
		else if (mode === "normal" && matchesKey(data, "k")) this.move(-1);
		else return false;
		return true;
	}


	private activeLine(): LineEditor {
		return this.stage === "args" ? this.args : this.query;
	}

	private onLineEdited(): void {
		if (this.stage === "select") {
			this.selectedIndex = 0;
			this.scrollOffset = 0;
			return;
		}
		this.refreshSuggestions();
	}

	private filteredCommands(): RankedCommand[] {
		const query = this.query.getText().trim();
		if (!query) return this.commands.map((command, index) => ({ command, score: index }));

		return this.commands
			.map((command) => ({ command, score: fuzzyScore(query, commandSearchText(command)) }))
			.filter((ranked): ranked is RankedCommand => ranked.score !== undefined)
			.sort((left, right) => left.score - right.score || compareCommands(left.command, right.command));
	}

	private move(delta: number): void {
		if (this.stage === "args") {
			this.suggestionSelected = clamp(this.suggestionSelected + delta, 0, Math.max(0, this.suggestions.length - 1));
			return;
		}
		this.selectedIndex = clamp(this.selectedIndex + delta, 0, Math.max(0, this.filteredCommands().length - 1));
	}

	private page(delta: number): void {
		const stickyRows = this.stage === "args" && this.argsCommand?.argumentHint ? 6 : 5;
		const rows = Math.max(1, overlayRowBudget(this.tui, OVERLAY_OPTIONS) - stickyRows);
		this.move(delta * rows);
	}

	private finish(result: PaletteResult): void {
		if (!this.close()) return;
		this.options.finish(result);
	}

	private close(): boolean {
		if (this.closed) return false;
		this.closeLineEditors();
		this.closed = true;
		this.abortController?.abort();
		return true;
	}

	private closeLineEditors(): void {
		const active = this.activeLine();
		const inactive = active === this.query ? this.args : this.query;
		inactive.dispose();
		active.dispose();
	}
}

function commandSearchText(command: CommandInfo): string {
	return `${command.name} ${command.description ?? ""} ${command.source}`;
}

function fuzzyScore(query: string, text: string): number | undefined {
	const needle = query.toLowerCase();
	const haystack = text.toLowerCase();
	let score = 0;
	let lastIndex = -1;
	let runLength = 0;

	for (const char of needle) {
		if (char === " ") continue;
		const index = haystack.indexOf(char, lastIndex + 1);
		if (index === -1) return undefined;

		const gap = lastIndex === -1 ? index : index - lastIndex - 1;
		runLength = gap === 0 ? runLength + 1 : 0;
		score += gap * 8 + index;
		if (index === 0 || haystack[index - 1] === " " || haystack[index - 1] === "-" || haystack[index - 1] === "_") score -= 6;
		score -= runLength * 4;
		lastIndex = index;
	}

	return score;
}

function compareCommands(left: CommandInfo, right: CommandInfo): number {
	return left.source.localeCompare(right.source) || left.name.localeCompare(right.name);
}

function safeText(text: string): string {
	return stripTerminalSequences(text);
}

function padCell(text: string, width: number): string {
	const cellWidth = Math.max(0, width);
	const truncated = truncateToWidth(text, cellWidth, "…");
	return `${truncated}${" ".repeat(Math.max(0, cellWidth - visibleWidth(truncated)))}`;
}

function resolveRows(value: SizeValue | undefined, totalRows: number): number {
	if (typeof value === "number") return Math.max(1, Math.floor(value));
	if (typeof value === "string" && value.endsWith("%")) {
		const percent = Number(value.slice(0, -1));
		if (Number.isFinite(percent)) return Math.max(1, Math.floor((totalRows * percent) / 100));
	}
	return Math.max(1, totalRows);
}

function verticalMarginRows(margin: OverlayMargin): number {
	if (typeof margin === "number") return Math.max(0, margin * 2);
	return Math.max(0, (margin?.top ?? 0) + (margin?.bottom ?? 0));
}

function overlayRowBudget(tui: Pick<TUI, "terminal">, options: OverlayRowBudgetOptions): number {
	const terminalRows = Math.max(1, tui.terminal.rows);
	const maxByHeight = resolveRows(options.maxHeight, terminalRows);
	const maxByMargin = Math.max(1, terminalRows - verticalMarginRows(options.margin));
	return Math.max(1, Math.min(maxByHeight, maxByMargin));
}

function scrollWindow<T>(options: ScrollWindowOptions<T>) {
	const total = options.items.length;
	const rows = Math.max(1, options.visibleRows);
	const maxOffset = Math.max(0, total - rows);
	let offset = Math.max(0, Math.min(options.previousOffset, maxOffset));

	if (options.selectedIndex < offset) offset = options.selectedIndex;
	else if (options.selectedIndex >= offset + rows) offset = options.selectedIndex - rows + 1;

	return {
		offset,
		visibleItems: options.items.slice(offset, offset + rows),
		overflow: total > rows,
		position: total > rows ? `${Math.min(total, options.selectedIndex + 1)}/${total}` : undefined,
	};
}

function assembleBox(sections: BoxSections): string[] {
	const hint = sections.hint ? [sections.hint] : [];
	const full = [sections.title, sections.input, ...hint, ...sections.body, sections.separator, sections.footer, sections.bottom];
	if (full.length <= sections.maxRows) return full;
	const withoutSeparator = [sections.title, sections.input, ...hint, ...sections.body, sections.footer, sections.bottom];
	if (withoutSeparator.length <= sections.maxRows) return withoutSeparator;
	const withoutInput = [sections.title, ...sections.body, sections.footer, sections.bottom];
	if (withoutInput.length <= sections.maxRows) return withoutInput;
	return [sections.title, sections.footer, sections.bottom].slice(0, Math.max(1, sections.maxRows));
}

function topBorder(title: string, width: number, theme: Theme): string {
	const boxWidth = Math.max(2, width);
	const prefix = `${theme.fg("border", "╭─ ")}${theme.fg("accent", theme.bold(title))}${theme.fg("border", " ")}`;
	const suffix = theme.fg("border", "╮");
	const fill = Math.max(0, boxWidth - visibleWidth(prefix) - visibleWidth(suffix));
	return `${prefix}${theme.fg("border", "─".repeat(fill))}${suffix}`;
}

function boxLine(content: string, width: number, theme: Theme): string {
	const boxWidth = Math.max(2, width);
	const inner = Math.max(0, boxWidth - 2);
	return `${theme.fg("border", "│")}${padCell(` ${content}`, inner)}${theme.fg("border", "│")}`;
}

function boxRawLine(content: string, width: number, theme: Theme): string {
	const boxWidth = Math.max(2, width);
	const inner = Math.max(0, boxWidth - 2);
	return `${theme.fg("border", "│")}${padCell(content, inner)}${theme.fg("border", "│")}`;
}

function separator(width: number, theme: Theme): string {
	const boxWidth = Math.max(2, width);
	return theme.fg("border", `├${"─".repeat(Math.max(0, boxWidth - 2))}┤`);
}

function bottomBorder(width: number, theme: Theme): string {
	const boxWidth = Math.max(2, width);
	return theme.fg("border", `╰${"─".repeat(Math.max(0, boxWidth - 2))}╯`);
}

function formatKeycap(key: string): string {
	const parts = key.split("+");
	const base = parts.pop() ?? key;
	const modifiers = parts.map((part) => MODIFIER_KEYCAPS[part] ?? part);
	const baseLabel = SPECIAL_KEYCAPS[base] ?? base;
	return modifiers.length > 0 ? `${modifiers.join("-")}-${baseLabel}` : baseLabel;
}

function firstKeyLabel(keybindings: KeybindingsManager, keybinding: AppKeybindingName): string {
	const [first] = keybindings.getKeys(keybinding);
	return first ? formatKeycap(first) : "?";
}

function pageHint(keybindings: KeybindingsManager): string {
	return `${firstKeyLabel(keybindings, "tui.select.pageUp")}/${firstKeyLabel(keybindings, "tui.select.pageDown")} page`;
}

function isBarePrintableKey(key: string): boolean {
	return key.length === 1 || /^[a-z0-9]$/i.test(key);
}

function isTextEntrySafeKey(key: string): boolean {
	return key.includes("+") || !isBarePrintableKey(key);
}

function isSafeTextEntryNavigationInput(
	data: string,
	keybindings: KeybindingsManager,
	keybinding: AppKeybindingName,
): boolean {
	return keybindings.getKeys(keybinding).some((key) => isTextEntrySafeKey(key) && matchesKey(data, key));
}

function textEntryMoveHint(keybindings: KeybindingsManager): string | undefined {
	return textEntryHint(keybindings, "move");
}

function textEntryPickHint(keybindings: KeybindingsManager): string | undefined {
	return textEntryHint(keybindings, "pick");
}

function textEntryHint(keybindings: KeybindingsManager, verb: string): string | undefined {
	const up = keybindings.getKeys("tui.select.up").find(isTextEntrySafeKey);
	const down = keybindings.getKeys("tui.select.down").find(isTextEntrySafeKey);
	return up && down ? `${formatKeycap(up)}/${formatKeycap(down)} ${verb}` : undefined;
}

function keybarLine(leftActions: string[], rightActions: string[], innerWidth: number): string {
	const left = [...leftActions];
	const right = [...rightActions];
	const raw = (): string => {
		const leftText = left.length > 0 ? `  ${left.join("   ")}` : "  ";
		if (right.length === 0) return leftText;
		const rightText = `${right.join("   ")}  `;
		const gap = Math.max(1, innerWidth - visibleWidth(leftText) - visibleWidth(rightText));
		return `${leftText}${" ".repeat(gap)}${rightText}`;
	};

	while (left.length > 0 && visibleWidth(raw()) > innerWidth) left.pop();
	while (right.length > 1 && visibleWidth(raw()) > innerWidth) right.shift();
	return padCell(raw(), innerWidth);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
