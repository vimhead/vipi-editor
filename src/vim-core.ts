import { decodeKittyPrintable, matchesKey, parseKey, type KeyId } from "@earendil-works/pi-tui";

export type VimModeId = string;
export type VimCursorStyle = "thin" | "block";
export type VimBuiltinMode = "insert" | "normal";
export type VimTextObjectScope = "inner" | "around";

export type VimPosition = {
	line: number;
	col: number;
};

export type VimTextRange = {
	from: VimPosition;
	to: VimPosition;
	linewise?: boolean;
};

export interface VimBufferAdapter {
	getLines(): readonly string[];
	getCursor(): VimPosition;
	moveToPosition(position: VimPosition): void;
	replaceRange(range: VimTextRange, replacement: string): void;
	textForRange(range: VimTextRange): string;
}

export interface VimHost {
	requestRender(): void;
	requestCursorStyle(style: VimCursorStyle): void;
	readClipboard(): string;
	writeClipboard(text: string): void;
	flashRange(range: VimTextRange): void;
	onChange?(): void;
	onModeChange?(previousMode: VimModeId, nextMode: VimModeId): void;
	notifyError?(message: string): void;
}

export type VimCommandContext<TServices extends object = Record<string, never>> = {
	core: VimCore<TServices>;
	buffer: VimBufferAdapter;
	host: VimHost;
} & TServices;

export type VimModeLabel<TServices extends object = Record<string, never>> =
	| string
	| ((context: VimCommandContext<TServices>) => string);

export type VimModeDefinition<TServices extends object = Record<string, never>> = {
	id: VimModeId;
	label: VimModeLabel<TServices>;
	cursor?: VimCursorStyle;
	handleInput?: (context: VimCommandContext<TServices>, data: string) => boolean;
	onEnter?: (context: VimCommandContext<TServices>, previousMode: VimModeId) => void;
	onExit?: (context: VimCommandContext<TServices>, nextMode: VimModeId) => void;
	render?: (context: VimCommandContext<TServices>, lines: string[], width: number) => string[];
};

export type VimBinding<TServices extends object = Record<string, never>> = {
	keys: readonly KeyId[];
	label?: string;
	shouldRecordForDotRepeat?: boolean;
	run: (context: VimCommandContext<TServices>) => void | Promise<void>;
};

export type VimMotion<TServices extends object = Record<string, never>> = {
	id: string;
	keys: readonly KeyId[];
	input?: "char";
	range: (context: VimCommandContext<TServices>, count: number, input?: string) => VimTextRange | undefined;
	target?: (context: VimCommandContext<TServices>, range: VimTextRange, input?: string) => VimPosition;
};

export type VimOperator<TServices extends object = Record<string, never>> = {
	id: string;
	key: KeyId;
	label?: string;
	apply: (context: VimCommandContext<TServices>, range: VimTextRange, count: number) => void;
};

export type VimTextObject<TServices extends object = Record<string, never>> = {
	id: string;
	key: KeyId;
	range: (context: VimCommandContext<TServices>, scope: VimTextObjectScope, count: number) => VimTextRange | undefined;
};

export type VimCoreOptions<TServices extends object = Record<string, never>> = {
	mode?: VimModeId;
	services?: TServices;
};

export type VimDispose = () => void;

export type VimRegistration<TServices extends object = Record<string, never>> = {
	modes?: readonly VimModeDefinition<TServices>[];
	bindings?: readonly { mode: VimModeId; binding: VimBinding<TServices> }[];
	motions?: readonly VimMotion<TServices>[];
	operators?: readonly VimOperator<TServices>[];
	textObjects?: readonly VimTextObject<TServices>[];
};

type RegisteredBinding<TServices extends object> = VimBinding<TServices> & { order: number };
type RegisteredMotion<TServices extends object> = VimMotion<TServices> & { order: number };
type RegisteredOperator<TServices extends object> = VimOperator<TServices> & { order: number };
type RegisteredTextObject<TServices extends object> = VimTextObject<TServices> & { order: number };

type PendingBinding<TServices extends object> = {
	type: "binding";
	modeId: VimModeId;
	candidates: RegisteredBinding<TServices>[];
	index: number;
	keys: KeyId[];
};

type PendingMotion<TServices extends object> = {
	type: "motion";
	candidates: RegisteredMotion<TServices>[];
	index: number;
	keys: KeyId[];
};

type PendingMotionInput<TServices extends object> = {
	type: "motionInput";
	motion: RegisteredMotion<TServices>;
	count: number;
	keys: KeyId[];
};

type PendingOperator<TServices extends object> = {
	type: "operator";
	operator: RegisteredOperator<TServices>;
	countBuffer: string;
	scope?: VimTextObjectScope;
	motionKeys: KeyId[];
};

type PendingOperatorMotionInput<TServices extends object> = {
	type: "operatorMotionInput";
	operator: RegisteredOperator<TServices>;
	motion: RegisteredMotion<TServices>;
	count: number;
	keys: KeyId[];
};

type PendingSequence<TServices extends object> =
	| PendingBinding<TServices>
	| PendingMotion<TServices>
	| PendingMotionInput<TServices>
	| PendingOperator<TServices>
	| PendingOperatorMotionInput<TServices>;

export class VimCore<TServices extends object = Record<string, never>> {
	private readonly modes = new Map<VimModeId, VimModeDefinition<TServices>>();
	private readonly bindingsByMode = new Map<VimModeId, RegisteredBinding<TServices>[]>();
	private readonly motions: RegisteredMotion<TServices>[] = [];
	private readonly operators: RegisteredOperator<TServices>[] = [];
	private readonly textObjects: RegisteredTextObject<TServices>[] = [];
	private mode: VimModeId;
	private pendingSequence: PendingSequence<TServices> | undefined;
	private dotRepeatAction: (() => void | Promise<void>) | undefined;
	private order = 0;

	constructor(
		private readonly buffer: VimBufferAdapter,
		private readonly host: VimHost,
		private readonly options: VimCoreOptions<TServices> = {},
	) {
		this.mode = options.mode ?? "insert";
	}

	context(): VimCommandContext<TServices> {
		return { core: this, buffer: this.buffer, host: this.host, ...(this.options.services ?? ({} as TServices)) };
	}

	registerMode(mode: VimModeDefinition<TServices>): VimDispose {
		this.modes.set(mode.id, mode);
		this.applyCursorStyle();
		return () => {
			if (this.modes.get(mode.id) === mode) this.modes.delete(mode.id);
			if (this.mode === mode.id) this.setMode("normal");
		};
	}

