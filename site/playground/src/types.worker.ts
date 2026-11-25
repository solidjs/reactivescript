// TypeScript's language service over the crate's TSX projection of each .rx (spec/13 TY-1c): what the editor
// extension asks through Volar, here for two questions: the type under the pointer, and what can be written at the
// caret. Loaded on the first of either.
import ts from "typescript";

const libs = import.meta.glob<string>(
  ["/node_modules/typescript/lib/lib.es5.d.ts", "/node_modules/typescript/lib/lib.es20{15,16,17,18,19,20,21,22}*.d.ts", "/node_modules/typescript/lib/lib.dom*.d.ts", "/node_modules/typescript/lib/lib.decorators*.d.ts"],
  { query: "?raw", import: "default", eager: true },
);
// the types a projection reaches: Solid's JSX, and what that imports
const packages = import.meta.glob<string>(
  [
    "/node_modules/@solidjs/web/package.json",
    "/node_modules/@solidjs/web/types/**/*.d.ts",
    "/node_modules/solid-js/package.json",
    "/node_modules/solid-js/types/**/*.d.ts",
    "/node_modules/@solidjs/signals/package.json",
    "/node_modules/@solidjs/signals/dist/types/**/*.d.ts",
    "/node_modules/csstype/package.json",
    "/node_modules/csstype/index.d.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

const fixed = new Map<string, string>();
for (const [path, text] of Object.entries(libs)) fixed.set("/lib/" + path.slice(path.lastIndexOf("/") + 1), text);
for (const [path, text] of Object.entries(packages)) fixed.set(path, text);
const dirs = new Set<string>(["/"]);
for (const f of fixed.keys()) for (let d = f.slice(0, f.lastIndexOf("/")); d; d = d.slice(0, d.lastIndexOf("/"))) dirs.add(d);

let files: Record<string, string> = {};
const versions = new Map<string, number>();
const read = (f: string) => files[f] ?? fixed.get(f);

const options: ts.CompilerOptions = {
  jsx: ts.JsxEmit.Preserve,
  jsxImportSource: "@solidjs/web",
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  allowJs: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

const SOLID = "/node_modules/solid-js/types/index.d.ts";
let exported: string[] | undefined;
/** Every value solid-js exports: what a Solid file can be offered before it has imported it. */
function solidExports(): string[] {
  if (exported) return exported;
  const program = service.getProgram();
  const file = program?.getSourceFile(SOLID);
  const checker = program?.getTypeChecker();
  const module = file && checker?.getSymbolAtLocation(file);
  if (!module || !checker) return [];
  const value = (s: ts.Symbol) => ((s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s).flags & ts.SymbolFlags.Value) !== 0;
  return (exported = checker.getExportsOfModule(module).filter(value).map((s) => s.name).filter((n) => /^[A-Za-z]/.test(n)));
}

const service = ts.createLanguageService({
  getScriptFileNames: () => [...Object.keys(files).filter((f) => /\.(tsx?|m?js)$/.test(f)), SOLID],
  getScriptVersion: (f) => String(versions.get(f) ?? 0),
  getScriptSnapshot: (f) => {
    const text = read(f);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => "/",
  getCompilationSettings: () => options,
  getDefaultLibFileName: () => "/lib/lib.d.ts",
  fileExists: (f) => read(f) !== undefined,
  readFile: read,
  directoryExists: (d) => dirs.has(d.replace(/\/$/, "") || "/"),
  getDirectories: (d) => [...dirs].filter((x) => x !== d && x.slice(0, x.lastIndexOf("/")) === d.replace(/\/$/, "")).map((x) => x.slice(x.lastIndexOf("/") + 1)),
  useCaseSensitiveFileNames: () => true,
});

export type TypeRequest = { id: number; files: Record<string, string>; file: string; offset: number; complete?: boolean; ambient?: boolean };
/** `rank`: 0 what the module declares or imports, 1 what Solid exports and the pick would import, 2 what every module has. */
export type Entry = { name: string; kind: string; rank?: number; importFrom?: string };
export type TypeAnswer = { id: number; text?: string; doc?: string; entries?: Entry[]; member?: boolean; solid?: string[]; error?: string };

const post = (a: TypeAnswer) => (self as unknown as Worker).postMessage(a);

self.onmessage = (e: MessageEvent<TypeRequest>) => {
  const { id, file, offset } = e.data;
  for (const [f, text] of Object.entries(e.data.files)) if (files[f] !== text) versions.set(f, (versions.get(f) ?? 0) + 1);
  files = e.data.files;
  try {
    if (e.data.complete) {
      const c = service.getCompletionsAtPosition(file, offset, {});
      // .rx has no ambient names: of what is in scope, only what the module declares or imports ("15" up is globals).
      // TypeScript itself (`ambient`) has them all
      const entries = (c?.entries ?? []).filter((x) => !x.name.startsWith("__") && (e.data.ambient || (x.kind !== "keyword" && (c!.isMemberCompletion || x.sortText < "15"))));
      return post({
        id,
        entries: entries.sort((a, b) => a.sortText.localeCompare(b.sortText) || a.name.localeCompare(b.name)).map((x) => ({ name: x.name, kind: x.kind, rank: x.sortText < "15" ? 0 : 2 })),
        member: !!c?.isMemberCompletion,
        solid: e.data.ambient ? solidExports() : undefined,
      });
    }
    const info = service.getQuickInfoAtPosition(file, offset);
    const tags = (info?.tags ?? []).map((t) => `@${t.name} ${ts.displayPartsToString(t.text)}`.trim());
    const answer: TypeAnswer = info ? { id, text: ts.displayPartsToString(info.displayParts), doc: [ts.displayPartsToString(info.documentation), ...tags].filter(Boolean).join("\n") } : { id };
    post(answer);
  } catch (err) {
    post({ id, error: String((err as Error)?.message ?? err) });
  }
};
