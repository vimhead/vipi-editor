import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
import { registration as jumpMode } from "./features/jump-mode.ts";
import { registration as commandPalette } from "./features/command-palette.ts";
import { registration as inputSource } from "./features/input-source.ts";
import { ModalEditor, takePendingRestoreDraft } from "./prompt-editor.ts";
import { VipiEditorSessionRuntime } from "./session-runtime.ts";
import { editorFeatures, isEditorFeature, readEditorSettings, writeEditorSettings } from "./settings.ts";

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
		if (!isVipiEditorRegistration(data) || isEditorFeature(data.extensionId)) return;
		externalRegistrations.set(data.extensionId, data);
		activeRuntime?.applyRegistration(data);
	});
	pi.events.on(VIPI_EDITOR_RUNTIME_API_REQUEST, (data) => {
		if (isVipiEditorRuntimeApiRequest(data) && activeRuntime) data.receive(activeRuntime.createRuntimeApi());
	});

	pi.registerCommand("vipi-editor", {
		description: "Show editor features, or enable/disable jump-mode, command-palette, or input-source",
		handler: async (args, ctx) => {
			const settings = await readEditorSettings(getAgentDir());
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length === 0) {
				ctx.ui.notify(editorFeatures.map((feature) => `${feature}: ${settings.disabled.includes(feature) ? "disabled" : "enabled"}`).join("\n"), "info");
				return;
			}
			const [action, feature] = parts;
			if (parts.length !== 2 || (action !== "enable" && action !== "disable") || !isEditorFeature(feature)) {
				ctx.ui.notify("Use /vipi-editor enable|disable jump-mode|command-palette|input-source", "error");
				return;
			}
			const disabled = new Set(settings.disabled);
			if (action === "disable") disabled.add(feature);
			else disabled.delete(feature);
			await writeEditorSettings(getAgentDir(), { disabled: [...disabled] });
			ctx.ui.notify(`${feature} ${action}d. Run /reload to apply.`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		stopRuntime();
		if (ctx.mode !== "tui") return;
		const settings = await readEditorSettings(getAgentDir());
		const registrations = new Map(externalRegistrations);
		for (const registration of [jumpMode, commandPalette, inputSource]) {
			if (isEditorFeature(registration.extensionId) && !settings.disabled.includes(registration.extensionId)) {
				registrations.set(registration.extensionId, registration);
			}
		}
		const runtime = new VipiEditorSessionRuntime({ pi, ctx, registrations });
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
