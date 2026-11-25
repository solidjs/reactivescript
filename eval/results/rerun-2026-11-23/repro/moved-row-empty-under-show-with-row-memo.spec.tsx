/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Show, Loading, action, createMemo, createOptimisticStore, flush, refresh } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
type C = { id: number; t: string };

test("a row moved into another keyed optimistic store renders empty under Show when a per-row memo reads the store", async () => {
  const asks: any[] = [];
  const ask = (k: string) => new Promise<any>((res, rej) => asks.push({ k, res, rej }));
  const find = (k: string) => asks.splice(asks.findIndex(a => a.k === k), 1)[0];
  const placed = (rs: C[], c: C, i: number) => { const n = rs.filter(x => x.id !== c.id); n.splice(i, 0, c); return n; };
  const c = document.body.appendChild(document.createElement("div"));
  let api: any;
  function Board() {
    const L: any = {};
    for (const k of ["todo", "doing", "done"]) {
      const [s, set] = (createOptimisticStore as any)(async () => await ask(k), [], { key: "id" });
      L[k] = { s, set };
    }
    const move = action(function* (card: C, from: string, to: string, i: number) {
      if (from !== to) L[from].set((rs: C[]) => rs.filter(x => x.id !== card.id));
      L[to].set((rs: C[]) => placed(rs, card, i));
      yield ask(`move:${card.id}`);
      refresh(L.todo.s); refresh(L.doing.s); refresh(L.done.s);
    });
    api = { L, move };
    const Col = (p: { col: string }) => <Loading fallback="L"><p>{p.col}({L[p.col].s.length}):<For each={L[p.col].s}>{(r: C) => {
      const i = createMemo(() => L[p.col].s.findIndex((x: C) => x.id === r.id));
      return <i><Show when={r.id < 0} fallback={<>[{r.id} {r.t}]<Show when={i() < L[p.col].s.length - 1}>v</Show></>}>adding</Show></i>;
    }}</For></p></Loading>;
    return <><Col col="todo" /><Col col="doing" /><Col col="done" /></>;
  }
  render(() => <Board />, c);
  await tick();
  find("todo").res([{ id: 1, t: "a" }, { id: 2, t: "b" }]); await tick();
  api.move(api.L.todo.s[0], "todo", "todo", 1); await tick();      // down #1
  find("doing").res([{ id: 3, t: "c" }, { id: 4, t: "d" }]); await tick();
  find("done").res([{ id: 5, t: "e" }]); await tick();
  api.move(api.L.doing.s[1], "doing", "done", 1); await tick();    // right #4
  find("move:1").res({}); await tick();                             // re-asks all three (left out)
  expect(c.textContent).toBe("todo(2):[2 b]v[1 a]doing(1):[3 c]done(2):[5 e]v[4 d]");
  api.move({ ...api.L.done.s[1] }, "done", "doing", 1); await tick();     // left #4 (a copy of the row)
  expect(c.textContent).toBe("todo(2):[2 b]v[1 a]doing(2):[3 c]v[4 d]done(1):[5 e]");   // actual: "...doing(2):[3 c]v..." (#4's row is empty)
});
