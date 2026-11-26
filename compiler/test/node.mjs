// The Node-API build loads on this platform and compiles a program for every target: what CI checks on each binary
// before it is published. Then the Vite front end's cache over it (vite.mjs).
// Usage: node test/node.mjs (after `npm run build`)
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const { app } = createRequire(import.meta.url)("../index.js");
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
let fail = 0;
// the last: a client-only build (08 CN-3d), as the Vite front end asks for one
for (const [entry, target, spa] of [["todo.rx", "dom"], ["todo.rx", "ssr"], ["shop/main.rx", "universal"], ["shop/main.rx", "dom", true]]) {
  const out = JSON.parse(app(path.join(examples, entry), target, null, spa));
  const modules = Object.keys(out.modules ?? {});
  const ok = modules.length > 0 && !out.error && !out.diagnostics;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${entry} (${target}${spa ? ", client-only" : ""}): ${ok ? `${modules.length} modules` : JSON.stringify(out).slice(0, 300)}`);
}
const bad = JSON.parse(app(path.join(examples, "missing.rx")));
if (!bad.error) { fail++; console.log("✗ a missing entry is not an error"); } else console.log("✓ a missing entry is an error");
// a relative JS import is the app's own file (MO-8): it stays an ES import, no package.json `#imports` needed; `./api`
// stays the injected API (CP-4)
const dir = mkdtempSync(path.join(tmpdir(), "rx-import-"));
writeFileSync(path.join(dir, "util.js"), "export const greet = n => `hi ${n}`;\n");
writeFileSync(path.join(dir, "main.rx"), [
  'import pure { greet } from "./util.js"',
  'import { save } from "./api"',
  'export default component App() {',
  '  source n := 1',
  '  <p onClick={() => { save(n) }}>{greet(n)}</p>',
  '}',
].join("\n"));
const rel = JSON.parse(app(path.join(dir, "main.rx"), "dom", null, true));
const code = Object.values(rel.modules ?? {}).map(m => m.code).join("\n");
const relOk = !rel.error && !rel.diagnostics && /from "\.\/util\.js"/.test(code) && !/from "\.\/api"/.test(code);
if (!relOk) fail++;
console.log(`${relOk ? "✓" : "✗"} a relative JS import stays an ES import${relOk ? "" : `: ${JSON.stringify(rel).slice(0, 300)}`}`);
// the Vite front end (vite.mjs) does not keep a failed build: a program that failed on an import compiles once the import
// is back (#84). The diagnostic names the importer and a rename keeps the file's mtime, so nothing it stamped changes
const { default: rx } = await import(pathToFileURL(fileURLToPath(new URL("../vite.mjs", import.meta.url))).href);
const root = mkdtempSync(path.join(tmpdir(), "rx-recover-"));
const main = path.join(root, "main.rx"), part = path.join(root, "part.rx"), away = path.join(root, "part.away");
writeFileSync(main, 'import { Part } from "./part.rx"\n\nexport default component App() {\n  <Part label="hello" />\n}\n');
writeFileSync(part, 'export component Part(props: { label: string }) {\n  <span>{props.label}</span>\n}\n');
const ctx = (id, moduleId) => ({ id, moduleId, root, solid: { generate: "dom" }, addWatchFile() {} });
const entry = front => front.compile("", ctx(main, main)).code, dep = front => front.compile("", ctx(part, `${part}?rx-dep`)).code;
const lost = compile => { try { compile(); } catch (e) { return /main\.rx:\d+(:\d+)?: error MODULE_NOT_FOUND/.test(e.message); } return false; };
let recovered;
try {
  const warm = rx(), want = { entry: entry(warm), dep: dep(warm) };
  renameSync(part, away); const failed = lost(() => entry(warm)); renameSync(away, part);
  if (!failed) throw new Error("a missing import is not MODULE_NOT_FOUND at its importer");
  if (entry(warm) !== want.entry || dep(warm) !== want.dep) throw new Error("the program compiled after its import came back differs from the first");
  // and a program whose first compile failed, then asked for by its dependency (the cold path)
  const cold = rx();
  renameSync(part, away); lost(() => entry(cold)); renameSync(away, part);
  if (dep(cold) !== want.dep) throw new Error("the dependency of a program that had failed differs from the first");
} catch (e) { recovered = e.message.split("\n")[0]; }
if (recovered) fail++;
console.log(`${recovered ? "✗" : "✓"} the Vite front end compiles a program again once its missing import is back${recovered ? `: ${recovered}` : ""}`);
process.exit(fail ? 1 : 0);
