import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^pi-me(?:[/-]|$)/.test(specifier)) throw new Error(`Retired package import: ${specifier}`);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
    const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: new URL(url).pathname,
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
