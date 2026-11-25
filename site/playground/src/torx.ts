// Solid 2.0 written back as .rx: the inverse of solidify, for the forms that view produces. A prototype: what it
// does not recognise is reported with its line, never guessed.

type Node = { type: string; start: number; end: number; loc?: { start: { line: number } }; [k: string]: any };
export type RxProblem = { line: number; message: string };

type Binding =
  | { kind: "read" } // a signal or memo accessor: `x()` is `x`
  | { kind: "store" } // read as itself
  | { kind: "await"; text: string } // `x$await()`: the hoisted await, written back in place
  | { kind: "setter"; of: string; guess?: boolean }
  | { kind: "import"; from: string; async?: boolean; asyncMembers?: Set<string> } // async: declared so in this file, so a reactive call is an await
  | { kind: "handler"; fn: Node } // a setup function that writes or has statements: an action
  | { kind: "mutable" } // a `let` in a component's setup: a source (.rx has no other writable name there), read by peek in reactive scope
  | { kind: "equation" } // a module's own declaration: read as itself, and a reactive read
  | { kind: "server" } // a "use server" function: a call from reactive scope is an await (12 SF-2)
  | { kind: "input"; as: string } // an effect's parameter: its input, by position ($0, $1)
  | { kind: "error" } // `class E extends Error`: an error declaration (R-f-1); `new E(a)` is `E(a)`
  | { kind: "context"; as: string } // `createContext(…)`: a context (07), named as .rx names it
  | { kind: "plain" };

const SOLID = new Set(["solid-js", "@solidjs/web", "solid-js/store"]);
const INDENT = "  ";
// .rx has no ambient names: what JavaScript gives every module is imported like anything else
const GLOBALS = new Set(
  "Array Object Math JSON Date Number Boolean Promise Map Set WeakMap WeakSet Symbol RegExp Error Intl URL URLSearchParams console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask structuredClone document window globalThis navigator location history localStorage sessionStorage fetch crypto performance alert confirm prompt parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent".split(" "),
);

// .rx's own builtins: the view writes them bare, and they stay bare
const RX_BUILTINS = new Set(["len", "str", "map", "filter", "sum", "fail", "fetch", "every", "indexOf"]);

/** The module the plain TypeScript of a Solid file moves to: what is not reactive stays what it was. */
export const HELPERS = "helpers.ts";

/** What a module's .d.rx says of a name it exports: a pure fn, an io fn, or a type. */
export type Declared = (from: string, name: string) => "pure" | "io" | "type" | undefined;

/** A .d.rx file's exports, by name. */
export function declaredIn(drx: string): Map<string, "pure" | "io" | "type"> {
  const m = new Map<string, "pure" | "io" | "type">();
  for (const x of drx.matchAll(/^export\s+(pure\s+)?(fn|type|const|source)\s+([\w$]+)/gm)) m.set(x[3], x[2] === "type" ? "type" : x[1] || x[2] !== "fn" ? "pure" : "io");
  return m;
}

/** Another module's Solid view, parsed, by the path an import names; undefined when it is not one of the program's. */
export type Modules = (from: string) => Node | undefined;