	registerBinding(modeId: VimModeId, binding: VimBinding<TServices>): VimDispose {
		const registered = { ...binding, order: ++this.order };
		const bindings = this.bindingsByMode.get(modeId) ?? [];
		bindings.push(registered);
		this.bindingsByMode.set(modeId, bindings);
		return () => removeItem(bindings, registered);
	}

	registerMotion(motion: VimMotion<TServices>): VimDispose {
		const registered = { ...motion, order: ++this.order };
		this.motions.push(registered);
		return () => removeItem(this.motions, registered);
	}

	registerOperator(operator: VimOperator<TServices>): VimDispose {
		const registered = { ...operator, order: ++this.order };
		this.operators.push(registered);
		return () => removeItem(this.operators, registered);
	}

	registerTextObject(textObject: VimTextObject<TServices>): VimDispose {
		const registered = { ...textObject, order: ++this.order };
		this.textObjects.push(registered);
		return () => removeItem(this.textObjects, registered);
	}

	register(registration: VimRegistration<TServices>): VimDispose {
		const cleanup = new VimDisposeStack();
		for (const mode of registration.modes ?? []) cleanup.use(this.registerMode(mode));
		for (const { mode, binding } of registration.bindings ?? []) cleanup.use(this.registerBinding(mode, binding));
		for (const motion of registration.motions ?? []) cleanup.use(this.registerMotion(motion));
		for (const operator of registration.operators ?? []) cleanup.use(this.registerOperator(operator));
		for (const textObject of registration.textObjects ?? []) cleanup.use(this.registerTextObject(textObject));
		return () => cleanup.dispose();
	}

	getMode(): VimModeId {
		return this.mode;
	}

	setMode(mode: VimModeId): void {
		if (mode === this.mode || !this.modes.has(mode)) return;
		const previousMode = this.mode;
		this.pendingSequence = undefined;
		this.modes.get(previousMode)?.onExit?.(this.context(), mode);
		this.mode = mode;
		this.modes.get(mode)?.onEnter?.(this.context(), previousMode);
		this.applyCursorStyle();
		this.host.onModeChange?.(previousMode, mode);
		this.host.requestRender();
	}

	getModeDefinition(modeId = this.mode): VimModeDefinition<TServices> | undefined {
		return this.modes.get(modeId);
	}

	getModeLabel(): string {
		const mode = this.currentMode();
		const label = mode ? modeLabel(mode, this.context()) : this.mode.toUpperCase();
		const pending = this.getPendingLabel();
		return pending ? `${pending} ${label}` : label;
	}

	getPendingLabel(): string | undefined {
		const pending = this.pendingSequence;
		if (!pending) return undefined;
		if (pending.type === "binding") return keySequenceLabel(pending.keys);
		if (pending.type === "motion") return keySequenceLabel(pending.keys);
		if (pending.type === "motionInput") return keySequenceLabel(pending.keys);
		if (pending.type === "operatorMotionInput") return `${pending.operator.label ?? pending.operator.key}${keySequenceLabel(pending.keys)}`;
		const scope = pending.scope === "inner" ? "i" : pending.scope === "around" ? "a" : "";
		return `${pending.operator.label ?? pending.operator.key}${pending.countBuffer}${scope}${keySequenceLabel(pending.motionKeys)}`;
	}

	clearPending(): void {
		this.pendingSequence = undefined;
		this.host.requestRender();
	}

	render(lines: string[], width: number): string[] {
		return this.currentMode()?.render?.(this.context(), lines, width) ?? lines;
	}

	hasCurrentInputRegistration(data: string): boolean {
		if (this.pendingSequence) return this.hasPendingInputRegistration(data, this.pendingSequence);
		if (this.bindingsForCurrentMode().some((binding) => matchesKey(data, binding.keys[0]))) return true;
		if (this.mode !== "normal") return false;
		return this.matchOperatorStart(data) !== undefined || this.motionsByPrecedence().some((motion) => matchesKey(data, motion.keys[0]));
	}

	handleInput(data: string): boolean {
		if (this.pendingSequence?.type === "binding") return this.handlePendingBinding(data, this.pendingSequence);
		if (this.pendingSequence?.type === "motion") return this.handlePendingMotion(data, this.pendingSequence);
		if (this.pendingSequence?.type === "motionInput") return this.handleMotionInput(data, this.pendingSequence);
		if (this.pendingSequence?.type === "operator") return this.handlePendingOperator(data, this.pendingSequence);
		if (this.pendingSequence?.type === "operatorMotionInput") return this.handleOperatorMotionInput(data, this.pendingSequence);

		const bindingHandled = this.handleBindingStart(data);
		if (bindingHandled) return true;

		if (this.mode === "normal") {
			const operator = this.matchOperatorStart(data);
			if (operator) {
				this.pendingSequence = { type: "operator", operator, countBuffer: "", motionKeys: [] };
				this.host.requestRender();
				return true;
			}
			if (this.handleMotionStart(data)) return true;
		}

		if (this.currentMode()?.handleInput?.(this.context(), data)) return true;
		return false;
	}

	repeatRecordedDotAction(): void {
		void Promise.resolve(this.dotRepeatAction?.()).catch((error: unknown) => {
			this.host.notifyError?.(error instanceof Error ? error.message : String(error));
		});
		this.host.requestRender();
	}

	applyCursorStyle(): void {
		this.host.requestCursorStyle(this.currentMode()?.cursor ?? "block");
	}

	getMotionRange(id: string, count = 1): { motion: VimMotion<TServices>; range: VimTextRange } | undefined {
		const motion = this.motionsByPrecedence().find((candidate) => candidate.id === id);
		const range = motion?.range(this.context(), count);
		return motion && range ? { motion, range } : undefined;
	}

	private currentMode(): VimModeDefinition<TServices> | undefined {
		return this.modes.get(this.mode);
	}

	private hasPendingInputRegistration(data: string, pending: PendingSequence<TServices>): boolean {
		if (matchesKey(data, "escape")) return true;
		switch (pending.type) {
			case "binding":
				return pending.candidates.some((binding) => {
					const key = binding.keys[pending.index];
					return key !== undefined && matchesKey(data, key);
				});
			case "motion":
				return pending.candidates.some((motion) => {
					const key = motion.keys[pending.index];
					return key !== undefined && matchesKey(data, key);
				});
			case "motionInput":
			case "operatorMotionInput":
				return getPrintableInput(data) !== undefined;
			case "operator":
				return this.hasOperatorInputRegistration(data, pending);
		}
	}

