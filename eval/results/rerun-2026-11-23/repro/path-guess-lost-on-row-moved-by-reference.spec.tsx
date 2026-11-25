/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import { For, Loading, action, createOptimisticStore, flush } from "solid-js";
import { render } from "../src/index.js";
const tick = async () => { for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 0)); flush(); } };
type C = { id: number; done: number };

test("a path guess on a row moved by reference into another optimistic store is lost while an earlier path guess on it is out", async () => {
  const asks: any[] = [];
  const ask = (k: string) => new Promise<any>((res, rej) => asks.push({ k, res, rej }));
  const find = (k: string) => asks.splice(asks.findIndex(a => a.k === k), 1)[0];
  const placed = (rs: C[], c: C, i: number) => { const n = rs.filter(x => x.id !== c.id); n.splice(i, 0, c); return n; };
  const c = document.body.appendChild(document.createElement("div"));
  let api: any;
  function Board() {
    const L: any = {};
    for (const k of ["todo", "doing"]) {
      const [s, set] = (createOptimisticStore as any)(async () => await ask(k), [], { key: "id" });
      L[k] = { s, set };
    }
    const move = action(function* (card: C, from: string, to: string, i: number) {
      L[from].set((rs: C[]) => rs.filter(x => x.id !== card.id));
      L[to].set((rs: C[]) => placed(rs, card, i));
      yield ask(`move:${card.id}`);
    });
    const count = action(function* (col: string, i: number, n: number, k: string) {
      L[col].set((d: any) => { d[i].done = n; });
      yield ask(k);
    });
    api = { L, move, count };
    const Col = (p: { col: string }) => <Loading fallback="L"><p>{p.col}:<For each={L[p.col].s}>{(r: C) => <i>[{r.id} {r.done}]</i>}</For></p></Loading>;
    return <><Col col="todo" /><Col col="doing" /></>;
  }
  render(() => <Board />, c);
  await tick();
  find("todo").res([{ id: 1, done: 0 }, { id: 2, done: 1 }]); await tick();
  api.count("todo", 1, 2, "toggle:a"); await tick();             // #2 1 -> 2 (out)
  find("doing").res([{ id: 3, done: 2 }, { id: 4, done: 0 }]); await tick();
  api.move(api.L.todo.s[1], "todo", "doing", 2); await tick();   // #2 to Doing, the row itself (out)
  expect(c.textContent).toBe("todo:[1 0]doing:[3 2][4 0][2 2]");
  api.count("doing", 2, 1, "toggle:b"); await tick();            // #2 2 -> 1 (out)
  expect(c.textContent).toBe("todo:[1 0]doing:[3 2][4 0][2 1]"); // actual: "...[2 2]": the guess is lost
});