export function toRx(ast: Node, src: string, opts: { declared?: Declared; modules?: Modules } = {}): { code: string; problems: RxProblem[]; files: Record<string, string> } {
  const problems: RxProblem[] = [];
  const scopes: Map<string, Binding>[] = [new Map()];
  const pureImports = new Set<string>(); // by local name: what reactive scope reads is imported pure, the rest is io
  let imperative = 0;
  const awaiting = new WeakSet<Node>();
  // a store setter's draft: `setCart((draft) => { … })`, its parameter standing for the store while its body is read
  const aliases = new Map<string, { store: string; fn: Node; written: Map<string, string>; wrote?: boolean; guess?: boolean }>();
  let exact = 0; // a write's target is printed as written, never as the local that holds its value
  // `x++` inside a statement: the write, placed after it
  const hoisted: ({ stmt: Node; after: string[]; before: string[] } | null)[] = [];
  const squeeze = (t: string) => t.replace(/\s+/g, "");
  /** A function with the "use server" directive. */
  const isServer = (f: Node | null | undefined) => !!f && (isFn(f) || f.type === "FunctionDeclaration") && f.body?.type === "BlockStatement" && (f.body.directives ?? []).some((d: Node) => d.value?.value === "use server");
  // what each server fn's body imports, and which are asked from reactive scope: those imports have to be pure (SF-1b)
  const serverCalls = new Map<string, Set<string>>();
  const askedServers = new Set<string>();
  let inServer: string | undefined;
  const globals = new Map<string, boolean>(); // each one used, and whether reactive scope reads it (a pure import)
  let assigns = false; // a plain JavaScript assignment was written as assign(target, key, value)
  let reactive = 0; // reads of reactive names so far: a source's first value that has one is a peek
  let derived = 0; // inside a derived computation (a projection's function): reactive scope, which cannot write
  const comments: Node[] = ast.comments ?? [];
  /** The comments between `from` and `n`, as // lines. */
  const leading = (n: Node, from: number): string[] =>
    comments
      .filter((c) => c.start >= from && c.end <= n.start)
      .flatMap((c) => (c.type === "CommentLine" ? [`//${c.value}`] : (c.value as string).split("\n").map((l) => `// ${l.replace(/^\s*\*?\s?/, "")}`)))
      .map((l) => l.trimEnd())
      .filter((l) => l !== "//");

  const lookup = (name: string) => {
    for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return scopes[i].get(name);
  };
  const bind = (name: string, b: Binding) => scopes[scopes.length - 1].set(name, b);
  const fail = (n: Node, message: string) => (problems.push({ line: n.loc?.start.line ?? 0, message }), "");
  const text = (n: Node) => src.slice(n.start, n.end);
  const callee = (n: Node | null | undefined) =>
    n && (n.type === "CallExpression" || n.type === "OptionalCallExpression") && n.callee.type === "Identifier" ? (n.callee.name as string) : undefined;
  const isFn = (n: Node | undefined) => !!n && (n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression");
  const isJsx = (n: Node | undefined) => !!n && (n.type === "JSXElement" || n.type === "JSXFragment");
  const unwrap = (n: Node): Node => (n.type === "ParenthesizedExpression" || n.type === "TSNonNullExpression" ? unwrap(n.expression) : n);
  /** `() => e`, `() => { return e }`: the `e`. */
  const returned = (f: Node): Node | undefined => {
    if (!isFn(f) && f?.type !== "FunctionDeclaration") return;
    if (f.body.type !== "BlockStatement") return f.body;
    return f.body.body.length === 1 && f.body.body[0].type === "ReturnStatement" ? f.body.body[0].argument : undefined;
  };
  const params = (f: Node) => f.params.map(text).join(", ");
  /** An arrow's parameters: .rx writes them without types. */
  const bare = (f: Node) => f.params.map((q: Node) => (q.typeAnnotation ? src.slice(q.start, q.typeAnnotation.start).replace(/\?$/, "") : text(q))).join(", ");
  /** `ThemeContext` is the context .rx calls `theme`. */
  const contextName = (js: string) => js.replace(/Context$/, "").replace(/^./, (c) => c.toLowerCase()) || js;
  const renamed = new Map<string, string>(); // an imported context: its .rx name
  const preludeAliases = new Set<string>(); // `const keep = filter`: a builtin imported under another name (09)
  /** The .rx name of the context `n` names, or undefined if it is not one. */
  const contextOf = (n: Node | undefined): string | undefined => {
    if (n?.type !== "Identifier") return;
    const b = lookup(n.name);
    if (b?.kind === "context") return b.as;
    if (b?.kind === "import") return renamed.set(n.name, contextName(n.name)), contextName(n.name);
  };
  /** `if (!(e instanceof A || e instanceof B)) throw e;` (or with `e()`): the classes a typed catch takes. */
  const rethrows = (st: Node | undefined, p: string, called: boolean): string[] | undefined => {
    if (st?.type !== "IfStatement" || st.alternate) return;
    const then = st.consequent.type === "BlockStatement" && st.consequent.body.length === 1 ? st.consequent.body[0] : st.consequent;
    const isP = (x: Node) => (called ? x.type === "CallExpression" && !x.arguments.length && x.callee.type === "Identifier" && x.callee.name === p : x.type === "Identifier" && x.name === p);
    const t = unwrap(st.test);
    if (then?.type !== "ThrowStatement" || !isP(unwrap(then.argument)) || t.type !== "UnaryExpression" || t.operator !== "!") return;
    const out: string[] = [];
    const walk = (x: Node): boolean => {
      x = unwrap(x);
      if (x.type === "LogicalExpression" && x.operator === "||") return walk(x.left) && walk(x.right);
      if (x.type === "BinaryExpression" && x.operator === "instanceof" && isP(unwrap(x.left)) && x.right.type === "Identifier") return out.push(x.right.name), true;
      return false;
    };
    return walk(t.argument) ? out : undefined;
  };
  /** What another module exports, read from its Solid view as this module's own declarations are read. */
  const exportedKinds = (mod: Node): Map<string, Binding> => {
    const out = new Map<string, Binding>();
    for (const st of mod.program.body as Node[]) {
      const d = st.type === "ExportNamedDeclaration" ? st.declaration : undefined;
      if (d?.type === "ClassDeclaration" && d.superClass?.type === "Identifier" && d.superClass.name === "Error") out.set(d.id.name, { kind: "error" });
      if (d?.type !== "VariableDeclaration") continue;
      for (const v of d.declarations as Node[]) {
        const name = callee(v.init);
        const get = v.id.type === "ArrayPattern" ? v.id.elements[0]?.name : v.id.type === "Identifier" ? v.id.name : undefined;
        if (!get) continue;
        if (v.id.type === "ArrayPattern" && (name === "createSignal" || name === "createOptimistic")) out.set(get, { kind: "read" });
        else if (v.id.type === "ArrayPattern" && (name === "createStore" || name === "createOptimisticStore")) out.set(get, { kind: "store" });
        else if (v.id.type === "Identifier" && (name === "createMemo" || name === "createDeferred")) out.set(get, { kind: "read" });
        else if (v.id.type === "Identifier" && (name === "createProjection" || name === "omit")) out.set(get, { kind: "store" });
        else if (v.id.type === "Identifier" && name === "createContext") out.set(get, { kind: "context", as: contextName(get) });
      }
    }
    return out;
  };

  /** `{ loadingValue: v }` among a primitive's options: `-> v`, the first paint (R-7). */
  const paintOf = (o: Node | undefined): Node | undefined =>
    o?.type === "ObjectExpression" ? o.properties.find((q: Node) => q.type === "ObjectProperty" && !q.computed && (q.key.name ?? q.key.value) === "loadingValue")?.value : undefined;
  let paint: string | undefined; // a first paint for the `.catch` about to be read: it goes between the await and the catch
  /** `(e) => alt`, or `(e) => { if (!(e instanceof A)) throw e; return alt }`: a catch clause (R-f-4, 07). */
  const catchClause = (f: Node | undefined): { p: string; classes?: string[]; alt: Node } | undefined => {
    if (!isFn(f) || f!.params.length !== 1 || f!.params[0].type !== "Identifier") return;
    const p = f!.params[0].name as string;
    if (f!.body.type !== "BlockStatement") return { p, alt: f!.body };
    const st: Node[] = f!.body.body;
    const classes = st.length === 2 && st[1].type === "ReturnStatement" && st[1].argument ? rethrows(st[0], p, false) : undefined;
    return classes ? { p, classes, alt: st[1].argument } : undefined;
  };
  const clause = (c: { p: string; classes?: string[]; alt: Node }) => {
    scopes.push(new Map([[c.p, { kind: "plain" } as Binding]]));
    const alt = expr(c.alt);
    scopes.pop();
    return `catch (${c.p}${c.classes ? `: ${c.classes.join(" | ")}` : ""}) => ${alt}`;
  };
  /** `createMemo(() => { try { return x } catch (e) { if (e instanceof NotReadyError || …) throw e; return alt } })`: `x catch (e) => alt`. */
  const caughtMemo = (f: Node | undefined): { x: Node; c: { p: string; classes?: string[]; alt: Node } } | undefined => {
    const t = isFn(f) && f!.body.type === "BlockStatement" && f!.body.body.length === 1 ? f!.body.body[0] : undefined;
    const ret = t?.type === "TryStatement" && !t.finalizer && t.block.body.length === 1 ? t.block.body[0] : undefined;
    const h = t?.handler;
    if (ret?.type !== "ReturnStatement" || !ret.argument || h?.param?.type !== "Identifier" || h.body.body.length !== 2 || h.body.body[1].type !== "ReturnStatement") return;
    const p = h.param.name as string;
    const first: Node = h.body.body[0];
    const then = first.type === "IfStatement" && !first.alternate ? (first.consequent.type === "BlockStatement" && first.consequent.body.length === 1 ? first.consequent.body[0] : first.consequent) : undefined;
    if (then?.type !== "ThrowStatement" || unwrap(then.argument).name !== p) return;
    const parts: Node[] = [];
    const flat = (x: Node): void => {
      x = unwrap(x);
      if (x.type === "LogicalExpression" && x.operator === "||") flat(x.left), flat(x.right);
      else parts.push(x);
    };
    flat(first.test);
    const ready = parts[0];
    if (!(ready?.type === "BinaryExpression" && ready.operator === "instanceof" && unwrap(ready.left).name === p && ready.right.name === "NotReadyError")) return;
    let classes: string[] | undefined;
    if (parts.length === 2) {
      classes = rethrows({ ...first, test: parts[1], consequent: then }, p, false);
      if (!classes) return;
    } else if (parts.length !== 1) return;
    return { x: ret.argument, c: { p, classes, alt: h.body.body[1].argument } };
  };

  /** `class E extends Error { constructor(a) { super(m); this.name = "E"; this.a = a; } }` as `error E(a) => m`. */
  function errorDecl(c: Node): string[] {
    const name = c.id.name as string;
    const members: Node[] = c.body.body;
    const ctor = members.find((m) => m.kind === "constructor");
    if (members.length !== (ctor ? 1 : 0)) return fail(c, `${name}: an error class with members besides its constructor has no .rx form`), [];
    if (!ctor) return [`error ${name}`];
    const ps: string[] = ctor.params.map((q: Node) => (q.type === "Identifier" ? q.name : ""));
    if (ps.some((q) => !q)) return fail(ctor, `${name}: an error's fields are named parameters`), [];
    let message: Node | undefined;
    for (const st of ctor.body.body as Node[]) {
      const e = st.type === "ExpressionStatement" ? unwrap(st.expression) : undefined;
      if (e?.type === "CallExpression" && e.callee.type === "Super" && e.arguments.length <= 1) message = e.arguments[0];
      else if (e?.type === "AssignmentExpression" && e.left.type === "MemberExpression" && e.left.object.type === "ThisExpression" && !e.left.computed) {
        const f = e.left.property.name as string;
        if (f === "name" && e.right.type === "StringLiteral" && e.right.value === name) continue;
        if (f !== "name" && e.right.type === "Identifier" && e.right.name === f && ps.includes(f)) continue;
        return fail(st, `${name}: a field that is not its parameter has no .rx form`), [];
      } else return fail(st, `${name}: an error's constructor only calls super and names its fields`), [];
    }
    scopes.push(new Map(ps.map((q) => [q, { kind: "plain" } as Binding])));
    const m = message ? ` => ${expr(message)}` : "";
    scopes.pop();
    const typed = ctor.params.map((q: Node) => text(q)).join(", ");
    return [`error ${name}${ps.length || message ? `(${typed})` : ""}${m}`];
  }

  // ---- text placement: an expression's text keeps the source's indentation until it is placed

  const lineIndent = (at: number) => /^[ \t]*/.exec(src.slice(src.lastIndexOf("\n", at - 1) + 1))![0];
  const place = (s: string, base: string, indent: string) =>
    s
      .split("\n")
      .map((l, i) => (i === 0 ? l : indent + (l.startsWith(base) ? l.slice(base.length) : l.trimStart()).replace(/^\t+/, (t) => INDENT.repeat(t.length))))
      .join("\n")
      // a newline ends a .rx expression, so an operator that leads a line moves to the end of the one before
      .replace(/([^,([{\s])\n([ \t]*)(\?\?|\?|:|&&|\|\||[-+*/%]|[!=]==?|[<>]=?) /g, "$1 $3\n$2")
      .replace(/([^,([{\s])\n[ \t]*(\??\.)(?=[\w$])/g, "$1$2");
  const indented = (lines: string[], indent: string) => lines.map((l) => (l ? indent + l : l));

  // ---- expressions: the source text, with the Solid forms inside it rewritten

  /** `e` as an operand: in parentheses unless it is a name or a call. */
  const operand = (s: string) => (/^[\w$.]+(\([^()]*\))?$/.test(s) ? s : `(${s})`);

  function rewrite(n: Node, parent?: Node): string | undefined {
    if (aliases.size && !exact && /MemberExpression$/.test(n.type)) {
      const local = aliases.get(root(n))?.written.get(squeeze(text(n)));
      if (local) return local;
    }
    // `x as T`, `x!`: TypeScript's, not .rx's
    if (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "TSNonNullExpression") return expr(n.expression, parent);
    const name = callee(n);
    const head = !!parent && ((/MemberExpression$/.test(parent.type) && parent.object === n) || (/CallExpression$/.test(parent.type) && parent.callee === n));
    const tight = head || (!!parent && /Binary|Logical|Unary|Await|Spread/.test(parent.type));
    if (name !== undefined) {
      const b = lookup(name);
      const a: Node[] = n.arguments;
      if (b?.kind === "read" && a.length === 0) return reactive++, name;
      if (b?.kind === "store" && a.length === 0) return reactive++, name;
      if (b?.kind === "handler" && !imperative) return fail(n, `${name} writes and is called while rendering: reactive scope cannot write in .rx (R-io-3)`);
      if (b?.kind === "await" && a.length === 0) return tight ? `(${b.text})` : b.text;
      if (b?.kind === "import" && inServer) serverCalls.get(inServer)?.add(name);
      if (b?.kind === "server" && !imperative && !awaiting.has(n) && !(parent && /Await|Yield/.test(parent.type))) {
        awaiting.add(n);
        askedServers.add(name);
        const s = `await ${expr(n)}`;
        return tight ? `(${s})` : s;
      }
      if (b?.kind === "import" && !imperative) {
        pureImports.add(name);
        if (b.async && !awaiting.has(n) && !(parent && /Await|Yield/.test(parent.type))) {
          awaiting.add(n);
          const s = `await ${expr(n)}`;
          return tight ? `(${s})` : s;
        }
      }
      if (b?.kind === "setter") return fail(n, `${name}(…) is a write: it can only be a statement in a handler or an action`);
      if (name === "untrack" && a.length === 1) {
        const inner = isFn(a[0]) ? returned(a[0]) : undefined;
        const of = inner ? expr(inner) : a[0].type === "Identifier" && lookup(a[0].name) ? a[0].name : undefined;
        if (of === undefined) return fail(n, "untrack of something that is not a signal, a memo or a function");
        return imperative ? (tight && inner ? operand(of) : of) : `peek(${of})`;
      }
      if ((name === "latest" || name === "isPending") && a.length === 1) {
        const inner = isFn(a[0]) ? returned(a[0]) : a[0].type === "Identifier" ? a[0] : undefined;
        if (!inner) return fail(n, `${name} of something that is not a function or an accessor`);
        const of = inner.type === "Identifier" ? inner.name : expr(inner);
        const s = `${name === "latest" ? "latest" : "pending?"} ${operand(of)}`;
        return head ? `(${s})` : s;
      }
      if (name === "String" && a.length === 1) return `str(${expr(a[0])})`;
      if (/^create[A-Z]|^(action|omit|merge)$/.test(name) && lookup(name)?.kind === "plain")
        return fail(n, `${name} is only read as a declaration or a statement, not inside an expression`);
    }
    if (/CallExpression$/.test(n.type) && /MemberExpression$/.test(n.callee.type) && !n.callee.computed) {
      const m = n.callee.property.name as string;
      // `console.log(…)` is .rx's log: a builtin, where `console` itself would have to be imported
      if (m === "log" && n.callee.object.type === "Identifier" && n.callee.object.name === "console" && !lookup("console")) return `log(${n.arguments.map((x: Node) => expr(x)).join(", ")})`;
      const cc = m === "catch" && !imperative && n.arguments.length === 1 ? catchClause(n.arguments[0]) : undefined;
      if (cc) {
        const at = paint;
        paint = undefined;
        awaiting.add(n.callee.object);
        const on = expr(n.callee.object, n).replace(/^await\s+/, "");
        const s = `await ${on}${at ? ` -> ${at}` : ""} ${clause(cc)}`;
        return tight ? `(${s})` : s;
      }
      if (m === "then" || m === "catch" || m === "finally") return fail(n, `.${m}(…): .rx has no promise chaining; an action's failure is caught in its body, try { … } catch (e) { … }`);
      const o = n.callee.object.type === "Identifier" ? lookup(n.callee.object.name) : undefined;
      if (o?.kind === "import" && o.asyncMembers?.has(m) && !imperative && !awaiting.has(n) && !(parent && /Await|Yield/.test(parent.type))) {
        awaiting.add(n);
        const head2 = !!parent && ((/MemberExpression$/.test(parent.type) && parent.object === n) || (/CallExpression$/.test(parent.type) && parent.callee === n));
        const s = `await ${expr(n)}`;
        return head2 || (!!parent && /Binary|Logical|Unary|Spread/.test(parent.type)) ? `(${s})` : s;
      }
    }
    if (n.type === "Identifier") {
      const b = lookup(n.name);
      const key = parent && ((/MemberExpression$/.test(parent.type) && parent.property === n && !parent.computed) || (parent.type === "ObjectProperty" && parent.key === n && !parent.computed));
      if (!key && b?.kind === "read") return fail(n, `the accessor ${n.name} is passed as a value: .rx has names, not accessors`);
      if (!key && b?.kind === "setter") return fail(n, `the setter ${n.name} is passed as a value: a write is a statement in .rx`);
      if (!key && aliases.has(n.name) && b?.kind === "plain") return aliases.get(n.name)!.store;
      if (!key && b?.kind === "input") return b.as;
      // a plain `let` never subscribes its readers: as a source, reactive scope reads it with peek
      if (!key && b?.kind === "mutable" && (!imperative || derived)) return `peek(${n.name})`;
      if (!key && (b?.kind === "store" || b?.kind === "equation")) reactive++;
      if (!key && b?.kind === "import" && !imperative) pureImports.add(n.name);
      if (!key && !b && RX_BUILTINS.has(n.name)) return;
      if (!key && !b && GLOBALS.has(n.name)) globals.set(n.name, !!globals.get(n.name) || !imperative);
      return;
    }
    if (n.type === "YieldExpression" || n.type === "AwaitExpression") {
      const s = `await ${expr(n.argument, n)}`;
      // in imperative scope a run suspends only at a statement (AC-1): an await inside an expression is bound first
      const h = hoisted[hoisted.length - 1];
      if (imperative && parent && h) {
        let v = "value";
        for (let i = 2; lookup(v); i++) v = `value${i}`;
        bind(v, { kind: "plain" });
        h.before.push(...`let ${v} = ${s}`.split("\n"));
        return v;
      }
      return tight ? `(${s})` : s;
    }
    // `GET(async function (id) { "use server"; … })`: a server fn as an expression (SF-1d)
    if (isFn(n) && isServer(n)) return ["server fn (" + params(n) + ") {", ...serverBody(n).map((l) => "\t" + l), "}"].join("\n");
    if (isFn(n)) {
      if (n.type === "FunctionExpression") return fail(n, "a function expression: .rx has arrow functions only");
      const shadow = new Map<string, Binding>();
      for (const p of n.params) for (const id of names(p)) shadow.set(id, { kind: "plain" });
      scopes.push(shadow);
      const lhs = n.params.length === 1 && n.params[0].type === "Identifier" && n.body.type !== "BlockStatement" ? n.params[0].name : `(${bare(n)})`;
      let out: string;
      if (n.body.type === "BlockStatement") {
        imperative++;
        out = `${lhs} => ${block(n.body.body)}`;
        imperative--;
      } else if (isWrite(unwrap(n.body))) {
        imperative++;
        out = `${lhs} => ${block([{ ...n.body, type: "ExpressionStatement", expression: n.body }])}`;
        imperative--;
      } else if (isJsx(unwrap(n.body))) {
        out = fail(n, "a function that returns JSX: write it as a component, <For> or <Show>");
      } else {
        const body = expr(n.body, n);
        out = `${lhs} => ${unwrap(n.body).type === "ObjectExpression" ? `(${body})` : body}`;
      }
      scopes.pop();
      return out;
    }
    if (isJsx(n)) return fail(n, "JSX inside an expression: .rx markup stands on its own, in {if}, {for} or a component");
    if (n.type === "UpdateExpression" && n.argument.type === "Identifier" && lookup(n.argument.name)?.kind === "mutable") {
      const x = n.argument.name as string;
      const h = hoisted[hoisted.length - 1];
      if (!h) return fail(n, `${text(n)} here: .rx writes are statements; write ${x} := ${x} ${n.operator[0]} 1 on its own line`);
      if (new RegExp(`(?<![.\\w$])${x.replace(/\$/g, "\\$")}(?![\\w$])`).test(src.slice(n.end, h.stmt.end))) return fail(n, `${text(n)} with a later read of ${x} in the same statement: split the statement`);
      h.after.push(`${x} := ${x} ${n.operator[0]} 1`);
      return n.prefix ? `(${x} ${n.operator[0]} 1)` : x;
    }
    if (n.type === "AssignmentExpression" || n.type === "UpdateExpression") return fail(n, `${text(n)}: .rx writes are statements on a source, x := e`);
    // `new E(a)` of an error class is the declaration's own call (R-f-1)
    if (n.type === "NewExpression" && n.callee.type === "Identifier" && (lookup(n.callee.name)?.kind === "error" || (lookup(n.callee.name)?.kind === "import" && /^[A-Z]/.test(n.callee.name))))
      return `${n.callee.name}(${n.arguments.map((x: Node) => expr(x)).join(", ")})`;
    // `(() => { throw e; })()`: .rx's throw expression (07)
    if (n.type === "CallExpression" && !n.arguments.length && unwrap(n.callee).type === "ArrowFunctionExpression") {
      const f = unwrap(n.callee);
      const only = f.body.type === "BlockStatement" && f.body.body.length === 1 ? f.body.body[0] : undefined;
      if (!f.params.length && only?.type === "ThrowStatement") return tight ? `(throw ${expr(only.argument)})` : `throw ${expr(only.argument)}`;
    }
    // `useContext(c)()`: the context's value, read where it is (07)
    if (n.type === "CallExpression" && !n.arguments.length && callee(n.callee) === "useContext" && lookup("useContext")?.kind === "plain") {
      const c = contextOf(n.callee.arguments[0]);
      if (c) return tight ? `(use ${c})` : `use ${c}`;
    }
    if (n.type === "ThisExpression" || n.type === "NewExpression" || n.type === "ClassExpression") return fail(n, `${n.type.replace("Expression", "").toLowerCase()} has no .rx form`);
    return;
  }

  /** A call that is a statement in .rx: a setter, a store path write, affects, refresh. */
  function isWrite(e: Node): boolean {
    const name = callee(e);
    if (name && (lookup(name)?.kind === "setter" || ((name === "affects" || name === "refresh") && lookup(name)?.kind === "plain"))) return true;
    if (e.type === "AssignmentExpression" && /MemberExpression$/.test(e.left.type)) return true;
    return e.type === "CallExpression" && e.callee.type === "MemberExpression" && e.callee.object.type === "Identifier" && lookup(e.callee.object.name)?.kind === "setter";
  }

  /** A server fn's statements: imperative scope, on the server. */
  function serverBody(f: Node): string[] {
    imperative++;
    scopes.push(new Map(f.params.flatMap(names).map((n: string) => [n, { kind: "plain" } as Binding])));
    const lines = f.body.body.flatMap(stmt);
    scopes.pop();
    imperative--;
    return lines;
  }

  function names(p: Node): string[] {
    if (p.type === "Identifier") return [p.name];
    if (p.type === "AssignmentPattern") return names(p.left);
    if (p.type === "RestElement") return names(p.argument);
    if (p.type === "ObjectPattern") return p.properties.flatMap((q: Node) => names(q.type === "RestElement" ? q : q.value));
    if (p.type === "ArrayPattern") return p.elements.filter(Boolean).flatMap(names);
    return [];
  }

  /** `n` as .rx, its later lines still carrying the source's indentation. */
  function raw(n: Node, parent?: Node): string {
    const whole = rewrite(n, parent);
    if (whole !== undefined) return whole.replace(/\n/g, "\n" + lineIndent(n.start));
    const edits: { start: number; end: number; text: string }[] = [];
    // `a?.b` is `a.b` (every .rx member read is optional) and `===` is `==` (E-6)
    const tokens = (m: Node) => {
      if (m.type === "OptionalMemberExpression" && m.optional) {
        const at = src.indexOf("?.", m.object.end);
        if (at >= 0 && at < m.property.start) edits.push({ start: at, end: at + 2, text: m.computed ? "" : "." });
      } else if (m.type === "BinaryExpression" && (m.operator === "===" || m.operator === "!==")) {
        const at = src.indexOf(m.operator, m.left.end);
        if (at >= 0 && at < m.right.start) edits.push({ start: at, end: at + 3, text: m.operator.slice(0, 2) });
      }
    };
    const walk = (m: Node) => {
      for (const k of Object.keys(m)) {
        if (k === "loc" || k === "typeAnnotation" || k === "typeParameters" || k === "returnType") continue;
        const v = m[k];
        for (const c of Array.isArray(v) ? v : [v]) {
          if (!c || typeof c.type !== "string" || typeof c.start !== "number") continue;
          const r = rewrite(c, m);
          if (r !== undefined) edits.push({ start: c.start, end: c.end, text: r.replace(/\n/g, "\n" + lineIndent(c.start)) });
          else tokens(c), walk(c);
        }
      }
    };
    tokens(n);
    walk(n);
    let out = "";
    let at = n.start;
    for (const e of edits.sort((a, b) => a.start - b.start)) {
      out += src.slice(at, e.start) + e.text;
      at = e.end;
    }
    return out + src.slice(at, n.end);
  }
  /** `n` as .rx, placed at column 0: later lines are relative to the first. */
  const expr = (n: Node, parent?: Node) => place(raw(n, parent), lineIndent(n.start), "");

  // ---- statements (imperative scope)

  function target(of: string, path: Node | undefined, n: Node): string {
    if (!path) return of;
    if (path.type !== "ArrayExpression") return fail(n, "a store path that is not written out as an array");
    return of + path.elements.map((k: Node) => (k.type === "StringLiteral" && /^[A-Za-z_$][\w$]*$/.test(k.value) ? `.${k.value}` : `[${expr(k)}]`)).join("");
  }

  const MUTATORS: Record<string, (v: string, a: string) => string> = {
    push: (v, a) => `[...${v}, ${a}]`,
    unshift: (v, a) => `[${a}, ...${v}]`,
    pop: (v) => `${v}.slice(0, -1)`,
    shift: (v) => `${v}.slice(1)`,
    splice: (v, a) => `${v}.toSpliced(${a})`,
    sort: (v, a) => `${v}.toSorted(${a})`,
    reverse: (v) => `${v}.toReversed()`,
  };
  /** A name for a local or a parameter that nothing in `fn` already uses. */
  const fresh = (want: string, fn: Node) => {
    const used = (n: string) => !!lookup(n) || new RegExp(`(?<![.\\w$])${n}(?![\\w$]|\\s*:)`).test(text(fn));
    let name = /^[A-Za-z_$][\w$]*$/.test(want) ? want : "v";
    for (let i = 2; used(name); i++) name = `${want}${i}`;
    bind(name, { kind: "plain" });
    return name;
  };
  const last = (path: Node) => (/MemberExpression$/.test(path.type) && !path.computed ? (path.property.name as string) : "v");
  /** A write's target, as written: the draft's parameter is the store, and no local stands in for it. */
  const exactly = (n: Node) => {
    exact++;
    const out = expr(n);
    exact--;
    return out;
  };

  /** One statement of a draft's body, `draft.a.b = v` and the like: writes along the store's path (W-1, W-6, AC-1d). */
  function draftWrite(e: Node, s: Node): string[] | undefined {
    const assign = e.type === "AssignmentExpression" || e.type === "UpdateExpression";
    const path = e.type === "AssignmentExpression" ? e.left : e.type === "UpdateExpression" ? e.argument : e.type === "CallExpression" && e.callee.type === "MemberExpression" ? e.callee.object : undefined;
    const a = path && aliases.get(root(path));
    if (!a || !/MemberExpression$/.test(path.type)) return;
    const g = a.guess ? "guess " : "";
    if (!assign) {
      const m = MUTATORS[e.callee.property.name];
      if (!m || e.callee.computed) return;
      // `list.push(x)`: a write to the next index appends in place, as push does. After another write in this run the
      // length it reads would be stale (AC-1d), so there the list is written functionally
      if (e.callee.property.name === "push" && e.arguments.length === 1 && e.arguments[0].type !== "SpreadElement" && !a.wrote) {
        a.wrote = true;
        return `${g}${exactly(path)}[${expr(path)}.length] := ${expr(e.arguments[0])}`.split("\n");
      }
      a.wrote = true;
      const v = fresh(last(path), a.fn);
      return `${g}${exactly(path)} := ${v} => ${m(v, e.arguments.map((x: Node) => expr(x)).join(", "))}`.split("\n");
    }
    const op = e.type === "UpdateExpression" ? e.operator[0] : e.operator.slice(0, -1);
    const by = e.type === "UpdateExpression" ? "1" : expr(e.right);
    const key = squeeze(text(path));
    const done = <T,>(lines: T) => ((a.wrote = true), lines);
    // `draft.a = ((v) => …)(draft.a)`: a functional write, as the view prints `x := v => …`
    const iife = e.type === "AssignmentExpression" && e.operator === "=" ? unwrap(e.right) : undefined;
    const f = iife?.type === "CallExpression" ? unwrap(iife.callee) : undefined;
    if (iife && f && isFn(f) && f.params.length === 1 && f.params[0].type === "Identifier" && iife.arguments.length === 1 && squeeze(text(iife.arguments[0])) === key)
      return done(`${g}${exactly(path)} := ${expr(f)}`.split("\n"));
    // read again below: the checker has a read after this run's own write as stale, so the value goes in a local
    const again = squeeze(src.slice(s.end, a.fn.end)).includes(key);
    if (again) {
      const value = op ? `${expr(path)} ${op} ${operand(by)}` : by;
      const local = fresh(last(path), a.fn);
      a.written.set(key, local);
      return done([...`let ${local} = ${value}`.split("\n"), `${g}${exactly(path)} := ${local}`]);
    }
    if (!op) return done(`${g}${exactly(path)} := ${by}`.split("\n"));
    const v = fresh(last(path), a.fn);
    return done(`${g}${exactly(path)} := ${v} => ${v} ${op} ${operand(by)}`.split("\n"));
  }
  /** `(draft) => { draft.x = 1 }`: a function that changes its argument and returns nothing. */
  const isDraft = (f: Node | undefined) => {
    if (!f || !isFn(f) || f.params.length !== 1 || f.params[0].type !== "Identifier") return false;
    if (f.body.type === "BlockStatement") return !f.body.body.some((x: Node) => x.type === "ReturnStatement" && x.argument);
    const b = unwrap(f.body);
    return b.type === "AssignmentExpression" || b.type === "UpdateExpression" || (b.type === "CallExpression" && b.callee.type === "MemberExpression" && root(b.callee.object) === f.params[0].name && b.callee.property.name in MUTATORS);
  };

  /**
   * A draft change that is one functional write of the whole value: a list method on the draft itself, or one row
   * found and changed. A guess has to be one (a guess along a path is not lowered), and a row reached through a local
   * has no path to write along.
   */
  function wholeWrite(b: Binding & { kind: "setter" }, f: Node): string[] | undefined {
    const param = f.params[0].name as string;
    const stmts: Node[] = f.body.type === "BlockStatement" ? f.body.body : [{ ...f.body, type: "ExpressionStatement", expression: f.body }];
    const head = `${b.guess ? "guess " : ""}${b.of} := ${param} =>`;
    scopes.push(new Map([[param, { kind: "plain" } as Binding]]));
    try {
      const only = stmts.length === 1 && stmts[0].type === "ExpressionStatement" ? unwrap(stmts[0].expression) : undefined;
      if (only?.type === "CallExpression" && only.callee.type === "MemberExpression" && only.callee.object.type === "Identifier" && only.callee.object.name === param && !only.callee.computed && only.callee.property.name in MUTATORS)
        return `${head} ${MUTATORS[only.callee.property.name](param, only.arguments.map((x: Node) => expr(x)).join(", "))}`.split("\n");
      // `const row = draft.find(…); row.a = 1; row.b = 2`
      const first = stmts[0];
      const d = first?.type === "VariableDeclaration" && first.declarations.length === 1 ? first.declarations[0] : undefined;
      const found = d && d.id.type === "Identifier" && d.init ? unwrap(d.init) : undefined;
      if (!found || found.type !== "CallExpression" || found.callee.type !== "MemberExpression" || found.callee.object.type !== "Identifier" || found.callee.object.name !== param || found.callee.property.name !== "find" || stmts.length < 2) return;
      const row = d.id.name as string;
      bind(row, { kind: "plain" });
      const fields: string[] = [];
      const set: string[] = [];
      for (const x of stmts.slice(1)) {
        const e = x.type === "ExpressionStatement" ? unwrap(x.expression) : undefined;
        const left = e?.type === "AssignmentExpression" ? e.left : e?.type === "UpdateExpression" ? e.argument : undefined;
        if (!e || !left || left.type !== "MemberExpression" || left.computed || left.object.type !== "Identifier" || left.object.name !== row) return;
        const k = left.property.name as string;
        const from = e.type === "AssignmentExpression" ? e.right : undefined;
        // a value that reads a field this change already wrote would read the old one in an object literal
        if (from && set.some((p) => new RegExp(`(?<![\\w$])${row}\\??\\.${p}(?![\\w$])`).test(text(from)))) return;
        const op = e.type === "UpdateExpression" ? e.operator[0] : e.operator.slice(0, -1);
        const by = from ? expr(from) : "1";
        fields.push(`${k}: ${op ? `${row}.${k} ${op} ${operand(by)}` : by}`);
        set.push(k);
      }
      const each = fresh("each", f);
      return [`${head} {`, `${INDENT}const ${row} = ${expr(found)}`, `${INDENT}return ${param}.map(${each} => ${each} == ${row} ? { ...${row}, ${fields.join(", ")} } : ${each})`, "}"];
    } finally {
      scopes.pop();
    }
  }

  function stmt(s: Node): string[] {
    hoisted.push(/^(Expression|Return|Throw)Statement$|^VariableDeclaration$/.test(s.type) ? { stmt: s, after: [], before: [] } : null);
    const lines = statement(s);
    const h = hoisted.pop();
    return [...(h?.before ?? []), ...lines, ...(h?.after ?? [])];
  }

  function statement(s: Node): string[] {
    switch (s.type) {
      case "ExpressionStatement": {
        const e = unwrap(s.expression);
        const name = callee(e);
        const b = name ? lookup(name) : undefined;
        if (b?.kind === "setter" && e.arguments.length === 1 && lookup(b.of)?.kind === "store" && isDraft(e.arguments[0])) {
          const whole = wholeWrite(b, e.arguments[0]);
          if (whole) return whole;
          const f = e.arguments[0] as Node;
          const alias = f.params[0].name as string;
          const outer = aliases.get(alias);
          aliases.set(alias, { store: b.of, fn: f, written: new Map(), guess: b.guess });
          scopes.push(new Map([[alias, { kind: "plain" } as Binding]]));
          const lines = (f.body.type === "BlockStatement" ? f.body.body : [{ ...f.body, type: "ExpressionStatement", expression: f.body }]).flatMap(stmt);
          scopes.pop();
          outer ? aliases.set(alias, outer) : aliases.delete(alias);
          return lines;
        }
        if (b?.kind === "setter" && e.arguments.length === 1 && !derived) {
          // a run suspends only at a statement (AC-1): an awaited value is bound first, then written
          if (/Yield|Await/.test(unwrap(e.arguments[0]).type)) {
            const v = fresh(b.of.replace(/\W.*$/, "") || "v", s);
            return [...`let ${v} = ${expr(e.arguments[0])}`.split("\n"), `${b.guess ? "guess " : ""}${b.of} := ${v}`];
          }
          return [`${b.guess ? "guess " : ""}${b.of} := ${expr(e.arguments[0])}`];
        }
        if (e.type === "UnaryExpression" && e.operator === "delete") return fail(e, `${text(e)}: .rx has no delete; write undefined or false to the key`), [];
        if (derived && ((b?.kind === "setter" && e.arguments.length === 1) || ((e.type === "AssignmentExpression" || e.type === "UpdateExpression") && lookup(root(e.type === "AssignmentExpression" ? e.left : e.argument))?.kind === "mutable")))
          return fail(e, `${text(e)} inside a derived computation: reactive scope cannot write in .rx; a previous value is read with pre x`), [];
        const along = draftWrite(e, s);
        if (along) return along;
        // a `let` of the component's setup is a source
        const x = e.type === "AssignmentExpression" ? e.left : e.type === "UpdateExpression" ? e.argument : undefined;
        if (x?.type === "Identifier" && lookup(x.name)?.kind === "mutable") {
          if (e.type === "UpdateExpression") return [`${x.name} := ${x.name} ${e.operator[0]} 1`];
          return `${x.name} := ${e.operator === "=" ? expr(e.right) : `${x.name} ${e.operator.slice(0, -1)} ${operand(expr(e.right))}`}`.split("\n");
        }
        // `input.value = ""`: plain JavaScript's assignment is not an .rx statement; a helper makes it
        if (e.type === "AssignmentExpression" && /MemberExpression$/.test(e.left.type) && !drafts.has(root(e.left)) && !["store", "read", "mutable", "equation", "setter"].includes(lookup(root(e.left))?.kind ?? "")) {
          assigns = true;
          const key = e.left.computed ? expr(e.left.property) : JSON.stringify(e.left.property.name);
          const value = e.operator === "=" ? expr(e.right) : `${expr(e.left)} ${e.operator.slice(0, -1)} ${operand(expr(e.right))}`;
          return `assign(${expr(e.left.object)}, ${key}, ${value})`.split("\n");
        }
        // `setX.path(["a", "b"], v)`: a write along a store's path
        if (e.type === "CallExpression" && e.callee.type === "MemberExpression" && e.callee.object.type === "Identifier" && e.callee.property.name === "path") {
          const w = lookup(e.callee.object.name);
          if (w?.kind === "setter" && e.arguments.length === 2) return [`${w.guess ? "guess " : ""}${target(w.of, e.arguments[0], e)} := ${expr(e.arguments[1])}`];
        }
        if ((name === "affects" || name === "refresh") && e.arguments.length === 1 && e.arguments[0].type === "Identifier") return [`${name} ${e.arguments[0].name}`];
        if (e.type === "AssignmentExpression" && e.operator === "=" && drafts.has(root(e.left))) return [`${expr(e.left)} := ${expr(e.right)}`];
        return expr(e).split("\n");
      }
      case "VariableDeclaration":
        return s.declarations.flatMap((d: Node) => {
          for (const id of names(d.id)) bind(id, { kind: "plain" });
          return `${s.kind === "const" ? "const" : "let"} ${text(d.id)}${d.init ? ` = ${expr(d.init)}` : ""}`.split("\n");
        });
      case "ReturnStatement":
        return (s.argument ? `return ${expr(s.argument, s)}` : "return").split("\n");
      case "ThrowStatement":
        return `throw ${expr(s.argument, s)}`.split("\n");
      case "IfStatement": {
        const out = [`if (${expr(s.test)}) {`, ...indented(body(s.consequent), INDENT)];
        if (s.alternate && !(s.alternate.type === "BlockStatement" && !s.alternate.body.length)) out.push("} else {", ...indented(body(s.alternate), INDENT));
        return [...out, "}"];
      }
      case "TryStatement": {
        const out = ["try {", ...indented(body(s.block), INDENT)];
        const p = s.handler?.param?.type === "Identifier" ? (s.handler.param.name as string) : undefined;
        // `if (!(e instanceof A)) throw e;` first: a typed catch, which rethrows the other classes (R-f-6)
        const classes = p ? rethrows(s.handler.body.body[0], p, false) : undefined;
        const handler = classes ? { ...s.handler.body, body: s.handler.body.body.slice(1) } : s.handler?.body;
        if (s.handler) out.push(`} catch${s.handler.param ? ` (${classes ? `${p}: ${classes.join(" | ")}` : text(s.handler.param)})` : ""} {`, ...indented(body(handler), INDENT));
        if (s.finalizer) out.push("} finally {", ...indented(body(s.finalizer), INDENT));
        return [...out, "}"];
      }
      case "BlockStatement":
        return body(s);
      case "EmptyStatement":
        return [];
      default:
        fail(s, `${s.type.replace(/Statement|Declaration/, "").toLowerCase()} statement: no .rx form in this prototype`);
        return [];
    }
  }
  const body = (s: Node): string[] => {
    scopes.push(new Map());
    const out = (s.type === "BlockStatement" ? s.body : [s]).flatMap(stmt);
    scopes.pop();
    return out;
  };
  const root = (n: Node): string => (n.type === "Identifier" ? n.name : /MemberExpression$/.test(n.type) ? root(n.object) : "");
  const drafts = new Set<string>();

  /** A handler's or an arrow's block: one line when it is short. */
  function block(stmts: Node[]): string {
    scopes.push(new Map());
    const lines = stmts.flatMap(stmt);
    scopes.pop();
    if (!lines.length) return "{ }";
    const one = `{ ${lines.join("; ")} }`;
    if (lines.every((l) => !/^[\s}]|\{$/.test(l)) && one.length <= 72) return one;
    return ["{", ...indented(lines, "\t"), "}"].join("\n");
  }

  // ---- markup

  const isHandler = (name: string) => /^on[A-Z:]/.test(name);
  const stripScope = (s: string) => s.split(/\s+/).filter((c) => c && !/^tsrx-[0-9a-f]+$/.test(c)).join(" ");
  const tagName = (n: Node): string => (n.type === "JSXMemberExpression" ? `${tagName(n.object)}.${n.property.name}` : n.type === "JSXNamespacedName" ? `${n.namespace.name}:${n.name.name}` : n.name);
  const attrOf = (el: Node, name: string): Node | undefined => el.openingElement.attributes.find((a: Node) => a.type === "JSXAttribute" && a.name.name === name);
  const valueOf = (a: Node | undefined): Node | undefined => (a?.value?.type === "JSXExpressionContainer" ? a.value.expression : a?.value ?? undefined);

  function attr(a: Node): string | undefined {
    if (a.type === "JSXSpreadAttribute") return `{...${expr(a.argument)}}`;
    const name = tagName(a.name);
    const v = a.value as Node | null;
    if (!v) return name;
    if (v.type === "StringLiteral") {
      if (name !== "class") return `${name}=${text(v)}`;
      const c = stripScope(v.value);
      return c ? `class="${c}"` : undefined;
    }
    let e = unwrap(v.expression);
    if (name === "children" && e.type === "ArrayExpression" && !e.elements.length) return;
    // `class={[e, "tsrx-…"]}`: the scoped class the compiler added
    if (name === "class" && e.type === "ArrayExpression" && e.elements.length === 2 && e.elements[1]?.type === "StringLiteral" && !stripScope(e.elements[1].value)) e = unwrap(e.elements[0]);
    if (name === "class" && e.type === "StringLiteral") return stripScope(e.value) ? `class="${stripScope(e.value)}"` : undefined;
    if (isJsx(e)) return fail(e, `JSX in the ${name} attribute: pass it as children, or make it a component`), undefined;
    if (name === "ref") return fail(a, "ref: element refs are not in this prototype"), undefined;
    if (isHandler(name)) imperative++;
    const s = expr(e);
    if (isHandler(name)) imperative--;
    return `${name}={${s}}`;
  }

  type Item = { inline: string } | { lines: string[] };
  const inlineText = (s: string) => (/[{}<>]/.test(s) ? `{${JSON.stringify(s)}}` : s);

  /** A block of markup with its own declarations: `() => { const x = createMemo(…); return <p /> }`, as .rx lines. */
  function region(f: Node): string[] {
    const stmts: Node[] = f.body.body;
    const view = stmts[stmts.length - 1];
    if (view?.type !== "ReturnStatement" || !view.argument) return fail(f, "a block of markup that does not end with one return of it"), [];
    scopes.push(new Map());
    const setup = stmts.slice(0, -1);
    declare(setup, true);
    const lines = setup.flatMap((x) => decl(x, setup));
    const out = markup([unwrap(view.argument)]);
    scopes.pop();
    return [...lines, ...out];
  }
  /** `(() => { …; return <jsx> })()`: a region the view keeps as a call. */
  const regionCall = (e: Node) =>
    e.type === "CallExpression" && !e.arguments.length && isFn(unwrap(e.callee)) && !unwrap(e.callee).params.length && unwrap(e.callee).body.type === "BlockStatement" ? unwrap(e.callee) : undefined;

  function child(c: Node): Item[] {
    if (c.type === "JSXText") {
      // JSX's own rule: lines trimmed, blank ones dropped, the rest joined by a space
      const lines = (c.value as string).split("\n");
      const kept = lines.map((l, i) => (i === 0 ? l : l.replace(/^[ \t]+/, ""))).map((l, i) => (i === lines.length - 1 ? l : l.replace(/[ \t]+$/, "")));
      const s = kept.filter((l) => l).join(" ");
      return s ? [{ inline: s }] : [];
    }
    if (c.type === "JSXExpressionContainer") {
      const e = unwrap(c.expression);
      if (e.type === "JSXEmptyExpression") return [];
      if (e.type === "StringLiteral") return [{ inline: e.value }];
      if (isJsx(e)) return child(e);
      const r = regionCall(e);
      if (r) return [{ lines: region(r) }];
      if (e.type === "ConditionalExpression" && (isJsx(unwrap(e.consequent)) || isJsx(unwrap(e.alternate)))) return [{ lines: ifBlock(expr(e.test), markup([unwrap(e.consequent)]), markup([unwrap(e.alternate)])) }];
      if (e.type === "LogicalExpression" && e.operator === "&&" && isJsx(unwrap(e.right))) return [{ lines: ifBlock(expr(e.left), markup([unwrap(e.right)]), []) }];
      if (e.type === "NullLiteral") return [];
      return [{ inline: `{${expr(e)}}` }];
    }
    if (c.type === "JSXFragment") return c.children.flatMap(child);
    if (c.type === "JSXElement") return [{ lines: element(c) }];
    if (c.type === "NullLiteral") return [];
    fail(c, `${c.type} as a child`);
    return [];
  }

  /** Children as lines: text and readers run together on a line, elements and control forms stand on their own. */
  function markup(nodes: Node[]): string[] {
    const items = nodes.flatMap((n) => (isJsx(n) || n.type.startsWith("JSX") ? child(n) : n.type === "NullLiteral" ? [] : [{ inline: `{${expr(n)}}` } as Item]));
    const out: string[] = [];
    let run: string[] = [];
    const flush = () => {
      if (!run.length) return;
      // a space at either end of a line would be trimmed: keep it in a string
      const first = run[0], last = run[run.length - 1];
      if (!first.startsWith("{") && /^\s/.test(first)) run[0] = `{${JSON.stringify(first)}}`;
      if (run.length > 1 && !last.startsWith("{") && /\s$/.test(last)) run[run.length - 1] = `{${JSON.stringify(last)}}`;
      else if (run.length === 1 && !run[0].startsWith("{") && /\s$/.test(run[0])) run[0] = `{${JSON.stringify(first)}}`;
      out.push(run.join(""));
      run = [];
    };
    for (const it of items) {
      if ("inline" in it) run.push(it.inline.startsWith("{") ? it.inline : inlineText(it.inline));
      else flush(), out.push(...it.lines);
    }
    flush();
    return out.flatMap((l) => l.split("\n"));
  }

  const ifBlock = (test: string, then: string[], other: string[]) =>
    other.length ? [`{if ${test} {`, ...indented(then, INDENT), "} else {", ...indented(other, INDENT), "}}"] : [`{if ${test} {`, ...indented(then, INDENT), "}}"];

  function element(el: Node): string[] {
    const tag = tagName(el.openingElement.name);
    const known = lookup(tag)?.kind === "plain" && SOLID_TAGS.has(tag);
    const kids = () => markup(el.children);
    const only = (...allowed: string[]) => {
      for (const a of el.openingElement.attributes) if (a.type !== "JSXAttribute" || !allowed.includes(a.name.name)) fail(a, `<${tag}> with ${a.type === "JSXAttribute" ? a.name.name : "a spread"}: no .rx form in this prototype`);
    };
    const fallback = (): { head: string; lines: string[] } => {
      const f = valueOf(attrOf(el, "fallback"));
      if (!f || f.type === "NullLiteral") return { head: "", lines: [] };
      const u = unwrap(f);
      if (isFn(u)) {
        const p = u.params[0];
        const st: Node[] = u.body.type === "BlockStatement" ? u.body.body : [];
        // `{ if (!(e() instanceof A)) throw e(); return <… /> }`: a typed boundary, which passes the rest up (R-f-4)
        const classes = tag === "Errored" && p?.type === "Identifier" && st.length === 2 && st[1].type === "ReturnStatement" ? rethrows(st[0], p.name, true) : undefined;
        if (classes && st[1].argument) {
          scopes.push(new Map([[p.name, { kind: "read" } as Binding]]));
          const lines = markup([unwrap(st[1].argument)]);
          scopes.pop();
          return { head: `(${p.name}: ${classes.join(" | ")})`, lines };
        }
        const b = returned(u);
        if (!b && u.body.type === "BlockStatement" && !(p && uses([u.body], p.name))) return { head: "", lines: region(u) };
        if (!b) return fail(u, `a <${tag}> fallback with statements`), { head: "", lines: [] };
        scopes.push(new Map(p?.type === "Identifier" ? [[p.name, { kind: "read" } as Binding]] : []));
        const lines = markup([unwrap(b)]);
        scopes.pop();
        return { head: p?.type === "Identifier" ? `(${p.name})` : "", lines };
      }
      return { head: "", lines: markup([u]) };
    };
    if (known && tag === "Show") {
      only("when", "fallback");
      const when = valueOf(attrOf(el, "when"));
      if (!when) return fail(el, "<Show> without when"), [];
      const fnKid = el.children.map((c: Node) => (c.type === "JSXExpressionContainer" ? unwrap(c.expression) : undefined)).find((x: Node | undefined) => x && isFn(x));
      if (fnKid) {
        // a branch that declares its own names: the view keeps it a function, its parameter unread
        const p = fnKid.params[0];
        if (fnKid.params.length > 1 || (p && (p.type !== "Identifier" || (p.name !== "__item" && uses([fnKid.body], p.name)))) || fnKid.body.type !== "BlockStatement")
          return fail(el, "<Show> with a function child: read the value by name instead"), [];
        return ifBlock(expr(when), region(fnKid), fallback().lines);
      }
      return ifBlock(expr(when), kids(), fallback().lines);
    }
    if (known && tag === "For") {
      only("each", "fallback");
      const each = valueOf(attrOf(el, "each"));
      const f = el.children.map((c: Node) => (c.type === "JSXExpressionContainer" ? unwrap(c.expression) : c)).find(isFn);
      const b = f && returned(f);
      // a body with declarations before its view: the loop's own equations, as `{for x in xs { y = …; <li /> }}`
      const block = f && !b && f.body.type === "BlockStatement" && f.body.body[f.body.body.length - 1]?.type === "ReturnStatement";
      if (!each || !(b || block) || f.params.length !== 1 || f.params[0].type !== "Identifier") return fail(el, "<For> needs each and one (item) => … child"), [];
      scopes.push(new Map([[f.params[0].name, { kind: "plain" } as Binding]]));
      const lines = b ? markup([unwrap(b)]) : region(f);
      scopes.pop();
      const loop = [`{for ${f.params[0].name} in ${expr(each)} {`, ...indented(lines, INDENT), "}}"];
      // .rx's for has no fallback: the empty list is an if
      const empty = fallback().lines;
      return empty.length ? ifBlock(`${operand(expr(each))}.length > 0`, loop, empty) : loop;
    }
    if (known && (tag === "Errored" || tag === "Loading")) {
      only(...(tag === "Loading" ? ["fallback", "on"] : ["fallback"]));
      const f = fallback();
      const on = tag === "Loading" ? valueOf(attrOf(el, "on")) : undefined;
      const word = tag === "Errored" ? "errored" : on ? `loading on(${expr(on)})` : "loading";
      const one = f.lines.length === 1 && f.lines[0].length <= 60;
      return one
        ? [`{${word} fallback${f.head} { ${f.lines[0]} } {`, ...indented(kids(), INDENT), "}}"]
        : [`{${word} fallback${f.head} {`, ...indented(f.lines, INDENT), "} {", ...indented(kids(), INDENT), "}}"];
    }
    if (known) return fail(el, `<${tag}>: no .rx form in this prototype`), [];
    if (lookup(tag)?.kind === "context") return fail(el, `<${tag} value>: a provider inside the view; .rx's provide covers a whole component, at the top of its view`), [];
    const attrs = el.openingElement.attributes.map(attr).filter((a: string | undefined): a is string => a !== undefined);
    const flat = attrs.join(" ");
    const inner = el.openingElement.selfClosing ? [] : kids();
    const end = inner.length ? ">" : "/>";
    const head = flat.includes("\n") || tag.length + flat.length > 96 ? [`<${tag}`, ...attrs.flatMap((a: string) => indented(a.split("\n"), INDENT)), end] : [`<${tag}${flat ? " " + flat : ""}${inner.length ? ">" : " />"}`];
    if (!inner.length) return head;
    if (head.length === 1 && inner.length === 1 && !/^\{(if|for|errored|loading) /.test(inner[0]) && head[0].length + inner[0].length + tag.length + 3 <= 100) return [`${head[0]}${inner[0]}</${tag}>`];
    return [...head, ...indented(inner, INDENT), `</${tag}>`];
  }
  const SOLID_TAGS = new Set(["Show", "For", "Errored", "Loading", "Switch", "Match", "Repeat", "Dynamic", "Portal"]);

  // ---- declarations (a component's body, or the module's)

  /** The prop pattern a component's first lines spell out, when every use of `props` is one of them. */
  function propPattern(fn: Node, stmts: Node[]): { pattern: string; taken: Set<Node> } | undefined {
    const p = fn.params[0];
    if (!p || p.type !== "Identifier") return;
    const fields: string[] = [];
    const taken = new Set<Node>();
    let rest = "";
    const member = (m: Node | undefined) => (m && /MemberExpression$/.test(m.type) && m.object.type === "Identifier" && m.object.name === p.name && !m.computed ? (m.property.name as string) : undefined);
    for (const s of stmts) {
      const d = s.type === "VariableDeclaration" && s.declarations.length === 1 ? s.declarations[0] : undefined;
      if (!d || d.id.type !== "Identifier" || !d.init) continue;
      const name = callee(d.init);
      const e = name === "createMemo" ? returned(d.init.arguments[0]) : undefined;
      const u = e && unwrap(e);
      if (u && member(u) !== undefined) {
        fields.push(member(u) === d.id.name ? d.id.name : `${member(u)}: ${d.id.name}`);
        taken.add(s);
      } else if (u?.type === "ConditionalExpression" && unwrap(u.test).type === "BinaryExpression" && /^===?$/.test(unwrap(u.test).operator) && member(unwrap(u.test).left) !== undefined && text(unwrap(u.test).right) === "undefined" && member(unwrap(u.alternate)) === member(unwrap(u.test).left)) {
        const k = member(unwrap(u.test).left)!;
        fields.push(`${k === d.id.name ? k : `${k}: ${d.id.name}`} = ${expr(u.consequent)}`);
        taken.add(s);
      } else if (name === "omit" && d.init.arguments[0]?.type === "Identifier" && d.init.arguments[0].name === p.name && d.init.arguments.slice(1).every((a: Node) => a.type === "StringLiteral")) {
        rest = d.id.name;
        taken.add(s);
      }
    }
    if (!taken.size) return;
    // any other read of props keeps the plain parameter
    let others = 0;
    const count = (n: Node) => {
      if (taken.has(n)) return;
      if (n.type === "Identifier" && n.name === p.name) others++;
      for (const k of Object.keys(n)) {
        if (k === "loc") continue;
        for (const c of Array.isArray(n[k]) ? n[k] : [n[k]]) if (c && typeof c.type === "string") count(c);
      }
    };
    stmts.forEach(count);
    if (others) return;
    return { pattern: `{ ${[...fields, ...(rest ? [`...${rest}`] : [])].join(", ")} }`, taken };
  }

  const typeArg = (call: Node) => (call.typeParameters?.params?.length === 1 ? `: ${text(call.typeParameters.params[0])}` : call.typeArguments?.params?.length === 1 ? `: ${text(call.typeArguments.params[0])}` : "");

  /** Names a declaration list makes, so a use above its declaration still reads as what it is. */
  function declare(stmts: Node[], setup = false) {
    const later: Node[] = [];
    for (const s of stmts) {
      if (s.type === "ClassDeclaration" && s.id && s.superClass?.type === "Identifier" && s.superClass.name === "Error") bind(s.id.name, { kind: "error" });
      if (s.type === "FunctionDeclaration" && s.id) bind(s.id.name, isServer(s) ? { kind: "server" } : setup && !returned(s) ? { kind: "handler", fn: s } : { kind: "plain" });
      if (s.type !== "VariableDeclaration") continue;
      for (const d of s.declarations) {
        const name = callee(d.init);
        if (d.id.type === "ArrayPattern" && d.id.elements.length >= 1 && d.id.elements.length <= 2 && d.id.elements.every((e: Node | null) => e?.type === "Identifier")) {
          // `const [value] = createSignal(…)`: a setter nobody names
          const [get, set = `set$${d.id.elements[0].name}`] = d.id.elements.map((e: Node) => e.name as string);
          if (name === "createSignal") {
            const truth = /^(.+)\$truth$/.exec(get);
            bind(get, { kind: "read" });
            bind(set, { kind: "setter", of: truth ? truth[1] : get });
          } else if (name === "createStore" || name === "createOptimisticStore") {
            bind(get, { kind: "store" });
            bind(set, { kind: "setter", of: get, guess: name === "createOptimisticStore" });
          } else if (name === "createOptimistic") {
            bind(get, { kind: "read" });
            bind(set, { kind: "setter", of: get, guess: true });
          }
        } else if (d.id.type === "Identifier") {
          if (isServer(d.init) || (/CallExpression$/.test(d.init?.type ?? "") && d.init.arguments.some(isServer))) bind(d.id.name, { kind: "server" });
          else if (name === "createMemo" || name === "createDeferred" || name === "useContext") bind(d.id.name, { kind: "read" });
          else if (name === "createContext") bind(d.id.name, { kind: "context", as: contextName(d.id.name) });
          else if (d.init?.type === "ArrowFunctionExpression" && d.init.body.type === "BlockStatement" && !returned(d.init) && (setup || !d.init.async)) bind(d.id.name, { kind: "handler", fn: d.init });
          else if (setup && d.init?.type === "ArrowFunctionExpression") (bind(d.id.name, { kind: "plain" }), later.push(d));
          else if (s.kind === "let" && (setup || d.init) && !isFn(d.init) && !/^create[A-Z]/.test(name ?? "")) bind(d.id.name, { kind: "mutable" });
          else if (name === "createProjection" || name === "omit" || name === "merge") bind(d.id.name, { kind: "store" });
          else bind(d.id.name, { kind: "plain" });
        }
      }
    }
    // `const add = () => setItems(…)`: one expression, but a write, so not a fn
    for (const d of later) if (isWrite(unwrap(d.init.body))) bind(d.id.name, { kind: "handler", fn: d.init });
  }

  /** A function of the setup that writes, as an action: the .rx form of a named procedure. */
  function actionDecl(id: string, f: Node): string[] {
    imperative++;
    scopes.push(new Map(f.params.flatMap(names).map((n: string) => [n, { kind: "plain" } as Binding])));
    const lines = (f.body.type === "BlockStatement" ? f.body.body : [{ ...f.body, type: "ExpressionStatement", expression: f.body }]).flatMap(stmt);
    scopes.pop();
    imperative--;
    return [`action ${id}(${params(f)}) {`, ...indented(lines, INDENT), "}"];
  }

  /** `createMemo(load)`: a function passed by name is asked with no arguments. */
  const byName = (f: Node | undefined) => f?.type === "Identifier" && (lookup(f.name)?.kind === "import" || lookup(f.name)?.kind === "plain");
  const asked = (f: Node) => {
    const b = lookup(f.name);
    if (b?.kind === "import") pureImports.add(f.name);
    return `${b?.kind === "import" && b.async ? "await " : ""}${f.name}()`;
  };

  const isPeek = (s: string) => {
    if (!s.startsWith("peek(") || !s.endsWith(")")) return false;
    let depth = 0;
    for (let i = 4; i < s.length; i++) if ((depth += s[i] === "(" ? 1 : s[i] === ")" ? -1 : 0) === 0) return i === s.length - 1;
    return false;
  };
  /** A source's first value: a snapshot, so one that reads a reactive name is a peek (E-4). */
  const first = (n: Node) => {
    const before = reactive;
    const s = expr(n);
    return reactive > before && !isPeek(s) ? `peek(${s})` : s;
  };

  /** `effect (inputs) { … }` over a function's statements, its parameters standing for the inputs. */
  function effectBlock(inputs: string, f: Node, bound: Map<string, Binding>): string[] {
    imperative++;
    scopes.push(bound);
    const lines = (f.body.type === "BlockStatement" ? f.body.body : [{ ...f.body, type: "ExpressionStatement", expression: f.body }]).flatMap(stmt);
    scopes.pop();
    imperative--;
    return [`effect (${inputs}) {`, ...indented(lines, INDENT), "}"];
  }

  /** `createEffect(compute, effect)`: what compute returns is the inputs, and effect's parameter reads them (EF-1). */
  function effectDecl(e: Node): string[] {
    const [compute, effect] = e.arguments as Node[];
    if (!isFn(compute) || !isFn(effect)) return fail(e, "createEffect needs its two functions written in place: what it reads, then what it does"), [];
    if (effect.params.length > 1) return fail(effect, "an effect that takes its previous value: .rx has pre x for the value before"), [];
    const value = returned(compute);
    if (compute.body.type === "BlockStatement" && !value && compute.body.body.length) return fail(compute, "an effect whose first function has statements: its inputs are expressions in .rx"), [];
    const u = value && unwrap(value);
    const param = effect.params[0] as Node | undefined;
    const bound = new Map<string, Binding>();
    let inputs: string[] = [];
    // `() => [a(), b()]` read as `([a, b]) => …`: one input each
    if (u?.type === "ArrayExpression" && param?.type === "ArrayPattern" && param.elements.every((x: Node | null) => !x || x.type === "Identifier") && u.elements.every((x: Node | null) => x && x.type !== "SpreadElement")) {
      inputs = u.elements.map((x: Node) => expr(x));
      param.elements.forEach((x: Node | null, i: number) => x && bound.set(x.name, { kind: "input", as: `$${i}` }));
    } else if (u) {
      inputs = [expr(u)];
      if (param?.type === "Identifier") bound.set(param.name, { kind: "input", as: "$0" });
      else if (param) return fail(param, "an effect that takes its value apart in its parameter: name it, and read its fields"), [];
    }
    return effectBlock(inputs.join(", "), effect, bound);
  }

  /** `async function f(a) { "use server"; … }`: `server fn f(a) { … }` (12 SF-1). */
  function serverDecl(id: string, f: Node): string[] {
    const outer = inServer;
    inServer = id;
    serverCalls.set(id, new Set());
    const lines = serverBody(f);
    inServer = outer;
    return [`server fn ${id}(${params(f)}) {`, ...indented(lines, INDENT), "}"];
  }

  function decl(s: Node, all: Node[]): string[] {
    if (s.type === "ClassDeclaration" && lookup(s.id?.name)?.kind === "error") return errorDecl(s);
    if (s.type === "FunctionDeclaration" && isServer(s)) return serverDecl(s.id.name, s);
    if (s.type === "FunctionDeclaration") {
      const h = lookup(s.id.name);
      return h?.kind === "handler" ? actionDecl(s.id.name, s) : fnDecl(s.id.name, s);
    }
    if (s.type === "TSTypeAliasDeclaration" || s.type === "TSInterfaceDeclaration") return place(text(s), lineIndent(s.start), "").split("\n");
    if (s.type === "ExpressionStatement") {
      const e = unwrap(s.expression);
      const name = callee(e);
      if (name === "createEffect") return effectDecl(e);
      // in a component's setup, "once this has settled" and "when this goes away" are an effect with no inputs (EF-4, EF-5)
      if ((name === "onSettled" || name === "onMount") && isFn(e.arguments[0]) && !e.arguments[0].params.length) return effectBlock("", e.arguments[0], new Map());
      if (name === "onCleanup" && isFn(e.arguments[0]) && !e.arguments[0].params.length) return ["effect () {", ...indented(`return ${expr(e.arguments[0])}`.split("\n"), INDENT), "}"];
      if (name === "createRenderEffect") return fail(s, "createRenderEffect: a render effect has no .rx form; effect (inputs) { … } runs after the view"), [];
      return fail(s, `${text(s).split("\n")[0]}: a statement in a component's setup has no .rx form`), [];
    }
    if (s.type !== "VariableDeclaration") return fail(s, `${s.type.replace(/Statement|Declaration/, "").toLowerCase()} in a component's setup: no .rx form in this prototype`), [];
    return s.declarations.flatMap((d: Node): string[] => {
      const init = d.init as Node | undefined;
      const name = callee(init);
      const a: Node[] = init?.arguments ?? [];
      const question = (f: Node, awaited: boolean) => {
        if (f.type === "Identifier") return asked(f);
        const e = returned(f);
        if (!e) return fail(f, "a derived value with statements: .rx equations are one expression");
        const s = expr(e);
        return awaited && !/^await\b/.test(s) && /Call/.test(unwrap(e).type) ? `await ${s}` : s;
      };
      if (d.id.type === "ArrayPattern" && name) {
        const get = d.id.elements[0]?.name as string;
        if (name === "createSignal") {
          const truth = /^(.+)\$truth$/.exec(get);
          // `createSignal(fn)`: a source with a question. The view's `x$truth` is one whose question is asked: an await
          if (isFn(a[0]) || byName(a[0])) {
            const v = paintOf(a[1]);
            // a first paint stands for an answer still to come: the question is an await
            const q = question(a[0], !!truth || !!v);
            return `source ${truth ? truth[1] : get}${typeArg(init!)} = ${q}${v ? ` -> ${expr(v)}` : ""}`.split("\n");
          }
          return `source ${get}${typeArg(init!)} := ${a[0] ? first(a[0]) : "undefined"}`.split("\n");
        }
        if (name === "createStore") {
          if (isFn(a[0])) return `source ${get}${typeArg(init!)} = ${question(a[0], false)}`.split("\n");
          return `source ${get}${typeArg(init!)} := ${a[0] ? first(a[0]) : "{}"}`.split("\n");
        }
        if (name === "createOptimistic" || name === "createOptimisticStore") {
          const e = isFn(a[0]) ? returned(a[0]) : undefined;
          // over `x$truth`: the pair is one source, declared where its truth is
          if (e && callee(e) === `${get}$truth`) return [];
          // `{ key: "id" }`: each row keeps its identity by that field (ST-4)
          const k = a[2]?.type === "ObjectExpression" ? a[2].properties.find((q: Node) => q.type === "ObjectProperty" && (q.key.name ?? q.key.value) === "key")?.value : undefined;
          const keyed = k?.type === "StringLiteral" && /^[A-Za-z_$][\w$]*$/.test(k.value) ? ` key ${k.value}` : "";
          if (isFn(a[0])) return `source ${get}${typeArg(init!)}${keyed} = ${question(a[0], false)}`.split("\n");
          // over a plain value: a source whose question is that constant, which is what can take a guess (ST-5c)
          return `source ${get}${typeArg(init!)} = ${a[0] ? expr(a[0]) : "undefined"}`.split("\n");
        }
      }
      if (d.id.type === "Identifier" && !init && lookup(d.id.name)?.kind === "mutable") return [`source ${d.id.name}${d.id.typeAnnotation ? text(d.id.typeAnnotation) : ""} := undefined`];
      if (d.id.type !== "Identifier" || !init) return fail(d, `${text(d).split("\n")[0]}: no .rx form in this prototype`), [];
      const id = d.id.name as string;
      if (name === "createContext") {
        // the default is an accessor, as the provided value is
        const dv = a[0] && isFn(a[0]) && !a[0].params.length ? returned(a[0]) : a[0];
        return `context ${contextName(id)}${typeArg(init)} ${dv ? `= ${expr(dv)}` : ""}`.trimEnd().split("\n");
      }
      if (name === "useContext") {
        const c = contextOf(a[0]);
        return c ? [`${id} = use ${c}`] : (fail(d, `${id}: useContext of something that is not a context`), []);
      }
      if (name === "createDeferred") {
        const e = returned(a[0]);
        return e ? `deferred ${id} = ${expr(e)}`.split("\n") : (fail(d, `${id}: a deferred value with statements; .rx equations are one expression`), []);
      }
      if (name === "createMemo" && byName(a[0])) return `${id} = ${asked(a[0])}`.split("\n");
      if (name === "createMemo" && caughtMemo(a[0])) {
        const { x, c } = caughtMemo(a[0])!;
        const text = expr(x);
        const tail = clause(c);
        // the await's own catch already says it: `await e -> v catch (e) => alt` is one clause
        return `${id} = ${text.endsWith(tail) ? text : `${text} ${tail}`}`.split("\n");
      }
      if (name === "createMemo" && paintOf(a[1])) {
        const e = returned(a[0]);
        if (!e) return fail(d, `${id}: a memo with statements; .rx equations are one expression`), [];
        const v = expr(paintOf(a[1])!);
        const u = unwrap(e);
        const caught = /CallExpression$/.test(u.type) && /MemberExpression$/.test(u.callee.type) && u.callee.property.name === "catch";
        if (caught) paint = v;
        let text = expr(e);
        paint = undefined;
        // a first paint stands for an answer still to come: with no await written, the call that asks it is one, on
        // whichever branch it sits
        const asked = (x: Node): string => {
          const w = unwrap(x);
          if (w.type === "ConditionalExpression") return `${expr(w.test)} ? ${asked(w.consequent)} : ${asked(w.alternate)}`;
          return /Call/.test(w.type) ? `await ${expr(w)}` : expr(w);
        };
        if (!caught) text = `${/\bawait\b/.test(text) ? text : asked(u)} -> ${v}`;
        // `i$x`: the answer a caught read of x reads, written back where it is read
        if (/^i\$[\w$]+$/.test(id)) return bind(id, { kind: "await", text }), [];
        return `${id} = ${text}`.split("\n");
      }
      if (name === "createMemo") {
        const e = returned(a[0]);
        if (!e) return fail(d, `${id}: a memo with statements; .rx equations are one expression`), [];
        // `i$x`: the answer a caught read of x reads, written back where it is read
        if (/^i\$[\w$]+$/.test(id)) {
          const t = expr(e);
          return bind(id, { kind: "await", text: /^await\b/.test(t) || !/Call/.test(unwrap(e).type) ? t : `await ${t}` }), [];
        }
        if (/\$await\d*$/.test(id)) {
          // an await under a condition is asked only on its branch: `c ? ask : undefined`, read where c holds
          const u = unwrap(e);
          const s = expr(u.type === "ConditionalExpression" && unwrap(u.alternate).type === "Identifier" && unwrap(u.alternate).name === "undefined" ? u.consequent : e);
          bind(id, { kind: "await", text: /^await\b/.test(s) ? s : `await ${s}` });
          return [];
        }
        // `x$answer`, read only by the keyed projection under it
        if (/\$answer$/.test(id) && all.some((o) => o.type === "VariableDeclaration" && o.declarations.some((p: Node) => callee(p.init) === "createProjection" && callee(returned(p.init.arguments[0])) === id))) return [];
        return `${id} = ${expr(e)}`.split("\n");
      }
      if (name === "createProjection") {
        const f = a[0];
        const key = a[2]?.type === "ObjectExpression" ? a[2].properties.find((p: Node) => p.key?.name === "key")?.value : undefined;
        if (key) {
          const e = f && returned(f);
          const inner = e && callee(e);
          const answer = inner && all.flatMap((o) => (o.type === "VariableDeclaration" ? o.declarations : [])).find((p: Node) => p.id.name === inner && /\$answer$/.test(inner));
          const of = answer ? returned(answer.init.arguments[0]) : e;
          if (!of || key.type !== "StringLiteral") return fail(d, `${id}: a keyed projection this prototype does not read`), [];
          return `${id} key ${key.value} = ${expr(of)}`.split("\n");
        }
        if (isFn(f) && f.params.length === 1 && f.params[0].type === "Identifier" && f.body.type === "BlockStatement") {
          // .rx names a draft d: the function's own name for it stands for d
          const param = f.params[0].name as string;
          if (param !== "d") aliases.set(param, { store: "d", fn: f, written: new Map() });
          drafts.add(param);
          imperative++;
          derived++;
          scopes.push(new Map([[param, { kind: "plain" } as Binding]]));
          const lines = f.body.body.flatMap(stmt);
          scopes.pop();
          derived--;
          imperative--;
          drafts.delete(param);
          aliases.delete(param);
          return [`${id} = draft(pre ${id} -> ${a[1] ? expr(a[1]) : "{}"}) {`, ...indented(lines, INDENT), "}"];
        }
        // `createProjection(() => value)`: a structured equation (ST-1), its value an object or a list
        const value = isFn(f) && (f.params.length === 0 || (f.params[0].type === "Identifier" && !uses([f.body], f.params[0].name))) ? returned(f) : undefined;
        if (value) return `${id} = ${expr(value)}`.split("\n");
        return fail(d, `${id}: a projection this prototype does not read`), [];
      }
      if (name === "action") {
        const f = a[0];
        if (!isFn(f) || f.body.type !== "BlockStatement") return fail(d, `${id}: an action needs a function with a body`), [];
        return actionDecl(id, f);
      }
      if (name === "omit") return fail(d, `${id} = omit(…): only read as the rest of a prop pattern`), [];
      if (name && /^create[A-Z]/.test(name) && lookup(name)?.kind === "plain") return fail(d, `${name}: no .rx form in this prototype`), [];
      const h = lookup(id);
      if (isServer(init)) return serverDecl(id, init);
      if (h?.kind === "server") {
        // a wrapped one: the wrapper is applied where the equation is declared
        const outer = inServer;
        inServer = id;
        serverCalls.set(id, new Set());
        const wrapped = `${id} = ${expr(init)}`.split("\n");
        inServer = outer;
        return wrapped;
      }
      if (h?.kind === "handler") return actionDecl(id, h.fn);
      if (h?.kind === "mutable") return `source ${id}${d.id.typeAnnotation ? text(d.id.typeAnnotation) : ""} := ${first(init)}`.split("\n");
      if (init.type === "Identifier" && RX_BUILTINS.has(init.name) && !lookup(init.name)) return preludeAliases.add(`${init.name} as ${id}`), [];
      if (isFn(init)) return fnDecl(id, init);
      return `${id}${d.id.typeAnnotation ? text(d.id.typeAnnotation) : ""} = ${expr(init)}`.split("\n");
    });
  }

  /** `if (c) return a; …; return d`: one expression, `c ? a : … : d`. */
  const guarded = (f: Node): string | undefined => {
    if (f.body?.type !== "BlockStatement") return;
    const steps: Node[] = f.body.body;
    const last = steps[steps.length - 1];
    if (steps.length < 2 || last?.type !== "ReturnStatement" || !last.argument) return;
    const arms: string[] = [];
    const arm = (n: Node) => (/^(Conditional|Sequence|Assignment|ArrowFunction)Expression$/.test(unwrap(n).type) ? `(${expr(n)})` : expr(n));
    for (const x of steps.slice(0, -1)) {
      const then = x.type === "IfStatement" && !x.alternate ? (x.consequent.type === "BlockStatement" && x.consequent.body.length === 1 ? x.consequent.body[0] : x.consequent) : undefined;
      if (then?.type === "ThrowStatement") {
        arms.push(`${arm(x.test)} ? throw ${expr(then.argument)}`);
        continue;
      }
      if (then?.type !== "ReturnStatement" || !then.argument) return;
      arms.push(`${arm(x.test)} ? ${arm(then.argument)}`);
    }
    return [...arms, arm(last.argument)].join(" : ");
  };
  function fnDecl(name: string, f: Node): string[] {
    if (!returned(f) && !f.async && !f.generator) {
      scopes.push(new Map(f.params.flatMap(names).map((n: string) => [n, { kind: "plain" } as Binding])));
      const g = guarded(f);
      scopes.pop();
      if (g !== undefined) {
        scopes.push(new Map(f.params.flatMap(names).map((n: string) => [n, { kind: "plain" } as Binding])));
        const out = `fn ${name}(${params(f)}) => ${guarded(f)}`.split("\n");
        scopes.pop();
        return out;
      }
    }
    const e = returned(f);
    if (!e) return fail(f, `${name}: a function with statements; .rx fn is one expression`), [];
    if (f.async || f.generator) return fail(f, `${name}: an async function; in .rx an await is written where it is read`), [];
    scopes.push(new Map(f.params.flatMap(names).map((n: string) => [n, { kind: "plain" } as Binding])));
    const out = `fn ${name}(${params(f)}) => ${expr(e)}`.split("\n");
    scopes.pop();
    return out;
  }

  const returnsJsx = (f: Node) => {
    const last = f.body.type === "BlockStatement" ? f.body.body[f.body.body.length - 1] : undefined;
    const e = last?.type === "ReturnStatement" ? last.argument : f.body.type !== "BlockStatement" ? f.body : undefined;
    return !!e && (isJsx(unwrap(e)) || unwrap(e).type === "NullLiteral");
  };

  /** A context's provider element: its .rx name, the value given, and what it wraps. */
  function provider(el: Node | undefined): { name: string; value: string; kids: Node[] } | undefined {
    if (el?.type !== "JSXElement" || el.openingElement.name.type !== "JSXIdentifier") return;
    const attrs = el.openingElement.attributes;
    const v = valueOf(attrOf(el, "value"));
    const tag = el.openingElement.name.name as string;
    // an imported component is not a context: only an import named …Context, given only a value, is read as one
    if (attrs.length !== 1 || !v || (lookup(tag)?.kind === "import" && !/Context$/.test(tag))) return;
    const c = contextOf({ ...el.openingElement.name, type: "Identifier" });
    if (!c) return;
    const f = unwrap(v);
    const value = isFn(f) && !f.params.length && returned(f) ? expr(returned(f)!) : f.type === "Identifier" && lookup(f.name)?.kind === "read" ? (reactive++, f.name) : expr(f);
    const kids = el.children.filter((k: Node) => !(k.type === "JSXText" && !k.value.trim()));
    return { name: c, value, kids };
  }
  function component(name: string, f: Node, prefix: string): string[] {
    scopes.push(new Map());
    const stmts: Node[] = f.body.type === "BlockStatement" ? f.body.body : [{ ...f.body, type: "ReturnStatement", argument: f.body }];
    const setup = stmts.slice(0, -1);
    const view = stmts[stmts.length - 1];
    declare(setup, true);
    const p = f.params[0] as Node | undefined;
    if (f.params.length > 1 || (p && p.type !== "Identifier")) fail(p ?? f, `${name}: a component takes one props parameter; destructuring it in Solid loses reactivity`);
    const pattern = propPattern(f, setup);
    let head = "";
    if (pattern) head = pattern.pattern;
    else if (p?.type === "Identifier" && uses(stmts, p.name)) head = text(p);
    if (p?.type === "Identifier") bind(p.name, { kind: "plain" });
    let at = f.body.start;
    const lines = setup.flatMap((s) => {
      const notes = leading(s, at);
      at = s.end;
      const d = pattern?.taken.has(s) ? [] : decl(s, setup);
      return d.length ? [...notes, ...d] : [];
    });
    let root = view?.type === "ReturnStatement" && view.argument ? unwrap(view.argument) : undefined;
    // `<C value={v}>…</C>` around the whole view: `provide c = v` (07)
    // the first provide is the innermost provider: read from the outside, they come last first
    const provides: string[] = [];
    for (let p = provider(root); p; p = provider(root)) {
      provides.unshift(`provide ${p.name} = ${p.value}`);
      root = p.kids.length === 1 ? p.kids[0] : { ...root!, type: "JSXFragment", children: p.kids };
    }
    lines.push(...provides);
    const out = markup(root ? (root.type === "JSXFragment" ? root.children : [root]) : []);
    if (view?.type !== "ReturnStatement") fail(view ?? f, `${name}: a component ends with one return of its markup`);
    scopes.pop();
    return [`${prefix}component ${name}(${head}) {`, ...indented(lines, INDENT), ...(lines.length && out.length ? [""] : []), ...indented(out, INDENT), "}"];
  }
  const uses = (nodes: Node[], name: string): boolean =>
    nodes.some(function has(n: Node): boolean {
      if ((n.type === "Identifier" || n.type === "JSXIdentifier") && n.name === name) return true;
      return Object.keys(n).some((k) => k !== "loc" && (Array.isArray(n[k]) ? n[k] : [n[k]]).some((c: any) => c && typeof c.type === "string" && has(c)));
    });

  // ---- the module

  const program: Node[] = ast.program.body;
  const inner = (s: Node) => (s.type === "ExportNamedDeclaration" || s.type === "ExportDefaultDeclaration" ? s.declaration : s) as Node | null;
  const declared = (d: Node): string[] => (d.type === "FunctionDeclaration" && d.id ? [d.id.name] : d.type === "VariableDeclaration" ? d.declarations.flatMap((v: Node) => names(v.id)) : []);
  const fnOf = (d: Node, name: string): Node | undefined => (d.type === "FunctionDeclaration" ? d : d.type === "VariableDeclaration" ? d.declarations.find((v: Node) => v.id.name === name)?.init : undefined);
  /** Declared async, or returning a promise it makes: a call from reactive scope is an await. */
  const isAsync = (f: Node | undefined) => {
    if (!f || (!isFn(f) && f.type !== "FunctionDeclaration")) return false;
    const r = returned(f);
    const u = r && unwrap(r);
    return !!f.async || (!!u && ((u.type === "NewExpression" && u.callee.name === "Promise") || callee(u) === "fetch"));
  };

  type Top = { s: Node; d: Node; from: number; comps: [string, Node][]; js: boolean; hook?: boolean; both?: boolean };
  const solidNames = program.filter((s) => s.type === "ImportDeclaration" && SOLID.has(s.source.value)).flatMap((s) => s.specifiers.map((sp: Node) => sp.local.name as string));
  const tops: Top[] = [];
  let defaultName = "";
  let mounted = "";
  let end = 0;
  for (const s of program) {
    const from = end;
    end = s.end;
    if (s.type === "ImportDeclaration") continue;
    const d = inner(s);
    if (!d) continue;
    if (s.type === "ExportDefaultDeclaration" && d.type === "Identifier") {
      defaultName = d.name;
      continue;
    }
    // `render(() => <App />, root)`: the entry's default component is what is mounted
    if (s.type === "ExpressionStatement" && callee(s.expression) === "render") {
      mounted = /<([A-Z][\w$]*)/.exec(text(s))?.[1] ?? "";
      continue;
    }
    const fns: [string, Node][] =
      d.type === "FunctionDeclaration" ? [[d.id?.name ?? "App", d]] : d.type === "VariableDeclaration" ? d.declarations.filter((v: Node) => isFn(v.init) && v.id.type === "Identifier").map((v: Node) => [v.id.name, v.init]) : isFn(d) ? [["App", d]] : [];
    const comps = fns.filter(([name, f]) => /^[A-Z]/.test(name) && returnsJsx(f));
    const all = comps.length && comps.length === (d.type === "VariableDeclaration" ? d.declarations.length : 1);
    if (s.type === "ExportDefaultDeclaration" && !all) {
      const left = [...new Set(text(s).match(/\b__rt\.\w+/g) ?? [])];
      fail(s, left.length ? `the view still uses the runtime (${left.join(", ")}): no Solid form to read` : "the default export is not a component");
    }
    else {
      if (s.type === "ExportDefaultDeclaration") defaultName = comps[0][0];
      tops.push({ s, d, from, comps: all ? comps : [], js: false });
    }
  }
  const decls = tops.map((t) => t.d);
  for (const s of program) {
    if (s.type !== "ImportDeclaration") continue;
    // a name another module of the program exports is what it is there: a source or a memo is read as itself (09)
    const mod = SOLID.has(s.source.value) ? undefined : opts.modules?.(s.source.value);
    const kinds = mod ? exportedKinds(mod) : undefined;
    for (const sp of s.specifiers) {
      const k = sp.type === "ImportSpecifier" ? kinds?.get(sp.imported.name) : undefined;
      if (k?.kind === "context") renamed.set(sp.local.name, k.as);
      bind(sp.local.name, SOLID.has(s.source.value) ? { kind: "plain" } : k ?? { kind: "import", from: s.source.value });
    }
  }
  declare(decls);

  // plain TypeScript with no .rx form (statements, async, new) stays TypeScript, with what it reads, in its own module
  for (const t of tops) {
    if (t.comps.length || (t.d.type !== "VariableDeclaration" && t.d.type !== "FunctionDeclaration")) continue;
    if (t.d.type === "VariableDeclaration" && t.d.declarations.some((v: Node) => /^create[A-Z]/.test(callee(v.init) ?? ""))) continue;
    const before = problems.length;
    const known = new Map(globals);
    decl(t.d, decls);
    t.js = problems.length > before || globals.size > known.size || declared(t.d).some((n) => lookup(n)?.kind === "handler");
    problems.length = before;
    globals.clear();
    for (const [k, v] of known) globals.set(k, v);
    // a function that makes signals or memos is not plain TypeScript: it cannot move, and it has no .rx form
    if (t.js && solidNames.some((n) => uses([t.d], n))) (t.js = false), (t.hook = true);
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of tops) {
      if (t.js || t.comps.length || !/^(Variable|Function)Declaration$/.test(t.d.type)) continue;
      if (t.d.type === "VariableDeclaration" && t.d.declarations.some((v: Node) => /^create[A-Z]/.test(callee(v.init) ?? ""))) continue;
      if (declared(t.d).some((n) => tops.some((o) => o.js && uses([o.d], n)))) t.js = grew = true;
    }
  }
  // a type the helpers name goes with them, and stays here too if the .rx names it
  for (const t of tops) {
    if (!/^TS(TypeAlias|Interface)Declaration$/.test(t.d.type)) continue;
    const name = t.d.id.name as string;
    if (!tops.some((o) => o.js && o !== t && uses([o.d], name))) continue;
    t.js = true;
    t.both = tops.some((o) => !o.js && uses([o.d], name));
  }
  const rxTops = tops.filter((t) => !t.js || t.both);
  const helperNames = tops.filter((t) => t.js).flatMap((t) => declared(t.d).filter((n) => uses(rxTops.map((o) => o.d), n)));
  const helperFrom = "./" + HELPERS.replace(/\.\w+$/, "");
  const asyncMembers = (d: Node, n: string) => {
    const o = d.type === "VariableDeclaration" ? d.declarations.find((v: Node) => v.id.name === n)?.init : undefined;
    const u = o && unwrap(o);
    if (u?.type !== "ObjectExpression") return;
    return new Set<string>(u.properties.filter((q: Node) => q.key?.name && (q.type === "ObjectMethod" ? q.async : isAsync(q.value))).map((q: Node) => q.key.name));
  };
  for (const t of tops) if (t.js) for (const n of declared(t.d)) bind(n, { kind: "import", from: helperFrom, async: isAsync(fnOf(t.d, n)), asyncMembers: asyncMembers(t.d, n) });

  for (const t of rxTops) if (!t.comps.length && !t.hook) for (const n of declared(t.d)) if (lookup(n)?.kind === "plain") bind(n, { kind: "equation" });
  reactive = 0;

  const comps = rxTops.flatMap((t) => t.comps.map(([name]) => name));
  // a module that exports its components by name has no default of its own
  const unnamed = rxTops.filter((t) => t.s.type !== "ExportNamedDeclaration").flatMap((t) => t.comps.map(([name]) => name));
  // a module that exports names is another module's: it has no default of its own unless it says so
  const named = program.some((st) => st.type === "ExportNamedDeclaration");
  if (!defaultName) defaultName = comps.includes(mounted) ? mounted : comps.includes("App") ? "App" : named ? "" : unnamed[unnamed.length - 1] ?? "";
  // `function Root() { return <C value={v}><App /></C> }` as the default: a module-level `provide c = v`, and App the default
  let rootOf: Node | undefined;
  const provided: string[] = [];
  const rootFn = rxTops.flatMap((t) => t.comps).find(([name]) => name === defaultName)?.[1];
  const rootBody: Node[] = rootFn?.body.type === "BlockStatement" ? rootFn.body.body : [];
  if (rootFn && !rootFn.params.length && rootBody.length === 1 && rootBody[0].type === "ReturnStatement" && rootBody[0].argument) {
    let el: Node | undefined = unwrap(rootBody[0].argument);
    const lines: string[] = [];
    for (let p = provider(el); p; p = provider(el)) lines.unshift(`provide ${p.name} = ${p.value}`), (el = p.kids.length === 1 ? unwrap(p.kids[0]) : undefined);
    const inner = el?.type === "JSXElement" && el.openingElement.selfClosing && el.openingElement.name.type === "JSXIdentifier" ? (el.openingElement.name.name as string) : "";
    const bare = el?.openingElement?.attributes.every((a: Node) => a.type === "JSXAttribute" && a.name.name === "children");
    if (lines.length && comps.includes(inner) && inner !== defaultName && bare) (rootOf = rootFn), provided.push(...lines), (defaultName = inner);
  }

  const out: string[][] = [];
  for (const t of rxTops) {
    // `x$truth` declares the source; it is exported when its optimistic layer, `x`, is
    const truth = t.d.type === "VariableDeclaration" ? (/^(.+)\$truth$/.exec(t.d.declarations[0]?.id?.elements?.[0]?.name ?? "")?.[1] ?? "") : "";
    const layer = truth && tops.some((o) => o.s.type === "ExportNamedDeclaration" && o.d.type === "VariableDeclaration" && o.d.declarations.some((v: Node) => v.id.elements?.[0]?.name === truth));
    const exported = t.s.type === "ExportNamedDeclaration" || layer ? "export " : "";
    const notes = leading(t.s, t.from);
    if (t.hook) {
      fail(t.s, `${declared(t.d).join(", ")}: Solid primitives outside a component (a custom hook) have no .rx form in this prototype`);
      for (const n of declared(t.d)) bind(n, { kind: "plain" });
    } else if (t.comps.length) {
      t.comps.forEach(([name, f], i) => out.push([...(i ? [] : notes), ...(f === rootOf ? provided : component(name, f, name === defaultName ? "export default " : exported))]));
    } else {
      const lines = decl(t.d, decls);
      if (lines.length) out.push([...notes, exported + lines[0], ...lines.slice(1)]);
    }
  }
  // one-line declarations sit together; a component stands apart
  const chunks: { text: string; single: boolean }[] = [];
  for (const lines of out) {
    const single = lines.length === 1 && !/component /.test(lines[0]);
    const prev = chunks[chunks.length - 1];
    if (single && prev?.single) prev.text += "\n" + lines[0];
    else chunks.push({ text: lines.join("\n"), single });
  }

  for (const name of askedServers) for (const local of serverCalls.get(name) ?? []) pureImports.add(local);
  const usedBy = (nodes: Node[], s: Node) => s.specifiers.some((sp: Node) => uses(nodes, sp.local.name));
  const imports: string[] = [];
  const kept: string[] = [];
  for (const s of program) {
    if (s.type !== "ImportDeclaration" || SOLID.has(s.source.value)) continue;
    const from = s.source.value as string;
    if (usedBy(tops.filter((t) => t.js).map((t) => t.d), s)) kept.push(text(s));
    if (s.importKind === "type" || !usedBy(rxTops.map((t) => t.d), s)) continue;
    if (s.specifiers.some((sp: Node) => sp.type === "ImportNamespaceSpecifier")) fail(s, "import * as: .rx imports names");
    const said = (sp: Node) => opts.declared?.(from, sp.type === "ImportSpecifier" ? sp.imported.name : "default");
    // a TypeScript type the module's .d.rx does not declare has no .rx name
    const used: Node[] = s.specifiers.filter((sp: Node) => !(sp.importKind === "type" && opts.declared && said(sp) !== "type"));
    const spec = (sp: Node) => {
      const r = (n: string) => renamed.get(sp.local.name) && n === sp.local.name ? renamed.get(n)! : renamed.has(sp.local.name) ? contextName(n) : n;
      return sp.type === "ImportSpecifier" && sp.imported.name !== sp.local.name ? `${r(sp.imported.name)} as ${r(sp.local.name)}` : r(sp.local.name);
    };
    // another .rx module is named with its extension, or the compiler looks for a JavaScript one
    const at = JSON.stringify(from.replace(/\.(tsx?|jsx?)$/, ""));
    if (opts.declared && !/\.rx$/.test(from)) {
      // the .d.rx decides: a pure fn imports pure, an io fn and a type do not
      for (const pure of [true, false]) {
        const group = used.filter((sp: Node) => (said(sp) === "pure" || (said(sp) === undefined && pureImports.has(sp.local.name))) === pure);
        const def = group.find((sp: Node) => sp.type === "ImportDefaultSpecifier");
        const named = group.filter((sp: Node) => sp.type === "ImportSpecifier").map(spec);
        if (def) imports.push(`import ${pure ? "pure " : ""}${def.local.name} from ${at}`);
        if (named.length) imports.push(`import ${pure ? "pure " : ""}{ ${named.join(", ")} } from ${at}`);
      }
      continue;
    }
    // one import statement is one purity, as it was written: pure when reactive scope reads any of its names
    const pure = !/\.rx$/.test(from) && used.some((sp: Node) => pureImports.has(sp.local.name)) ? "pure " : "";
    const def = used.find((sp: Node) => sp.type === "ImportDefaultSpecifier");
    const named = used.filter((sp: Node) => sp.type === "ImportSpecifier").map(spec);
    imports.push(`import ${pure}${def ? def.local.name : `{ ${named.join(", ")} }`} from ${at}`);
  }
  // what reactive scope reads is imported pure; the rest is io
  const helpersPure = helperNames.some((n) => pureImports.has(n));
  const pure = [...(helpersPure ? helperNames : []), ...[...globals].filter(([, p]) => p).map(([n]) => n)];
  const io = [...(helpersPure ? [] : helperNames), ...[...globals].filter(([, p]) => !p).map(([n]) => n), ...(assigns ? ["assign"] : [])];
  if (preludeAliases.size) imports.push(`import pure { ${[...preludeAliases].join(", ")} } from "./prelude"`);
  if (pure.length) imports.push(`import pure { ${pure.join(", ")} } from ${JSON.stringify(helperFrom)}`);
  if (io.length) imports.push(`import { ${io.join(", ")} } from ${JSON.stringify(helperFrom)}`);

  const files: Record<string, string> = {};
  const helpers = tops
    .filter((t) => t.js)
    .map((t) => {
      const first = comments.find((c) => c.start >= t.from && c.end <= t.s.start);
      const exported = t.s.type !== "ExportNamedDeclaration" && declared(t.d).some((n) => helperNames.includes(n));
      return src.slice(first ? first.start : t.s.start, t.s.start) + (exported ? "export " : "") + text(t.s);
    });
  if (assigns) helpers.push(`// plain JavaScript's assignment, for the .rx to call: only a source is written with :=\nexport const assign = (target: any, key: PropertyKey, value: unknown) => {\n  target[key] = value;\n};`);
  if (globals.size) helpers.push(`// what JavaScript gives every module, for the .rx to import\nexport const { ${[...globals.keys()].join(", ")} } = globalThis;`);
  if (helpers.length) files[HELPERS] = [...kept, ...(kept.length ? [""] : []), helpers.join("\n")].join("\n") + "\n";

  const head = imports.join("\n");
  return { code: [head, ...chunks.map((c) => c.text.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n"))].filter(Boolean).join("\n\n") + "\n", problems, files };
}
