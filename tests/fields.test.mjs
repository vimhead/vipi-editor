import "./loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { VIPI_EDITOR_READY, VIPI_EDITOR_UNREADY } from "vipi-editor/api";
import { createFixture } from "./fixture.mjs";

for (const factory of ["createInput", "createTextarea"]) {
  test(`${factory} requires the coordinated session`, context => {
    const fixture = createFixture(context, { ready: false });
    assert.throws(() => fixture.fields[factory](fixture.options), /active vipi-editor session/);
    fixture.activate();
    assert.equal(fixture.fields[factory](fixture.options).getMode(), "insert");
    fixture.stop();
    assert.throws(() => fixture.fields[factory](fixture.options), /active vipi-editor session/);
  });

  test(`${factory} retains Vim editing, pending commands, Escape, focus and compact rendering`, context => {
    const fixture = createFixture(context);
    const field = fixture.fields[factory](fixture.options);
    assert.equal(field.getMode(), "insert");
    assert.equal(field.capturesInput("\x1b"), true);
    field.handleInput("\x1b");
    assert.equal(field.getMode(), "normal");
    assert.equal(field.capturesInput("\x1b"), false);
    field.handleInput("g");
    assert.equal(field.capturesInput("\x1b"), true);
    for (const key of ["g", "0", "i", "X"]) field.handleInput(key);
    assert.equal(field.getValue(), "Xalpha beta");
    assert.ok(field.render(72).join("").includes(CURSOR_MARKER));
    field.focused = false;
    assert.ok(!field.render(72).join("").includes(CURSOR_MARKER));
    field.focused = true;
    for (const width of [40, 72, 80]) {
      const lines = field.render(width);
      assert.ok(lines.length > 0 && lines.length <= 20);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
    }
    field.invalidate();
    assert.ok(fixture.getRenderRequests() > 0);
    field.dispose();
    assert.equal(field.focused, false);
  });
}

test("textarea preserves multiline values", context => {
  const fixture = createFixture(context);
  const field = fixture.fields.createTextarea({ ...fixture.options, initialValue: "first\nsecond" });
  assert.equal(field.getValue(), "first\nsecond");
  for (const key of ["\x1b", "g", "g", "0", "i", "X"]) field.handleInput(key);
  assert.equal(field.getValue(), "Xfirst\nsecond");
});

test("a mismatched API is rejected and factory disposal releases event listeners permanently", context => {
  const fixture = createFixture(context);
  fixture.setVersion(99);
  assert.throws(() => fixture.fields.createInput(fixture.options), /active vipi-editor session/);
  fixture.setVersion(1);
  fixture.fields.dispose();
  assert.equal(fixture.emitter.listenerCount(VIPI_EDITOR_READY), 0);
  assert.equal(fixture.emitter.listenerCount(VIPI_EDITOR_UNREADY), 0);
  fixture.activate();
  assert.throws(() => fixture.fields.createInput(fixture.options), /active vipi-editor session/);
});

test("prompt, input and textarea share exclusive focus with nested restoration", context => {
  const fixture = createFixture(context);
  const prompt = fixture.createPrompt();
  prompt.setText("prompt draft");
  prompt.setMode("normal");
  prompt.focused = false;
  const input = fixture.fields.createInput(fixture.options);
  assert.equal(prompt.focused, false);
  input.handleInput("\x1b");
  const textarea = fixture.fields.createTextarea({ ...fixture.options, initialValue: "textarea draft" });
  assert.equal(input.focused, false);
  assert.equal(textarea.focused, true);
  assert.equal(fixture.runtime.focus.getFocusedEditor().getMode(), "insert");
  textarea.dispose();
  assert.equal(input.focused, true);
  assert.equal(input.getMode(), "normal");
  input.dispose();
  assert.equal(prompt.focused, true);
  assert.equal(prompt.getMode(), "normal");
  assert.equal(prompt.getText(), "prompt draft");
  assert.equal(fixture.modes.at(-1).editor, prompt);
});

test("inactive editor construction, mode changes and input cannot steal the cursor or publish layout changes", context => {
  const fixture = createFixture(context);
  const prompt = fixture.createPrompt();
  prompt.setMode("normal");
  const writes = fixture.terminalWrites.length;
  const events = fixture.modes.length;
  const input = fixture.api.vim.createLineEditor({ text: "inactive", focused: false, tui: fixture.tui });
  const textarea = fixture.fields.createTextarea({ ...fixture.options, focused: false });
  input.setMode("normal");
  input.setMode("insert");
  input.handleInput("X");
  textarea.handleInput("X");
  assert.equal(input.getText(), "inactive");
  assert.equal(textarea.getValue(), "alpha beta");
  assert.equal(fixture.terminalWrites.length, writes);
  assert.equal(fixture.modes.length, events);
  input.focused = true;
  assert.equal(prompt.focused, false);
  assert.equal(fixture.modes.at(-1).editor, input);
  assert.ok(fixture.terminalWrites.at(-1).includes("\x1b[6 q"));
  input.dispose();
  assert.ok(fixture.terminalWrites.at(-1).includes("\x1b[2 q"));
});

test("session shutdown invalidates cached APIs and live controls without restoring disposed focus", context => {
  const fixture = createFixture(context);
  const prompt = fixture.createPrompt();
  const field = fixture.fields.createTextarea(fixture.options);
  fixture.stop();
  assert.equal(prompt.focused, false);
  assert.equal(field.focused, false);
  assert.equal(fixture.runtime.focus.getFocusedEditor(), undefined);
  field.handleInput("X");
  assert.equal(field.getValue(), "alpha beta");
  assert.throws(() => fixture.api.vim.createLineEditor({ text: "stale" }), /session has stopped/);
  field.dispose();
  prompt.dispose();
  assert.equal(fixture.runtime.focus.getFocusedEditor(), undefined);
});

test("focus observers receive one event per change; throwing observers do not block others", async context => {
  const fixture = createFixture(context);
  fixture.api.vim.onFocusedModeChange(() => { throw new Error("sync observer"); });
  fixture.api.vim.onFocusedModeChange(async () => { throw new Error("async observer"); });
  const field = fixture.fields.createInput(fixture.options);
  assert.equal(fixture.modes.length, 1);
  field.focused = true;
  field.render(72);
  assert.equal(fixture.modes.length, 1);
  field.handleInput("\x1b");
  assert.deepEqual(fixture.modes.map(event => event.mode), ["insert", "normal"]);
  await Promise.resolve();
  assert.equal(fixture.notifications.length, 4);
});
