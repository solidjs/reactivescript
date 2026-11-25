/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Show, Loading, Errored, action, createMemo, createSignal, createOptimistic, flush, refresh } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
type C = { id: number };

test("a row mounted while a guess is held keeps a stale attribute when a later guess changes the memo it reads", async () => {
  const asks: any[] = [];
  const ask = (k: string) => new Promise<any>((res, rej) => asks.push({ k, res, rej }));
  const find = (k: string) => asks.splice(asks.findIndex(a => a.k === k), 1)[0];
  const list = (k: string) => {
    const [truth] = createSignal<C[]>(async () => await ask(k));
    const [shown, guess] = createOptimistic(() => truth());
    return { truth, shown, guess };
  };
  const c = document.body.appendChild(document.createElement("div"));
  let api: any;
  function Board() {
    const todo = list("todo"), doing = list("doing"), done = list("done");
    const L: any = { todo, doing, done };
    const full = createMemo(() => doing.shown().length >= 3);
    const [sel, setSel] = createSignal<number | null>(null);
    const selCol = createMemo(() => sel() == null ? null : todo.shown().some(x => x.id === sel()) ? "todo" : doing.shown().some(x => x.id === sel()) ? "doing" : "done");
    const selCard = createMemo(() => selCol() == null ? null : (L[selCol()!].shown() as C[]).find(x => x.id === sel()));
    const move = action(function* (id: number, from: string, to: string, index: number) {
      L[from].guess((rs: C[]) => rs.filter(x => x.id !== id));
      L[to].guess((rs: C[]) => { const n = [...rs]; n.splice(index, 0, { id }); return n; });
      yield ask(`move:${id}`);
      refresh(L[from].truth); refresh(L[to].truth);
    });
    api = { todo, full, setSel, move };
    const Column = (p: { col: string }) => <Loading fallback="L">
      <Errored fallback={`${p.col}:E `}>
        {p.col}:<For each={L[p.col].shown()}>{(r: C) => <i>{r.id}{p.col === "todo" ? <button disabled={full()}>r</button> : null}</i>}</For>{" "}
      </Errored>
    </Loading>;
    return <>
      <Column col="todo" /><Column col="doing" /><Column col="done" />
      <Show when={selCard()} fallback="pick">#{sel()} in {selCol()}</Show>
    </>;
  }
  render(() => <Board />, c);
  const disabled = () => [...c.querySelectorAll("button")].map(b => b.disabled);
  await tick();
  find("doing").res([{ id: 3 }, { id: 4 }]); await tick();
  find("todo").rej(new Error("declined")); await tick();
  find("done").res([{ id: 5 }]); await tick();
  api.setSel(5); await tick();
  refresh(api.todo.truth); await tick();                 // retry To do
  api.move(5, "done", "doing", 2); await tick();         // Doing 3, 4, 5 (its answer never comes)
  api.move(3, "doing", "done", 0); await tick();         // Doing 4, 5
  find("todo").res([{ id: 1 }, { id: 2 }]); await tick();   // To do's rows mount now
  find("move:3").res({}); await tick();                  // re-asks Doing and Done (left out)
  find("todo").res([{ id: 1 }, { id: 2 }]); await tick();   // To do is asked again here; answer it
  expect(c.textContent).toBe("todo:1r2r doing:45 done:3 #5 in doing");
  expect(disabled()).toEqual([false, false]);
  api.move(3, "done", "doing", 2); await tick();         // Doing 4, 5, 3: full
  expect(c.textContent).toBe("todo:1r2r doing:453 done: #5 in doing");
  expect(api.full()).toBe(true);
  expect(disabled()).toEqual([true, true]);              // actual: [false, false]
});