	private hasOperatorInputRegistration(data: string, pending: PendingOperator<TServices>): boolean {
		if (!pending.scope && pending.motionKeys.length === 0) {
			return countDigit(data, pending.countBuffer.length > 0) !== undefined
				|| matchesKey(data, "i")
				|| matchesKey(data, "a")
				|| matchesKey(data, pending.operator.key);
		}
		if (pending.scope) return this.textObjectsByPrecedence().some((textObject) => matchesKey(data, textObject.key));
		const index = pending.motionKeys.length;
		return this.motionsByPrecedence().some((motion) => {
			const key = motion.keys[index];
			return key !== undefined && matchesKey(data, key);
		});
	}

	private handleBindingStart(data: string): boolean {
		const bindings = this.bindingsForCurrentMode();
		const matches = bindings.filter((binding) => matchesKey(data, binding.keys[0]));
		if (matches.length === 0) return false;

		const exact = matches.find((binding) => binding.keys.length === 1);
		if (exact) {
			this.runBinding(exact);
			return true;
		}

		this.pendingSequence = { type: "binding", modeId: this.mode, candidates: matches, index: 1, keys: [matches[0]?.keys[0] ?? ""] };
		this.host.requestRender();
		return true;
	}

	private handlePendingBinding(data: string, pending: PendingBinding<TServices>): boolean {
		if (matchesKey(data, "escape")) {
			this.clearPending();
			return true;
		}

		const next = pending.candidates.filter((binding) => {
			const key = binding.keys[pending.index];
			return key !== undefined && matchesKey(data, key);
		});
		if (next.length === 0) {
			this.clearPending();
			return isPrintableInput(data);
		}

		const matchedKey = next[0]?.keys[pending.index];
		const keys = matchedKey ? [...pending.keys, matchedKey] : pending.keys;
		const exact = next.find((binding) => binding.keys.length === pending.index + 1);
		if (exact) {
			this.pendingSequence = undefined;
			this.runBinding(exact);
			return true;
		}

		this.pendingSequence = { ...pending, candidates: next, index: pending.index + 1, keys };
		this.host.requestRender();
		return true;
	}

	private handleMotionStart(data: string): boolean {
		const matches = this.motionsByPrecedence().filter((motion) => matchesKey(data, motion.keys[0]));
		if (matches.length === 0) return false;

		const exact = matches.find((motion) => motion.keys.length === 1);
		if (exact) {
			if (exact.input === "char") {
				this.pendingSequence = { type: "motionInput", motion: exact, count: 1, keys: [...exact.keys] };
				this.host.requestRender();
				return true;
			}
			this.applyMotion(exact, 1);
			return true;
		}

		this.pendingSequence = { type: "motion", candidates: matches, index: 1, keys: [matches[0]?.keys[0] ?? ""] };
		this.host.requestRender();
		return true;
	}

	private handlePendingMotion(data: string, pending: PendingMotion<TServices>): boolean {
		if (matchesKey(data, "escape")) {
			this.clearPending();
			return true;
		}

		const next = pending.candidates.filter((motion) => {
			const key = motion.keys[pending.index];
			return key !== undefined && matchesKey(data, key);
		});
		if (next.length === 0) {
			this.clearPending();
			return isPrintableInput(data);
		}

		const matchedKey = next[0]?.keys[pending.index];
		const keys = matchedKey ? [...pending.keys, matchedKey] : pending.keys;
		const exact = next.find((motion) => motion.keys.length === pending.index + 1);
		if (exact) {
			if (exact.input === "char") {
				this.pendingSequence = { type: "motionInput", motion: exact, count: 1, keys };
				this.host.requestRender();
				return true;
			}
			this.pendingSequence = undefined;
			this.applyMotion(exact, 1);
			return true;
		}

		this.pendingSequence = { ...pending, candidates: next, index: pending.index + 1, keys };
		this.host.requestRender();
		return true;
	}

	private handleMotionInput(data: string, pending: PendingMotionInput<TServices>): boolean {
		if (matchesKey(data, "escape")) {
			this.clearPending();
			return true;
		}
		const input = getPrintableInput(data);
		if (!input) return false;
		this.pendingSequence = undefined;
		this.applyMotion(pending.motion, pending.count, input);
		return true;
	}

	private handlePendingOperator(data: string, pending: PendingOperator<TServices>): boolean {
		if (matchesKey(data, "escape")) {
			this.clearPending();
			return true;
		}

		if (!pending.scope && pending.motionKeys.length === 0) {
			const digit = countDigit(data, pending.countBuffer.length > 0);
			if (digit) {
				this.pendingSequence = { ...pending, countBuffer: `${pending.countBuffer}${digit}` };
				this.host.requestRender();
				return true;
			}

			if (matchesKey(data, "i")) {
				this.pendingSequence = { ...pending, scope: "inner" };
				this.host.requestRender();
				return true;
			}
			if (matchesKey(data, "a")) {
				this.pendingSequence = { ...pending, scope: "around" };
				this.host.requestRender();
				return true;
			}

			if (matchesKey(data, pending.operator.key)) {
				const count = sequenceCount(pending.countBuffer);
				this.pendingSequence = undefined;
				this.applyOperator(pending.operator, lineRange(this.buffer, count), count, () => lineRange(this.buffer, count));
				return true;
			}
		}

		if (pending.scope) return this.handleTextObject(data, pending);
		return this.handleOperatorMotion(data, pending);
	}

	private handleTextObject(data: string, pending: PendingOperator<TServices>): boolean {
		const textObject = this.textObjectsByPrecedence().find((candidate) => matchesKey(data, candidate.key));
		if (!textObject || !pending.scope) {
			this.clearPending();
			return isPrintableInput(data);
		}

		const count = sequenceCount(pending.countBuffer);
		const scope = pending.scope;
		const range = textObject.range(this.context(), scope, count);
		this.pendingSequence = undefined;
		if (range) this.applyOperator(pending.operator, range, count, () => textObject.range(this.context(), scope, count));
		else this.host.requestRender();
		return true;
	}

	private handleOperatorMotion(data: string, pending: PendingOperator<TServices>): boolean {
		const index = pending.motionKeys.length;
		const candidates = this.motionsByPrecedence().filter((motion) => {
			const key = motion.keys[index];
			return key !== undefined && matchesKey(data, key);
		});
		if (candidates.length === 0) {
			this.clearPending();
			return isPrintableInput(data);
		}

		const matchedKey = candidates[0]?.keys[index];
		const motionKeys = matchedKey ? [...pending.motionKeys, matchedKey] : pending.motionKeys;
		const exact = candidates.find((motion) => motion.keys.length === index + 1);
		if (!exact) {
			this.pendingSequence = { ...pending, motionKeys };
			this.host.requestRender();
			return true;
		}

		const count = sequenceCount(pending.countBuffer);
		if (exact.input === "char") {
			this.pendingSequence = { type: "operatorMotionInput", operator: pending.operator, motion: exact, count, keys: motionKeys };
			this.host.requestRender();
			return true;
		}

		const range = exact.range(this.context(), count);
		this.pendingSequence = undefined;
		if (range) this.applyOperator(pending.operator, range, count, () => exact.range(this.context(), count));
		else this.host.requestRender();
		return true;
	}

