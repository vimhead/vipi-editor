import { spawnSync } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineVipiEditorExtension, type VipiEditorFocusedModeEvent } from "../api.ts";

type InputSourceCommand = {
	executable: string;
	currentArgs: string[];
	setArgs: (inputSource: string) => string[];
};

type InputSourceSwitcherOptions = {
	defaultInputSource: string;
	command: InputSourceCommand;
	runCommand: (command: string, args: string[]) => { status: number | null; stdout: string; error: Error | undefined };
};

const MACOS_DEFAULT_INPUT_SOURCE = "com.apple.keylayout.ABC";
const MACISM_COMMAND: InputSourceCommand = {
	executable: "macism",
	currentArgs: [],
	setArgs: (inputSource) => [inputSource],
};

export const registration = defineVipiEditorExtension({
	extensionId: "input-source",
	setup(api) {
		const switcher = createMacOsInputSourceSwitcher();
		if (!switcher) return;
		api.vim.onFocusedModeChange((event) => switcher.handleFocusedMode(event));
		api.onDispose(() => switcher.dispose());
	},
});


export class InputSourceSwitcher {
	private previousInputSource: string | undefined;
	private isCommandMode = false;
	private context: ExtensionContext | undefined;
	private isCommandFailureReported = false;

	constructor(private readonly options: InputSourceSwitcherOptions) {}

	handleFocusedMode(event: VipiEditorFocusedModeEvent): void {
		this.context = event.ctx;
		const isCommandMode = event.mode !== "insert";
		if (isCommandMode === this.isCommandMode || this.isCommandFailureReported) return;
		this.isCommandMode = isCommandMode;
		if (isCommandMode) this.switchToDefaultInputSource(event.ctx);
		else this.restorePreviousInputSource(event.ctx);
	}

	dispose(): void {
		if (this.isCommandMode && this.context && !this.isCommandFailureReported) this.restorePreviousInputSource(this.context);
		this.isCommandMode = false;
		this.context = undefined;
	}

	private switchToDefaultInputSource(ctx: ExtensionContext): void {
		const currentInputSource = this.readCurrentInputSource(ctx);
		if (!currentInputSource) return;
		this.previousInputSource = currentInputSource;
		if (currentInputSource !== this.options.defaultInputSource) this.setInputSource(this.options.defaultInputSource, ctx);
	}

	private restorePreviousInputSource(ctx: ExtensionContext): void {
		const previousInputSource = this.previousInputSource;
		if (!previousInputSource) return;
		const currentInputSource = this.readCurrentInputSource(ctx);
		if (currentInputSource && currentInputSource !== previousInputSource) this.setInputSource(previousInputSource, ctx);
	}

	private readCurrentInputSource(ctx: ExtensionContext): string | undefined {
		const result = this.options.runCommand(this.options.command.executable, this.options.command.currentArgs);
		if (result.status === 0) return result.stdout.trim();
		this.reportCommandFailure(ctx, result.error);
		return undefined;
	}

	private setInputSource(inputSource: string, ctx: ExtensionContext): void {
		const result = this.options.runCommand(this.options.command.executable, this.options.command.setArgs(inputSource));
		if (result.status !== 0) this.reportCommandFailure(ctx, result.error);
	}

	private reportCommandFailure(ctx: ExtensionContext, error: Error | undefined): void {
		if (this.isCommandFailureReported) return;
		this.isCommandFailureReported = true;
		ctx.ui.notify(`vipi-editor input source switching failed: ${error?.message ?? this.options.command.executable}`, "warning");
	}
}

function createMacOsInputSourceSwitcher(): InputSourceSwitcher | undefined {
	if (process.platform !== "darwin") return undefined;
	return new InputSourceSwitcher({
		command: MACISM_COMMAND,
		defaultInputSource: process.env.VIPI_EDITOR_DEFAULT_INPUT_SOURCE ?? process.env.PI_ME_DEFAULT_INPUT_SOURCE ?? MACOS_DEFAULT_INPUT_SOURCE,
		runCommand: (command, args) => {
			const result = spawnSync(command, args, { encoding: "utf8", timeout: 1000 });
			return { status: result.status, stdout: result.stdout ?? "", error: result.error };
		},
	});
}
