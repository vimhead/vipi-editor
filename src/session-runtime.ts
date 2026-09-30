import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	VIPIR_EDITOR_API_VERSION,
	type VipirEditorApi,
	type VipirEditorDispose,
	type VipirEditorFocusedModeEditor,
	type VipirEditorFocusedModeHandler,
	type VipirEditorRegistration,
	type VipirEditorRuntimeApi,
	type VipirEditorServices,
	type PromptEditor,
} from "./api.ts";
import { EditorFocusCoordinator } from "./focus.ts";
import { LineEditor, type LineEditorOptions } from "./line-editor.ts";
import { TextareaEditor, type TextareaEditorOptions } from "./textarea-editor.ts";
import type { DefaultVimServices, VimCore } from "./vim-core.ts";

type SessionPrompt = PromptEditor & {
	core: VimCore<VipirEditorServices & DefaultVimServices>;
	dispose(): void;
};

type SessionRuntimeOptions = {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	registrations: ReadonlyMap<string, VipirEditorRegistration>;
};

export class VipirEditorSessionRuntime {
	readonly focus: EditorFocusCoordinator;
	private readonly cleanupByExtension = new Map<string, DisposeStack>();
	private readonly focusedModeHandlers = new Set<VipirEditorFocusedModeHandler>();
	private editor: SessionPrompt | undefined;
	private isDisposed = false;

	constructor(private readonly options: SessionRuntimeOptions) {
		this.focus = new EditorFocusCoordinator((editor) => this.publishFocusedMode(editor as VipirEditorFocusedModeEditor));
	}

	get pi(): ExtensionAPI { return this.options.pi; }
	get ctx(): ExtensionContext { return this.options.ctx; }

	setEditor(editor: SessionPrompt): void {
		this.assertActive();
		for (const cleanup of this.cleanupByExtension.values()) cleanup.dispose();
		this.cleanupByExtension.clear();
		this.editor?.dispose();
		this.editor = editor;
		for (const registration of this.options.registrations.values()) this.applyRegistration(registration);
	}

	applyRegistration(registration: VipirEditorRegistration): void {
		this.assertActive();
		this.cleanupByExtension.get(registration.extensionId)?.dispose();
		this.cleanupByExtension.delete(registration.extensionId);
		const editor = this.editor;
		if (!editor) return;
		const cleanup = new DisposeStack();
		try {
			registration.setup(this.createApi(editor, cleanup));
			this.cleanupByExtension.set(registration.extensionId, cleanup);
		} catch (error) {
			cleanup.dispose();
			throw error;
		}
		editor.requestRender();
	}

	createRuntimeApi(): VipirEditorRuntimeApi {
		return {
			version: VIPIR_EDITOR_API_VERSION,
			vim: {
				createLineEditor: (options) => this.createLineEditor(options),
				createTextareaEditor: (options) => this.createTextareaEditor(options),
				focusEditor: (editor) => this.focus.focusEditor(editor),
				onFocusedModeChange: (handler) => this.registerFocusedModeHandler(handler),
			},
		};
	}

	dispose(): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		this.focus.dispose();
		for (const cleanup of this.cleanupByExtension.values()) cleanup.dispose();
		this.cleanupByExtension.clear();
		this.focusedModeHandlers.clear();
		this.editor = undefined;
	}

	private createApi(editor: SessionPrompt, cleanup: DisposeStack): VipirEditorApi {
		return {
			...this.createRuntimeApi(),
			onDispose: (action) => { cleanup.use(action); },
			vim: {
				...this.createRuntimeApi().vim,
				registerMode: (mode) => cleanup.use(editor.core.registerMode(mode)),
				registerBinding: (modeId, binding) => cleanup.use(editor.core.registerBinding(modeId, binding)),
				onFocusedModeChange: (handler) => cleanup.use(this.registerFocusedModeHandler(handler)),
			},
		};
	}

	private createLineEditor(options: LineEditorOptions): LineEditor {
		this.assertActive();
		return new LineEditor(options, this.focus);
	}

	private createTextareaEditor(options: TextareaEditorOptions): TextareaEditor {
		this.assertActive();
		return new TextareaEditor(options, this.focus);
	}

	private registerFocusedModeHandler(handler: VipirEditorFocusedModeHandler): VipirEditorDispose {
		this.assertActive();
		this.focusedModeHandlers.add(handler);
		const editor = this.focus.getFocusedEditor();
		if (editor) this.notifyHandler(handler, editor as VipirEditorFocusedModeEditor);
		return () => { this.focusedModeHandlers.delete(handler); };
	}

	private publishFocusedMode(editor: VipirEditorFocusedModeEditor): void {
		for (const handler of this.focusedModeHandlers) this.notifyHandler(handler, editor);
	}

	private notifyHandler(handler: VipirEditorFocusedModeHandler, editor: VipirEditorFocusedModeEditor): void {
		const report = (error: unknown) => this.ctx.ui.notify(`vipir-editor focus handler failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		try {
			Promise.resolve(handler({ editor, pi: this.pi, ctx: this.ctx, mode: editor.getMode() })).catch(report);
		} catch (error) {
			report(error);
		}
	}

	private assertActive(): void {
		if (this.isDisposed) throw new Error("The vipir-editor session has stopped.");
	}
}

class DisposeStack {
	private readonly actions: VipirEditorDispose[] = [];
	private isDisposed = false;

	use(action: VipirEditorDispose): VipirEditorDispose {
		if (this.isDisposed) action();
		else this.actions.push(action);
		return action;
	}

	dispose(): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		for (const action of this.actions.splice(0).reverse()) action();
	}
}
