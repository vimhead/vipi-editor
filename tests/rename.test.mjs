import assert from "node:assert/strict";
import test from "node:test";
import * as api from "vipir-editor/api";
import { createFixture } from "./fixture.mjs";

test("Vipi export aliases and v1 wire channels still address the coordinated runtime", context => {
  for (const suffix of ["API_VERSION", "READY", "UNREADY", "REGISTER", "RUNTIME_API_REQUEST"]) {
    assert.equal(api[`VIPI_EDITOR_${suffix}`], api[`VIPIR_EDITOR_${suffix}`]);
  }
  assert.equal(api.defineVipiEditorExtension, api.defineVipirEditorExtension);
  assert.equal(api.registerVipiEditorExtension, api.registerVipirEditorExtension);
  const fixture = createFixture(context);
  const prompt = fixture.createPrompt();
  let legacyRuntime;
  fixture.pi.events.emit("vipi-editor:v1:runtime-api-request", { version: 1, receive: value => { legacyRuntime = value; } });
  const field = legacyRuntime.vim.createLineEditor({ tui: fixture.tui, focused: true });
  assert.equal(prompt.focused, false);
  field.dispose();
  assert.equal(prompt.focused, true);
});
