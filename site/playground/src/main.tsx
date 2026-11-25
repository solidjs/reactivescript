import { render } from "@solidjs/web";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { compile, ENTRY, init, type Diagnostic } from "./compile";
import { highlight, highlightRx } from "./highlight";
import { linkLines } from "./link";
import { primsIn } from "./explain";
import { presets } from "./presets";
import { decode, encode } from "./share";
import { formatSolid, solidToRx } from "./format";
import { HELPERS, type RxProblem } from "./torx";
import { completeAt, completeAtSolid, typeAt, typeAtSolid, withImport, type Entry, type Hover } from "./hover";

const GUIDE = "https://github.com/solidjs/reactivescript/blob/main/guide/diagnostics.md";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function lineCol(text: string, line: number, column: number) {
  let i = 0;
  for (let l = 1; l < line; l++) {
    const n = text.indexOf("\n", i);
    if (n < 0) return text.length;
    i = n + 1;
  }
  return Math.min(i + column, text.length);
}

/** A textarea over its highlighted copy. */
function Editor(props: { value: string; html: string; onChange: (value: string) => void; testid: string; ref?: (el: HTMLTextAreaElement) => void; typeAt?: (offset: number) => Promise<Hover | undefined>; completeAt?: (offset: number, text: string) => Promise<{ from: number; items: Entry[] }> }) {
  let textarea!: HTMLTextAreaElement;
  let backdrop!: HTMLPreElement;
  const [tip, setTip] = createSignal<{ hover: Hover; left: number; top: number } | undefined>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let asked = -1;
  const hide = () => {
    clearTimeout(timer);
    asked = -1;
    setTip(undefined);
  };
  const syncScroll = () => {
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
    hide();
  };
  /** Where the text sits: the padding, a line's height and a character's width, measured from the backdrop. */
  const metrics = () => {
    const cs = getComputedStyle(backdrop);
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden";
    backdrop.append(probe);
    const box = probe.getBoundingClientRect();
    probe.remove();
    return { left: parseFloat(cs.paddingLeft), top: parseFloat(cs.paddingTop), line: box.height, char: box.width / 100 };
  };
  const onMove = (e: MouseEvent) => {
    if (!props.typeAt) return;
    clearTimeout(timer);
    const box = textarea.getBoundingClientRect();
    const m = metrics();
    const row = Math.floor((e.clientY - box.top + textarea.scrollTop - m.top) / m.line);
    const column = (e.clientX - box.left + textarea.scrollLeft - m.left) / m.char;
    const lines = props.value.split("\n");
    // a tab is as wide as the tab-size, so columns are counted, not characters
    let at = 0;
    let width = 0;
    const text = lines[row] ?? "";
    while (at < text.length && width + (text[at] === "\t" ? 2 - (width % 2) : 1) <= column) width += text[at++] === "\t" ? 2 - (width % 2) : 1;
    if (row < 0 || row >= lines.length || column < 0 || at >= text.length || !/[\w$.]/.test(text[at])) return hide();
    const offset = lines.slice(0, row).reduce((n, l) => n + l.length + 1, 0) + at;
    const shown = tip();
    if (shown && offset >= shown.hover.start && offset < shown.hover.start + shown.hover.length) return;
    timer = setTimeout(async () => {
      asked = offset;
      const hover = await props.typeAt!(offset).catch(() => undefined);
      if (asked !== offset) return;
      if (!hover) return setTip(undefined);
      const before = props.value.slice(0, hover.start);
      const line = before.split("\n").length - 1;
      const col = [...before.slice(before.lastIndexOf("\n") + 1)].reduce((w, c) => w + (c === "\t" ? 2 - (w % 2) : 1), 0);
      setTip({ hover, left: Math.max(4, m.left + col * m.char - textarea.scrollLeft), top: m.top + (line + 1) * m.line - textarea.scrollTop + 4 });
    }, 180);
  };
  // what can be written at the caret, as a list under it
  const [menu, setMenu] = createSignal<{ from: number; to: number; items: Entry[]; index: number; left: number; top: number } | undefined>();
  let suggesting: ReturnType<typeof setTimeout> | undefined;
  let wanted = 0;
  let list: HTMLUListElement | undefined;
  createEffect(
    () => menu()?.index,
    (index) => {
      if (index !== undefined) list?.children[index]?.scrollIntoView({ block: "nearest" });
    },
  );
  const close = () => {
    clearTimeout(suggesting);
    wanted++;
    setMenu(undefined);
  };
  /** Where an offset of `text` is drawn, in the editor's box. */
  const place = (text: string, offset: number) => {
    const m = metrics();
    const before = text.slice(0, offset);
    const col = [...before.slice(before.lastIndexOf("\n") + 1)].reduce((w, c) => w + (c === "\t" ? 2 - (w % 2) : 1), 0);
    return { left: Math.max(4, m.left + col * m.char - textarea.scrollLeft), top: m.top + before.split("\n").length * m.line - textarea.scrollTop + 2 };
  };
  const suggest = (force = false) => {
    if (!props.completeAt) return;
    clearTimeout(suggesting);
    suggesting = setTimeout(async () => {
      const text = textarea.value;
      const at = textarea.selectionStart;
      if (at !== textarea.selectionEnd) return close();
      // after a dot, or inside a word; anywhere when asked for
      if (!force && !/[\w$.]/.test(text[at - 1] ?? "")) return close();
      const mine = ++wanted;
      const found = await props.completeAt!(at, text).catch(() => undefined);
      if (mine !== wanted) return;
      if (!found?.items.length || textarea.selectionStart !== at) return setMenu(undefined);
      hide();
      setMenu({ from: found.from, to: at, items: found.items, index: 0, ...place(text, found.from) });
    }, 90);
  };
  const accept = (item: Entry) => {
    const m = menu();
    if (!m) return;
    let text = textarea.value.slice(0, m.from) + item.name + textarea.value.slice(m.to);
    let caret = m.from + item.name.length;
    if (item.importFrom) {
      const added = withImport(text, item.name, item.importFrom);
      text = added.text;
      if (added.at <= caret) caret += added.shift;
    }
    close();
    props.onChange(text);
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  };
  const onKey = (e: KeyboardEvent) => {
    const m = menu();
    if (m) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        return void setMenu({ ...m, index: (m.index + (e.key === "ArrowDown" ? 1 : m.items.length - 1)) % m.items.length });
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        return accept(m.items[m.index]);
      }
      if (e.key === "Escape") return close();
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") close();
    }
    if (e.key === " " && e.ctrlKey) {
      e.preventDefault();
      return suggest(true);
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end, value } = textarea;
      props.onChange(value.slice(0, s) + "  " + value.slice(end));
      queueMicrotask(() => textarea.setSelectionRange(s + 2, s + 2));
    }
  };
  return (
    <div class="editor">
      <pre class="backdrop" aria-hidden="true" ref={backdrop} innerHTML={props.html + "\n"} />
      <textarea
        ref={(el) => {
          textarea = el;
          props.ref?.(el);
        }}
        data-testid={props.testid}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        value={props.value}
        onInput={(e) => (hide(), props.onChange(e.currentTarget.value), suggest())}
        onScroll={() => (syncScroll(), close())}
        onKeyDown={onKey}
        onMouseMove={onMove}
        onMouseLeave={hide}
        onMouseDown={close}
        onBlur={close}
      />
      <Show when={menu()}>
        {(m) => (
          <ul class="complete" data-testid="complete" ref={list} style={{ left: `${m().left}px`, top: `${m().top}px` }}>
            <For each={m().items} keyed={false}>
              {(item, i) => (
                // mousedown, and no focus taken: the caret stays where the name goes
                <li class={i === m().index ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), accept(item()))}>
                  <span>{item().name}</span>
                  <i>{item().kind === "const" || item().kind === "let" || item().kind === "var" ? "name" : item().kind}</i>
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
      <Show when={tip()}>
        {(t) => (
          <div class="hover" data-testid="hover" style={{ left: `${t().left}px`, top: `${t().top}px` }}>
            <pre innerHTML={highlight(t().hover.text, "javascript")} />
            <Show when={t().hover.doc}>
              <p>{t().hover.doc}</p>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

const SAMPLE_SOLID = `import { createSignal, createMemo } from "solid-js";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return <button onClick={() => setCount(count() + 1)}>{doubled()}</button>;
}
`;

/** Solid 2.0 on the left, the same program as .rx on the right (torx.ts), checked by the compiler. */
function FromSolid(props: { source: string; onChange: (value: string) => void; files: Record<string, string>; ready: boolean; hidden: boolean; views: Record<string, string>; onRx: (r: { of: string; code: string; files: Record<string, string> }) => void }) {
  const [out, setOut] = createSignal<{ of: string; code: string; problems: RxProblem[]; files: Record<string, string> }>({ of: "", code: "", problems: [], files: {} });
  createEffect(
    () => [props.source, props.views] as const,
    ([source, views]) => {
      solidToRx(source, views).then((r) => {
        if (props.source !== source) return;
        setOut({ of: source, ...r });
        props.onRx({ of: source, code: r.problems.length ? "" : r.code, files: r.files });
      });
    },
  );
  const current = () => out().of === props.source;
  const rx = () => (current() ? out().code : "");
  const problems = () => (current() ? out().problems : []);
  const helpers = () => Object.entries(current() ? out().files : {});
  // the checker's word on the .rx, with the declaration files of the program in the other mode
  const checked = createMemo(() => (props.ready && rx() && !problems().length ? compile({ ...props.files, ...out().files, "main.rx": rx() }, "dom") : undefined));
  const diagnostics = () => (checked()?.diagnostics ?? []).filter((d) => d.file === ENTRY);
  const html = createMemo(() => {
    const bad = new Set(problems().map((p) => p.line));
    return props.source
      .split("\n")
      .map((l, i) => `<span class="eline${bad.has(i + 1) ? " bad" : ""}">${highlight(l, "javascript") || " "}</span>`)
      .join("\n");
  });
  let textarea!: HTMLTextAreaElement;
  const goTo = (line: number) => {
    const start = lineCol(props.source, line, 0);
    textarea.focus();
    textarea.setSelectionRange(start, lineCol(props.source, line + 1, 0) - 1);
  };
  return (
    <main class="grid" hidden={props.hidden}>
      <section class="pane editor-pane">
        <div class="tabs">
          <span class="tab on">
            <button type="button">App.tsx</button>
          </span>
        </div>
        <Editor
          value={props.source}
          html={html()}
          onChange={props.onChange}
          testid="solid-editor"
          ref={(el) => (textarea = el)}
          typeAt={(offset) => typeAtSolid(props.source, props.files, offset)}
          completeAt={(offset, text) => completeAtSolid(text, props.files, offset)}
        />
        <div class="diags" data-testid="rx-problems">
          <div class="label">
            Not converted <span class={`count${problems().length ? " bad" : ""}`}>{problems().length}</span>
          </div>
          <Show when={problems().length} fallback={<p class="ok">{current() ? "Every form here has an .rx reading." : ""}</p>}>
            <ul>
              <For each={problems()} keyed={false}>
                {(p) => (
                  <li>
                    <button type="button" class="where" onClick={() => goTo(p().line)}>
                      App.tsx:{p().line}
                    </button>
                    <span class="msg">{p().message}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </section>

      <section class="pane out-pane">
        <div class="out-head">
          <span class="label">ReactiveScript</span>
          <span class="hint">the same program as .rx; a prototype that lists what it cannot read</span>
        </div>
        <Show when={problems().length}>
          <p class="stale-note">Some of this has no .rx form yet, so the result is incomplete.</p>
        </Show>
        <div class="output">
          <pre class="code" data-testid="rx-out" innerHTML={highlightRx(rx())} />
          <For each={helpers()}>
            {([name, code]) => (
              <div class="explain" data-testid="rx-helpers">
                <div class="label">
                  {name} <span class="hint">plain TypeScript stays TypeScript; the .rx imports it</span>
                </div>
                <pre class="code helper" innerHTML={highlight(code, "javascript")} />
              </div>
            )}
          </For>
          <Show when={checked()}>
            <div class="explain" data-testid="rx-check">
              <div class="label">
                The checker on this .rx <span class={`count${diagnostics().length ? " bad" : ""}`}>{diagnostics().length}</span>
              </div>
              <Show when={diagnostics().length} fallback={<p class="ok">The checker accepts it.</p>}>
                <ul class="checks">
                  <For each={diagnostics()} keyed={false}>
                    {(d) => (
                      <li>
                        <span class="where">main.rx:{d().line ?? "?"}</span>
                        <a class="code" href={`${GUIDE}#${d().code.toLowerCase()}`} target="_blank" rel="noopener">
                          {d().code}
                        </a>
                        <span class="rule">[{d().rule}]</span>
                        <span class="msg">{d().message}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>
        </div>
      </section>
    </main>
  );
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  // the Clipboard API exists only on https and localhost; a LAN address over http needs the old copy command
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.append(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

function Playground(props: { initial: { files: Record<string, string>; active: string; preset?: string; solid?: string }; compiler: Promise<void> }) {
  const [files, setFiles] = createSignal<Record<string, string>>(props.initial.files);
  const [active, setActive] = createSignal(props.initial.active);
  const [preset, setPreset] = createSignal(props.initial.preset ?? "");
  const [copied, setCopied] = createSignal("");
  const [mode, setMode] = createSignal<"rx" | "solid">(props.initial.solid === undefined ? "rx" : "solid");
  const [solidSource, setSolidSource] = createSignal(props.initial.solid ?? "");

  // "loading", "ready", or why the compiler did not load
  const [compiler, setCompiler] = createSignal("loading");
  props.compiler.then(
    () => setCompiler("ready"),
    (e) => setCompiler(String(e?.message ?? e)),
  );
  const ready = () => compiler() === "ready";
  const result = createMemo(() => (ready() ? compile(files(), "dom") : { diagnostics: [], app: {}, ms: 0 }));
  const lastGood = createMemo<ReturnType<typeof compile> | undefined>((prev) => (result().app.modules ? result() : prev));
  const stale = () => ready() && !result().app.modules;
  const diagnostics = () => result().diagnostics;
  const failure = () => result().app.error;
  const modules = createMemo(() =>
    Object.entries(lastGood()?.app.modules ?? {})
      .sort(([a], [b]) => Number(b === ENTRY) - Number(a === ENTRY))
      .map(([p, m]) => ({ path: p, jsx: m.jsx ?? "" })),
  );
  const rawJsx = createMemo(() => modules().map((m) => m.jsx).join("\n\n"));
  const [solid, setSolid] = createSignal<{ raw: string; code: string; error?: string }>({ raw: "", code: "" });
  createEffect(
    () => [rawJsx(), modules()] as const,
    ([raw, mods]) => {
      Promise.all(mods.map((m) => formatSolid(m.jsx).then((r) => ({ ...r, path: m.path }))))
        .then(
          (rs) =>
            rawJsx() === raw &&
            setSolid({ raw, code: rs.map((r) => (r.path === ENTRY ? r.code : `// ${r.path}\n${r.code}`)).join("\n"), error: rs.find((r) => r.error)?.error }),
        )
        .catch((e) => rawJsx() === raw && setSolid({ raw, code: raw, error: String(e?.message ?? e) }));
    },
  );
  const shown = () => (solid().raw === rawJsx() ? solid().code : "");
  // the Solid view of each .rx module, by file name: the converter reads what another module exports from it
  const moduleViews = createMemo(() => {
    const out: Record<string, string> = {};
    let name = ENTRY.replace(/^\//, "");
    let lines: string[] = [];
    for (const l of shown().split("\n")) {
      const h = /^\/\/ \/(\S+\.rx)$/.exec(l);
      if (!h) {
        lines.push(l);
        continue;
      }
      out[name] = lines.join("\n");
      name = h[1];
      lines = [];
    }
    out[name] = lines.join("\n");
    return out;
  });
  // each view line's .rx line, where it can be told: a click there selects it in the editor
  const links = createMemo(() => linkLines(shown(), files()));
  const [picked, setPicked] = createSignal(-1);
  const codeHtml = createMemo(() =>
    shown()
      .split("\n")
      .map((l, i) => {
        const at = links()[i];
        const cls = `cl${at ? " link" : ""}${picked() === i ? " on" : ""}`;
        return `<div class="${cls}"${at ? ` data-l="${i}" title="${esc(at.file)}:${at.line}"` : ""}>${highlight(l, "javascript") || " "}</div>`;
      })
      .join(""),
  );
  const prims = createMemo(() => primsIn(shown()));

  const text = () => files()[active()] ?? "";
  const editLines = createMemo(() => {
    const mine = diagnostics().filter((d) => d.file === "/" + active() && d.line);
    const bad = new Set(mine.map((d) => d.line!));
    const t = text();
    // a problem's own span, or the word at its start when the span is empty
    const marks = mine.flatMap((d): [number, number][] => {
      if (!d.range) return [];
      const s = lineCol(t, d.range.start.line, d.range.start.column);
      const e = lineCol(t, d.range.end.line, d.range.end.column);
      return [[s, e > s ? e : s + Math.max(1, /^[\w$]*/.exec(t.slice(s))![0].length)]];
    });
    return highlightRx(t, marks)
      .split("\n")
      .map((l, i) => `<span class="eline${bad.has(i + 1) ? " bad" : ""}">${l || " "}</span>`)
      .join("\n");
  });

  let textarea!: HTMLTextAreaElement;

  const update = (value: string) => {
    setFiles({ ...files(), [active()]: value });
    setPreset("");
  };
  const loadPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setFiles({ ...p.files });
    setActive("main.rx");
    setPreset(id);
    setMode("rx");
  };
  // the .rx read from the Solid side, kept for turning the page back; none when the reading left something out
  let converted: { of: string; code: string; files: Record<string, string> } | undefined;
  const toggleMode = () => {
    // each way round, the editor gets the program the other side showed: the Solid view, or the .rx read from it
    if (mode() === "rx") setSolidSource(shown().split(/\n\/\/ \/[^\n]*\n/)[0] || SAMPLE_SOLID);
    else if (converted && converted.of === solidSource() && converted.code.trim()) {
      const next: Record<string, string> = { ...files(), ...converted.files, "main.rx": converted.code };
      if (!(HELPERS in converted.files)) delete next[HELPERS];
      setFiles(next);
      setActive("main.rx");
      setPreset("");
    }
    setMode(mode() === "rx" ? "solid" : "rx");
  };
  const goTo = (d: Diagnostic) => {
    const name = d.file.replace(/^\//, "");
    if (name in files()) setActive(name);
    queueMicrotask(() => {
      const t = files()[active()] ?? "";
      const start = d.range ? lineCol(t, d.range.start.line, d.range.start.column) : lineCol(t, d.line ?? 1, 0);
      const end = d.range ? lineCol(t, d.range.end.line, d.range.end.column) : start;
      textarea.focus();
      textarea.setSelectionRange(start, Math.max(end, start));
    });
  };
  const pickLine = (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".cl[data-l]");
    const at = el ? links()[Number(el.dataset.l)] : undefined;
    if (!el || !at) return;
    setPicked(Number(el.dataset.l));
    if (at.file in files()) setActive(at.file);
    queueMicrotask(() => {
      const t = files()[active()] ?? "";
      const start = lineCol(t, at.line, 0);
      const end = t.indexOf("\n", start);
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(start, end < 0 ? t.length : end);
      const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
      textarea.scrollTop = Math.max(0, (at.line - 1) * lh - textarea.clientHeight / 3);
    });
  };
  const addFile = () => {
    const name = prompt("New file name (an .rx module, a .d.rx declaration, or a .js module):", "util.rx");
    if (!name || name in files() || !/^[\w./-]+\.(rx|js|mjs)$/.test(name)) return;
    setPreset("");
    setFiles({ ...files(), [name]: name.endsWith(".d.rx") ? "export pure fn load()\n" : name.endsWith(".rx") ? "export n = 1\n" : "export const n = 1;\n" });
    setActive(name);
  };
  const removeFile = (name: string) => {
    if (name === "main.rx" || !confirm(`Remove ${name}?`)) return;
    const next = { ...files() };
    delete next[name];
    setPreset("");
    setFiles(next);
    setActive("main.rx");
  };
  const share = async () => {
    const hash = await encode({ files: files(), active: active(), solid: mode() === "solid" ? solidSource() : undefined });
    history.replaceState(null, "", "#" + hash);
    setCopied((await copyText(location.href)) ? "Link copied" : "Copy the address bar");
    setTimeout(() => setCopied(""), 2000);
  };

  // the URL keeps the program, so a reload or a shared link opens it again
  let hashTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    () => [files(), active(), preset(), mode() === "solid" ? solidSource() : undefined] as const,
    ([f, a, p, s]) => {
      clearTimeout(hashTimer);
      hashTimer = setTimeout(async () => {
        // the Solid → .rx side is kept too, so a reload opens the page the same way round
        const hash = p && s === undefined ? `example=${p}` : await encode({ files: f, active: a, solid: s });
        history.replaceState(null, "", "#" + hash);
      }, 300);
    },
  );

  return (
    <div class="shell">
      <header class="bar">
        <a class="brand" href="https://reactivescript.dev/" target="_blank" rel="noopener">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width="28" height="28" />
          <span>
            ReactiveScript <b>Playground</b>
          </span>
        </a>
        <label class="field">
          <span>Example</span>
          <select data-testid="example" value={preset()} onChange={(e) => loadPreset(e.currentTarget.value)}>
            <option value="" disabled>
              (edited)
            </option>
            <For each={presets}>{(p) => <option value={p.id}>{p.title}</option>}</For>
          </select>
        </label>
        <button type="button" class="btn" data-testid="mode" onClick={toggleMode}>
          {mode() === "rx" ? "Solid → .rx" : ".rx → Solid"}
        </button>
        <span class="spacer" />
        <span class="ms" data-testid="ms">
          {ready() ? `${result().ms.toFixed(1)} ms` : ""}
        </span>
        <button type="button" class="btn primary" onClick={share}>
          {copied() || "Share"}
        </button>
      </header>

      <Show when={mode() === "rx"} fallback={<p class="blurb">Paste Solid 2.0 on the left to read it as ReactiveScript. The compiler then checks the result.</p>}>
        <Show when={presets.find((p) => p.id === preset())}>{(p) => <p class="blurb">{p().blurb}</p>}</Show>
      </Show>

      <FromSolid source={solidSource()} onChange={setSolidSource} files={files()} ready={ready()} hidden={mode() !== "solid"} views={moduleViews()} onRx={(r) => (converted = r)} />
      <main class="grid" hidden={mode() !== "rx"}>
        <section class="pane editor-pane">
          <div class="tabs">
            <For each={Object.keys(files())}>
              {(name) => (
                <span class={`tab${active() === name ? " on" : ""}`}>
                  <button type="button" onClick={() => setActive(name)}>
                    {name}
                  </button>
                  <Show when={name !== "main.rx"}>
                    <button type="button" class="x" title={`Remove ${name}`} onClick={() => removeFile(name)}>
                      ×
                    </button>
                  </Show>
                </span>
              )}
            </For>
            <button type="button" class="tab add" title="Add a file" onClick={addFile}>
              +
            </button>
          </div>
          <Editor value={text()} html={editLines()} onChange={update} testid="editor" ref={(el) => (textarea = el)} typeAt={(offset) => typeAt(files(), active(), offset)} completeAt={(offset, text) => completeAt({ ...files(), [active()]: text }, active(), offset)} />
          <div class="diags" data-testid="diagnostics">
            <div class="label">
              Diagnostics <span class={`count${diagnostics().length ? " bad" : ""}`}>{diagnostics().length}</span>
            </div>
            <Show when={diagnostics().length || failure()} fallback={<p class={ready() ? "ok" : "loading"}>{ready() ? "The checker accepts the program." : ""}</p>}>
              <Show when={failure()}>{(f) => <pre class="err">{f()}</pre>}</Show>
              <ul>
                <For each={diagnostics()} keyed={false}>
                  {(d) => (
                    <li>
                      <button type="button" class="where" onClick={() => goTo(d())}>
                        {d().file.replace(/^\//, "")}:{d().range ? `${d().range!.start.line}:${d().range!.start.column + 1}` : d().line ?? "?"}
                      </button>
                      <a class="code" href={`${GUIDE}#${d().code.toLowerCase()}`} target="_blank" rel="noopener" data-testid="diag-code">
                        {d().code}
                      </a>
                      <span class="rule">[{d().rule}]</span>
                      <span class="msg">{d().message}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </section>

        <section class="pane out-pane">
          <div class="out-head">
            <span class="label">Solid primitives</span>
            <span class="hint">what the compiler's __rt calls are in Solid 2.0, for reading</span>
          </div>
          <Show when={stale() && lastGood()}>
            <p class="stale-note">Not compiled: showing the last output that compiled.</p>
          </Show>
          <Show when={solid().raw === rawJsx() && solid().error}>
            <p class="stale-note" data-testid="solid-error">
              Could not write this as Solid primitives ({solid().error}); showing the compiler's JSX instead.
            </p>
          </Show>
          <div class={`output${stale() ? " stale" : ""}`}>
            <Show when={!ready()}>
              <div class="loading" data-testid="loading">
                <Show when={compiler() !== "loading"} fallback={<p>Loading the compiler…</p>}>
                  <p>The compiler did not load.</p>
                  <pre class="err">{compiler()}</pre>
                  <button type="button" class="btn" onClick={() => location.reload()}>
                    Retry
                  </button>
                </Show>
              </div>
            </Show>
            <pre class="code" data-testid="solid" innerHTML={codeHtml()} onClick={pickLine} />
            <Show when={prims().length}>
              <div class="explain">
                <div class="label">What each primitive stands for in .rx</div>
                <table class="map" data-testid="explain">
                  <thead>
                    <tr>
                      <th>Solid</th>
                      <th>written in .rx as</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={prims()} keyed={false}>
                      {(p) => (
                        <tr>
                          <td>
                            <code>{p().name}</code>
                          </td>
                          <td>{p().from}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </div>
        </section>
      </main>
    </div>
  );
}

async function start() {
  const compiler = init();
  const fromHash = await decode(location.hash);
  const featured = presets.find((p) => p.id === (fromHash?.preset ?? "await")) ?? presets[0];
  const initial = fromHash?.files
    ? { files: fromHash.files, active: fromHash.active in fromHash.files ? fromHash.active : "main.rx", solid: fromHash.solid }
    : { files: { ...featured.files }, active: "main.rx", preset: featured.id };
  const root = document.getElementById("app")!;
  root.textContent = "";
  render(() => <Playground initial={initial} compiler={compiler} />, root);
}

start().catch((e) => {
  const root = document.getElementById("app")!;
  root.innerHTML = `<div class="loading"><p>The playground did not start.</p><pre class="err"></pre></div>`;
  root.querySelector("pre")!.textContent = String(e?.message ?? e);
});
