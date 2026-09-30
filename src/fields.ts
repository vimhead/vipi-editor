import {
	type EditorTheme,
	type SelectListTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import {
	VIPIR_EDITOR_API_VERSION,
	VIPIR_EDITOR_READY,
	VIPIR_EDITOR_RUNTIME_API_REQUEST,
	VIPIR_EDITOR_UNREADY,
	type FieldControl,
	type VipirEditorEventBus,
	type VipirEditorKeybindingsManager,
	type VipirEditorRuntimeApi,
	type VipirEditorTheme,
} from "./api.ts";

export type { FieldControl } from "./textarea-editor.ts";

export type FieldControlOptions = {
	readonly tui: TUI;
	readonly theme: VipirEditorTheme;
	readonly keybindings: VipirEditorKeybindingsManager;
	readonly initialValue: string;
	readonly placeholder: string | undefined;
	readonly focused: boolean;
	readonly onRequestRender: (() => void) | undefined;
};

export type FieldControls = {
	createInput(options: FieldControlOptions): FieldControl;
	createTextarea(options: FieldControlOptions): FieldControl;
	dispose(): void;
};

export function createFieldControls(pi: { events: VipirEditorEventBus }): FieldControls {
	let runtimeApi: VipirEditorRuntimeApi | undefined;
	let isDisposed = false;

	const requestRuntimeApi = () => {
		runtimeApi = undefined;
		pi.events.emit(VIPIR_EDITOR_RUNTIME_API_REQUEST, {
			version: VIPIR_EDITOR_API_VERSION,
			receive(api: VipirEditorRuntimeApi) {
				if (api.version === VIPIR_EDITOR_API_VERSION) runtimeApi = api;
			},
		});
	};

	const requireRuntimeApi = (): VipirEditorRuntimeApi => {
		if (isDisposed || !runtimeApi) {
			throw new Error("Fields require an active vipir-editor session. Enable vipir-editor and create fields after session_start.");
		}
		return runtimeApi;
	};

	requestRuntimeApi();
	const offReady = pi.events.on(VIPIR_EDITOR_READY, requestRuntimeApi);
	const offUnready = pi.events.on(VIPIR_EDITOR_UNREADY, () => {
		runtimeApi = undefined;
	});

	return {
		createInput(options) {
			return new ModalInputControl(requireRuntimeApi(), options);
		},
		createTextarea(options) {
			return new ModalTextareaControl(requireRuntimeApi(), options);
		},
		dispose() {
			isDisposed = true;
			offReady();
			offUnready();
			runtimeApi = undefined;
		},
	};
}

class ModalInputControl implements FieldControl {
	private readonly lineEditor;

	constructor(runtimeApi: VipirEditorRuntimeApi, private readonly options: FieldControlOptions) {
		this.lineEditor = runtimeApi.vim.createLineEditor({
			text: options.initialValue,
			mode: "insert",
			placeholder: options.placeholder,
			theme: options.theme,
			tui: options.tui,
			showModeBadge: true,
			focused: options.focused,
			onChange: undefined,
			onModeChange: undefined,
			onFocusedModeChange: undefined,
			onRequestRender: options.onRequestRender,
		});
	}

	get focused(): boolean {
		return this.lineEditor.focused;
	}

	set focused(value: boolean) {
		this.lineEditor.setFocused(value);
	}

	getValue(): string {
		return this.lineEditor.getText();
	}

	getMode(): string {
		return this.lineEditor.getMode();
	}

	capturesInput(data: string): boolean {
		return Boolean(this.lineEditor.getPendingLabel()) || (this.lineEditor.getMode() === "insert" && this.options.keybindings.matches(data, "tui.select.cancel"));
	}

	render(width: number): string[] {
		return this.lineEditor.render(width);
	}

	handleInput(data: string): void {
		this.lineEditor.handleInput(data);
	}

	invalidate(): void {
		this.lineEditor.invalidate();
	}

	dispose(): void {
		this.lineEditor.dispose();
	}
}

class ModalTextareaControl implements FieldControl {
	private readonly textareaEditor;

	constructor(runtimeApi: VipirEditorRuntimeApi, private readonly options: FieldControlOptions) {
		this.textareaEditor = runtimeApi.vim.createTextareaEditor({
			text: options.initialValue,
			mode: "insert",
			tui: options.tui,
			editorTheme: editorTheme(options.theme),
			theme: options.theme,
			showModeBadge: true,
			focused: options.focused,
			onChange: undefined,
			onModeChange: undefined,
			onFocusedModeChange: undefined,
			onRequestRender: options.onRequestRender,
		});
	}

	get focused(): boolean {
		return this.textareaEditor.focused;
	}

	set focused(value: boolean) {
		this.textareaEditor.focused = value;
	}

	getValue(): string {
		return this.textareaEditor.getValue();
	}

	getMode(): string {
		return this.textareaEditor.getMode();
	}

	capturesInput(data: string): boolean {
		return this.textareaEditor.capturesInput?.(data) === true || (this.textareaEditor.getMode() === "insert" && this.options.keybindings.matches(data, "tui.select.cancel"));
	}

	render(width: number): string[] {
		return this.textareaEditor.render(width);
	}

	handleInput(data: string): void {
		this.textareaEditor.handleInput?.(data);
	}

	invalidate(): void {
		this.textareaEditor.invalidate();
	}

	dispose(): void {
		this.textareaEditor.dispose?.();
	}
}

function editorTheme(theme: VipirEditorTheme): EditorTheme {
	return {
		borderColor: (text) => theme.fg("borderMuted", text),
		selectList: selectListTheme(theme),
	};
}

function selectListTheme(theme: VipirEditorTheme): SelectListTheme {
	return {
		selectedPrefix: (text) => theme.fg("accent", text),
		selectedText: (text) => theme.fg("accent", text),
		description: (text) => theme.fg("muted", text),
		scrollInfo: (text) => theme.fg("muted", text),
		noMatch: (text) => theme.fg("muted", text),
	};
}
