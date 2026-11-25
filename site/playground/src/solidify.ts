// The crate's `__rt` JSX read as Solid 2.0 primitives (spec/11 CP-4b); a reading aid, not what runs.

/** The index just past the bracket that closes the one at `open`, skipping strings, templates and comments. */
function close(code: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === "\\") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      i = code.indexOf("\n", i);
      if (i < 0) return code.length;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "]" || c === "}") {
      stack.pop();
      if (!stack.length) return i + 1;
    }
  }
  return code.length;
}

/** Top-level arguments of the call whose `(` is at `open`. */
function args(code: string, open: number): { list: string[]; end: number } {
  const end = close(code, open);
  const inner = code.slice(open + 1, end - 1);
  const list: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < inner.length && inner[i] !== c; i++) if (inner[i] === "\\") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      list.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (inner.slice(start).trim()) list.push(inner.slice(start).trim());
  return { list, end };
}

/** Applies `f` to the code between strings, templates and comments, leaving their contents as written. */
function inCode(code: string, f: (part: string) => string): string {
  let out = "";
  let from = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    let end = -1;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      for (; j < code.length && code[j] !== c; j++) if (code[j] === "\\") j++;
      end = j + 1;
    } else if (c === "/" && code[i + 1] === "/") {
      end = code.indexOf("\n", i);
      if (end < 0) end = code.length;
    }
    if (end < 0) continue;
    out += f(code.slice(from, i)) + code.slice(i, end);
    from = i = end;
    i--;
  }
  return out + f(code.slice(from));
}

/** Rewrites every `name(` call in `code` with `f(args, start, end)`; returning undefined keeps the call. */
function eachCall(code: string, name: string, f: (a: string[], start: number) => string | undefined): string {
  let out = "";
  let from = 0;
  for (let i = code.indexOf(name + "(", from); i >= 0; i = code.indexOf(name + "(", from)) {
    // a member call is not this one; a spread's `...` is not a member access
    if (/[\w$]/.test(code[i - 1] ?? "") || (code[i - 1] === "." && code.slice(i - 3, i) !== "...")) {
      out += code.slice(from, i + name.length);
      from = i + name.length;
      continue;
    }
    const open = i + name.length;
    const { list, end } = args(code, open);
    const r = f(list, i);
    out += code.slice(from, i) + (r ?? code.slice(i, end));
    from = end;
  }
  return out + code.slice(from);
}

/** The index just past the JSX element whose `<` is at `i`, or -1 if it is not one. */
function elementEnd(code: string, i: number): number {
  const open = /^<([A-Za-z][\w.$-]*)/.exec(code.slice(i));
  if (!open) return -1;
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === "{") {
      j = close(code, j) - 1;
      continue;
    }
    if (c !== "<") continue;
    const tag = /^<(\/?)([A-Za-z][\w.$-]*)?/.exec(code.slice(j))!;
    if (tag[1] === "/") {
      if (!tag[2] && code.slice(j, j + 3) === "</>") return -1;
      depth--;
      j = code.indexOf(">", j);
      if (depth === 0) return j + 1;
      continue;
    }
    if (!tag[2]) return -1;
    // the rest of the tag: attributes with their expressions, up to `>` or `/>`
    let k = j + tag[0].length;
    for (; k < code.length && code[k] !== ">"; k++) {
      if (code[k] === "{") k = close(code, k) - 1;
      else if (code[k] === '"' || code[k] === "'") k = code.indexOf(code[k], k + 1);
    }
    if (code[k - 1] === "/") {
      if (depth === 0) return k + 1;
    } else depth++;
    j = k;
  }
  return -1;
}
/** `open X close` → `X` where X is one JSX element and `keep(at)` allows it. */
function unwrapOne(code: string, open: string, closer: string, keep: (code: string, at: number) => boolean): string {
  for (let i = code.indexOf(open); i >= 0; i = code.indexOf(open, i + 1)) {
    const start = i + open.length + (/^\s*/.exec(code.slice(i + open.length))![0].length);
    if (code[start] !== "<" || code[start + 1] === ">" || code[start + 1] === "/") continue;
    const end = elementEnd(code, start);
    if (end < 0) continue;
    const rest = /^\s*/.exec(code.slice(end))![0].length;
    if (code.slice(end + rest, end + rest + closer.length) !== closer || !keep(code, i)) continue;
    code = code.slice(0, i) + code.slice(start, end) + code.slice(end + rest + closer.length);
  }
  return code;
}

/** `(X)` → `X` when the parentheses wrap all of it. */
const unparen = (x: string) => {
  x = x.trim();
  return x.startsWith("(") && close(x, 0) === x.length ? x.slice(1, -1).trim() : x;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unprev = (fn: string) => (/__prev/.test(fn.replace(/^\(__prev\)\s*=>/, "")) ? fn : fn.replace(/^\(__prev\)\s*=>/, "() =>"));
const unseed = (seed: string) => {
  const m = /^__rt\.untrack\(\(\) => ([\s\S]*)\)$/.exec(seed);
  if (!m) return seed;
  const value = unparen(m[1]);
  // createSignal(fn) would derive from fn, so a function-valued seed keeps its untrack
  return /^(\([^)]*\)\s*=>|\w+\s*=>|function|async)/.test(value) ? seed : value;
};

