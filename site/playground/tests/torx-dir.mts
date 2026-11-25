// A directory of Solid .tsx modules written back as .rx: App.tsx is main.rx, the rest keep their names.
// node tests/torx-dir.mts <solid dir> <out dir>   (prints what torx could not read; exit 1 if anything)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { declaredIn, toRx } from "../src/torx.ts";
import { existsSync } from "node:fs";
import * as babel from "prettier/plugins/babel";

const [from, to, drxDir = from] = process.argv.slice(2);
// each ./x import is checked against x.d.rx, when there is one
const declared = (mod: string, name: string) => {
  const f = join(drxDir, mod.replace(/^\.\//, "") + ".d.rx");
  return existsSync(f) ? declaredIn(readFileSync(f, "utf8")).get(name) : undefined;
};
mkdirSync(to, { recursive: true });
const tsx = readdirSync(from).filter((n) => /\.tsx?$/.test(n));
const stem = (n: string) => n.replace(/\.tsx?$/, "");
const rxName = (n: string) => (stem(n) === "App" ? "main.rx" : `${stem(n)}.rx`);
const local = new Map(tsx.map((n) => [stem(n), rxName(n)]));
let problems = 0;
const helpers: Record<string, string> = {};
for (const n of tsx) {
  const src = readFileSync(join(from, n), "utf8");
  const r = toRx((babel as any).parsers["babel-ts"].parse(src, {}), src, { declared });
  for (const p of r.problems) console.log(`${n}:${p.line}: ${p.message}`);
  problems += r.problems.length;
  // a sibling module is imported by its .rx file name
  const code = r.code.replace(/from "\.\/([\w$-]+)"/g, (all, m) => (local.has(m) ? `from "./${local.get(m)}"` : all));
  writeFileSync(join(to, rxName(n)), code);
    // each module's helpers, once: modules repeat the same small functions
  for (const [k, v] of Object.entries(r.files)) for (const part of v.split(/\n(?=export |\/\/ |type )/)) if (!(helpers[k] ?? "").includes(part.trim())) helpers[k] = (helpers[k] ? helpers[k].trimEnd() + "\n" : "") + part.trim() + "\n";
}
for (const [k, v] of Object.entries(helpers)) writeFileSync(join(to, k), v);
console.log(`${tsx.length} modules, ${problems} problems`);
process.exit(problems ? 1 : 0);
