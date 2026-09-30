import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

export type VipirEditorTheme = {
	fg(role: string, text: string): string;
	bold(text: string): string;
	inverse(text: string): string;
};

export type VipirEditorEventBus = {
	emit(channel: string, data: unknown): void;
	on(channel: string, handler: (data: unknown) => void): () => void;
};

export type VipirEditorExtensionApi = ExtensionAPI;

export type VipirEditorExtensionContext = ExtensionContext;

export type VipirEditorKeybindingsManager = {
	matches(data: string, keybinding: string): boolean;
	getKeys(keybinding: string): string[];
};

export type VipirEditorKeySequence = readonly KeyId[];