/** The index of the `;` (or closing `}`) that ends the statement running from `from`. */
function statementEnd(code: string, from: number): number {
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === "\\") i++;
    } else if ("([{".includes(c)) i = close(code, i) - 1;
    else if (c === ";" || c === "}") return i;
  }
  return code.length;
}
/** The `{` of the innermost block around `at`. */
function enclosing(code: string, at: number): number {
  for (let o = at - 1; o >= 0; o--) if (code[o] === "{" && close(code, o) > at) return o;
  return -1;
}
/** The last `return` directly in the block whose `{` is at `open`. */
function lastReturn(code: string, open: number): number {
  const end = close(code, open) - 1;
  let found = -1;
  for (let i = open + 1; i < end; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < end && code[i] !== c; i++) if (code[i] === "\\") i++;
    } else if ("([{".includes(c)) i = close(code, i) - 1;
    else if (/^return\b/.test(code.slice(i, i + 7)) && !/[\w$.]/.test(code[i - 1])) found = i;
  }
  return found;
}

/** `context c = d`, `use c` and `provide c = e` (07): Solid's createContext, useContext and the context as provider. */
function contexts(code: string, used: Set<string>): string {
  const names = new Set<string>();
  for (const m of code.matchAll(/__rt\.(?:context\("([\w$]+)"|useGet\(([\w$]+),|provide\(([\w$]+),)/g)) names.add((m[1] ?? m[2] ?? m[3]).replace(/^v\$/, ""));
  if (!names.size) return code;
  code = eachCall(code, "__rt.context", (a) => (used.add("createContext"), `createContext(${a[1] === "null" ? "" : a[1]})`));
  code = eachCall(code, "__rt.useGet", (a) => (used.add("useContext"), `useContext(${a[0]})()`));
  for (let i = code.indexOf("__rt.provide("); i >= 0; i = code.indexOf("__rt.provide(", i + 1)) {
    const { list, end } = args(code, i + "__rt.provide".length);
    // the entry's `w` is the source's writer, for the runtime's registry; a reader takes only the value
    const fields = (list[1] ?? "").startsWith("{") ? args(list[1], 0).list : [];
    const g = fields.map((f) => /^get:\s*([\s\S]*)$/.exec(f)).find(Boolean);
    const v = fields.map((f) => /^value:\s*([\s\S]*)$/.exec(f)).find(Boolean);
    // `{ get: memo }`: the memo's function is the accessor the context carries
    const memo = g && /^(__rt\.memo|createMemo)\(/.exec(g[1]);
    const inner = memo && close(g[1], memo[1].length) === g[1].length ? args(g[1], memo[1].length).list : undefined;
    const value = inner ? (memo![1] === "createMemo" ? inner[0] : unprev(inner[1] ?? "")) : g ? g[1] : v ? `() => ${v[1]}` : undefined;
    const open = enclosing(code, i);
    const ret = open < 0 ? -1 : lastReturn(code, open);
    if (value === undefined || ret < 0) continue;
    const from = code.lastIndexOf("\n", i) + 1;
    const to = code[end] === ";" ? end + 1 : end;
    const xEnd = statementEnd(code, ret + "return".length);
    const x = unparen(code.slice(ret + "return".length, xEnd));
    const wrapped = `return (\n<${list[0]} value={${value}}>\n${x.startsWith("<") ? x : `{${x}}`}\n</${list[0]}>\n)`;
    code = ret > i ? code.slice(0, from) + code.slice(to, ret) + wrapped + code.slice(xEnd) : code.slice(0, ret) + wrapped + code.slice(xEnd, from) + code.slice(to);
    i = from - 1;
  }
  // a context is its own provider component, so its name is capitalized
  for (const n of names) {
    const e = n.replace(/\$/g, "\\$");
    code = code.replace(new RegExp(`(__i\\d+\\[)"${e}"\\]`, "g"), `$1"${cap(n)}Context"]`);
    code = inCode(code, (part) => part.replace(new RegExp(`(?<![\\w$.])(?:v\\$)?${e}\\b(?!=\\{)`, "g"), `${cap(n)}Context`));
  }
  return code;
}

/** `error E(a) => m` (R-f-1) as a class, `throw E(a)` as `throw new E(a)`, and a typed catch or boundary by instanceof. */
function errorClasses(code: string): string {
  const names: string[] = [];
  for (let i = code.indexOf("function g$"); i >= 0; i = code.indexOf("function g$", i + 1)) {
    const m = /^function g\$([\w$]+)\(__rt\) \{/.exec(code.slice(i));
    if (!m) continue;
    const end = close(code, i + m[0].length - 1);
    const at = code.indexOf("__rt.errorClass(", i);
    if (at < 0 || at > end) continue;
    const a = args(code, at + "__rt.errorClass".length).list;
    const fn = /^\(([^)]*)\)\s*=>\s*([\s\S]*)$/.exec(a[2] ?? "");
    let fields: string[];
    try {
      fields = JSON.parse(a[1] ?? "[]");
    } catch {
      continue;
    }
    if (!fn) continue;
    const name = m[1];
    const ps = fn[1].split(",").map((s) => s.trim()).filter(Boolean);
    const cls = [`class ${name} extends Error {`, `constructor(${ps.join(", ")}) {`, `super(${unparen(fn[2])});`, `this.name = ${JSON.stringify(name)};`, ...fields.map((f, k) => `this.${f} = ${ps[k] ?? "undefined"};`), "}", "}"].join("\n");
    const lead = `let c$${name};\n`;
    const from = code.slice(i - lead.length, i) === lead ? i - lead.length : i;
    code = code.slice(0, from) + cls + code.slice(end);
    names.push(name);
    i = from;
  }
  for (const n of names) code = code.replace(new RegExp(`^[ \\t]*const (?:v\\$)?${n} = g\\$${n}\\(__rt\\);\\n`, "m"), "");
  // an error a JavaScript module declares (a .d.rx `error`) is its class, imported by name
  for (const m of code.matchAll(/^[ \t]*const (?:v\$)?([\w$]+) = __rt\.jsError\("[\w$]+"\);$/gm)) names.push(m[1]);
  for (const n of names) code = inCode(code, (part) => part.replace(new RegExp(`(?<![\\w$.])(?<!new )((?:v\\$)?${n.replace(/\$/g, "\\$")})\\(`, "g"), "new $1("));

  // `c ? throw e : x` (07): JavaScript has no throw expression, so a function that returns one is an if, then a return
  code = code.replace(/^([ \t]*)return ([^\n;]*?) \? __rt\.throw\(([^\n]*)\) : ([^\n;]*);$/gm, (all, ind, c, e, x) => (close(`(${e})`, 0) === e.length + 2 ? `${ind}if (${c}) throw ${e};\n${ind}return ${x};` : all));
  code = eachCall(code, "__rt.throw", (a) => `(() => {\nthrow ${a[0]};\n})()`);
  code = eachCall(code, "__rt.isA", (a) => {
    const cs = /^\[([\w$,\s]+)\]$/.exec(a[1] ?? "");
    return cs ? `(${cs[1].split(",").map((c) => c.trim()).filter(Boolean).map((c) => `${a[0]} instanceof ${c}`).join(" || ")})` : undefined;
  });
  // `await e -> v` (R-7): Solid's loadingValue. A question only the browser answers (SV-7b) is ssrSource "client"
  code = eachCall(code, "__rt.firstPaint", (a) => {
    const f = /^\(\)\s*=>\s*([\s\S]*)$/.exec(a[0] ?? "");
    return f && !f[1].trim().startsWith("{") ? `{ loadingValue: ${unparen(f[1])} }` : undefined;
  });
  code = eachCall(code, "__rt.clientQuestion", (a) => {
    const o = (a[0] ?? "").trim();
    if (!o || o === "undefined") return `{ ssrSource: "client" }`;
    return o.startsWith("{") && o.endsWith("}") ? `{ ${o.slice(1, -1).trim().replace(/,$/, "")}, ssrSource: "client" }` : undefined;
  });
  // `x catch (e: C) => alt` (R-f-4, 07): what it matches, as a test on the alternative's parameter
  const caught = (match: string, alt: string) => {
    const f = /^\(([\w$]+)\)\s*=>\s*([\s\S]*)$/.exec(alt.trim());
    const m = /^\(([\w$]+)\)\s*=>\s*([\s\S]*)$/.exec(match.trim());
    if (!f || !m) return;
    const p = f[1] === "__e" ? "e" : f[1];
    const any = /^__rt\.isA\([\w$]+, undefined\)$/.test(m[2].trim());
    if (!any && /__rt\./.test(m[2])) return;
    const test = any ? undefined : unparen(m[2].replace(new RegExp(`\\b${m[1].replace(/\$/g, "\\$")}\\b`, "g"), p));
    return { p, test, body: unparen(f[2].replace(/\b__e\b/g, p)) };
  };
  // on an awaited answer: the promise's own catch, which throws the other classes on
  code = eachCall(code, "__rt.settle", (a) => {
    const c = caught(a[1] ?? "", a[2] ?? "");
    if (!c) return undefined;
    const on = /^[\w$.]+(\([^()]*\))?$/.test(a[0]) ? a[0] : `(${a[0]})`;
    return c.test ? `${on}.catch((${c.p}) => {\nif (!(${c.test})) throw ${c.p};\nreturn ${c.body};\n})` : `${on}.catch((${c.p}) => ${c.body})`;
  });
  // on a read: a try that lets Solid's NotReadyError through, so a pending read stays pending
  const tried = (f: string, c: NonNullable<ReturnType<typeof caught>>) => {
    const r = /^\(\)\s*=>\s*([\s\S]*)$/.exec(f.trim());
    const read = r && !r[1].trim().startsWith("{") ? `return ${r[1]};` : `return (${f})();`;
    return `try {\n${read}\n} catch (${c.p}) {\nif (${c.p} instanceof NotReadyError${c.test ? ` || !(${c.test})` : ""}) throw ${c.p};\nreturn ${c.body};\n}`;
  };
  code = eachCall(code, "__rt.catchMemo", (a) => {
    const c = caught(a[1] ?? "", a[2] ?? "");
    return c ? `__rt.memo(null, () => {\n${tried(a[0], c)}\n})` : undefined;
  });
  for (const h of ["__rt.catchRead", "__rt.tryCatch"])
    code = eachCall(code, h, (a) => {
      const c = caught(a[1] ?? "", a[2] ?? "");
      return c ? `(() => {\n${tried(a[0], c)}\n})()` : undefined;
    });

  // a typed boundary (R-f-4) is an Errored whose fallback throws other classes on, to the boundary above it
  for (let i = code.indexOf("<__rt.TypedErrored"); i >= 0; i = code.indexOf("<__rt.TypedErrored", i + 1)) {
    let k = i + "<__rt.TypedErrored".length;
    for (; k < code.length && code[k] !== ">"; k++) if (code[k] === "{") k = close(code, k) - 1;
    const tag = code.slice(i, k);
    const attr = (n: string) => {
      const m = new RegExp(`\\s${n}=\\{`).exec(tag);
      const o = m ? i + m.index + m[0].length - 1 : -1;
      return o < 0 ? undefined : code.slice(o + 1, close(code, o) - 1).trim();
    };
    const cs = /^\[([\w$,\s]+)\]$/.exec(attr("classes") ?? "");
    const fb = /^\(([\w$]+)\)\s*=>\s*([\s\S]*)$/.exec(attr("fallback") ?? "");
    if (!cs || !fb) continue;
    const p = fb[1] === "__err" ? "err" : fb[1];
    const test = cs[1].split(",").map((c) => `${p}() instanceof ${c.trim()}`).join(" || ");
    code = code.slice(0, i) + `<Errored fallback={(${p}) => {\nif (!(${test})) throw ${p}();\nreturn ${fb[2].replace(/\b__err\b/g, p)};\n}}` + code.slice(k);
  }
  return code.replace(/<\/__rt\.TypedErrored>/g, "</Errored>");
}

export function solidify(code: string): string {
  const used = new Set<string>();
  const optimistic = new Set<string>();
  const stores = new Set<string>();
  // a source's setter is setX, unless the module already has that name (an action `setX`, say): then setXValue
  const taken = new Set([...code.matchAll(/\b(?:const|let|function|class) (?:[vw]\$)?([\w$]+)/g)].map((m) => m[1]));
  for (const m of code.matchAll(/^import \{([^}]*)\}/gm)) for (const x of m[1].split(",")) taken.add(x.trim().split(/\s+as\s+/).pop()!.replace(/^[vw]\$/, ""));
  const setter = (n: string) => (taken.has(`set${cap(n)}`) ? `set${cap(n)}Value` : `set${cap(n)}`);

  // import aliases: `import { f as w$f }` and `const v$f = w$f;` are one name
  code = code.replace(/(\w+) as w\$\1\b/g, "$1").replace(/^\s*const v\$(\w+) = w\$\1;\n/gm, "");
  // at the module's top level (a server fn's body) an import is still read by its alias
  const imported = [...code.matchAll(/^import \{([^}]*)\} from /gm)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!)).filter(Boolean);
  for (const n of imported) code = inCode(code, (part) => part.replace(new RegExp(`\\bw\\$${n}\\b`, "g"), n));
  // `server fn f(a) { … }` (12 SF-1): Solid's "use server" function. Its body arrives as a generator handed to the
  // runtime, each await a yield
  for (let i = code.indexOf("async function sf$"); i >= 0; i = code.indexOf("async function sf$", i + 1)) {
    const head = /^async function sf\$(\w+?)(\$\d+)?\(\.\.\.__a\) /.exec(code.slice(i));
    if (!head) continue;
    const open = i + head[0].length;
    const end = close(code, open);
    const call = code.indexOf("__rt.serverCall(", open);
    if (call < 0 || call > end) continue;
    const gen = args(code, call + "__rt.serverCall".length).list[1] ?? "";
    const p = gen.indexOf("(");
    const pe = p < 0 ? -1 : close(gen, p);
    const b = pe < 0 ? -1 : gen.indexOf("{", pe);
    if (!gen.startsWith("function*") || b < 0) continue;
    const body = inCode(gen.slice(b + 1, close(gen, b) - 1), (part) => part.replace(/\byield\b/g, "await"));
    code = code.slice(0, i) + `async function ${head[2] ? "" : head[1]}(${gen.slice(p + 1, pe - 1)}) {\n"use server";${body}}` + code.slice(end);
  }
  // the name a server fn is called by is the function itself
  code = code.replace(/^[ \t]*const v\$(\w+) = __rt\.serverRef\("\1", sf\$\1\);\n/gm, "").replace(/\bsf\$(\w+)\b/g, "$1");
  code = contexts(code, used);
  code = errorClasses(code);
  code = code.replace(/^[ \t]*__rt\.reg\([^;]*\);\n/gm, "").replace(/^[ \t]*__rt\.hoisted\([^;]*\);\n/gm, "");
  if ((code.match(/\b__o\b/g) ?? []).length === (code.match(/const __o = __rt\.owner\(\);/g) ?? []).length)
    code = code.replace(/^[ \t]*const __o = __rt\.owner\(\);\n/gm, "");

  code = eachCall(code, "__rt.source", (a) => {
    const seed = unseed(a[1] ?? "undefined");
    const prim = /^[[{]/.test(seed.trim()) ? "createStore" : "createSignal";
    if (prim === "createStore") stores.add(JSON.parse(a[0]));
    used.add(prim);
    return `${prim}(${seed})`;
  });
  code = eachCall(code, "__rt.question", (a, at) => {
    const [, fn, opts, mode = "", key] = a;
    const name = JSON.parse(a[0]);
    const flag = (f: string) => new RegExp(`\\b${f}: true`).test(mode);
    const o = opts && opts !== "undefined" ? `, ${opts}` : "";
    const f = unprev(fn);
    if (flag("optimistic") && flag("structured")) return stores.add(name), used.add("createOptimisticStore"), `createOptimisticStore(${f}, ${key ? "[]" : "{}"}${key ? `, { key: ${key} }` : ""})`;
    if (flag("optimistic") && flag("derived")) return used.add("createOptimistic"), `createOptimistic(${f}${o})`;
    if (flag("optimistic")) {
      // a truth signal, and the optimistic layer a guess writes over it
      optimistic.add(name);
      used.add("createSignal").add("createOptimistic");
      void at;
      return `createSignal(${f}${o})`;
    }
    if (flag("structured")) return stores.add(name), used.add("createStore"), `createStore(${f}, {})`;
    used.add("createSignal");
    return `createSignal(${f}${o})`;
  });
  // `const [v$x, w$x] = createSignal(fn)` with a guess: `const [x$truth, setX] = …; const [x, setOptimisticX] = createOptimistic(…)`
  for (const name of optimistic) {
    const decl = `const [v$${name}, w$${name}] = createSignal(`;
    const i = code.indexOf(decl);
    if (i < 0) continue;
    const end = close(code, i + decl.length - 1);
    const semi = code[end] === ";" ? end + 1 : end;
    const ind = /[ \t]*$/.exec(code.slice(0, i))![0];
    const call = code.slice(i + decl.length - "createSignal(".length, end);
    code = code.slice(0, i) + `const [${name}$truth, ${setter(name)}] = ${call};\n${ind}const [${name}, setOptimistic${cap(name)}] = createOptimistic(() => ${name}$truth());` + code.slice(semi);
  }

  // `x key k = e` (ST-4): the answer as a memo, and a projection over it that keeps each row by its key
  for (let i = code.indexOf("const v$"); i >= 0; i = code.indexOf("const v$", i + 1)) {
    const m = /^const v\$(\w+) = __rt\.keyed\(/.exec(code.slice(i));
    if (!m) continue;
    const { list, end } = args(code, i + m[0].length - 1);
    const semi = code[end] === ";" ? end + 1 : end;
    const ind = /[ \t]*$/.exec(code.slice(0, i))![0];
    const name = m[1];
    stores.add(name);
    used.add("createMemo").add("createProjection");
    code = code.slice(0, i) + `const ${name}$answer = createMemo(${list[2]});\n${ind}const v$${name} = createProjection(() => ${name}$answer(), [], { key: ${list[1]} });` + code.slice(semi);
  }
  // `x = draft(pre x -> seed) { … }` (ST-3): a projection whose function writes its draft
  for (let i = code.indexOf("const v$"); i >= 0; i = code.indexOf("const v$", i + 1)) {
    const m = /^const v\$(\w+) = __rt\.draft\(/.exec(code.slice(i));
    if (!m) continue;
    const { list, end } = args(code, i + m[0].length - 1);
    stores.add(m[1]);
    used.add("createProjection");
    code = code.slice(0, i) + `const v$${m[1]} = createProjection(${list[1]}, ${unseed(list[0])})` + code.slice(end);
  }
  // a draft write: `{ let __t = d; __t[k] = v; }` is `d[k] = v;`
  code = code.replace(/\{\s*let __t = ([\w$]+);\s*__t((?:\[[^\n]*?\]|\.\w+)+) = ([^;\n]+);\s*\}/g, "$1$2 = $3;");
  // Prettier breaks a long chain after `__rt`: join it back, so each helper is found by its name
  code = code.replace(/\b__rt\s+\./g, "__rt.");
  // a template part and `str` format alike
  code = code.replace(/\b__B\.str\(|\b__rt\.fmt\(/g, "String(");

  code = eachCall(code, "__rt.memo", (a) => {
    // `...rest` in a prop pattern: Solid's omit is already a live view of props, so the memo around it adds nothing
    const omitted = /^\(__prev\)\s*=>\s*__rt\.omit\(([\s\S]*)\)$/.exec(a[1]);
    if (omitted && close(a[1], a[1].indexOf("__rt.omit(") + 9) === a[1].length) {
      stores.add(JSON.parse(a[0]));
      used.add("omit");
      return `omit(${omitted[1]})`;
    }
    used.add("createMemo");
    return `createMemo(${unprev(a[1])}${a[2] && a[2] !== "undefined" ? `, ${a[2]}` : ""})`;
  });
  // `deferred x = e` (V-16): a memo that lags its inputs on purpose
  code = eachCall(code, "__rt.deferred", (a) => {
    used.add("createDeferred");
    return `createDeferred(${unprev(a[1])}${a[2] && a[2] !== "undefined" ? `, ${a[2]}` : ""})`;
  });
  code = code.replace(/!__rt\.eq\(/g, "__rt.neq(");
  code = eachCall(code, "__rt.neq", (a) => `((${a[0]}) !== (${a[1]}))`);
  code = eachCall(code, "__rt.eq", (a) => `((${a[0]}) === (${a[1]}))`);
  code = eachCall(code, "__rt.awaited", (a) => a[0]);
  code = eachCall(code, "__rt.show", (a) => a[0]);
  code = eachCall(code, "__rt.snapshot", (a) => (used.add("untrack"), `untrack(${a[0]})`));
  code = eachCall(code, "__rt.refresh", (a) => (used.add("refresh"), `refresh(${a[1]})`));
  code = eachCall(code, "__rt.scopedClass", (a) => `[${a[0]}, ${a[1]}]`);
  // `__rt.effect(n, () => [a(), b()], ($p) => untrack(() => { … $p[0] … }))` (EF-1): Solid's createEffect, whose
  // second function is not tracked and takes what the first returned, here named as the .rx names them
  code = eachCall(code, "__rt.effect", (a) => {
    const n = Number(a[0]);
    const apply = /^\(\$p\)\s*=>\s*(?:__rt\.)?untrack\(/.exec(a[2] ?? "");
    const list = a[1]?.indexOf("[") ?? -1;
    if (!apply || list < 0 || !Number.isInteger(n)) return undefined;
    const inner = args(a[2], apply[0].length - 1).list[0] ?? "";
    const body = /^\(\)\s*=>\s*([\s\S]*)$/.exec(inner);
    if (!body) return undefined;
    const inputs = args(a[1], list).list;
    const read = n === 0 ? "() => {}" : n === 1 ? `() => ${inputs[0]}` : `() => [${inputs.join(", ")}]`;
    const params = n === 0 ? "()" : n === 1 ? "($0)" : `([${inputs.map((_, i) => `$${i}`).join(", ")}])`;
    used.add("createEffect");
    return `createEffect(${read}, ${params} => ${body[1].replace(/\$p\[(\d+)\]/g, "$$$1")})`;
  });
  for (const h of ["untrack", "latest", "isPending", "affects", "onFlush", "onSettled", "until", "action"])
    code = code.replace(new RegExp(`__rt\\.${h}\\(`, "g"), () => (used.add(h), `${h}(`));

  // `(() => { return X; })()`: what was left of a region's function once its owner line went
  for (let i = code.indexOf("(() => {"); i >= 0; i = code.indexOf("(() => {", i + 1)) {
    const bodyOpen = i + "(() => ".length;
    const bodyEnd = close(code, bodyOpen);
    if (code.slice(bodyEnd, bodyEnd + 3) !== ")()") continue;
    const m = /^\{\s*return ([\s\S]*);\s*\}$/.exec(code.slice(bodyOpen, bodyEnd));
    if (m && !/^\s*\(?\s*$/.test(m[1])) code = code.slice(0, i) + unparen(m[1]) + code.slice(bodyEnd + 3);
  }

  // `=> { return X; }` is `=> X`: innermost first, so again until an outer one has no return left inside it
  for (let before = ""; before !== code; ) {
    before = code;
    for (let i = code.indexOf("=> {"); i >= 0; i = code.indexOf("=> {", i + 1)) {
      const bodyOpen = i + 3;
      const bodyEnd = close(code, bodyOpen);
      const m = /^\{\s*return ([\s\S]*);\s*\}$/.exec(code.slice(bodyOpen, bodyEnd));
      if (m && !/^\s*\(?\s*$/.test(m[1]) && !/\breturn\b/.test(m[1])) {
        const x = unparen(m[1]);
        code = code.slice(0, bodyOpen) + (x.startsWith("{") ? `(${x})` : x) + code.slice(bodyEnd);
      }
    }
  }
  // `{if x { … x … }}` narrows x: the branch's `n$x` is x again
  code = code.replace(/^[ \t]*const n\$([\w$]+) = __item;\n/gm, "");
  code = inCode(code, (part) => part.replace(/\bn\$([\w$]+)\b/g, "$1"));
  // a branch's unused item parameter: `{(__item) => X}` is `{X}`
  for (let i = code.indexOf("(__item) => "); i >= 0; i = code.indexOf("(__item) => ", i + 1)) {
    const body = i + "(__item) => ".length;
    const end = "([{".includes(code[body]) ? close(code, body) : code.indexOf("\n", body);
    // a block body stays a function: `{{ … }}` is not JSX
    // an inner branch's own `(__item) =>` is not a read of this one
    if (/\b__item\b(?!\) =>)/.test(code.slice(body, end < 0 ? undefined : end))) continue;
    code = code.slice(0, i) + (code[body] === "{" ? "() => " : "") + code.slice(body);
  }
  // an errored fallback that names no error is the fallback itself
  for (let i = code.indexOf("fallback={(__err) => "); i >= 0; i = code.indexOf("fallback={(__err) => ", i + 1)) {
    const body = i + "fallback={(__err) => ".length;
    const end = close(code, i + "fallback=".length) - 1;
    if (!/\b__err\b/.test(code.slice(body, end))) code = code.slice(0, i) + "fallback={" + code.slice(body);
  }

  // writers and names
  for (const name of optimistic) code = code.replace(new RegExp(`w\\$${name}\\.guess\\(`, "g"), `setOptimistic${cap(name)}(`);
  // a store's writer, as Solid's setter takes it: a function that changes its draft. A guess on an optimistic store is
  // that same setter
  const along = (name: string, keys: string, value: string) => {
    const target = "draft" + args(keys, 0).list.map((k) => (/^"[A-Za-z_$][\w$]*"$/.test(k) ? `.${k.slice(1, -1)}` : `[${k}]`)).join("");
    return `w$${name}.set((draft) => {\n${target} = ${/^(\([\w$]*\)|[\w$]+)\s*=>/.test(value) ? `(${value})(${target})` : value};\n})`;
  };
  for (const name of stores) {
    code = eachCall(code, `w$${name}.path`, (a) => (a.length === 2 && a[0].startsWith("[") ? along(name, a[0], a[1]) : undefined));
    code = eachCall(code, `w$${name}.guess`, (a) => {
      if (a.length === 2 && a[1].startsWith("[")) return along(name, a[1], a[0]);
      if (a.length !== 1) return undefined;
      return `w$${name}.set(${/^(\([\w$]*\)|[\w$]+)\s*=>/.test(a[0]) ? a[0] : `() => ${a[0].startsWith("{") ? `(${a[0]})` : a[0]}`})`;
    });
  }
  code = inCode(code, (part) =>
    part
      .replace(/\bw\$(\w+)\.set\(/g, (_, n) => `${setter(n)}(`)
      .replace(/\bw\$(\w+)\b/g, (_, n) => setter(n))
      .replace(/\ba\$(\w+)\$(\d+)\b/g, (_, n, k) => (k === "0" ? `${n}$await` : `${n}$await${k}`))
      .replace(/\bp\$(\w+)\b/g, (_, n) => `prev${cap(n)}`)
      .replace(/\b[vV]\$(\w+)\b/g, "$1"),
  );
  // a store, or omit's view of props, is read as itself, not called: within the block that declares it
  for (const n of stores) {
    const decl = new RegExp(`const (?:\\[${n}, \\w+\\]|${n}) = (?:create(?:Store|OptimisticStore|Projection)|omit)\\(`, "g");
    for (const m of [...code.matchAll(decl)].reverse()) {
      let open = (m.index ?? 0) - 1;
      while (open >= 0 && !(code[open] === "{" && close(code, open) > (m.index ?? 0))) open--;
      const end = open < 0 ? code.length : close(code, open);
      const from = open < 0 ? 0 : open;
      code = code.slice(0, from) + inCode(code.slice(from, end), (part) => part.replace(new RegExp(`(?<=^|[^\\w$.]|\\.\\.\\.)${n}\\(\\)`, "g"), n)) + code.slice(end);
    }
  }

  // JSX text: `type={"button"}` and `{"Clear"}` as plain text where nothing changes by it
  code = code.replace(/=\{("[^"\\{}]*")\}/g, "=$1").replace(/\{"([^"\\{}<>&\n]*[^"\\{}<>&\s])"\}/g, (all, t, at, str) => (/^\S/.test(t) ? t : all));
  // a fragment around one element, or braces around one element, says nothing
  for (let before = ""; before !== code; ) {
    before = code;
    code = unwrapOne(code, "<>", "</>", () => true);
    code = unwrapOne(code, "{", "}", (now, at) => /[>}]\s*$/.test(now.slice(0, at)));
  }

  // another module's names: `import __m0 from "./x.rx"` + `const __i0 = __rt.module(__m0, __m0); const A = __i0["B"];`
  for (const m of [...code.matchAll(/^import (__m\d+) from ("[^"]+");\n/gm)]) {
    const inst = new RegExp(`^[ \\t]*const (__i\\d+) = __rt\\.module\\(${m[1]}, ${m[1]}\\);\\n`, "m").exec(code);
    if (!inst) continue;
    const names: string[] = [];
    code = code.replace(new RegExp(`^[ \\t]*const ([\\w$]+) = ${inst[1]}\\["([\\w$]+)"\\];\\n`, "gm"), (_, local, name) => (names.push(local === name ? name : `${name} as ${local}`), ""));
    code = code.replace(inst[0], "").replace(m[0], names.length ? `import { ${names.join(", ")} } from ${m[2]};\n` : "");
  }
  // a module named ./api is the app's server: `const x = __rt.api("x")` is a name imported from it
  const api: string[] = [];
  code = code.replace(/^[ \t]*const ([\w$]+) = __rt\.(?:api|jsError)\("([\w$]+)"\);\n/gm, (_, local, name) => (api.push(local === name ? name : `${name} as ${local}`), ""));
  if (api.length) code = `import { ${api.join(", ")} } from "./api";\n` + code;
  // `log` is the one builtin JavaScript has a name for: the console's. A module that imported the name gets the same
  const logs = new Set<string>();
  code = code.replace(/^[ \t]*const ([\w$]+) = __B\.log;\n/gm, (_, n) => (logs.add(n), ""));
  for (const n of logs) code = inCode(code, (part) => part.replace(new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}\\(`, "g"), "console.log("));
  code = code.replace(/\b__B\.log\(/g, "console.log(");
  // .rx's other builtins (len, str, fetch, …) are names of their own, not JavaScript's
  code = code.replace(/\b__B\.(\w+)\b/g, "$1");
  // `const len = __B.len` named a builtin for the module: with __B gone it would read itself
  code = code.replace(/^[ \t]*const ([\w$]+) = \1;\n/gm, "");
  // a module that is not the entry: its setup is the module's top level, and what it returns is what it exports
  const mod = /export default function module\(__rt\) \{\s*(?:const __B = __rt\.B;\s*)?([\s\S]*?)\breturn \{([^{}]*)\};\s*\}\s*$/.exec(code);
  if (mod && !/__rt\b/.test(mod[1])) {
    let body = mod[1].replace(/^\t/gm, "");
    for (const [, key, value] of mod[2].matchAll(/([\w$]+):\s*([\w$]+)/g)) {
      if (key !== value) continue;
      // `x`, not the `x$await` declared above it
      body = body.replace(new RegExp(`^(function|const|let) (\\[?${key.replace(/\$/g, "\\$")}(?![\\w$]))`, "m"), "export $1 $2");
    }
    // an error class sits above the module's setup
    let above = code.slice(0, mod.index);
    for (const [, key, value] of mod[2].matchAll(/([\w$]+):\s*([\w$]+)/g)) if (key === value) above = above.replace(new RegExp(`^class ${key}\\b`, "m"), `export class ${key}`);
    code = above + body;
  }

  // the app wrapper, when nothing in it needs the runtime any more
  const wrap = /export default function main\(__rt\) \{\s*const __B = __rt\.B;\s*return \(\) => \{([\s\S]*)\breturn ([\s\S]*?);\s*\};\s*\}\s*$/.exec(code);
  if (wrap && !/__rt|__B/.test(wrap[1] + wrap[2])) {
    const one = /^\(?\s*(?:<>\s*)?<(\w+) children=\{\[\]\} \/>\s*(?:<\/>\s*)?\)?$/.exec(wrap[2].trim());
    // a module-level provide wraps the app: the root is a component of its own
    code = code.slice(0, wrap.index) + wrap[1].replace(/^\t\t/gm, "") + (one ? `export default ${one[1]};\n` : `export default function Root() {\nreturn ${wrap[2].trim()};\n}\n`);
  }

  // a component used with no children is passed none, not an empty list
  code = inCode(code, (part) => part.replace(/\s+children=\{\[\]\}(?=\s*\/?>)/g, ""));
  // a provided value is an accessor, so `use c` alone is what useContext returns
  code = code.replace(/createMemo\(\(\) => (useContext\([\w$]+\))\(\)\)/g, "$1");
  for (const n of used) if (!new RegExp(`\\b${n}\\(`).test(code)) used.delete(n);
  if (/\binstanceof NotReadyError\b/.test(code)) used.add("NotReadyError");
  for (const c of ["Errored", "Loading", "For", "Show", "Repeat"]) if (new RegExp(`<${c}[\\s>]`).test(code)) used.add(c);
  const head = used.size ? `import { ${[...used].sort().join(", ")} } from "solid-js";\n` : "";
  return head + code;
}
