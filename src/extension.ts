import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	VIPI_EDITOR_API_VERSION,
	VIPI_EDITOR_READY,
	VIPI_EDITOR_REGISTER,
	VIPI_EDITOR_RUNTIME_API_REQUEST,
	VIPI_EDITOR_UNREADY,
	isVipiEditorRegistration,
	isVipiEditorRuntimeApiRequest,
	type VipiEditorRegistration,
} from "./api.ts";
import { ModalEditor, takePendingRestoreDraft } from "./prompt-editor.ts";
import { VipiEditorSessionRuntime } from "./session-runtime.ts";

export default function vipiEditor(pi: ExtensionAPI): void {
	const externalRegistrations = new Map<string, VipiEditorRegistration>();
	let activeRuntime: VipiEditorSessionRuntime | undefined;
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
			pi.events.emit(VIPI_EDITOR_UNREADY, { version: VIPI_EDITOR_API_VERSION });
		}
	};

	pi.events.on(VIPI_EDITOR_REGISTER, (data) => {
		if (!isVipiEditorRegistration(data) || externalRegistrations.get(data.extensionId) === data) return;
		externalRegistrations.set(data.extensionId, data);
		activeRuntime?.applyRegistration(data);
	});
	pi.events.on(VIPI_EDITOR_RUNTIME_API_REQUEST, (data) => {
		if (isVipiEditorRuntimeApiRequest(data) && activeRuntime) data.receive(activeRuntime.createRuntimeApi());
	});

	pi.on("session_start", async (_event, ctx) => {
		stopRuntime();
		if (ctx.mode !== "tui") return;
		const runtime = new VipiEditorSessionRuntime({ pi, ctx, registrations: externalRegistrations });
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
			pi.events.emit(VIPI_EDITOR_READY, { version: VIPI_EDITOR_API_VERSION });
		} catch (error) {
			stopRuntime();
			throw error;
		}
	});

	pi.on("session_shutdown", stopRuntime);
}
