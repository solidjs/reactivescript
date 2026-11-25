
/** The `.rx` form each Solid primitive in the view stands for (spec/11 CP-4b, @reactivescript/runtime). */
export const SOLID_PRIMS: Record<string, string> = {
  createSignal: "source x := e (ST-1); for source x = await …, its truth (ST-5)",
  createStore: "source x := […] or {…}: structured, a store (ST-2a)",
  createOptimistic: "source x = … that an action guesses (AC-3)",
  createOptimisticStore: "a keyed or structured source an action guesses by row (AC-3)",
  createMemo: "an equation x = e (E-1), and each hoisted await (R-1)",
  createProjection: "x key k = e (ST-4), and x = draft(pre x -> seed) { … } (ST-3)",
  action: "action f(…) { … } (AC-1): each await is a yield",
  affects: "affects x (AC-5)",
  refresh: "refresh x (AC-4)",
  untrack: "a read in imperative scope: a snapshot (H-10)",
  omit: "{ a, ...rest }: a rest of a destructured value, a live view of the other fields (RG-4b)",
  latest: "latest x (R-12)",
  isPending: "pending? x (R-9)",
  onFlush: "onFlush(() => { … }) (EF-8)",
  createDeferred: "deferred x = e: an equation that lags its inputs on purpose (V-16)",
  createEffect: "effect (a, b) { … }: the inputs it runs for, then what it does with them ($0, $1) (EF-1)",
  onSettled: "onSettled (EF-7)",
  until: "until (AC-6)",
  Errored: "errored fallback(e) { … } { … } (R-f-4)",
  Loading: "loading fallback { … } { … }",
  Show: "if c { … } else { … }",
  For: "for x in xs { … }",
  Repeat: "for i in 0..n { … }",
};

export function primsIn(code: string): { name: string; from: string }[] {
  const m = /^import \{([^}]*)\} from "solid-js";/m.exec(code);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((n) => SOLID_PRIMS[n])
    .map((name) => ({ name, from: SOLID_PRIMS[name] }));
}
