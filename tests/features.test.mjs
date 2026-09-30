import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { CommandPalette, registration as paletteRegistration } from "../src/features/command-palette.ts";
import { registration as jumpRegistration } from "../src/features/jump-mode.ts";
import { InputSourceSwitcher } from "../src/features/input-source.ts";
import { createFixture } from "./fixture.mjs";

test("jump mode is registered on the coordinated prompt and returns to normal", context => {
  const fixture = createFixture(context, { registrations: [jumpRegistration] });
  const prompt = fixture.createPrompt();
  prompt.setText("alpha beta alpha");
  prompt.handleInput("\x1b");
  prompt.handleInput("s");
  assert.equal(prompt.getMode(), "jump");
  prompt.handleInput("a");
  assert.ok(prompt.render(72).every(line => visibleWidth(line) <= 72));
  prompt.handleInput("\x1b");
  assert.equal(prompt.getMode(), "normal");
  assert.equal(fixture.modes.at(-1).mode, "normal");
});

test("palette query and arguments share focus, obey overlay visibility, and restore the prompt", context => {
  const fixture = createFixture(context);
  const prompt = fixture.createPrompt();
  prompt.setMode("normal");
  const finished = [];
  const palette = new CommandPalette({
    tui: fixture.tui, theme: fixture.theme, keybindings: fixture.keybindings,
    finish: result => finished.push(result), createLineEditor: fixture.api.vim.createLineEditor,
    commands: [{ name: "model", description: "Select model", source: "builtin", argumentHint: "<provider/model>" }],
  });
  context.after(() => palette.dispose());
  assert.equal(prompt.focused, false);
  const query = fixture.runtime.focus.getFocusedEditor();
  palette.focused = false;
  assert.equal(query.focused, false);
  assert.ok(!palette.render(72).join("").includes(CURSOR_MARKER));
  palette.focused = true;
  assert.equal(query.focused, true);
  for (const width of [40, 72, 80]) {
    const lines = palette.render(width);
    assert.ok(lines.length <= 14);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
    assert.ok(lines.at(-1).includes("╰"));
  }
  palette.handleInput("\t");
  const args = fixture.runtime.focus.getFocusedEditor();
  assert.notEqual(query, args);
  assert.equal(query.focused, false);
  palette.handleInput("X");
  assert.equal(args.getText(), "X");
  palette.handleInput("\x1b");
  palette.handleInput("\x1b");
  assert.equal(fixture.runtime.focus.getFocusedEditor(), query);
  palette.handleInput("\x1b");
  palette.handleInput("\x1b");
  assert.deepEqual(finished, [{ cancel: true }]);
  assert.equal(prompt.focused, true);
  assert.equal(prompt.getMode(), "normal");
});

test("palette binding opens one coordinated overlay and preserves the prompt draft on cancel", async context => {
  const fixture = createFixture(context, { registrations: [paletteRegistration] });
  let opened = 0;
  fixture.ctx.ui.addAutocompleteProvider = () => {};
  fixture.ctx.ui.custom = async (create, options) => {
    opened++;
    assert.equal(options.overlay, true);
    let result;
    const overlay = create(fixture.tui, fixture.theme, fixture.keybindings, value => { result = value; });
    overlay.handleInput("\x1b");
    overlay.handleInput("\x1b");
    overlay.dispose();
    return result;
  };
  const prompt = fixture.createPrompt();
  prompt.setText("saved draft");
  for (const key of ["\x1b", " ", " "]) prompt.handleInput(key);
  await Promise.resolve();
  assert.equal(opened, 1);
  assert.equal(prompt.getText(), "saved draft");
  assert.equal(prompt.focused, true);
});

test("input-source switching preserves the insert layout across normal-mode focus transfers", context => {
  const fixture = createFixture(context);
  let current = "Russian";
  const changes = [];
  const switcher = new InputSourceSwitcher({
    defaultInputSource: "ABC", command: { executable: "fake", currentArgs: [], setArgs: value => [value] },
    runCommand: (_command, args) => {
      if (args.length) { current = args[0]; changes.push(current); }
      return { status: 0, stdout: current, error: undefined };
    },
  });
  fixture.api.vim.onFocusedModeChange(event => switcher.handleFocusedMode(event));
  const prompt = fixture.createPrompt();
  prompt.setMode("normal");
  const first = fixture.api.vim.createLineEditor({ tui: fixture.tui, mode: "normal", focused: true });
  assert.deepEqual(changes, ["ABC"]);
  first.setMode("insert");
  assert.equal(current, "Russian");
  first.setMode("normal");
  first.dispose();
  assert.equal(current, "ABC");
  switcher.dispose();
  switcher.dispose();
  assert.equal(current, "Russian");
  assert.deepEqual(changes, ["ABC", "Russian", "ABC", "Russian"]);
});

test("missing input-source helper is reported once without breaking Vim editing", context => {
  const fixture = createFixture(context);
  let calls = 0;
  const switcher = new InputSourceSwitcher({
    defaultInputSource: "ABC", command: { executable: "missing", currentArgs: [], setArgs: value => [value] },
    runCommand: () => { calls++; return { status: null, stdout: "", error: new Error("ENOENT") }; },
  });
  fixture.api.vim.onFocusedModeChange(event => switcher.handleFocusedMode(event));
  const field = fixture.fields.createInput(fixture.options);
  for (const key of ["\x1b", "i", "X", "\x1b"]) field.handleInput(key);
  assert.equal(field.getValue(), "alpha betXa");
  assert.equal(fixture.notifications.length, 1);
  assert.equal(calls, 1);
});
