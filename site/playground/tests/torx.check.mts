// Round trip: .rx → the Solid view → .rx (toRx) → the Solid view again; the two views must match.
// Run after `pnpm wasm`: node tests/torx.check.mts [-v]
import { readFileSync } from "node:fs";
import { loadRxc } from "../src/rxc.ts";
import { presets } from "../src/presets.ts";
import { solidify } from "../src/solidify.ts";
import { toRx } from "../src/torx.ts";
import { extra, samples } from "./torx.samples.mts";
import * as prettier from "prettier/standalone";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";

const verbose = process.argv.includes("-v");
const call = loadRxc(new WebAssembly.Module(readFileSync(new URL("../public/rxc.wasm", import.meta.url))));
const fmt = (c: string) => prettier.format(c, { parser: "babel", plugins: [babel, estree as any], printWidth: 100, useTabs: true });

async function view(files: Record<string, string>) {
  const out = call("app", { entry: "/main.rx", target: "dom", jsx: true }, files);
  if (!out.modules) throw new Error(out.error ?? JSON.stringify(out.diagnostics));
  return fmt(solidify(await fmt(out.modules["/main.rx"].jsx)));
}
// a <style> is not in the view, so its scope classes are not either
const unscoped = async (code: string) =>
  fmt(
    code
      .replace(/class=\{\[([^\n]*), "tsrx-[0-9a-f]+"\]\}/g, "class={$1}")
      .replace(/ ?tsrx-[0-9a-f]+/g, "")
      .replace(/\s+class=""/g, ""),
  );
const back = (solid: string) => toRx((babel as any).parsers["babel-ts"].parse(solid, {}), solid);

let failed = 0;
const cases = [...presets.map((p) => [p.id, p.files] as const), ...Object.entries(extra).map(([k, v]) => [k, { "main.rx": v }] as const)];
for (const [id, files] of cases) {
  const fs = Object.fromEntries(Object.entries(files).map(([k, v]) => ["/" + k, v]));
  const solid = await view(fs);
  const rx = back(solid);
  let again = "";
  let error = rx.problems.map((p) => `line ${p.line}: ${p.message}`).join("\n");
  if (!error) {
    try {
      again = await view({ ...fs, "/main.rx": rx.code });
    } catch (e) {
      error = `the .rx does not compile: ${(e as Error).message}`;
    }
  }
  const same = !error && (await unscoped(again)) === (await unscoped(solid));
  console.log(`${same ? "ok  " : "FAIL"} ${id}`);
  if (!same) failed++;
  if (!same || verbose) {
    if (error) console.log(error);
    console.log("--- .rx from Solid\n" + rx.code);
    if (!same && again) console.log("--- expected view\n" + (await unscoped(solid)) + "--- got\n" + (await unscoped(again)));
  }
}

for (const [id, s] of Object.entries(samples)) {
  const rx = back(s.solid);
  const fs = { ...(s.files ?? {}), "/main.rx": rx.code };
  const out = rx.problems.length ? undefined : call("app", { entry: "/main.rx", target: "dom", jsx: true }, fs);
  const codes = [...new Set<string>((out?.diagnostics ?? []).map((d: any) => d.code))];
  const text = (s.helpers ?? []).every((h) => (rx.files["helpers.ts"] ?? "").includes(h)) && (s.has ?? []).every((h) => rx.code.includes(h));
  const ok = text && rx.problems.length === (s.problems ?? 0) && (s.problems ? true : s.diagnostics ? JSON.stringify(codes) === JSON.stringify(s.diagnostics) : !!out?.modules);
  console.log(`${ok ? "ok  " : "FAIL"} hand-written ${id}${s.problems ? `: ${rx.problems.length} problems reported` : s.diagnostics ? `: the checker says ${codes.join(", ")}` : ""}`);
  if (!ok) failed++;
  if (!ok || verbose) console.log(rx.code + Object.entries(rx.files).map(([k, v]) => `--- ${k}\n${v}`).join("") + rx.problems.map((p) => `line ${p.line}: ${p.message}`).join("\n") + (out && !out.modules ? `\n${out.error ?? ""} ${JSON.stringify(out.diagnostics)}` : ""));
}
process.exit(failed ? 1 : 0);
