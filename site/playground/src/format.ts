import { solidify } from "./solidify";
import { toRx, type RxProblem } from "./torx";

let loaded: Promise<(code: string) => Promise<string>> | undefined;

const WIDTH = 110;
const width = (s: string) => s.replace(/\t/g, "  ").length;

/** Puts the short calls Prettier splits one argument per line back on one line. */
function rejoin(code: string) {
  const lines = code.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i];
    if (open.endsWith("(")) {
      const indent = /^\t*/.exec(open)![0];
      let j = i + 1;
      while (j < lines.length && j - i <= 6 && !/^\t*\)/.test(lines[j]) && !/[<>{]\s*$/.test(lines[j]) && !lines[j].includes("//")) j++;
      const close = lines[j];
      if (close !== undefined && close.startsWith(indent + ")") && j - i <= 6) {
        const args = lines.slice(i + 1, j).map((l) => l.trim()).join(" ").replace(/,$/, "");
        const joined = open + args + close.slice(indent.length);
        if (width(joined) <= WIDTH) {
          out.push(joined);
          i = j;
          continue;
        }
      }
    }
    out.push(open);
  }
  return out.join("\n");
}

/** Prettier, loaded the first time the JSX view is shown. */
export function formatter() {
  return (loaded ??= Promise.all([import("prettier/standalone"), import("prettier/plugins/babel"), import("prettier/plugins/estree")]).then(
    ([prettier, babel, estree]) =>
      async (code: string) =>
        rejoin(await prettier.format(code, { parser: "babel", plugins: [babel, estree as any], printWidth: 100, useTabs: true })),
    (e) => {
      loaded = undefined;
      throw e;
    },
  ));
}

/** The crate's JSX read as Solid primitives (`solidify`), formatted. */
export async function formatSolid(raw: string): Promise<{ code: string; error?: string }> {
  const format = await formatter();
  let runtime = raw;
  try {
    runtime = await format(raw);
    return { code: await format(solidify(runtime)) };
  } catch (e) {
    return { code: runtime, error: String((e as Error)?.message ?? e).split("\n")[0] };
  }
}

/** Solid 2.0 written back as .rx (`toRx`), over the Babel parser Prettier carries. */
export async function solidToRx(code: string, views: Record<string, string> = {}): Promise<{ code: string; problems: RxProblem[]; files: Record<string, string> }> {
  const babel = await import("prettier/plugins/babel");
  const parse = (src: string) => (babel as any).parsers["babel-ts"].parse(src, {});
  let ast;
  try {
    ast = parse(code);
  } catch (e: any) {
    return { code: "", problems: [{ line: e?.loc?.start?.line ?? e?.loc?.line ?? 0, message: String(e?.message ?? e).split("\n")[0] }], files: {} };
  }
  // the program's other modules, by the path an import names them, so a source read from one reads as itself
  const parsed = new Map<string, unknown>();
  const modules = (from: string) => {
    const view = views[from.replace(/^\.\//, "")];
    if (view === undefined) return;
    if (!parsed.has(from)) {
      try {
        parsed.set(from, parse(view));
      } catch {
        parsed.set(from, undefined);
      }
    }
    return parsed.get(from) as any;
  };
  return toRx(ast, code, { modules });
}