	private handleOperatorMotionInput(data: string, pending: PendingOperatorMotionInput<TServices>): boolean {
		if (matchesKey(data, "escape")) {
			this.clearPending();
			return true;
		}
		const input = getPrintableInput(data);
		if (!input) return false;
		const range = pending.motion.range(this.context(), pending.count, input);
		this.pendingSequence = undefined;
		if (range) this.applyOperator(pending.operator, range, pending.count, () => pending.motion.range(this.context(), pending.count, input));
		else this.host.requestRender();
		return true;
	}

	private applyMotion(motion: RegisteredMotion<TServices>, count: number, input?: string): void {
		const range = motion.range(this.context(), count, input);
		if (!range) {
			this.host.requestRender();
			return;
		}
		this.buffer.moveToPosition(motion.target?.(this.context(), range, input) ?? movementTargetForRange(range));
		this.host.requestRender();
	}

	private applyOperator(
		operator: RegisteredOperator<TServices>,
		range: VimTextRange,
		count: number,
		repeatRange?: () => VimTextRange | undefined,
	): void {
		operator.apply(this.context(), range, count);
		if (operator.id !== "yank" && repeatRange) {
			this.recordDotRepeatAction(() => {
				const nextRange = repeatRange();
				if (nextRange) operator.apply(this.context(), nextRange, count);
			});
		}
		this.host.requestRender();
	}

	private matchOperatorStart(data: string): RegisteredOperator<TServices> | undefined {
		return this.operatorsByPrecedence().find((operator) => matchesKey(data, operator.key));
	}

	private runBinding(binding: RegisteredBinding<TServices>): void {
		if (binding.shouldRecordForDotRepeat) this.recordDotRepeatAction(() => binding.run(this.context()));
		Promise.resolve(binding.run(this.context())).catch((error: unknown) => {
			this.host.notifyError?.(error instanceof Error ? error.message : String(error));
		});
		this.host.requestRender();
	}

	private recordDotRepeatAction(action: () => void | Promise<void>): void {
		this.dotRepeatAction = action;
	}

	private bindingsForCurrentMode(): RegisteredBinding<TServices>[] {
		return [...(this.bindingsByMode.get(this.mode) ?? [])].sort(byPrecedence);
	}

	private motionsByPrecedence(): RegisteredMotion<TServices>[] {
		return [...this.motions].sort(byPrecedence);
	}

	private operatorsByPrecedence(): RegisteredOperator<TServices>[] {
		return [...this.operators].sort(byPrecedence);
	}

	private textObjectsByPrecedence(): RegisteredTextObject<TServices>[] {
		return [...this.textObjects].sort(byPrecedence);
	}
}

export type DefaultVimServices = {
	openLineBelow?: () => void;
	openLineAbove?: () => void;
	scrollHalfPage?: (direction: -1 | 1) => void;
};

export type RegisterDefaultVimOptions = {
	handleInsertInput: boolean;
	multilineTextObjects?: boolean;
	extraNormalBindings?: boolean;
};

