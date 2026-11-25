// Both directions, checked for lost text as well as a matching view:
//   .rx first:   rx → Solid → rx'          rx' must keep rx's comments, strings and names
//   Solid first: tsx → rx → Solid → rx''   rx'' must equal rx (a fixed point), and rx must keep tsx's comments, strings and names
// Run after `pnpm wasm`: node tests/roundtrip.check.mts [-v]
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
const parse = (code: string) => (babel as any).parsers["babel-ts"].parse(code, {});

async function view(files: Record<string, string>) {
  const out = call("app", { entry: "/main.rx", target: "dom", jsx: true }, files);
  if (!out.modules) throw new Error(out.error ?? JSON.stringify(out.diagnostics));
  return fmt(solidify(await fmt(out.modules["/main.rx"].jsx)));
}
const back = (solid: string) => toRx(parse(solid), solid);
const squeeze = (s: string) => s.replace(/\s+/g, " ").trim();

// What a reader would miss: comments, string and template text, and the names the author chose.
type Facts = { comments: Set<string>; strings: Set<string>; names: Set<string>; types: Set<string> };
// names .rx spells differently by design: Solid's API, its setters, and `props`
const SOLID_API = /^(create[A-Z]\w*|on[A-Z]\w*|set[A-Z]\w*|props|render|action|refresh|isPending|untrack|batch|Show|For|Loading|Errored|Switch|Match|Index)$/;
function solidFacts(code: string): Facts {
  const ast = parse(code);
  const f: Facts = { comments: new Set(), strings: new Set(), names: new Set(), types: new Set() };
  for (const c of ast.comments ?? []) for (const l of String(c.value).split("\n")) if (l.replace(/^\s*\*?/, "").trim()) f.comments.add(squeeze(l.replace(/^\s*\*?/, "")));
  const walk = (n: any, parent?: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, parent));
    if (typeof n.type !== "string") return;
    if (n.type === "StringLiteral" && parent?.type !== "ImportDeclaration" && n.value.trim()) f.strings.add(n.value);
    if (n.type === "TemplateElement" && n.value.cooked.trim()) f.strings.add(n.value.cooked);
    if (n.type === "JSXText" && n.value.trim()) f.strings.add(squeeze(n.value));
    const declared = (id: any) => {
      if (!id) return;
      if (id.type === "Identifier" && !SOLID_API.test(id.name)) f.names.add(id.name);
      if (id.type === "ArrayPattern") id.elements.forEach(declared);
      if (id.type === "ObjectPattern") id.properties.forEach((p: any) => declared(p.value ?? p.argument));
      if (id.type === "AssignmentPattern") declared(id.left);
      if (id.type === "RestElement") declared(id.argument);
    };
    if (n.type === "TSTypeAliasDeclaration") f.types.add(`type ${n.id.name}`);
    if (n.type === "TSTypeAnnotation" || n.type === "TSTypeParameterInstantiation") f.types.add(squeeze(code.slice(n.start, n.end).replace(/^:|^<|>$/g, "")));
    if (n.type === "VariableDeclarator") declared(n.id);
    if (n.type === "FunctionDeclaration") declared(n.id);
    if (/Function/.test(n.type)) n.params?.forEach(declared);
    for (const k of Object.keys(n)) if (!["loc", "start", "end", "comments", "leadingComments", "trailingComments", "innerComments", "extra", "range"].includes(k)) walk(n[k], n);
  };
  walk(ast.program);
  return f;
}
// .rx has no JS parser here: comments, quoted strings, and declared names by pattern
function rxFacts(code: string): Facts {
  const f: Facts = { comments: new Set(), strings: new Set(), names: new Set(), types: new Set() };
  for (const m of code.matchAll(/^\s*type (\w+)/gm)) f.types.add(`type ${m[1]}`);
  for (const m of code.matchAll(/\bsource \w+: ([^=\n]+?) :?=/g)) f.types.add(squeeze(m[1]));
  for (const m of code.matchAll(/(?:^|[^:])\/\/(.*)$/gm)) if (m[1].trim()) f.comments.add(squeeze(m[1]));
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) if ((m[1] ?? m[2]).trim()) f.strings.add(m[1] ?? m[2]);
  for (const m of code.replace(/(^|[^:])\/\/.*$/gm, "$1").matchAll(/\b(?:source|const|let|component|action|fn|guess)\s+([A-Za-z_$][\w$]*)/g)) f.names.add(m[1]);
  return f;
}
const missing = (want: Facts, haystack: string) => {
  const h = squeeze(haystack);
  const word = (n: string) => new RegExp(`(^|[^\\w$])${n.replace(/\$/g, "\\$")}([^\\w$]|$)`).test(haystack);
  return {
    comments: [...want.comments].filter((c) => !h.includes(c)),
    strings: [...want.strings].filter((s) => !h.includes(squeeze(s)) && !haystack.includes(JSON.stringify(s).slice(1, -1))),
    names: [...want.names].filter((n) => !word(n)),
    types: [...want.types].filter((t) => !h.includes(t)),
  };
};
// the compiled view is untyped JavaScript with no comments, so a trip through it drops both by design
const BY_DESIGN = new Set(["comments", "types"]);
const report = (m: ReturnType<typeof missing>, only?: "real" | "design") =>
  Object.entries(m)
    .filter(([k, v]) => v.length && (only === undefined || BY_DESIGN.has(k) === (only === "design")))
    .map(([k, v]) => `    lost ${k}: ${v.map((x) => JSON.stringify(x)).join(", ")}`)
    .join("\n");

