export const extra: Record<string, string> = {
  "a first paint": `export default component App() {
  source id := 1
  a = await fetch("a:" + id) -> "first"
  <main>
    <button onClick={() => { id := id + 1 }}>+</button>
    {errored fallback(e) { <p>err {e.message}</p> } {
      <p>{a} {pending? a ? "busy" : "idle"}</p>
    }}
  </main>
}
`,
  "catches on awaits": `export error Gone(n: number) => \`gone \${n}\`

export default component App() {
  source id := 1
  b = await fetch("b:" + id) -> 0 catch (e) => -1
  c = await fetch("c:" + id) catch (e: Gone) => 7
  <main>
    <button onClick={() => { id := id + 1 }}>+</button>
    {errored fallback(e) { <p>err {e.message}</p> } {
      {loading fallback { <p>wait</p> } {
        <p>{b} {c}</p>
      }}
    }}
  </main>
}
`,
  "typed errors": `export error Big(n: number) => \`too big: \${n}\`
export error Odd(n: number) => \`odd: \${n}\`

fn check(n: number): number => n > 3 ? throw Big(n) : n

export default component App() {
  source n := 0
  source note := ""
  checked = check(n)
  odd = n % 2 == 1 && n < 3 ? throw Odd(n) : n

  action bump() {
    try {
      if (n > 4) { throw Big(n) }
      n := n + 1
    } catch (e: Big) {
      note := e.message
    }
  }

  <main>
    <button onClick={bump}>+</button>
    <button onClick={() => { n := 0 }}>reset</button>
    <button onClick={() => { n := n - 1 }}>-</button>
    <p>{note}</p>
    {errored fallback(e) { <p>outer {e.message}</p> } {
      {errored fallback(e: Big) { <p>big {e.message} {e.n}</p> } {
        <p>{checked} {odd}</p>
      }}
    }}
  </main>
}
`,
  context: `export context theme: string = "light"

component Badge() {
  t = use theme
  <span class={t}>{t}</span>
}

component Nested() {
  provide theme = "nested"
  <Badge />
}

export default component App() {
  source dark := false
  provide theme = dark ? "dark" : "light"
  <div>
    <button onClick={() => { dark := !dark }}>toggle</button>
    <Badge />
    <Nested />
  </div>
}
`,
  "a module-level provide": `context user: string = "guest"
source who := "ada"
provide user = who

component Name() {
  u = use user
  <b>{u}</b>
}

export default component App() {
  <div>
    <button onClick={() => { who := who + "!" }}>more</button>
    <Name />
  </div>
}
`,
  "server functions": `import pure { GET } from "./wrappers"
import pure { findUser } from "./db"
import { saveUser } from "./db"

server fn loadUser(id: number) {
  let row = await findUser(id)
  return { id, name: row.name }
}

getUser = GET(server fn (id: number) {
  let row = await findUser(id)
  return row
})

export server fn rename(id: number, name: string) {
  await saveUser(id, name)
  return name
}

export default component App() {
  source id := 1
  user = await loadUser(id)
  other = await getUser(id)

  action save() {
    try {
      let n = await rename(id, "Grace")
      id := id + 1
    } catch (e) {
    }
  }

  {errored fallback(e) { <p>{e.message}</p> } {
    {loading fallback { <p>Loading…</p> } {
      <p onClick={save}>{user.name} {other.name}</p>
    }}
  }}
}
`,
  "rest props": `component Badge({ label, tone = "info", ...rest }) {\n  <span class={tone} {...rest}>{label}</span>\n}\n\nexport default component App() {\n  <Badge label="New" title="fresh" />\n}\n`,
  "store path": `export default component App() {\n  source user := { name: "Ada", tags: ["a"] }\n  <p onClick={() => { user.name := "Grace" }}>{user.name}</p>\n}\n`,
};

