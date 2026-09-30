import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vipiEditor from "../src/extension.ts";
import { createFixture } from "./fixture.mjs";
import { VIPI_EDITOR_READY, VIPI_EDITOR_UNREADY, VIPI_EDITOR_RUNTIME_API_REQUEST, registerVipiEditorExtension } from "vipi-editor/api";

async function setup(context) {
  const directory = await mkdtemp(join(tmpdir(), "vipi-editor-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  context.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(directory, { recursive: true, force: true }); });
  const fixture = createFixture(context, { ready: false });
  fixture.emitter.removeAllListeners(VIPI_EDITOR_RUNTIME_API_REQUEST);
  const handlers = new Map();
  const commands = new Map();
  fixture.pi.on = (name, handler) => handlers.set(name, handler);
  fixture.pi.registerCommand = (name, command) => commands.set(name, command);
  let prompt;
  let promptFactory;
  fixture.ctx.ui.setEditorComponent = factory => {
    promptFactory = factory;
    if (!factory) { prompt = undefined; return; }
    prompt = factory(fixture.tui, fixture.editorTheme, fixture.keybindings);
    prompt.focused = true;
  };
  vipiEditor(fixture.pi);
  const stop = () => handlers.get("session_shutdown")({}, fixture.ctx);
  context.after(stop);
  return { ...fixture, directory, handlers, commands, stop, getPrompt: () => prompt, replacePrompt: () => fixture.ctx.ui.setEditorComponent(promptFactory), start: () => handlers.get("session_start")({}, fixture.ctx) };
}

test("editor-only package coordinates API fields, cleans up and restarts", async context => {
  const fixture = await setup(context);
  const events = [];
  fixture.emitter.on(VIPI_EDITOR_READY, () => events.push("ready"));
  fixture.emitter.on(VIPI_EDITOR_UNREADY, () => events.push("unready"));
  await fixture.start();
  assert.equal(fixture.tui.getShowHardwareCursor(), true);
  const prompt = fixture.getPrompt();
  prompt.handleInput("\x1b");
  assert.equal(prompt.getMode(), "normal");
  assert.equal(fixture.commands.size, 0);
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

for (const timing of ["before-start", "after-start"]) {
  test(`external plugins attach ${timing} and retain bindings after prompt replacement and restart`, async context => {
    const fixture = await setup(context);
    let setups = 0;
    let cleanups = 0;
    let calls = 0;
    const registration = {
      extensionId: "jump-mode",
      setup(api) {
        setups++;
        api.onDispose(() => cleanups++);
        api.vim.registerBinding("normal", { keys: ["z"], run: () => { calls++; } });
      },
    };
    if (timing === "after-start") await fixture.start();
    const off = registerVipiEditorExtension(fixture.pi, registration);
    context.after(off);
    if (timing === "before-start") await fixture.start();
    assert.equal(setups, 1);
    fixture.emitter.emit(VIPI_EDITOR_READY);
    assert.equal(setups, 1);
    fixture.getPrompt().handleInput("\x1b");
    fixture.getPrompt().handleInput("z");
    assert.equal(calls, 1);
    fixture.replacePrompt();
    fixture.getPrompt().handleInput("\x1b");
    fixture.getPrompt().handleInput("z");
    assert.equal(calls, 2);
    assert.equal(setups, 2);
    assert.equal(cleanups, 1);
    fixture.stop();
    assert.equal(cleanups, 2);
    await fixture.start();
    fixture.getPrompt().handleInput("\x1b");
    fixture.getPrompt().handleInput("z");
    assert.equal(calls, 3);
    assert.equal(setups, 3);
    fixture.stop();
    assert.equal(cleanups, 3);
  });
}

test("the public package exposes only the editor, not built-in plugins", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const source = await readFile(new URL("../src/extension.ts", import.meta.url), "utf8");
  assert.deepEqual(manifest.pi.extensions, ["./src/extension.ts"]);
  assert.ok(!source.includes("./features/"));
  assert.ok(!source.includes("registerCommand"));
});