export function registerDefaultVimEditing<TServices extends DefaultVimServices>(
	core: VimCore<TServices>,
	options: RegisterDefaultVimOptions,
): VimDispose {
	const cleanup = new VimDisposeStack();
	const mode = (definition: VimModeDefinition<TServices>) => cleanup.use(core.registerMode(definition));
	const motion = (definition: VimMotion<TServices>) => cleanup.use(core.registerMotion(definition));
	const normal = (binding: VimBinding<TServices>) => cleanup.use(core.registerBinding("normal", binding));
	const operator = (definition: VimOperator<TServices>) => cleanup.use(core.registerOperator(definition));
	const textObject = (definition: VimTextObject<TServices>) => cleanup.use(core.registerTextObject(definition));

	mode({
		id: "insert",
		label: "INSERT",
		cursor: "thin",
		handleInput: (context, data) => options.handleInsertInput ? handleInsertEditing(context, data) : false,
	});
	mode({
		id: "normal",
		label: "NORMAL",
		cursor: "block",
		onEnter: (context, previousMode) => {
			if (previousMode === "insert") context.buffer.moveToPosition(normalCursorPositionAfterInsert(context.buffer));
		},
	});

	cleanup.use(core.registerBinding("insert", {
		keys: ["escape"],
		run: (context) => {
			context.host.requestCursorStyle(context.core.getModeDefinition("normal")?.cursor ?? "block");
			context.core.setMode("normal");
		},
	}));

	motion({
		id: "lineStart",
		keys: ["0"],
		range: (context) => ({ from: { line: context.buffer.getCursor().line, col: 0 }, to: context.buffer.getCursor() }),
	});
	motion({
		id: "lineEnd",
		keys: ["$"],
		range: (context) => {
			const cursor = context.buffer.getCursor();
			return { from: cursor, to: { line: cursor.line, col: context.buffer.getLines()[cursor.line]?.length ?? 0 } };
		},
	});
	motion({
		id: "wordLeft",
		keys: ["b"],
		range: (context) => {
			const cursor = context.buffer.getCursor();
			return { from: wordLeftPosition(context.buffer.getLines(), cursor), to: cursor };
		},
		target: (_context, range) => range.from,
	});
	motion({
		id: "wordRight",
		keys: ["w"],
		range: (context, count) => repeatedMotionRange(context.buffer, "wordRight", count),
	});
	motion({
		id: "wordEnd",
		keys: ["e"],
		range: (context, count) => repeatedMotionRange(context.buffer, "wordEnd", count),
		target: (context, range) => previousPosition(context.buffer.getLines(), range.to),
	});
	motion({
		id: "promptStart",
		keys: ["g", "g"],
		range: (context) => ({ from: { line: 0, col: 0 }, to: context.buffer.getCursor() }),
	});
	motion({
		id: "promptEnd",
		keys: ["shift+g"],
		range: (context) => {
			const lines = context.buffer.getLines();
			return { from: context.buffer.getCursor(), to: { line: lines.length - 1, col: lines.at(-1)?.length ?? 0 } };
		},
	});
	motion({
		id: "findForward",
		keys: ["f"],
		input: "char",
		range: (context, count, input) => charSearchRange(context, "findForward", count, input),
		target: charSearchTarget,
	});
	motion({
		id: "findBackward",
		keys: ["shift+f"],
		input: "char",
		range: (context, count, input) => charSearchRange(context, "findBackward", count, input),
		target: charSearchTarget,
	});
	motion({
		id: "tillForward",
		keys: ["t"],
		input: "char",
		range: (context, count, input) => charSearchRange(context, "tillForward", count, input),
		target: charSearchTarget,
	});
	motion({
		id: "tillBackward",
		keys: ["shift+t"],
		input: "char",
		range: (context, count, input) => charSearchRange(context, "tillBackward", count, input),
		target: charSearchTarget,
	});

	textObject({ id: "word", key: "w", range: (context, scope, count) => wordTextObjectRange(context.buffer.getLines(), context.buffer.getCursor(), scope, count) });
	if (options.multilineTextObjects) {
		textObject({ id: "paragraph", key: "p", range: (context, scope, count) => paragraphTextObjectRange(context.buffer.getLines(), context.buffer.getCursor(), scope, count) });
	}

	operator({ id: "delete", key: "d", label: "d", apply: (context, range) => changeBuffer(context, range, "") });
	operator({
		id: "change",
		key: "c",
		label: "c",
		apply: (context, range) => {
			changeBuffer(context, range.linewise ? linewiseToCharacterRange(context, range) : range, "");
			context.core.setMode("insert");
		},
	});
	operator({
		id: "yank",
		key: "y",
		label: "y",
		apply: (context, range) => {
			const text = context.buffer.textForRange(range);
			if (text.length === 0) return;
			context.host.writeClipboard(text);
			context.host.flashRange(range);
		},
	});

	normal({ keys: ["."], run: (context) => context.core.repeatRecordedDotAction() });
	normal({ keys: ["h"], run: moveLeft });
	normal({ keys: ["left"], run: moveLeft });
	normal({ keys: ["l"], run: moveRightWithinLine });
	normal({ keys: ["right"], run: moveRightWithinLine });
	normal({ keys: ["0"], run: (context) => context.buffer.moveToPosition({ ...context.buffer.getCursor(), col: 0 }) });
	normal({ keys: ["home"], run: (context) => context.buffer.moveToPosition({ ...context.buffer.getCursor(), col: 0 }) });
	normal({ keys: ["$"], run: moveLineEnd });
	normal({ keys: ["end"], run: moveLineEnd });
	normal({ keys: ["w"], run: (context) => moveByMotion(context, "wordRight") });
	normal({ keys: ["b"], run: (context) => context.buffer.moveToPosition(wordLeftPosition(context.buffer.getLines(), context.buffer.getCursor())) });
	normal({ keys: ["e"], run: (context) => context.buffer.moveToPosition(previousPosition(context.buffer.getLines(), wordEndExclusivePosition(context.buffer.getLines(), context.buffer.getCursor()))) });
	normal({ keys: ["g", "g"], label: "gg", run: (context) => context.buffer.moveToPosition({ line: 0, col: 0 }) });
	normal({
		keys: ["shift+g"],
		run: (context) => {
			const lines = context.buffer.getLines();
			context.buffer.moveToPosition({ line: lines.length - 1, col: lines.at(-1)?.length ?? 0 });
		},
	});
	normal({ keys: ["x"], shouldRecordForDotRepeat: true, run: deleteCharacterUnderCursor });
	normal({ keys: ["shift+x"], shouldRecordForDotRepeat: true, run: deleteBackward });
	normal({ keys: ["shift+d"], shouldRecordForDotRepeat: true, run: (context) => changeBuffer(context, rangeById(context, "lineEnd"), "") });
	normal({
		keys: ["shift+c"],
		shouldRecordForDotRepeat: true,
		run: (context) => {
			changeBuffer(context, rangeById(context, "lineEnd"), "");
			context.core.setMode("insert");
		},
	});
	normal({
		keys: ["shift+y"],
		run: (context) => {
			const range = rangeById(context, "lineEnd");
			const text = context.buffer.textForRange(range);
			if (text.length > 0) {
				context.host.writeClipboard(text);
				context.host.flashRange(range);
			}
		},
	});
	normal({ keys: ["p"], shouldRecordForDotRepeat: true, run: pasteAfter });
	normal({ keys: ["shift+p"], shouldRecordForDotRepeat: true, run: pasteBefore });
	normal({ keys: ["i"], run: (context) => context.core.setMode("insert") });
	normal({
		keys: ["a"],
		run: (context) => {
			moveRightWithinLine(context);
			context.core.setMode("insert");
		},
	});
	normal({
		keys: ["shift+i"],
		run: (context) => {
			context.buffer.moveToPosition({ ...context.buffer.getCursor(), col: 0 });
			context.core.setMode("insert");
		},
	});
	normal({
		keys: ["shift+a"],
		run: (context) => {
			moveLineEnd(context);
			context.core.setMode("insert");
		},
	});

	if (options.extraNormalBindings) {
		normal({ keys: ["ctrl+u"], run: (context) => context.scrollHalfPage?.(-1) });
		normal({ keys: ["ctrl+d"], run: (context) => context.scrollHalfPage?.(1) });
		normal({ keys: ["o"], run: (context) => context.openLineBelow?.() });
		normal({ keys: ["shift+o"], run: (context) => context.openLineAbove?.() });
	}

	return () => cleanup.dispose();
}

type CharSearchKind = "findForward" | "findBackward" | "tillForward" | "tillBackward";

function charSearchRange<TServices extends object>(
	context: VimCommandContext<TServices>,
	kind: CharSearchKind,
	count: number,
	input: string | undefined,
): VimTextRange | undefined {
	if (!input) return undefined;
	const cursor = context.buffer.getCursor();
	const lines = context.buffer.getLines();
	const cursorIndex = positionToIndex(lines, cursor);
	const foundIndex = findCharIndex(lines.join("\n"), input, cursorIndex, kind === "findForward" || kind === "tillForward", count);
	if (foundIndex === undefined) return undefined;

	const found = indexToPosition(lines, foundIndex);
	const afterFound = indexToPosition(lines, foundIndex + input.length);
	if (kind === "findForward") return { from: cursor, to: afterFound };
	if (kind === "tillForward") return { from: cursor, to: found };
	if (kind === "findBackward") return { from: found, to: cursor };
	return { from: afterFound, to: cursor };
}

