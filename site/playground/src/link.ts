// Which .rx line each line of the Solid view came from: a declaration by its name, a block by its place among the
// module's blocks of that kind. The view is rewritten text, so this is what survives it.

export type Link = { file: string; line: number };

const esc = (s: string) => s.replace(/\$/g, "\\$");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What a view line declares or opens: a name to find, or the nth block of a kind. */
function target(line: string): { name: string; provide?: boolean } | { block: string } | undefined {
  const l = line.replace(/^\s*(?:export\s+(?:default\s+)?)?/, "");
  let m: RegExpExecArray | null;
  if ((m = /^const \[(\w+?)(?:\$truth)?, \w+\] = create(?:Signal|Store|OptimisticStore|Optimistic)\(/.exec(l))) return { name: m[1] };
  if ((m = /^const (\w+)Context = createContext\(/.exec(l))) return { name: lower(m[1]) };
  if ((m = /^const (?:i\$)?(\w+?)(?:\$await\d*|\$answer)? = (?:createMemo|createDeferred|createProjection|omit|useContext|action)\(/.exec(l))) return { name: m[1] };
  if ((m = /^(?:async )?function (\w+)\(/.exec(l))) return { name: m[1] };
  if ((m = /^class (\w+) extends Error\b/.exec(l))) return { name: m[1] };
  if ((m = /^<(\w+)Context value=/.exec(l))) return { name: lower(m[1]), provide: true };
  if (/^createEffect\(/.test(l)) return { block: "effect" };
  if ((m = /^<(Errored|Loading|Show|For)\b/.exec(l))) return { block: { Errored: "errored", Loading: "loading", Show: "if", For: "for" }[m[1]]! };
}

// a block nested in another is written without its own `{`; an `if (` with a parenthesis is a statement, not markup
const BLOCK: Record<string, RegExp> = {
  errored: /\{errored\b|^[ \t]*errored\b/gm,
  loading: /\{loading\b|^[ \t]*loading\b/gm,
  if: /\{if\b|^[ \t]*if[ \t]+(?!\()/gm,
  for: /\{for\b|^[ \t]*for[ \t]+[\w$]+[ \t]+in\b/gm,
  effect: /^[ \t]*effect\b/gm,
};

/** The 1-based line of `at` in `src`. */
const lineOf = (src: string, at: number) => src.slice(0, at).split("\n").length;

/** One entry per line of `view`: where in which .rx module it was written, when that can be told. */
export function linkLines(view: string, files: Record<string, string>, entry = "main.rx"): (Link | undefined)[] {
  let file = entry;
  const seen = new Map<string, number>();
  return view.split("\n").map((line) => {
    const header = /^\/\/ \/(\S+\.rx)$/.exec(line);
    if (header) {
      file = header[1];
      seen.clear();
      return { file, line: 1 };
    }
    const src = files[file];
    const t = src === undefined ? undefined : target(line);
    if (!t || src === undefined) return;
    if ("block" in t) {
      const n = seen.get(t.block) ?? 0;
      seen.set(t.block, n + 1);
      const hit = [...src.matchAll(BLOCK[t.block])][n];
      return hit ? { file, line: lineOf(src, hit.index ?? 0) } : undefined;
    }
    const n = esc(t.name);
    const forms = t.provide
      ? [new RegExp(`^[ \\t]*provide[ \\t]+${n}\\b`, "m")]
      : [
          new RegExp(`^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:source|deferred|action|component|error|context|server[ \\t]+fn|fn)[ \\t]+${n}\\b`, "m"),
          new RegExp(`^[ \\t]*(?:export[ \\t]+)?${n}\\b[^=\\n]*?[^:=!<>]=(?!=)`, "m"),
        ];
    for (const r of forms) {
      const hit = r.exec(src);
      if (hit) return { file, line: lineOf(src, hit.index + (/^\s*/.exec(hit[0])![0].length)) };
    }
  });
}
