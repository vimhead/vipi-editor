import "./loader.mjs";
import { EventEmitter } from "node:events";
import { VipirEditorSessionRuntime } from "../src/session-runtime.ts";
import { ModalEditor } from "../src/prompt-editor.ts";
import { createFieldControls, VIPIR_EDITOR_API_VERSION, VIPIR_EDITOR_READY, VIPIR_EDITOR_UNREADY, VIPIR_EDITOR_RUNTIME_API_REQUEST } from "vipir-editor/api";

export function createFixture(context, { ready = true, registrations = [] } = {}) {
  const emitter = new EventEmitter();
  const terminalWrites = [];
  const notifications = [];
  const modes = [];
  let renders = 0;
  let showHardwareCursor = false;
  const tui = {
    terminal: { write: data => terminalWrites.push(data), columns: 72, rows: 20 },
    requestRender() { renders++; },
    getShowHardwareCursor: () => showHardwareCursor,
    setShowHardwareCursor: value => { showHardwareCursor = value; },
  };
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text, inverse: text => text,
    getThinkingBorderColor: () => text => text };
  const keybindings = {
    matches: (data, action) => (action === "tui.select.cancel" && data === "\x1b") || (action === "tui.select.confirm" && data === "\r"),
    getKeys: action => ({ "tui.select.cancel": ["escape"], "tui.select.confirm": ["enter"], "tui.select.up": ["up"], "tui.select.down": ["down"] }[action] ?? []),
  };
  const editorTheme = { borderColor: text => text, selectList: { selectedPrefix: text => text, selectedText: text => text, description: text => text, scrollInfo: text => text, noMatch: text => text } };
  const pi = { events: {
    emit: (name, data) => emitter.emit(name, data),
    on(name, listener) { emitter.on(name, listener); return () => emitter.off(name, listener); },
  }, getCommands: () => [] };
  const ctx = { mode: "tui", isIdle: () => true, ui: { theme, notify: (...args) => notifications.push(args) } };
  const runtime = new VipirEditorSessionRuntime({ pi, ctx, registrations: new Map(registrations.map(r => [r.extensionId, r])) });
  let active = ready;
  let version = VIPIR_EDITOR_API_VERSION;
  emitter.on(VIPIR_EDITOR_RUNTIME_API_REQUEST, ({ receive }) => {
    if (active) receive({ ...runtime.createRuntimeApi(), version });
  });
  const api = runtime.createRuntimeApi();
  api.vim.onFocusedModeChange(event => modes.push({ editor: event.editor, mode: event.mode }));
  const fields = createFieldControls(pi);
  const options = { tui, theme, keybindings, initialValue: "alpha beta", placeholder: undefined, focused: true, onRequestRender: () => tui.requestRender() };
  context.after(() => { fields.dispose(); runtime.dispose(); });
  return {
    pi, ctx, runtime, api, fields, options, tui, theme, keybindings, editorTheme, modes, emitter, terminalWrites, notifications,
    getRenderRequests: () => renders,
    createPrompt() { const editor = new ModalEditor({ tui, theme: editorTheme, keybindings, runtime, appTheme: theme }); editor.focused = true; return editor; },
    activate() { active = true; emitter.emit(VIPIR_EDITOR_READY); },
    stop() { active = false; runtime.dispose(); emitter.emit(VIPIR_EDITOR_UNREADY); },
    setVersion(next) { version = next; emitter.emit(VIPIR_EDITOR_READY); },
  };
}
