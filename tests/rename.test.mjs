import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as api from "vipir-editor/api";
import { createFixture } from "./fixture.mjs";

test("editor exports contain no old-name value or type aliases", async () => {
  assert.ok(!Object.keys(api).some(name => /Vipi(?!r)|VIPI(?!R)/.test(name)));
  const source = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Vipi(?!r)|VIPI(?!R)|vipi(?!r)/);
});

test("only Vipir channels address the coordinated runtime", context => {
  for (const name of ["READY", "UNREADY", "REGISTER", "RUNTIME_API_REQUEST"]) {
    assert.ok(api[`VIPIR_EDITOR_${name}`].startsWith("vipir-editor:v1:"));
  }
  const fixture = createFixture(context);
  const prompt = fixture.createPrompt();
  let received;
  fixture.pi.events.emit("vipi-editor:v1:runtime-api-request", { version: 1, receive: value => { received = value; } });
  assert.equal(received, undefined);
  fixture.pi.events.emit(api.VIPIR_EDITOR_RUNTIME_API_REQUEST, { version: 1, receive: value => { received = value; } });
  const field = received.vim.createLineEditor({ tui: fixture.tui, focused: true });
  assert.equal(prompt.focused, false);
  field.dispose();
  assert.equal(prompt.focused, true);
});