function charSearchTarget<TServices extends object>(
	context: VimCommandContext<TServices>,
	range: VimTextRange,
	input: string | undefined,
): VimPosition {
	const lines = context.buffer.getLines();
	const cursor = context.buffer.getCursor();
	const forward = comparePosition(range.from, range.to) <= 0;
	if (forward) {
		const cursorIndex = positionToIndex(lines, cursor);
		const targetIndex = Math.max(cursorIndex, positionToIndex(lines, range.to) - (input?.length ?? 1));
		return indexToPosition(lines, targetIndex);
	}
	return range.from;
}

function findCharIndex(text: string, input: string, cursorIndex: number, forward: boolean, count: number): number | undefined {
	let remaining = Math.max(1, count);
	if (forward) {
		let index = cursorIndex + 1;
		while (index < text.length) {
			const found = text.indexOf(input, index);
			if (found === -1) return undefined;
			remaining--;
			if (remaining === 0) return found;
			index = found + input.length;
		}
		return undefined;
	}

	let index = Math.max(0, cursorIndex - 1);
	while (index >= 0) {
		const found = text.lastIndexOf(input, index);
		if (found === -1) return undefined;
		remaining--;
		if (remaining === 0) return found;
		index = found - 1;
	}
	return undefined;
}

function handleInsertEditing<TServices extends object>(context: VimCommandContext<TServices>, data: string): boolean {
	if (matchesKey(data, "left")) moveLeft(context);
	else if (matchesKey(data, "right")) moveRight(context);
	else if (matchesKey(data, "home")) context.buffer.moveToPosition({ ...context.buffer.getCursor(), col: 0 });
	else if (matchesKey(data, "end")) moveLineEnd(context);
	else if (matchesKey(data, "backspace")) deleteBackward(context);
	else if (matchesKey(data, "delete")) deleteForward(context);
	else {
		const char = getPrintableInput(data);
		if (!char) return false;
		insertText(context, char);
	}
	return true;
}

function changeBuffer<TServices extends object>(context: VimCommandContext<TServices>, range: VimTextRange, replacement: string): void {
	context.buffer.replaceRange(range, replacement);
	context.host.onChange?.();
}

function linewiseToCharacterRange<TServices extends object>(context: VimCommandContext<TServices>, range: VimTextRange): VimTextRange {
	const [start, end] = normalizeRange(range);
	return {
		from: { line: start.line, col: 0 },
		to: { line: end.line, col: context.buffer.getLines()[end.line]?.length ?? 0 },
	};
}

function insertText<TServices extends object>(context: VimCommandContext<TServices>, text: string): void {
	context.buffer.replaceRange({ from: context.buffer.getCursor(), to: context.buffer.getCursor() }, text);
	context.host.onChange?.();
}

function pasteAfter<TServices extends object>(context: VimCommandContext<TServices>): void {
	const text = context.host.readClipboard();
	if (!text) return;
	moveRightWithinLine(context);
	insertText(context, text);
}

function pasteBefore<TServices extends object>(context: VimCommandContext<TServices>): void {
	const text = context.host.readClipboard();
	if (!text) return;
	insertText(context, text);
}

function deleteBackward<TServices extends object>(context: VimCommandContext<TServices>): void {
	const cursor = context.buffer.getCursor();
	const from = previousPosition(context.buffer.getLines(), cursor);
	if (comparePosition(from, cursor) === 0) return;
	changeBuffer(context, { from, to: cursor }, "");
}

function deleteForward<TServices extends object>(context: VimCommandContext<TServices>): void {
	deleteRangeToPosition(context, nextPosition(context.buffer.getLines(), context.buffer.getCursor()));
}

function deleteCharacterUnderCursor<TServices extends object>(context: VimCommandContext<TServices>): void {
	deleteRangeToPosition(context, nextPositionWithinLine(context.buffer.getLines(), context.buffer.getCursor()));
}

function deleteRangeToPosition<TServices extends object>(context: VimCommandContext<TServices>, to: VimPosition): void {
	const cursor = context.buffer.getCursor();
	if (comparePosition(cursor, to) === 0) {
		deleteBackward(context);
		return;
	}
	changeBuffer(context, { from: cursor, to }, "");
}

function moveLeft<TServices extends object>(context: VimCommandContext<TServices>): void {
	const lines = context.buffer.getLines();
	context.buffer.moveToPosition(previousPosition(lines, context.buffer.getCursor()));
}

function moveRight<TServices extends object>(context: VimCommandContext<TServices>): void {
	const lines = context.buffer.getLines();
	context.buffer.moveToPosition(nextPosition(lines, context.buffer.getCursor()));
}

function moveRightWithinLine<TServices extends object>(context: VimCommandContext<TServices>): void {
	const lines = context.buffer.getLines();
	context.buffer.moveToPosition(nextPositionWithinLine(lines, context.buffer.getCursor()));
}

function normalCursorPositionAfterInsert(buffer: VimBufferAdapter): VimPosition {
	const cursor = buffer.getCursor();
	const line = buffer.getLines()[cursor.line] ?? "";
	if (line.length === 0) return { line: cursor.line, col: 0 };
	return { line: cursor.line, col: Math.max(0, Math.min(cursor.col - 1, line.length - 1)) };
}

function moveLineEnd<TServices extends object>(context: VimCommandContext<TServices>): void {
	const cursor = context.buffer.getCursor();
	context.buffer.moveToPosition({ line: cursor.line, col: context.buffer.getLines()[cursor.line]?.length ?? 0 });
}

function moveByMotion<TServices extends object>(context: VimCommandContext<TServices>, id: string): void {
	const match = context.core.getMotionRange(id);
	if (!match) return;
	context.buffer.moveToPosition(match.motion.target?.(context, match.range) ?? movementTargetForRange(match.range));
}

function rangeById<TServices extends object>(context: VimCommandContext<TServices>, id: string): VimTextRange {
	return context.core.getMotionRange(id)?.range ?? { from: context.buffer.getCursor(), to: context.buffer.getCursor() };
}

export type VimMotionId = "line" | "lineStart" | "lineEnd" | "wordLeft" | "wordRight" | "wordEnd" | "promptStart" | "promptEnd";

export function rangeForMotion(buffer: Pick<VimBufferAdapter, "getLines" | "getCursor">, motion: VimMotionId): VimTextRange {
	const cursor = buffer.getCursor();
	const lines = buffer.getLines();
	switch (motion) {
		case "line":
			return lineRange(buffer, 1);
		case "lineStart":
			return { from: { line: cursor.line, col: 0 }, to: cursor };
		case "lineEnd":
			return { from: cursor, to: { line: cursor.line, col: lines[cursor.line]?.length ?? 0 } };
		case "wordLeft":
			return { from: wordLeftPosition(lines, cursor), to: cursor };
		case "wordRight":
			return { from: cursor, to: wordRightPosition(lines, cursor) };
		case "wordEnd":
			return { from: cursor, to: wordEndExclusivePosition(lines, cursor) };
		case "promptStart":
			return { from: { line: 0, col: 0 }, to: cursor };
		case "promptEnd":
			return { from: cursor, to: { line: lines.length - 1, col: lines.at(-1)?.length ?? 0 } };
	}
}

