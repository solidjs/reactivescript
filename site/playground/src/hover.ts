// The type under the pointer, and what can be written at the caret: an .rx offset, through the projection's mappings,
// to TypeScript in a worker.
import { projection } from "./compile";
import type { Entry, TypeAnswer, TypeRequest } from "./types.worker";

export type { Entry };

export type Hover = { text: string; doc: string; start: number; length: number };

let worker: Worker | undefined;
let seq = 0;
const waiting = new Map<number, (a: TypeAnswer) => void>();

function ask(request: Omit<TypeRequest, "id">): Promise<TypeAnswer> {
  if (!worker) {
    worker = new Worker(new URL("./types.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<TypeAnswer>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    worker.onerror = () => {
      for (const done of waiting.values()) done({ id: -1, error: "the type checker did not load" });
      waiting.clear();
      worker = undefined;
    };
  }
  const id = ++seq;
  return new Promise((done) => {
    waiting.set(id, done);
    worker!.postMessage({ id, ...request } satisfies TypeRequest);
  });
}

/** A `.d.rx`'s functions as TypeScript sees them: their parameters, and the return type when one is written. */
const declarations = (rx: string) =>
  [...rx.matchAll(/^export\s+(?:pure\s+)?fn\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^\n]*?))?\s*(?:rejects\([^)]*\))?\s*$/gm)]
    .map(([, name, params, type]) => `export declare function ${name}(${params.replace(/\bref\s+/g, "")}): ${type?.trim() || "any"};`)
    .join("\n") + "\nexport {};\n";

type Projected = { of: Record<string, string>; files: Record<string, string>; maps: Record<string, [number, number, number][]> };
let last: Projected | undefined;

/** What TypeScript reads for these files: each module's projection, the prelude, declarations, and plain modules as they are. */
function project(files: Record<string, string>): Projected {
  if (last?.of === files) return last;
  const p = projection(files);
  const out: Record<string, string> = { "/prelude.ts": p.prelude };
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".d.rx")) out[`/${name.slice(0, -5)}.d.ts`] = declarations(text);
    else if (name.endsWith(".rx")) out[`/${name.slice(0, -3)}.tsx`] = p.code["/" + name] ?? "export {};\n";
    else out["/" + name] = text;
  }
  return (last = { of: files, files: out, maps: p.mappings });
}

/** `const x: number` is how the projection declares it; the .rx says what it is. */
function inRx(text: string, name: string, rx: string) {
  // an import reads as what it names; the `import x` line under it says nothing more
  text = text.replace(/^\(alias\) /, "").replace(/\nimport [\w$]+$/, "");
  const m = /^(const|let|var) /.exec(text);
  if (!m) return text;
  const id = name.replace(/[$]/g, "\\$&");
  return (new RegExp(`\\bsource\\s+${id}\\b`).test(rx) ? "source " : "") + text.slice(m[0].length);
}

export async function typeAt(files: Record<string, string>, name: string, offset: number): Promise<Hover | undefined> {
  if (!name.endsWith(".rx") || name.endsWith(".d.rx")) return;
  const p = project(files);
  // the name the offset is in: the projection copies its text, so the same place inside it is the same place
  const hit = (p.maps["/" + name] ?? []).filter(([, s, n]) => s <= offset && offset <= s + n).sort((a, b) => a[2] - b[2])[0];
  if (!hit) return;
  const [g, s, n] = hit;
  const a = await ask({ files: p.files, file: `/${name.slice(0, -3)}.tsx`, offset: g + Math.min(offset - s, n - 1) });
  // an import nothing declares has no type to show
  if (!a.text || /^import [\w$]+$/.test(a.text)) return;
  const rx = files[name];
  return { text: inRx(a.text, rx.slice(s, s + n), rx), doc: a.doc ?? "", start: s, length: n };
}

// what every .rx module has without importing it (spec/11 CP-4b, `B`)
const BUILTINS = "log str len map filter sum every indexOf onFlush onSettled until".split(" ");
// the forms a name can start: offered beside the names in scope, never after a dot
const KEYWORDS = "source component action server effect fn await latest peek pre guess refresh affects draft import export let return try catch if else for loading errored fallback".split(" ");

