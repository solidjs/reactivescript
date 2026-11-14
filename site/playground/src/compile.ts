import { loadRxc, type Files } from "./rxc";

export type Target = "dom" | "ssr" | "universal";

export type Diagnostic = {
  file: string;
  line?: number;
  code: string;
  rule: string;
  message: string;
  range?: { start: { line: number; column: number }; end: { line: number; column: number } };
};

export type AppOut = {
  entry?: string;
  css?: string;
  modules?: Record<string, { code: string; map: unknown; jsx?: string }>;
  diagnostics?: Diagnostic[];
  error?: string;
};

export type Result = {
  diagnostics: Diagnostic[];
  app: AppOut;
  ms: number;
};

export const ENTRY = "/main.rx";

// kept across hot updates, so an edited module does not drop the loaded compiler
let call: ReturnType<typeof loadRxc> | undefined = import.meta.hot?.data.call;

async function fetchModule(): Promise<WebAssembly.Module> {
  const res = await fetch(`${import.meta.env.BASE_URL}rxc.wasm`);
  if (!res.ok || res.headers.get("content-type")?.includes("text/html")) throw new Error("rxc.wasm is missing: run `pnpm wasm` to build it");
  return res.headers.get("content-type")?.includes("application/wasm") ? WebAssembly.compileStreaming(res) : WebAssembly.compile(await res.arrayBuffer());
}

export async function init() {
  let module: WebAssembly.Module | undefined;
  for (let attempt = 1; !module; attempt++) {
    try {
      module = await fetchModule();
    } catch (e) {
      // a download cut off midway (NotReadableError, a network error) is worth another try; a missing file is not
      if (attempt >= 3 || String(e).includes("pnpm wasm")) throw e;
    }
  }
  call = loadRxc(module);
  if (import.meta.hot) import.meta.hot.data.call = call;
}

/** The editor's files keyed by absolute path, as the crate reads them. */
export const toFs = (files: Record<string, string>): Files =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => ["/" + k.replace(/^\/+/, ""), v]));

const normalize = (d: any): Diagnostic => ({ ...d, message: d.message ?? d.msg ?? "" });

export function compile(files: Record<string, string>, target: Target): Result {
  if (!call) return { diagnostics: [], app: { error: "the compiler is not loaded: reload the page" }, ms: 0 };
  const t0 = performance.now();
  const fs = toFs(files);
  const diagnostics: Diagnostic[] = [];
  for (const file of Object.keys(fs).filter((f) => f.endsWith(".rx") && !f.endsWith(".d.rx"))) {
    try {
      const a = call("analyze", { file, prelude: "./prelude", project: false }, fs);
      diagnostics.push(...(a.diagnostics ?? []).map(normalize));
    } catch (e) {
      diagnostics.push({ file, code: "PANIC", rule: "—", message: `the compiler trapped: ${(e as Error).message}` });
    }
  }
  let app: AppOut;
  try {
    app = fs[ENTRY] === undefined ? { error: "no main.rx: the program starts at main.rx" } : call("app", { entry: ENTRY, target, jsx: true }, fs);
  } catch (e) {
    app = { error: `the compiler trapped: ${(e as Error).message}` };
  }
  if (app.diagnostics) app.diagnostics = app.diagnostics.map(normalize);
  // analyze reports per file; app's checker run can name a file analyze did not (a .d.rx, say)
  for (const d of app.diagnostics ?? [])
    if (!diagnostics.some((x) => x.file === d.file && x.code === d.code && x.line === d.line)) diagnostics.push(d);
  return { diagnostics, app, ms: performance.now() - t0 };
}
