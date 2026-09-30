import { spawnSync } from "node:child_process";

type ClipboardCommand = {
	command: string;
	args: string[];
};

export function writeSystemClipboard(text: string): void {
	const command = getClipboardWriteCommand();
	if (!command) return;
	spawnSync(command.command, command.args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
}

export function readSystemClipboard(): string {
	const command = getClipboardReadCommand();
	if (!command) return "";
	const result = spawnSync(command.command, command.args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	return result.status === 0 ? result.stdout : "";
}

function getClipboardWriteCommand(): ClipboardCommand | undefined {
	if (process.platform === "darwin" && commandExists("pbcopy")) return { command: "pbcopy", args: [] };
	if (process.platform === "win32" && commandExists("powershell.exe")) {
		return {
			command: "powershell.exe",
			args: ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
		};
	}
	if (commandExists("wl-copy")) return { command: "wl-copy", args: [] };
	if (commandExists("xclip")) return { command: "xclip", args: ["-selection", "clipboard"] };
	if (commandExists("xsel")) return { command: "xsel", args: ["--clipboard", "--input"] };
	return undefined;
}

function getClipboardReadCommand(): ClipboardCommand | undefined {
	if (process.platform === "darwin" && commandExists("pbpaste")) return { command: "pbpaste", args: [] };
	if (process.platform === "win32" && commandExists("powershell.exe")) {
		return { command: "powershell.exe", args: ["-NoProfile", "-Command", "Get-Clipboard -Raw"] };
	}
	if (commandExists("wl-paste")) return { command: "wl-paste", args: ["--no-newline"] };
	if (commandExists("xclip")) return { command: "xclip", args: ["-selection", "clipboard", "-out"] };
	if (commandExists("xsel")) return { command: "xsel", args: ["--clipboard", "--output"] };
	return undefined;
}

function commandExists(command: string): boolean {
	const checker = process.platform === "win32" ? "where" : "command";
	const args = process.platform === "win32" ? [command] : ["-v", command];
	const result = spawnSync(checker, args, { stdio: "ignore", shell: process.platform !== "win32" });
	return result.status === 0;
}
