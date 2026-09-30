export type FocusTarget = { getMode(): string };

export type FocusRegistration = {
	readonly isFocused: boolean;
	setFocused(isFocused: boolean): void;
	publishMode(): void;
	dispose(): void;
};

type FocusEntry = {
	editor: FocusTarget;
	onFocusChange: () => void;
	onDispose: () => void;
};

export class EditorFocusCoordinator {
	private readonly entries = new Set<FocusEntry>();
	private history: FocusEntry[] = [];
	private active: FocusEntry | undefined;
	private published: { editor: FocusTarget; mode: string } | undefined;
	private isDisposed = false;

	constructor(private readonly onFocusedMode: (editor: FocusTarget) => void) {}

	register(options: FocusEntry): FocusRegistration {
		if (this.isDisposed) throw new Error("The vipi-editor session has stopped.");
		const entry = options;
		this.entries.add(entry);
		const coordinator = this;
		return {
			get isFocused() { return coordinator.active === entry; },
			setFocused: (isFocused) => {
				if (!this.entries.has(entry)) return;
				if (isFocused) this.activate(entry);
				else if (this.active === entry) this.activate(undefined);
			},
			publishMode: () => {
				if (this.active === entry) this.publishMode(entry);
			},
			dispose: () => this.release(entry),
		};
	}

	focusEditor(editor: FocusTarget): void {
		const entry = [...this.entries].find((entry) => entry.editor === editor);
		if (entry) this.activate(entry);
	}

	getFocusedEditor(): FocusTarget | undefined {
		return this.active?.editor;
	}

	dispose(): void {
		if (this.isDisposed) return;
		this.isDisposed = true;
		this.activate(undefined);
		const entries = [...this.entries];
		this.entries.clear();
		this.history = [];
		for (const entry of entries) entry.onDispose();
	}

	private activate(entry: FocusEntry | undefined): void {
		if (this.active === entry) return;
		const previous = this.active;
		this.active = entry;
		this.published = undefined;
		if (entry) {
			this.history = this.history.filter((candidate) => candidate !== entry);
			this.history.push(entry);
		}
		previous?.onFocusChange();
		entry?.onFocusChange();
		if (entry) this.publishMode(entry);
	}

	private publishMode(entry: FocusEntry): void {
		const mode = entry.editor.getMode();
		if (this.published?.editor === entry.editor && this.published.mode === mode) return;
		this.published = { editor: entry.editor, mode };
		this.onFocusedMode(entry.editor);
	}

	private release(entry: FocusEntry): void {
		if (!this.entries.delete(entry)) return;
		this.history = this.history.filter((candidate) => candidate !== entry);
		if (this.active === entry) this.activate(this.history.at(-1));
	}
}
