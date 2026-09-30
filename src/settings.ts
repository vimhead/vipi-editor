import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const editorFeatures = ["jump-mode", "command-palette", "input-source"] as const;
export type EditorFeature = typeof editorFeatures[number];
export type EditorSettings = { disabled: EditorFeature[] };

export function isEditorFeature(value: unknown): value is EditorFeature {
	return typeof value === "string" && editorFeatures.some((feature) => feature === value);
}

export function parseEditorSettings(value: unknown): EditorSettings {
	if (!value || typeof value !== "object" || !("disabled" in value) || !Array.isArray(value.disabled) || !value.disabled.every(isEditorFeature)) {
		throw new Error("vipi-editor.json must contain a disabled array of jump-mode, command-palette, or input-source.");
	}
	return { disabled: [...new Set(value.disabled)].sort() };
}

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
		throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function readEditorSettings(agentDir: string): Promise<EditorSettings> {
	const explicit = await readJson(join(agentDir, "vipi-editor.json"));
	if (explicit !== undefined) return parseEditorSettings(explicit);
	const legacy = await readJson(join(agentDir, "vipi.json")) ?? await readJson(join(agentDir, "yappi.json"));
	if (!legacy || typeof legacy !== "object") return { disabled: [] };
	const state = legacy as Record<string, unknown>;
	const featureChoices = Array.isArray(state.editorDisabledFeatures) ? state.editorDisabledFeatures.filter(isEditorFeature) : [];
	const disabled = state.disabled ?? state.disabledPrimary;
	const legacyChoices = Array.isArray(disabled) ? editorFeatures.filter((feature) => disabled.includes(`pi-me-${feature}`)) : [];
	return { disabled: [...new Set([...featureChoices, ...legacyChoices])].sort() };
}

export async function writeEditorSettings(agentDir: string, settings: EditorSettings): Promise<void> {
	const normalized = parseEditorSettings(settings);
	await mkdir(agentDir, { recursive: true });
	const path = join(agentDir, "vipi-editor.json");
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(normalized, null, "\t")}\n`, "utf8");
	await rename(temporary, path);
}
