import { matchesKey, sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	buildRenderedLineMaps,
	defineVipiEditorExtension,
	getPrintableInput,
	normalizeRange,
	type PromptEditor,
	type VipiEditorPosition,
	type VipiEditorRenderedLineMap,
	type VipiEditorTextRange,
} from "../api.ts";

type JumpMatch = {
	line: number;
	col: number;
	endCol: number;
	label?: string;
};

type JumpState = {
	pattern: string;
	matches: JumpMatch[];
	labels: Map<string, JumpMatch>;
	visibleRanges: VipiEditorTextRange[];
	target?: JumpMatch;
};

type RenderJumpSegmentOptions = {
	editor: PromptEditor;
	segment: string;
	matches: JumpMatch[];
	map: VipiEditorRenderedLineMap;
	suffixWidth: number;
	width: number;
};

const JUMP_MODE_ID = "jump";
const PRIMARY_JUMP_LABELS = "asdfghjklqwertyuiopzxcvbnm";
const FALLBACK_JUMP_LABELS = PRIMARY_JUMP_LABELS.toUpperCase();
const JUMP_LABELS = `${PRIMARY_JUMP_LABELS}${FALLBACK_JUMP_LABELS}`;
const jumpStates = new WeakMap<PromptEditor, JumpState>();

export const registration = defineVipiEditorExtension({
	extensionId: "jump-mode",
	setup(api) {
		api.vim.registerMode({
			id: JUMP_MODE_ID,
			label: ({ editor }) => {
				const pattern = jumpStates.get(editor)?.pattern;
				return pattern ? `JUMP ${pattern}` : "JUMP";
			},
			cursor: "block",
			onEnter({ editor }) {
				jumpStates.set(editor, createJumpState(editor, ""));
			},
			onExit({ editor }) {
				jumpStates.delete(editor);
			},
			handleInput({ editor }, input) {
				return handleJumpInput(editor, input);
			},
			render({ editor }, lines, width) {
				return renderJumpOverlay(editor, lines, width);
			},
		});

		api.vim.registerBinding("normal", {
			keys: ["s"],
			run({ editor }) {
				editor.setMode(JUMP_MODE_ID);
			},
		});
	},
});


function handleJumpInput(editor: PromptEditor, input: string): boolean {
	if (matchesKey(input, "escape")) {
		editor.setMode("normal");
		return true;
	}

	if (matchesKey(input, "backspace")) {
		const pattern = jumpStates.get(editor)?.pattern ?? "";
		const next = createJumpState(editor, pattern.slice(0, -1));
		next.visibleRanges = jumpStates.get(editor)?.visibleRanges ?? [];
		jumpStates.set(editor, next);
		editor.requestRender();
		return true;
	}

	if (matchesKey(input, "enter")) {
		const target = jumpStates.get(editor)?.target;
		if (target) jumpToMatch(editor, target);
		editor.setMode("normal");
		return true;
	}

	const char = getPrintableInput(input);
	if (!char) {
		editor.runEditorInput(input);
		return true;
	}

	const labeledMatch = jumpStates.get(editor)?.labels.get(char);
	if (labeledMatch) {
		jumpToMatch(editor, labeledMatch);
		editor.setMode("normal");
		return true;
	}

	const previous = jumpStates.get(editor);
	const next = createJumpState(editor, `${previous?.pattern ?? ""}${char.toLowerCase()}`);
	next.visibleRanges = previous?.visibleRanges ?? [];
	jumpStates.set(editor, next);
	editor.requestRender();
	return true;
}

function createJumpState(editor: PromptEditor, pattern: string): JumpState {
	const previousVisibleRanges = jumpStates.get(editor)?.visibleRanges ?? [];
	const matches = assignJumpLabels(editor, pattern, computeJumpMatches(editor, pattern, previousVisibleRanges));
	return {
		pattern,
		matches,
		labels: new Map(matches.flatMap((match) => (match.label ? [[match.label, match]] : []))),
		visibleRanges: previousVisibleRanges,
		target: matches[0],
	};
}

function computeJumpMatches(editor: PromptEditor, pattern: string, visibleRanges: VipiEditorTextRange[]): JumpMatch[] {
	if (pattern.length === 0) return [];

	const cursor = editor.getCursor();
	const matches: JumpMatch[] = [];
	const normalizedPattern = pattern.toLowerCase();
	for (const [lineIndex, line] of editor.getLines().entries()) {
		const normalizedLine = line.toLowerCase();
		let col = normalizedLine.indexOf(normalizedPattern);
		while (col !== -1) {
			const match = { line: lineIndex, col, endCol: col + pattern.length };
			if (visibleRanges.length === 0 || visibleRanges.some((range) => rangeContainsMatch(range, match))) {
				matches.push(match);
			}
			col = normalizedLine.indexOf(normalizedPattern, col + 1);
		}
	}

	return matches.sort((left, right) => {
		const leftDistance = jumpDistance(cursor, left);
		const rightDistance = jumpDistance(cursor, right);
		return leftDistance - rightDistance || left.line - right.line || left.col - right.col;
	});
}

