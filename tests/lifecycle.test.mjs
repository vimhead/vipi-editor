import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vipiEditor from "../src/extension.ts";
import { createFixture } from "./fixture.mjs";
import { VIPI_EDITOR_READY, VIPI_EDITOR_UNREADY, VIPI_EDITOR_RUNTIME_API_REQUEST } from "vipi-editor/api";
import { readEditorSettings, writeEditorSettings } from "../src/settings.ts";

async function setup(context, { disabled = ["input-source"] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vipi-editor-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  context.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(directory, { recursive: true, force: true }); });
  await writeEditorSettings(directory, { disabled });
  const fixture = createFixture(context, { ready: false });
  fixture.emitter.removeAllListeners(VIPI_EDITOR_RUNTIME_API_REQUEST);
  const handlers = new Map();
  const commands = new Map();
  fixture.pi.on = (name, handler) => handlers.set(name, handler);
  fixture.pi.registerCommand = (name, command) => commands.set(name, command);
  let prompt;
  fixture.ctx.ui.setEditorComponent = factory => {
    if (!factory) { prompt = undefined; return; }
    prompt = factory(fixture.tui, fixture.editorTheme, fixture.keybindings);
    prompt.focused = true;
  };
  vipiEditor(fixture.pi);
  const stop = () => handlers.get("session_shutdown")({}, fixture.ctx);
  context.after(stop);
  return { ...fixture, directory, handlers, commands, stop, getPrompt: () => prompt, start: () => handlers.get("session_start")({}, fixture.ctx) };
}

test("single extension starts all features, coordinates API fields, cleans up and restarts", async context => {
  const fixture = await setup(context);
  const events = [];
  fixture.emitter.on(VIPI_EDITOR_READY, () => events.push("ready"));
  fixture.emitter.on(VIPI_EDITOR_UNREADY, () => events.push("unready"));
  await fixture.start();
  assert.equal(fixture.tui.getShowHardwareCursor(), true);
  const prompt = fixture.getPrompt();
  prompt.handleInput("\x1b");
  prompt.handleInput("s");
  assert.equal(prompt.getMode(), "jump");
  const field = fixture.fields.createInput(fixture.options);
  assert.equal(prompt.focused, false);
  field.dispose();
  assert.equal(prompt.focused, true);
  fixture.stop();
  fixture.stop();
  assert.equal(prompt.focused, false);
  assert.equal(fixture.tui.getShowHardwareCursor(), false);
  assert.throws(() => fixture.fields.createInput(fixture.options), /active vipi-editor session/);
  await fixture.start();
  assert.notEqual(fixture.getPrompt(), prompt);
  assert.equal(fixture.fields.createTextarea(fixture.options).getMode(), "insert");
  assert.equal(events.filter(event => event === "ready").length, 2);
});

test("non-TUI startup never installs an editor or publishes readiness", async context => {
  const fixture = await setup(context);
  fixture.ctx.mode = "rpc";
  let ready = 0;
  fixture.emitter.on(VIPI_EDITOR_READY, () => ready++);
  await fixture.start();
  assert.equal(fixture.getPrompt(), undefined);
  assert.equal(ready, 0);
  assert.equal(fixture.tui.getShowHardwareCursor(), false);
});

test("feature commands persist explicit choices and disable features on the next session", async context => {
  const fixture = await setup(context);
  const command = fixture.commands.get("vipi-editor");
  await command.handler("disable jump-mode", fixture.ctx);
  await fixture.start();
  const prompt = fixture.getPrompt();
  prompt.handleInput("\x1b");
  prompt.handleInput("s");
  assert.notEqual(prompt.getMode(), "jump");
  assert.deepEqual((await readEditorSettings(fixture.directory)).disabled, ["input-source", "jump-mode"]);
  await command.handler("enable jump-mode", fixture.ctx);
  await fixture.start();
  fixture.getPrompt().handleInput("\x1b");
  fixture.getPrompt().handleInput("s");
  assert.equal(fixture.getPrompt().getMode(), "jump");
  const saved = await readFile(join(fixture.directory, "vipi-editor.json"), "utf8");
  await command.handler("disable unknown", fixture.ctx);
  assert.equal(await readFile(join(fixture.directory, "vipi-editor.json"), "utf8"), saved);
});

test("settings inherit legacy feature choices without writes until an explicit override", async context => {
  const directory = await mkdtemp(join(tmpdir(), "vipi-editor-settings-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await readEditorSettings(directory), { disabled: [] });
  await writeFile(join(directory, "vipi.json"), JSON.stringify({ disabled: ["pi-me-jump-mode"], editorDisabledFeatures: ["command-palette"] }));
  assert.deepEqual(await readEditorSettings(directory), { disabled: ["command-palette", "jump-mode"] });
  await assert.rejects(readFile(join(directory, "vipi-editor.json")), { code: "ENOENT" });
  await writeEditorSettings(directory, { disabled: [] });
  assert.deepEqual(await readEditorSettings(directory), { disabled: [] });
  await writeFile(join(directory, "vipi-editor.json"), '{"disabled":["unknown"]}');
  await assert.rejects(readEditorSettings(directory), /disabled array/);
});
