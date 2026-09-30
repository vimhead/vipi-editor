import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	VIPIR_EDITOR_API_VERSION,
	VIPIR_EDITOR_READY,
	VIPIR_EDITOR_REGISTER,
	VIPIR_EDITOR_RUNTIME_API_REQUEST,
	VIPIR_EDITOR_UNREADY,
	isVipirEditorRegistration,
	isVipirEditorRuntimeApiRequest,
	type VipirEditorRegistration,
} from "./api.ts";
import { ModalEditor, takePendingRestoreDraft } from "./prompt-editor.ts";
import { VipirEditorSessionRuntime } from "./session-runtime.ts";

export default function vipirEditor(pi: ExtensionAPI): void {
	const externalRegistrations = new Map<string, VipirEditorRegistration>();
	let activeRuntime: VipirEditorSessionRuntime | undefined;
	let restoreHardwareCursor: (() => void) | undefined;

	const stopRuntime = () => {
		const runtime = activeRuntime;
		activeRuntime = undefined;
		try {
			runtime?.dispose();
			runtime?.ctx.ui.setEditorComponent(undefined);
		} finally {
			restoreHardwareCursor?.();
			restoreHardwareCursor = undefined;
			pi.events.emit(VIPIR_EDITOR_UNREADY, { version: VIPIR_EDITOR_API_VERSION });
		}
	};

	pi.events.on(VIPIR_EDITOR_REGISTER, (data) => {
		if (!isVipirEditorRegistration(data) || externalRegistrations.get(data.extensionId) === data) return;
		externalRegistrations.set(data.extensionId, data);
		activeRuntime?.applyRegistration(data);
	});
	pi.events.on(VIPIR_EDITOR_RUNTIME_API_REQUEST, (data) => {
		if (isVipirEditorRuntimeApiRequest(data) && activeRuntime) data.receive(activeRuntime.createRuntimeApi());
	});

	pi.on("session_start", async (_event, ctx) => {
		stopRuntime();
		if (ctx.mode !== "tui") return;
		const runtime = new VipirEditorSessionRuntime({ pi, ctx, registrations: externalRegistrations });
		activeRuntime = runtime;
		try {
			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				restoreHardwareCursor?.();
				const wasEnabled = tui.getShowHardwareCursor();
				tui.setShowHardwareCursor(true);
				restoreHardwareCursor = () => tui.setShowHardwareCursor(wasEnabled);
				const editor = new ModalEditor({ tui, theme, keybindings, runtime, appTheme: ctx.ui.theme });
				const restoreText = takePendingRestoreDraft();
				if (restoreText !== undefined) queueMicrotask(() => {
					if (activeRuntime === runtime && editor.getText().length === 0) {
						editor.setText(restoreText);
						editor.requestRender();
					}
				});
				return editor;
			});
			pi.events.emit(VIPIR_EDITOR_READY, { version: VIPIR_EDITOR_API_VERSION });
		} catch (error) {
			stopRuntime();
			throw error;
		}
	});

	pi.on("session_shutdown", stopRuntime);
}