function assignJumpLabels(editor: PromptEditor, pattern: string, matches: JumpMatch[]): JumpMatch[] {
	const labels = [...JUMP_LABELS].filter((label) => !jumpLabelConflicts(editor, pattern, label));
	return matches.map((match) => {
		const label = labels.shift();
		return label ? { ...match, label } : match;
	});
}

function jumpLabelConflicts(editor: PromptEditor, pattern: string, label: string): boolean {
	if (pattern.length === 0) return false;
	const conflictingPattern = `${pattern}${label}`.toLowerCase();
	return editor.getLines().some((line) => line.toLowerCase().includes(conflictingPattern));
}

function jumpToMatch(editor: PromptEditor, match: JumpMatch): void {
	editor.moveToPosition({ line: match.line, col: match.col });
}

function renderJumpOverlay(editor: PromptEditor, lines: string[], width: number): string[] {
	const theme = editor.getTheme();
	const state = jumpStates.get(editor);
	const result = [...lines];
	const maps = buildRenderedLineMaps(result.slice(1, -1), editor.getLines());
	const logicalLines = editor.getLines();
	const visibleRanges = maps.map((map) => ({
		from: { line: map.logicalLine, col: map.startCol },
		to: { line: map.logicalLine, col: map.endCol },
	}));
	if (state) state.visibleRanges = visibleRanges;

	for (const map of maps) {
		const line = lines[map.outputLine] ?? "";
		const segmentWidth = map.endCol - map.startCol;
		const prefix = sliceByColumn(line, 0, map.lineStartCol, true);
		const suffixStart = map.lineStartCol + segmentWidth;
		const rawSuffix = sliceByColumn(line, suffixStart, Math.max(0, visibleWidth(line) - suffixStart), true);
		const segment = (logicalLines[map.logicalLine] ?? "").slice(map.startCol, map.endCol);
		const matches = state?.pattern
			? state.matches.filter(
					(match) => match.line === map.logicalLine && match.col >= map.startCol && match.endCol <= map.endCol,
				)
			: [];
		const renderedSegment = renderJumpSegment({
			editor,
			segment,
			matches,
			map,
			suffixWidth: visibleWidth(rawSuffix),
			width,
		});
		const suffix = sliceByColumn(
			rawSuffix,
			renderedSegment.suffixSkip,
			Math.max(0, visibleWidth(rawSuffix) - renderedSegment.suffixSkip),
			true,
		);

		result[map.outputLine] = `${theme.fg("dim", prefix)}${renderedSegment.text}${theme.fg("dim", suffix)}`;
	}

	return result.map((line) => truncateToWidth(line, width, ""));
}

function renderJumpSegment(options: RenderJumpSegmentOptions): { text: string; suffixSkip: number } {
	const theme = options.editor.getTheme();
	if (!jumpStates.get(options.editor)?.pattern || options.matches.length === 0) return { text: theme.fg("dim", options.segment), suffixSkip: 0 };

	let result = "";
	let col = 0;
	let suffixSkip = 0;
	const sortedMatches = [...options.matches].sort((left, right) => left.col - right.col);
	for (const match of sortedMatches) {
		const start = match.col - options.map.startCol;
		const end = match.endCol - options.map.startCol;
		if (start < col) continue;

		result += theme.fg("dim", options.segment.slice(col, start));
		result += theme.fg("text", options.segment.slice(start, end));
		col = end;

		if (!match.label) continue;

		const labelCol = options.map.lineStartCol + end;
		const labelWidth = visibleWidth(match.label);
		const canReplaceNextCell = col < options.segment.length;
		const canReplaceSuffixCell = options.suffixWidth - suffixSkip > labelWidth;
		const canAppendToShortLine = options.suffixWidth === 0 && labelCol + labelWidth <= options.width;
		if (!canReplaceNextCell && !canReplaceSuffixCell && !canAppendToShortLine) continue;

		result += theme.fg("accent", theme.bold(match.label));
		if (canReplaceNextCell) col++;
		else if (canReplaceSuffixCell) suffixSkip += labelWidth;
	}

	result += theme.fg("dim", options.segment.slice(col));
	return { text: result, suffixSkip };
}

function jumpDistance(cursor: VipiEditorPosition, match: JumpMatch): number {
	return Math.abs(cursor.line - match.line) * 10_000 + Math.abs(cursor.col - match.col);
}

function rangeContainsMatch(range: VipiEditorTextRange, match: JumpMatch): boolean {
	const [start, end] = normalizeRange(range);
	return match.line === start.line && match.line === end.line && match.col >= start.col && match.endCol <= end.col;
}