function lineRange(buffer: Pick<VimBufferAdapter, "getLines" | "getCursor">, count: number): VimTextRange {
	const cursor = buffer.getCursor();
	const lines = buffer.getLines();
	const toLine = Math.min(lines.length - 1, cursor.line + Math.max(1, count) - 1);
	return { from: { line: cursor.line, col: 0 }, to: { line: toLine, col: lines[toLine]?.length ?? 0 }, linewise: true };
}

export function repeatedMotionRange(buffer: Pick<VimBufferAdapter, "getLines" | "getCursor">, motion: VimMotionId, count: number): VimTextRange {
	const safeCount = Math.max(1, count);
	const cursor = buffer.getCursor();
	const lines = buffer.getLines();
	switch (motion) {
		case "line":
			return lineRange(buffer, count);
		case "wordLeft": {
			let position = cursor;
			for (let index = 0; index < safeCount; index++) position = wordLeftPosition(lines, position);
			return { from: position, to: cursor };
		}
		case "wordRight": {
			let position = cursor;
			for (let index = 0; index < safeCount; index++) position = wordRightPosition(lines, position);
			return { from: cursor, to: position };
		}
		case "wordEnd": {
			let position = cursor;
			for (let index = 0; index < safeCount; index++) position = wordEndExclusivePosition(lines, position);
			return { from: cursor, to: position };
		}
		default:
			return rangeForMotion(buffer, motion);
	}
}

export function normalizeRange(range: VimTextRange): [VimPosition, VimPosition] {
	return comparePosition(range.from, range.to) <= 0 ? [range.from, range.to] : [range.to, range.from];
}

export function comparePosition(left: VimPosition, right: VimPosition): number {
	return left.line - right.line || left.col - right.col;
}

export function clampPosition(position: VimPosition, lines: readonly string[]): VimPosition {
	const line = clamp(position.line, 0, Math.max(0, lines.length - 1));
	const col = clamp(position.col, 0, lines[line]?.length ?? 0);
	return { line, col };
}

export function positionToIndex(lines: readonly string[], position: VimPosition): number {
	let index = 0;
	for (let line = 0; line < position.line; line++) index += (lines[line]?.length ?? 0) + 1;
	return index + clamp(position.col, 0, lines[position.line]?.length ?? 0);
}

export function indexToPosition(lines: readonly string[], index: number): VimPosition {
	let remaining = Math.max(0, index);
	for (let line = 0; line < lines.length; line++) {
		const lineLength = lines[line]?.length ?? 0;
		if (remaining <= lineLength) return { line, col: remaining };
		remaining -= lineLength + 1;
	}
	const lastLine = Math.max(0, lines.length - 1);
	return { line: lastLine, col: lines[lastLine]?.length ?? 0 };
}

export function previousPosition(lines: readonly string[], position: VimPosition): VimPosition {
	return indexToPosition(lines, Math.max(0, positionToIndex(lines, position) - 1));
}

export function nextPosition(lines: readonly string[], position: VimPosition): VimPosition {
	const maxIndex = Math.max(0, lines.join("\n").length);
	return indexToPosition(lines, Math.min(maxIndex, positionToIndex(lines, position) + 1));
}

export function nextPositionWithinLine(lines: readonly string[], position: VimPosition): VimPosition {
	const line = lines[position.line] ?? "";
	if (position.col >= line.length) return { line: position.line, col: line.length };
	return nextPosition(lines, position);
}

export function textRange(lines: readonly string[], range: VimTextRange): string {
	const [start, end] = normalizeRange(range);
	if (range.linewise) return lines.slice(start.line, end.line + 1).join("\n");
	if (start.line === end.line) return (lines[start.line] ?? "").slice(start.col, end.col);
	return [
		(lines[start.line] ?? "").slice(start.col),
		...lines.slice(start.line + 1, end.line),
		(lines[end.line] ?? "").slice(0, end.col),
	].join("\n");
}

export function replaceTextRange(lines: readonly string[], range: VimTextRange, replacement: string): string[] {
	const [start, end] = normalizeRange(range);
	const replacementLines = replacement.split("\n");
	if (range.linewise) {
		const insertedLines = replacement.length === 0 ? [] : replacementLines;
		const result = [...lines.slice(0, start.line), ...insertedLines, ...lines.slice(end.line + 1)];
		return result.length > 0 ? result : [""];
	}

	const before = (lines[start.line] ?? "").slice(0, start.col);
	const after = (lines[end.line] ?? "").slice(end.col);
	if (replacementLines.length === 1) {
		return [...lines.slice(0, start.line), `${before}${replacementLines[0] ?? ""}${after}`, ...lines.slice(end.line + 1)];
	}

	const first = `${before}${replacementLines[0] ?? ""}`;
	const last = `${replacementLines.at(-1) ?? ""}${after}`;
	return [...lines.slice(0, start.line), first, ...replacementLines.slice(1, -1), last, ...lines.slice(end.line + 1)];
}

export function positionAfterReplacement(_lines: readonly string[], range: VimTextRange, replacement: string): VimPosition {
	const [start] = normalizeRange(range);
	if (replacement.length === 0) return start;
	const replacementLines = replacement.split("\n");
	if (replacementLines.length === 1) return { line: start.line, col: start.col + (replacementLines[0]?.length ?? 0) };
	return { line: start.line + replacementLines.length - 1, col: replacementLines.at(-1)?.length ?? 0 };
}

export function wordLeftPosition(lines: readonly string[], cursor: VimPosition): VimPosition {
	const text = lines.join("\n");
	let index = Math.max(0, positionToIndex(lines, cursor) - 1);
	while (index > 0 && charKind(text[index] ?? "") === "space") index--;
	const kind = charKind(text[index] ?? "");
	while (index > 0 && charKind(text[index - 1] ?? "") === kind) index--;
	return indexToPosition(lines, index);
}

export function wordRightPosition(lines: readonly string[], cursor: VimPosition): VimPosition {
	const text = lines.join("\n");
	let index = positionToIndex(lines, cursor);
	const kind = charKind(text[index] ?? "");
	if (kind !== "space") {
		while (index < text.length && charKind(text[index] ?? "") === kind) index++;
	}
	while (index < text.length && charKind(text[index] ?? "") === "space") index++;
	return indexToPosition(lines, index);
}

