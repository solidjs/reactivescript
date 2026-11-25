import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("xml", xml);

export const highlight = (code: string, language: "javascript") => hljs.highlight(code, { language, ignoreIllegals: true }).value;

const RX_KEYWORDS = new Set(
  "source|component|action|effect|export|default|import|pure|from|if|else|for|in|await|loading|errored|fallback|guess|affects|refresh|latest|pending?|peek|pre|deferred|key|draft|let|try|catch|throw|error|fn|type|on|portal|onFlush|until|server|client|return|true|false|null|rejects".split("|"),
);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A light colouring of .rx for the editor's backdrop: comments, strings, keywords, :=, tags. Each `[start, end)` of
 *  `marks` is underlined, a problem's span. */
export function highlightRx(src: string, marks: [number, number][] = []) {
  const TOKEN = /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)|(:=)|(<\/?[A-Za-z][\w.-]*)|([A-Za-z_$][\w$]*\??)|([^"`/<:A-Za-z_$]+|.)/gs;
  const marked = (t: string, at: number) => {
    const cuts = new Set([0, t.length]);
    for (const [s, e] of marks) for (const c of [s - at, e - at]) if (c > 0 && c < t.length) cuts.add(c);
    const at2 = [...cuts].sort((a, b) => a - b);
    let s = "";
    // a newline stays outside the underline, so each editor line keeps its own spans
    for (let i = 0; i + 1 < at2.length; i++) {
      const part = t.slice(at2[i], at2[i + 1]);
      const on = marks.some(([ms, me]) => ms <= at + at2[i] && at + at2[i] < me);
      s += on ? part.split("\n").map((p) => (p ? `<span class="sq">${esc(p)}</span>` : "")).join("\n") : esc(part);
    }
    return s;
  };
  let out = "";
  for (const m of src.matchAll(TOKEN)) {
    const [t, comment, str, assign, tag, word] = m;
    const x = marked(t, m.index ?? 0);
    if (comment) out += `<span class="hl-c">${x}</span>`;
    else if (str) out += `<span class="hl-s">${x}</span>`;
    else if (assign) out += `<span class="hl-w">${x}</span>`;
    else if (tag) out += `<span class="hl-t">${x}</span>`;
    else if (word) out += RX_KEYWORDS.has(t) ? `<span class="hl-k">${x}</span>` : x;
    else out += x;
  }
  return out;
}
