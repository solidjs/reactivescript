// Round trip over a corpus of .rx apps, to find bugs: each directory with a main.rx is an app.
//   rx → Solid view (per module) → rx' (torx) → Solid view'      the two views must match
// Every failure is put in the layer that broke, with its first lines, and written to OUT as JSON.
// node tests/roundtrip.corpus.mts <dir>... [LIMIT=n] [OUT=file] [SHOW=kind]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { loadRxc } from "../src/rxc.ts";
import { solidify } from "../src/solidify.ts";
import { declaredIn, toRx } from "../src/torx.ts";
import * as prettier from "prettier/standalone";
import * as babel from "prettier/plugins/babel";
import * as estree from "prettier/plugins/estree";

const call = loadRxc(new WebAssembly.Module(readFileSync(new URL("../public/rxc.wasm", import.meta.url))));
const fmt = (c: string) => prettier.format(c, { parser: "babel", plugins: [babel, estree as any], printWidth: 100, useTabs: true });
const parse = (code: string) => (babel as any).parsers["babel-ts"].parse(code, {});
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const SHOW = process.env.SHOW;

function apps(roots: string[]): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    if (names.includes("main.rx")) found.push(d);
    for (const n of names) if (n !== "node_modules" && !n.startsWith(".git") && statSync(join(d, n)).isDirectory()) walk(join(d, n));
  };
  roots.forEach(walk);
  return found;
}
const load = (d: string) =>
  Object.fromEntries(readdirSync(d).filter((n) => /\.(rx|ts|js|mjs)$/.test(n) && statSync(join(d, n)).isFile()).map((n) => ["/" + n, readFileSync(join(d, n), "utf8")]));

type Out = { modules?: Record<string, { jsx?: string }>; error?: string; diagnostics?: { code: string; message?: string; msg?: string; line?: number; file?: string }[] };
const compile = (files: Record<string, string>): Out => call("app", { entry: "/main.rx", target: "dom", jsx: true }, files);
const unscoped = (code: string) =>
  code.replace(/class=\{\[([^\n]*), "tsrx-[0-9a-f]+"\]\}/g, "class={$1}").replace(/ ?tsrx-[0-9a-f]+/g, "").replace(/\s+class=""/g, "");
async function views(out: Out) {
  const v: Record<string, string> = {};
  for (const [k, m] of Object.entries(out.modules ?? {})) if (m.jsx !== undefined && k.endsWith(".rx")) v[k] = await fmt(unscoped(await fmt(solidify(await fmt(m.jsx)))));
  return v;
}
const diag = (out: Out) => (out.diagnostics ?? []).map((d) => `${d.file ?? ""}:${d.line ?? "?"} ${d.code} ${(d.message ?? d.msg ?? "").slice(0, 160)}`).join("\n") || (out.error ?? "");

type Finding = { app: string; kind: string; module?: string; detail: string; rx?: string; view?: string; rx2?: string };
const findings: Finding[] = [];
const seen = new Set<string>();
let ran = 0, skipped = 0, dup = 0;
const counts: Record<string, number> = {};
const note = (f: Finding) => {
  findings.push(f);
  counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  if (!SHOW || SHOW === f.kind) console.log(`${f.kind.padEnd(14)} ${f.app}${f.module ? " " + f.module : ""}\n  ${f.detail.split("\n").slice(0, 4).join("\n  ")}`);
};

for (const d of apps(process.argv.slice(2))) {
  if (ran >= LIMIT) break;
  const files = load(d);
  const hash = createHash("sha1").update(JSON.stringify(files)).digest("hex");
  if (seen.has(hash)) {
    dup++;
    continue;
  }
  seen.add(hash);
  const app = relative(process.cwd(), d);
  let out0: Out;
  try {
    out0 = compile(files);
  } catch (e) {
    note({ app, kind: "rxc-throws", detail: String(e) });
    continue;
  }
  if (!out0.modules) {
    skipped++;
    continue;
  }
  ran++;
  let v0: Record<string, string>;
  try {
    v0 = await views(out0);
  } catch (e) {
    note({ app, kind: "view-unparsable", detail: (e as Error).message });
    continue;
  }
  const files2 = { ...files };
  let broke = false;
  for (const [mod, view] of Object.entries(v0)) {
    let r: ReturnType<typeof toRx>;
    try {
      // the other modules' views: what each exports, so a source read across modules reads as itself
      // and its .d.rx files: a pure fn imports pure, an io fn does not
      const declared = (from: string, name: string) => {
        const d = files["/" + from.replace(/^\.\//, "").replace(/\.\w+$/, "") + ".d.rx"];
        return d === undefined ? undefined : declaredIn(d).get(name);
      };
      r = toRx(parse(view), view, { declared, modules: (from) => (v0["/" + from.replace(/^\.\//, "")] === undefined ? undefined : parse(v0["/" + from.replace(/^\.\//, "")])) });
    } catch (e) {
      note({ app, module: mod, kind: "torx-throws", detail: (e as Error).stack ?? String(e), view });
      broke = true;
      continue;
    }
    if (r.problems.length) {
      note({ app, module: mod, kind: "torx-refuses", detail: r.problems.map((p) => `line ${p.line}: ${p.message}`).join("\n"), rx: files[mod], view });
      broke = true;
      continue;
    }
    files2[mod] = r.code;
    for (const [k, v] of Object.entries(r.files)) files2["/" + k] = v;
  }
  if (broke) continue;
  const out2 = compile(files2);
  if (!out2.modules) {
    note({ app, kind: "rx2-rejected", detail: diag(out2), rx2: Object.entries(files2).filter(([k]) => k.endsWith(".rx")).map(([k, v]) => `--- ${k}\n${v}`).join("\n") });
    continue;
  }
  const v2 = await views(out2);
  for (const mod of Object.keys(v0)) {
    if (v0[mod] === v2[mod]) continue;
    const a = v0[mod].split("\n"), b = (v2[mod] ?? "").split("\n");
    const i = a.findIndex((l, j) => l !== b[j]);
    note({ app, module: mod, kind: "view-differs", detail: `first difference at line ${i + 1}\n- ${a[i]?.trim()}\n+ ${b[i]?.trim()}`, rx: files[mod], rx2: files2[mod], view: v0[mod] });
  }
}
console.log(`\n${ran} apps round-tripped, ${skipped} skipped (the original does not compile), ${dup} duplicates`);
console.log(Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join("\n") || "no findings");
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(findings, null, 1));