/** Of what TypeScript offers, what continues the word being typed. */
function fitting(items: Entry[], prefix: string, from: number): { from: number; items: Entry[] } {
  const lower = prefix.toLowerCase();
  const fits = items.filter((x, i) => x.name.toLowerCase().startsWith(lower) && items.findIndex((y) => y.name === x.name) === i);
  // nothing left to write when the one thing that fits is already there
  if (fits.length === 1 && fits[0].name === prefix) return { from, items: [] };
  return { from, items: fits.sort((a, b) => Number(b.name.startsWith(prefix)) - Number(a.name.startsWith(prefix)) || (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 40) };
}

/** `text` with `name` imported from `from`: added to that module's import, or as a new one. `shift`: how far what follows moved. */
export function withImport(text: string, name: string, from: string): { text: string; at: number; shift: number } {
  const m = new RegExp(`import\\s*(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${from.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`).exec(text);
  if (!m) {
    const line = `import { ${name} } from "${from}";\n`;
    return { text: line + text, at: 0, shift: line.length };
  }
  const list = m[1];
  if (list.split(",").some((x) => x.trim().split(/\s+as\s+/).pop() === name)) return { text, at: 0, shift: 0 };
  const kept = list.replace(/\s+$/, "");
  const comma = kept.endsWith(",");
  const add = !kept.trim() ? ` ${name}` : list.includes("\n") ? `${comma ? "" : ","}\n  ${name}${comma ? "," : ""}` : `${comma ? " " : ", "}${name}`;
  const at = m.index + m[0].indexOf("{") + 1 + kept.length;
  return { text: text.slice(0, at) + add + text.slice(at), at, shift: add.length };
}

/** The names that fit at `offset`: `from` is where the word being typed starts, so that much is replaced. */
export async function completeAt(files: Record<string, string>, name: string, offset: number): Promise<{ from: number; items: Entry[] }> {
  const rx = files[name] ?? "";
  const prefix = /[\w$]*$/.exec(rx.slice(0, offset))![0];
  const from = offset - prefix.length;
  if (!name.endsWith(".rx") || name.endsWith(".d.rx")) return { from, items: [] };
  const p = project(files);
  const hit = (p.maps["/" + name] ?? []).filter(([, s, n]) => s <= offset && offset <= s + n).sort((a, b) => a[2] - b[2])[0];
  let items: Entry[] = [];
  if (hit) items = (await ask({ files: p.files, file: `/${name.slice(0, -3)}.tsx`, offset: hit[0] + (offset - hit[1]), complete: true })).entries ?? [];
  if (rx[from - 1] !== "." && prefix) items = [...items, ...BUILTINS.map((k) => ({ name: k, kind: "built-in" })), ...KEYWORDS.map((k) => ({ name: k, kind: "keyword" }))];
  return fitting(items, prefix, from);
}

// ---- Solid's own source, in the Solid → .rx pane: TypeScript reads it as it is

const SOLID_FILE = "/App.tsx";
/** The Solid source with what it can import: the other files' declarations, and plain modules as they are. */
function beside(source: string, files: Record<string, string>) {
  const out: Record<string, string> = { [SOLID_FILE]: source };
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith(".d.rx")) out[`/${name.slice(0, -5)}.d.ts`] = declarations(text);
    else if (!name.endsWith(".rx")) out["/" + name] = text;
  }
  return out;
}

export async function typeAtSolid(source: string, files: Record<string, string>, offset: number): Promise<Hover | undefined> {
  const start = offset - /[\w$]*$/.exec(source.slice(0, offset))![0].length;
  const length = /^[\w$]*/.exec(source.slice(start))![0].length;
  if (!length) return;
  const a = await ask({ files: beside(source, files), file: SOLID_FILE, offset });
  if (!a.text) return;
  return { text: a.text.replace(/^\(alias\) /, ""), doc: a.doc ?? "", start, length };
}

export async function completeAtSolid(source: string, files: Record<string, string>, offset: number): Promise<{ from: number; items: Entry[] }> {
  const prefix = /[\w$]*$/.exec(source.slice(0, offset))![0];
  const from = offset - prefix.length;
  // after a dot, or once a word is started: every name in scope is too many to offer for nothing typed
  if (source[from - 1] !== "." && !prefix) return { from, items: [] };
  const a = await ask({ files: beside(source, files), file: SOLID_FILE, offset, complete: true, ambient: true });
  const items = a.entries ?? [];
  // where a name can stand, every Solid export fits, imported or not: picking one adds the import
  const more = a.member || !prefix ? [] : (a.solid ?? []).filter((n) => !items.some((x) => x.name === n && x.rank === 0)).sort().map((n) => ({ name: n, kind: "solid-js", rank: 1, importFrom: "solid-js" }));
  return fitting([...items.filter((x) => !more.some((y) => y.name === x.name)), ...more], prefix, from);
}