let failed = 0;
const line = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed++;
  if (detail) console.log(detail);
};

console.log("# .rx first: rx → Solid → rx'");
const rxCases = [...presets.map((p) => [p.id, p.files] as const), ...Object.entries(extra).map(([k, v]) => [k, { "main.rx": v }] as const)];
for (const [id, files] of rxCases) {
  const fs = Object.fromEntries(Object.entries(files).map(([k, v]) => ["/" + k, v]));
  const rx0 = fs["/main.rx"];
  const solid = await view(fs);
  const rx1 = back(solid);
  const lost = missing(rxFacts(rx0), rx1.code + Object.values(rx1.files).join("\n"));
  const textSame = squeeze(rx1.code) === squeeze(rx0);
  const r = report(lost, "real");
  const design = report(lost, "design");
  line(!rx1.problems.length && !r, `${id}${textSame ? " (same text)" : ""}`, [
    rx1.problems.map((p) => `    problem line ${p.line}: ${p.message}`).join("\n"),
    r,
    design && `  through the view, by design\n${design}`,
    !textSame && verbose ? `--- rx\n${rx0}--- rx'\n${rx1.code}` : "",
  ].filter(Boolean).join("\n"));
}

console.log("\n# Solid first: tsx → rx → Solid → rx'' → Solid'");
const unscoped = async (code: string) =>
  fmt(code.replace(/class=\{\[([^\n]*), "tsrx-[0-9a-f]+"\]\}/g, "class={$1}").replace(/ ?tsrx-[0-9a-f]+/g, "").replace(/\s+class=""/g, ""));
const order = (code: string) => [...code.matchAll(/^\s*(?:export default )?(?:source|component|action|guess|type)?\s*([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?(?::=|=|\(|\{)/gm)].map((m) => m[1]);
// a module named ./api lowers to __rt.api test flights, which the view cannot be read back from
const unApi = (s: (typeof samples)[string]) => ({ ...s, solid: s.solid.replaceAll('"./api"', '"./server"'), files: s.files && Object.fromEntries(Object.entries(s.files).map(([k, v]) => [k.replace(/^\/api\./, "/server."), v])) });
for (const [id, s0] of Object.entries(samples)) {
  const s = unApi(s0);
  if (s.problems) {
    console.log(`skip ${id}: torx refuses it on purpose (${s.problems} problems)`);
    continue;
  }
  if (s.diagnostics) {
    console.log(`skip ${id}: the .rx is meant to fail the checker (${s.diagnostics.join(", ")}), so it has no view`);
    continue;
  }
  const rx1 = back(s.solid);
  const helpers = Object.fromEntries(Object.entries(rx1.files).map(([k, v]) => ["/" + k, v]));
  const fs = { ...(s.files ?? {}), ...helpers, "/main.rx": rx1.code };
  const all = (r: { code: string; files: Record<string, string> }) => r.code + Object.values(r.files).join("\n");
  const notes: string[] = [];
  let ok = false;
  try {
    const solid1 = await view(fs);
    const rx2 = back(solid1);
    const solid2 = await view({ ...fs, ...Object.fromEntries(Object.entries(rx2.files).map(([k, v]) => ["/" + k, v])), "/main.rx": rx2.code });
    ok = !rx2.problems.length && (await unscoped(solid1)) === (await unscoped(solid2));
    if (!ok) notes.push(`    views differ after a second trip` + rx2.problems.map((p) => `\n    problem line ${p.line}: ${p.message}`).join(""));
    // tsx → rx goes through no view, so it must keep comments, strings and types; a draft's or an effect's
    // parameter names give way to store paths and $0 by design
    const lostRx = missing(solidFacts(s.solid), all(rx1));
    if (lostRx.comments.length || lostRx.strings.length || lostRx.types.length) ok = false;
    const a = report(lostRx);
    const b = report(missing(rxFacts(rx1.code), all(rx2)));
    if (a) notes.push("  tsx → rx\n" + a);
    if (b) notes.push("  rx → Solid → rx''\n" + b);
    const o1 = order(rx1.code).join(" "), o2 = order(rx2.code).join(" ");
    if (o1 !== o2) notes.push(`  rx → Solid → rx'' reorders declarations\n    ${o1}\n    ${o2}`);
    if (verbose) notes.push(`--- tsx\n${s.solid}--- rx\n${rx1.code}--- rx''\n${rx2.code}`);
  } catch (e) {
    notes.push(`    the .rx does not compile: ${(e as Error).message.slice(0, 300)}`);
  }
  console.log(`${ok ? "ok  " : "FAIL"} ${id}`);
  if (!ok) failed++;
  if (notes.length) console.log(notes.join("\n"));
}
process.exit(failed ? 1 : 0);