export function wordEndExclusivePosition(lines: readonly string[], cursor: VimPosition): VimPosition {
	const text = lines.join("\n");
	let index = positionToIndex(lines, cursor);
	let kind = charKind(text[index] ?? "");
	if (kind !== "space" && charKind(text[index + 1] ?? "") !== kind) index++;
	while (index < text.length && charKind(text[index] ?? "") === "space") index++;
	kind = charKind(text[index] ?? "");
	while (index < text.length && kind !== "space" && charKind(text[index] ?? "") === kind) index++;
	return indexToPosition(lines, index);
}

export function charKind(char: string): "space" | "word" | "punct" {
	if (char.length === 0 || /\s/u.test(char)) return "space";
	return /[\p{L}\p{N}_]/u.test(char) ? "word" : "punct";
}

function wordTextObjectRange(lines: readonly string[], cursor: VimPosition, scope: VimTextObjectScope, count: number): VimTextRange | undefined {
	const line = lines[cursor.line] ?? "";
	const tokens = textTokens(line);
	const tokenIndex = tokenIndexAtCursor(tokens, cursor.col);
	if (tokenIndex === -1) return undefined;

	const endToken = tokens[Math.min(tokens.length - 1, tokenIndex + Math.max(1, count) - 1)];
	const startToken = tokens[tokenIndex];
	if (!startToken || !endToken) return undefined;

	let start = startToken.start;
	let end = endToken.end;
	if (scope === "around") {
		const trailingEnd = consumeWhitespaceRight(line, end);
		if (trailingEnd > end) end = trailingEnd;
		else start = consumeWhitespaceLeft(line, start);
	}

	return { from: { line: cursor.line, col: start }, to: { line: cursor.line, col: end } };
}

function paragraphTextObjectRange(lines: readonly string[], cursor: VimPosition, scope: VimTextObjectScope, count: number): VimTextRange | undefined {
	const paragraph = paragraphAtLine(lines, cursor.line);
	if (!paragraph) return undefined;

	let startLine = paragraph.startLine;
	let endLine = paragraph.endLine;
	for (let index = 1; index < Math.max(1, count); index++) {
		const next = nextParagraphAfter(lines, endLine);
		if (!next) break;
		endLine = next.endLine;
	}

	if (scope === "around") {
		const trailingEndLine = consumeBlankLinesDown(lines, endLine + 1);
		if (trailingEndLine > endLine) endLine = trailingEndLine;
		else startLine = consumeBlankLinesUp(lines, startLine - 1);
	}

	return { from: { line: startLine, col: 0 }, to: { line: endLine, col: lines[endLine]?.length ?? 0 }, linewise: true };
}

type TextToken = {
	start: number;
	end: number;
	kind: "word" | "punct";
};

function textTokens(line: string): TextToken[] {
	const tokens: TextToken[] = [];
	let index = 0;
	while (index < line.length) {
		const kind = charKind(line[index] ?? "");
		if (kind === "space") {
			index++;
			continue;
		}
		const start = index;
		while (index < line.length && charKind(line[index] ?? "") === kind) index++;
		tokens.push({ start, end: index, kind });
	}
	return tokens;
}

function tokenIndexAtCursor(tokens: readonly TextToken[], col: number): number {
	return tokens.findIndex((token) => col >= token.start && col < token.end);
}

function consumeWhitespaceRight(line: string, col: number): number {
	let index = col;
	while (index < line.length && charKind(line[index] ?? "") === "space") index++;
	return index;
}

function consumeWhitespaceLeft(line: string, col: number): number {
	let index = col;
	while (index > 0 && charKind(line[index - 1] ?? "") === "space") index--;
	return index;
}

function paragraphAtLine(lines: readonly string[], line: number): { startLine: number; endLine: number } | undefined {
	if (isBlankLine(lines[line] ?? "")) return undefined;
	let startLine = line;
	while (startLine > 0 && !isBlankLine(lines[startLine - 1] ?? "")) startLine--;
	let endLine = line;
	while (endLine < lines.length - 1 && !isBlankLine(lines[endLine + 1] ?? "")) endLine++;
	return { startLine, endLine };
}

function nextParagraphAfter(lines: readonly string[], line: number): { startLine: number; endLine: number } | undefined {
	let nextLine = line + 1;
	while (nextLine < lines.length && isBlankLine(lines[nextLine] ?? "")) nextLine++;
	return nextLine < lines.length ? paragraphAtLine(lines, nextLine) : undefined;
}

function consumeBlankLinesDown(lines: readonly string[], line: number): number {
	let currentLine = line;
	while (currentLine < lines.length && isBlankLine(lines[currentLine] ?? "")) currentLine++;
	return currentLine - 1;
}

function consumeBlankLinesUp(lines: readonly string[], line: number): number {
	let currentLine = line;
	while (currentLine >= 0 && isBlankLine(lines[currentLine] ?? "")) currentLine--;
	return currentLine + 1;
}

function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

function movementTargetForRange(range: VimTextRange): VimPosition {
	if (comparePosition(range.from, range.to) > 0) return range.from;
	return range.to;
}

function countDigit(data: string, hasCount: boolean): string | undefined {
	const char = getPrintableInput(data);
	if (!char || !/^\d$/u.test(char)) return undefined;
	return hasCount || char !== "0" ? char : undefined;
}

function sequenceCount(countBuffer: string): number {
	return Math.max(1, Number.parseInt(countBuffer || "1", 10));
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

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function keySequenceLabel(keys: readonly KeyId[]): string {
	return keys.map(keyLabel).join(" ");
}

function keyLabel(key: KeyId): string {
	if (key === "space") return "SPC";
	if (/^shift\+[a-z]$/i.test(key)) return key.slice("shift+".length).toUpperCase();
	return key;
}

function modeLabel<TServices extends object>(mode: VimModeDefinition<TServices>, context: VimCommandContext<TServices>): string {
	return typeof mode.label === "function" ? mode.label(context) : mode.label;
}

function byPrecedence(left: { order: number }, right: { order: number }): number {
	return right.order - left.order;
}

class VimDisposeStack {
	private readonly cleanupActions: VimDispose[] = [];
	private isDisposed = false;

	use(cleanupAction: VimDispose): VimDispose {
		if (this.isDisposed) {
			cleanupAction();
			return cleanupAction;
		}
		this.cleanupActions.push(cleanupAction);
		return cleanupAction;
	}

	dispose(): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		for (const cleanupAction of this.cleanupActions.splice(0).reverse()) cleanupAction();
	}
}

function removeItem<T>(items: T[], item: T): void {
	const index = items.indexOf(item);
	if (index !== -1) items.splice(index, 1);
}