// Solid written by hand, not taken from the view: what converts must compile, what does not must say why
export const samples: Record<string, { solid: string; files?: Record<string, string>; problems?: number; diagnostics?: string[]; helpers?: string[]; has?: string[] }> = {
  counter: { solid: `import { createSignal, createMemo } from "solid-js";

export default function Counter() {
  const [count, setCount] = createSignal(0);
  const doubled = createMemo(() => count() * 2);
  return <button onClick={() => setCount(count() + 1)}>{doubled()}</button>;
}
` },
  todos: { solid: `import { createSignal, createStore, createMemo, Show, For } from "solid-js";

type Todo = { id: number; title: string; done: boolean };

function Row(props: { todo: Todo; onToggle: (id: number) => void }) {
  return (
    <li class={props.todo.done ? "done" : ""}>
      <button onClick={() => props.onToggle(props.todo.id)}>{props.todo.title}</button>
    </li>
  );
}

export default function Todos() {
  const [todos, setTodos] = createStore<Todo[]>([{ id: 1, title: "Write", done: false }]);
  const [filter, setFilter] = createSignal<"all" | "open">("all");
  const [text, setText] = createSignal("");
  const visible = createMemo(() => todos.filter((t) => filter() === "all" || !t.done));
  const remaining = createMemo(() => todos.filter((t) => !t.done).length);
  const add = () => {
    setTodos((ts) => [...ts, { id: ts.length + 1, title: text(), done: false }]);
    setText("");
  };
  return (
    <section>
      <input value={text()} onInput={(e) => setText(e.currentTarget.value)} />
      <button onClick={add}>Add</button>
      <button onClick={() => setFilter(filter() === "all" ? "open" : "all")}>Showing {filter()}</button>
      <Show when={visible().length > 0} fallback={<i>Nothing to do</i>}>
        <ul>
          <For each={visible()}>{(todo) => <Row todo={todo} onToggle={(id) => setTodos((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))} />}</For>
        </ul>
      </Show>
      {remaining() > 0 && <b>{remaining()} left</b>}
      {remaining() === 0 ? <em>All done</em> : <span>Keep going</span>}
    </section>
  );
}
` },
  async: { files: { "/api.d.rx": "export pure fn fetchUser(id: number)\n" }, solid: `import { createSignal, createMemo, Loading } from "solid-js";
import { fetchUser } from "./api";

export default function Profile() {
  const [id, setId] = createSignal(1);
  const user = createMemo(async () => await fetchUser(id()));
  const name = createMemo(() => user().name.toUpperCase());
  return (
    <Loading fallback={<p>Loading…</p>}>
      <h1>{name()}</h1>
      <button onClick={() => setId((i) => i + 1)}>Next</button>
    </Loading>
  );
}
`, diagnostics: ["UNHANDLED_FAILURE"] },
  // plain TypeScript beside the component moves to helpers.ts; its async functions are awaited where they are read
  cities: { solid: `import { createMemo, createSignal, For, isPending, Loading } from "solid-js";
import { render } from "@solidjs/web";

const CITIES: Record<string, string[]> = {
  California: ["Los Angeles", "San Francisco", "San Diego"],
  Florida: ["Miami", "Orlando", "Tampa"],
  "New York": ["New York City", "Buffalo", "Rochester"],
  Texas: ["Houston", "Dallas", "Austin"],
};

// Stand-ins for network requests.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getStates = async () => (await sleep(500), Object.keys(CITIES));
const getCities = async (state: string) => (await sleep(500), CITIES[state] ?? []);

function App() {
  // Async memos read like plain values, even when one depends on another.
  const states = createMemo(getStates);
  const [state, setState] = createSignal(() => states()[0]);
  const cities = createMemo(() => getCities(state()));
  // A writable signal derived from the list: picking a new state resets the
  // city on its own, with no effect to keep them in sync.
  const [city, setCity] = createSignal(() => cities()[0]);

  return (
    <Loading fallback={<p>Loading…</p>}>
      <select onChange={(e) => setState(e.currentTarget.value)}>
        <For each={states()}>{(name) => <option>{name}</option>}</For>
      </select>{" "}
      <select disabled={isPending(cities)} onChange={(e) => setCity(e.currentTarget.value)}>
        <For each={cities()}>{(name) => <option>{name}</option>}</For>
      </select>
      <p>
        Selection: {city()}, {state()}
      </p>
    </Loading>
  );
}
`, diagnostics: ["UNHANDLED_FAILURE"], helpers: ["export const getStates = async", "const CITIES: Record<string, string[]>"], has: ["states = await getStates()", "cities = await getCities(state)", "export default component App()", "// Async memos read like plain values"] },
  "cities with a boundary": { solid: `import { createMemo, createSignal, Errored, For, isPending, Loading } from "solid-js";
import { render } from "@solidjs/web";

const CITIES: Record<string, string[]> = {
  California: ["Los Angeles", "San Francisco", "San Diego"],
  Florida: ["Miami", "Orlando", "Tampa"],
  "New York": ["New York City", "Buffalo", "Rochester"],
  Texas: ["Houston", "Dallas", "Austin"],
};

// Stand-ins for network requests.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const getStates = async () => (await sleep(500), Object.keys(CITIES));
const getCities = async (state: string) => (await sleep(500), CITIES[state] ?? []);

function App() {
  // Async memos read like plain values, even when one depends on another.
  const states = createMemo(getStates);
  const [state, setState] = createSignal(() => states()[0]);
  const cities = createMemo(() => getCities(state()));
  // A writable signal derived from the list: picking a new state resets the
  // city on its own, with no effect to keep them in sync.
  const [city, setCity] = createSignal(() => cities()[0]);

  return (
    <Errored fallback={(e) => <p>{e().message}</p>}><Loading fallback={<p>Loading…</p>}>
      <select onChange={(e) => setState(e.currentTarget.value)}>
        <For each={states()}>{(name) => <option>{name}</option>}</For>
      </select>{" "}
      <select disabled={isPending(cities)} onChange={(e) => setCity(e.currentTarget.value)}>
        <For each={cities()}>{(name) => <option>{name}</option>}</For>
      </select>
      <p>
        Selection: {city()}, {state()}
      </p>
    </Loading></Errored>
  );
}
`, has: ["{errored fallback(e) {"] },
  // a store setter's draft is writes along the store's path; a value read again after its write goes in a local
  // (AC-1d), a push is a write to the next index, other array methods are functional writes (W-6), a setup function
  // that writes is an action, a `let` is a source
  cart: { solid: `import { createMemo, createStore, For } from "solid-js";
import { render } from "@solidjs/web";

type Item = { id: number; name: string; price: number; qty: number };

export default function App() {
  const [cart, setCart] = createStore<{ items: Item[] }>({
    items: [
      { id: 1, name: "Stickers", price: 3, qty: 2 },
      { id: 2, name: "T-shirt", price: 25, qty: 1 },
    ],
  });
  const total = createMemo(() => cart.items.reduce((sum, item) => sum + item.price * item.qty, 0));
  let nextId = 3;

  // Setters hand you a draft: change it like a plain object. Only what you
  // touched updates, so a quantity change re-renders one number, not the row.
  const change = (id: number, by: number) =>
    setCart((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      draft.items[index].qty += by;
      if (draft.items[index].qty === 0) draft.items.splice(index, 1);
    });

  const addMug = () =>
    setCart((draft) => {
      draft.items.push({ id: nextId, name: \`Mug #\${nextId++}\`, price: 12, qty: 1 });
    });

  return (
    <>
      <ul>
        <For each={cart.items} fallback={<li>Your cart is empty.</li>}>
          {(item) => (
            <li>
              {item.name}: {item.qty} × \${item.price}{" "}
              <button onClick={() => change(item.id, 1)}>+</button>
              <button onClick={() => change(item.id, -1)}>−</button>
            </li>
          )}
        </For>
      </ul>
      <button onClick={addMug}>Add a mug</button>
      <p>Total: \${total()}</p>
    </>
  );
}
`, has: [
    "source nextId := 3",
    "action change(id: number, by: number) {",
    "let qty = cart.items[index].qty + by",
    "cart.items[index].qty := qty",
    "if (qty == 0) {",
    "cart.items := items => items.toSpliced(index, 1)",
    "action addMug() {",
    "cart.items[cart.items.length] := { id: nextId, name: `Mug #${nextId}`, price: 12, qty: 1 }",
    "<button onClick={addMug}>Add a mug</button>",
    "nextId := nextId + 1",
    "{if cart.items.length > 0 {",
    "<li>Your cart is empty.</li>",
  ] },
  // .rx has no ambient names: Math is imported from helpers.ts, pure where reactive scope reads it; console.log is
  // the builtin log;
  // a source's first value that reads a reactive name is a peek (E-4)
  "globals and first values": { solid: `import { createMemo, createSignal } from "solid-js";

const LIMIT = 10;

export default function App() {
  const [count, setCount] = createSignal(1);
  const [start, setStart] = createSignal(count() * 2);
  const [cap] = createSignal(LIMIT);
  const capped = createMemo(() => Math.min(count(), LIMIT));
  return (
    <button
      onClick={() => {
        console.log(count());
        setCount(count() + 1);
      }}
    >
      {capped()} of {cap()} from {start()}
    </button>
  );
}
`, helpers: ["export const { Math } = globalThis;"], has: [
    'import pure { Math } from "./helpers"',
    "onClick={() => { log(count); count := count + 1 }}",
    "source start := peek(count * 2)",
    "source cap := peek(LIMIT)",
    "{capped} of {cap} from {start}",
  ] },
  // writes in reactive scope have no .rx form: a counter bumped while rendering, a `let` written by a projection
  "writes while rendering": { solid: `import { createProjection, createSignal, For } from "solid-js";
import { render } from "@solidjs/web";

const ROWS = Array.from({ length: 1000 }, (_, id) => ({ id, label: \`Row \${id}\` }));

function App() {
  const [selected, setSelected] = createSignal(0);
  const [checked, setChecked] = createSignal(ROWS.length);

  // A projection is a store derived from other state. A click changes two
  // keys, so only the two rows that read them update, not all 1,000.
  let previous: number | undefined;
  const selection = createProjection<Record<number, true>>((draft) => {
    const id = selected();
    if (previous !== undefined) delete draft[previous];
    draft[id] = true;
    previous = id;
  }, {});

  let checks = 0;
  const isSelected = (id: number) => {
    checks++;
    return !!selection[id];
  };
  const select = (id: number) => {
    checks = 0;
    setSelected(id);
    setTimeout(() => setChecked(checks));
  };

  return (
    <>
      <p>Rows that re-ran on the last click: {checked()}</p>
      <ul style={{ height: "240px", overflow: "auto", padding: 0 }}>
        <For each={ROWS}>
          {(row) => (
            <li
              style={{ "list-style": "none", cursor: "pointer", "font-weight": isSelected(row.id) ? "bold" : "normal" }}
              onClick={() => select(row.id)}
            >
              {row.label}
            </li>
          )}
        </For>
      </ul>
    </>
  );
}

render(() => <App />, document.getElementById("app")!);
`, problems: 3, helpers: ["export const ROWS = Array.from(", "export const { setTimeout } = globalThis;"], has: [
    'import pure { ROWS } from "./helpers"',
    "selection = draft(pre selection -> {}) {",
    "d[id] := true",
    "setTimeout(() => { checked := checks })",
  ] },
  // a plain `let` is a source, the only writable name a component has; what renders reads it with peek, so it
  // subscribes to nothing, as in Solid
  "a plain let": { solid: `import { createSignal } from "solid-js";

export default function App() {
  const [n, setN] = createSignal(0);
  let clicks = 0;
  return (
    <button
      onClick={() => {
        clicks++;
        setN(n() + 1);
      }}
    >
      {n()} ({clicks} when drawn)
    </button>
  );
}
`, has: ["source clicks := 0", "clicks := clicks + 1", "{n} ({peek(clicks)} when drawn)"] },
  // an optimistic store: a guess is one functional write of the whole list (a found row changed, or a push), the api
  // object's async methods are awaited in reactive scope, a module's `let` is a source, casts and typed arrow
  // parameters go, a DOM assignment is assign(…). Catching an action's failure from its promise has no .rx form.
  "optimistic todos": { solid: `import { action, createOptimisticStore, createSignal, For, Loading, refresh } from "solid-js";
import { render } from "@solidjs/web";

type Todo = { id: number; text: string; done: boolean; pending?: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A pretend server. Saves take a second, and you can make the next one fail.
let saved: Todo[] = [
  { id: 1, text: "Read the docs", done: true },
  { id: 2, text: "Try optimistic actions", done: false },
];
let nextId = 3;
const api = {
  failNext: false,
  async list() {
    await sleep(200);
    return structuredClone(saved);
  },
  async save(update: (todos: Todo[]) => Todo[]) {
    await sleep(1000);
    if (api.failNext) {
      api.failNext = false;
      throw new Error("The server rejected that change.");
    }
    saved = update(saved);
  },
};

function App() {
  const [todos, setTodos] = createOptimisticStore<Todo[]>(() => api.list(), []);
  const [error, setError] = createSignal("");

  // Write the change you expect, then do the real work. The guess shows at once
  // and is discarded when the action settles, so a failure needs no rollback code.
  const toggle = action(function* (id: number) {
    setTodos((draft) => {
      const todo = draft.find((todo) => todo.id === id)!;
      todo.done = !todo.done;
      todo.pending = true;
    });
    yield api.save((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    refresh(todos);
  });

  const add = action(function* (text: string) {
    const todo = { id: nextId++, text, done: false };
    setTodos((draft) => {
      draft.push({ ...todo, pending: true });
    });
    yield api.save((list) => [...list, todo]);
    refresh(todos);
  });

  const run = (result: Promise<void>) => {
    setError("");
    result.catch((err: Error) => setError(err.message));
  };

  return (
    <Loading fallback={<p>Loading todos…</p>}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("text") as HTMLInputElement;
          if (input.value.trim()) run(add(input.value.trim()));
          input.value = "";
        }}
      >
        <input name="text" placeholder="New todo" /> <button>Add</button>
      </form>
      <For each={todos}>
        {(todo) => (
          <label style={{ display: "block", opacity: todo.pending ? 0.5 : 1 }}>
            <input type="checkbox" checked={todo.done} onChange={() => run(toggle(todo.id))} /> {todo.text}
          </label>
        )}
      </For>
      <label>
        <input type="checkbox" onChange={(event) => (api.failNext = event.currentTarget.checked)} /> Fail the next save
      </label>
      <p role="alert">{error()}</p>
    </Loading>
  );
}

render(() => <App />, document.getElementById("app")!);
`, problems: 1, helpers: ["type Todo = ", "export const api = {", "export const assign = (target: any, key: PropertyKey, value: unknown) => {"], has: [
    'import pure { api } from "./helpers"',
    'import { assign } from "./helpers"',
    "source nextId := 3",
    "source todos: Todo[] = await api.list()",
    "guess todos := draft => {",
    "const todo = draft.find(todo => todo.id == id)",
    "return draft.map(each => each == todo ? { ...todo, done: !todo.done, pending: true } : each)",
    "await api.save(list => list.map(t => t.id == id ? { ...t, done: !t.done } : t))",
    "refresh todos",
    "const todo = { id: nextId, text, done: false }",
    "nextId := nextId + 1",
    "guess todos := draft => [...draft, { ...todo, pending: true }]",
    'const input = event.currentTarget.elements.namedItem("text")',
    'assign(input, "value", "")',
    'onChange={event => { assign(api, "failNext", event.currentTarget.checked) }}',
  ] },
  // a projection that returns its value is a structured equation (ST-1)
  "a derived projection": { solid: `import { createProjection, createStore } from "solid-js";

export default function App() {
  const [store, setStore] = createStore({ users: ["a", "b"] });
  const triple = createProjection(() => ({users: store.users.map(u => u + '3')}))
  return <p onClick={() => setStore((d) => { d.users.push("c"); })}>{triple.users.length}</p>;
}
`, has: ["triple = {users: store.users.map(u => u + '3')}", "{triple.users.length}", 'store.users[store.users.length] := "c"'] },
  // an optimistic store over a plain value is a source with a constant question (ST-5c); a guess goes along the
  // store's path like any write
  "a guess along a path": { files: { "/api.d.rx": "export fn save()\n" }, solid: `import { action, createOptimisticStore, refresh } from "solid-js";
import { save } from "./api";

export default function App() {
  const [store, setStore] = createOptimisticStore({ users: ["Brenley", "Lance"] });
  const add = action(function* () {
    setStore((s) => s.users.push("Chantel"));
    try {
      yield save();
      refresh(store);
    } catch (e) {}
  });
  return <button onClick={() => add()}>{store.users.length}</button>;
}
`, has: ['source store = { users: ["Brenley", "Lance"] }', 'guess store.users[store.users.length] := "Chantel"', "refresh store"] },
  // createEffect(compute, effect) is effect (inputs) { … }: the effect's parameter is $0, a list of inputs read apart
  // is one input each, the cleanup is what the block returns; onSettled in the setup is an effect with no inputs
  effects: { solid: `import { createEffect, createMemo, createSignal, onSettled } from "solid-js";

export default function App() {
  const [count, setCount] = createSignal(0);
  const double = createMemo(() => count() * 2);
  createEffect(
    () => count(),
    (value) => {
      document.title = \`Count \${value}\`;
      return () => console.log("was", value);
    },
  );
  createEffect(() => [count(), double()], ([c, d]) => console.log(c, d));
  onSettled(() => {
    console.log("mounted");
  });
  return <button onClick={() => setCount(count() + 1)}>{count()}</button>;
}
`, has: [
    "effect (count) {",
    'assign(document, "title", `Count ${$0}`)',
    'return () => log("was", $0)',
    "effect (count, double) {",
    "log($0, $1)",
    "effect () {",
    'log("mounted")',
  ] },
  // createDeferred is a deferred equation (V-16)
  "a deferred value": { solid: `import { createDeferred, createSignal } from "solid-js";

export default function App() {
  const [query, setQuery] = createSignal("");
  const shown = createDeferred(() => query().toUpperCase());
  return <p onClick={() => setQuery("a")}>{shown()}</p>;
}
`, has: ["deferred shown = query.toUpperCase()", "{shown}"] },
  // a "use server" function is a server fn; a call from reactive scope is awaited, and what its body imports is
  // imported pure, or the question would be io (12 SF-1b, SF-2b)
  "a use server function": { solid: `import { createMemo, createSignal, Errored, Loading } from "solid-js";
import { findUser } from "./db";
import { GET } from "./wrappers";

async function loadUser(id: number) {
  "use server";
  const row = await findUser(id);
  return { id, name: row.name };
}

const getUser = GET(async function (id: number) {
  "use server";
  return await findUser(id);
});

export default function App() {
  const [id, setId] = createSignal(1);
  const user = createMemo(() => loadUser(id()));
  const other = createMemo(() => getUser(id()));
  return (
    <Errored fallback={(e) => <p>{e().message}</p>}>
      <Loading fallback={<p>Loading…</p>}>
        <p onClick={() => setId(id() + 1)}>{user().name} {other().name}</p>
      </Loading>
    </Errored>
  );
}
`, has: [
    'import pure { findUser } from "./db"',
    'import pure { GET } from "./wrappers"',
    "server fn loadUser(id: number) {",
    "const row = await findUser(id)",
    "return { id, name: row.name }",
    "getUser = GET(server fn (id: number) {",
    "let value = await findUser(id)",
    "return value",
    "user = await loadUser(id)",
    "other = await getUser(id)",
  ] },
  // an error class is an error declaration; a typed catch and a typed boundary rethrow the other classes (R-f-1, R-f-4,
  // R-f-6); a function that throws before it returns is a throw expression
  "typed errors in Solid": { solid: `import { action, createMemo, createSignal, Errored } from "solid-js";

export class TooBig extends Error {
  constructor(n: number) {
    super("too big: " + String(n));
    this.name = "TooBig";
    this.n = n;
  }
}

function check(n: number) {
  if (n > 3) throw new TooBig(n);
  return n;
}

export default function App() {
  const [n, setN] = createSignal(0);
  const [note, setNote] = createSignal("");
  const checked = createMemo(() => check(n()));
  const bump = action(function* () {
    try {
      if (n() > 4) throw new TooBig(n());
      setN(n() + 1);
    } catch (e) {
      if (!(e instanceof TooBig)) throw e;
      setNote(e.message);
    }
  });
  return (
    <main>
      <button onClick={bump}>+</button>
      <p>{note()}</p>
      <Errored fallback={(e) => <p>outer {e().message}</p>}>
        <Errored
          fallback={(e) => {
            if (!(e() instanceof TooBig)) throw e();
            return <p>big {e().n}</p>;
          }}
        >
          <p>{checked()}</p>
        </Errored>
      </Errored>
    </main>
  );
}
`, has: [
    "export error TooBig(n: number) => \"too big: \" + str(n)",
    "fn check(n: number) => n > 3 ? throw TooBig(n) : n",
    "if (n > 4) {",
    "throw TooBig(n)",
    "} catch (e: TooBig) {",
    "{errored fallback(e: TooBig) { <p>big {e.n}</p> } {",
  ] },
  // createContext is a context, useContext a use of it, and the context as provider around a view is provide (07)
  "a context in Solid": { solid: `import { createContext, createSignal, useContext } from "solid-js";

const ThemeContext = createContext<string>(() => "light");

function Badge() {
  const t = useContext(ThemeContext);
  return <span class={t()}>{t()}</span>;
}

export default function App() {
  const [dark, setDark] = createSignal(false);
  return (
    <ThemeContext value={() => (dark() ? "dark" : "light")}>
      <button onClick={() => setDark(!dark())}>toggle</button>
      <Badge />
    </ThemeContext>
  );
}
`, has: [
    "context theme: string = \"light\"",
    "t = use theme",
    "provide theme = dark ? \"dark\" : \"light\"",
    "<Badge />",
  ] },
  // loadingValue is a first paint, a promise's catch an await's catch, and a memo whose try lets NotReadyError
  // through a catch on what it reads (R-7, R-f-4)
  "a first paint and catches in Solid": { solid: `import { createMemo, createSignal, Errored, Loading, NotReadyError } from "solid-js";

export default function App() {
  const [id, setId] = createSignal(1);
  const [user, setUser] = createSignal(() => fetch("u:" + id()), { loadingValue: "nobody" });
  const i$size = createMemo(() => fetch("s:" + id()).catch((e) => 0), { loadingValue: 10 });
  const size = createMemo(() => {
    try {
      return i$size();
    } catch (e) {
      if (e instanceof NotReadyError) throw e;
      return 0;
    }
  });
  return (
    <Errored fallback={(e) => <p>{e().message}</p>}>
      <Loading fallback={<p>wait</p>}>
        <p onClick={() => setId(id() + 1)}>{user()} {size()}</p>
      </Loading>
    </Errored>
  );
}
`, has: [
    'source user = await fetch("u:" + id) -> "nobody"',
    'size = await fetch("s:" + id) -> 10 catch (e) => 0',
  ] },
  // a builtin under another name is imported so from the prelude; a keyed optimistic store keeps its key (ST-4); a
  // loop body with its own equations keeps them in the loop
  "a prelude alias, a keyed store and a loop with equations": { solid: `import { action, createMemo, createOptimisticStore, createSignal, Errored, For, Loading } from "solid-js";
import { fetchIssues } from "./api";

const keep = filter;

export default function App() {
  const [shown, setShown] = createSignal("open");
  const [issues, setIssues] = createOptimisticStore(() => fetchIssues(shown()), [], { key: "id" });
  const drop = action(function* (id: number) {
    setIssues(() => keep(issues, (t) => t.id !== id));
  });
  return (
    <Errored fallback={(e) => <p>{e().message}</p>}>
      <Loading fallback={<p>wait</p>}>
        <ul>
          <For each={issues}>
            {(issue) => {
              const label = createMemo(() => issue.title + " (" + shown() + ")");
              return <li onClick={() => drop(issue.id)}>{label()}</li>;
            }}
          </For>
        </ul>
      </Loading>
    </Errored>
  );
}
`, has: [
    'import pure { filter as keep } from "./prelude"',
    "source issues key id = ",
    "{for issue in issues {",
    'label = issue.title + " (" + shown + ")"',
  ] },
  refused: { solid: `import { createSignal, createEffect, createMemo } from "solid-js";

function useDouble(n) {
  return createMemo(() => n() * 2);
}

export default function App() {
  const [count, setCount] = createSignal(0);
  const double = useDouble(count);
  createEffect(() => count(), (c) => console.log(c));
  let ref;
  return <p ref={ref} onClick={() => count++}>{double()}</p>;
}
`, problems: 4 },
};
