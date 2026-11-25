# ReactiveScript for Zed

Highlighting for `.rx` and `.d.rx` from a Tree-sitter grammar
([`../tree-sitter-rx`](../tree-sitter-rx)), and, through the `.rx` language server
([`../rx-language-server`](../rx-language-server)), TypeScript's hover, go to
definition, references, rename, completion and type errors, plus the
compiler's own diagnostics. ` ```rx ` and ` ```reactivescript ` blocks in
Markdown use the same language.

The extension installs `@reactivescript/language-server` from npm (and updates it
when a newer release exists; offline it keeps the installed copy) and runs it
with Zed's Node over stdio.

The project needs a `tsconfig.json` with Solid's JSX (`"jsx": "preserve"`,
`"jsxImportSource": "@solidjs/web"`) and `@solidjs/web` in its `node_modules`;
the server writes the projection's prelude to `node_modules/.reactivescript/`.
It uses the worktree's `node_modules/typescript`, else its own TypeScript.

## Installing as a dev extension

Run **zed: install dev extension** in the command palette and pick this folder
(`tooling/zed-rx`). Zed needs Rust (via rustup) to build the extension, and
fetches and compiles the grammar named in `extension.toml`. For local work,
point `[grammars.rx]`'s `repository` at a checkout with the grammar committed
(`file:///path/to/reactivescript`) and `rev` at that commit.

## Working on the extension

Before opening Zed, from this folder:

```sh
cargo fmt --check
cargo clippy --release --target wasm32-wasip2 -- -D warnings
cargo build --release --target wasm32-wasip2   # rustup target add wasm32-wasip2
./check-queries.sh                             # needs pnpm
```

`check-queries.sh` runs every query in `languages/reactivescript` over
`examples/*.rx`, on the grammar `extension.toml` pins. A query that names a
node the grammar does not have stops Zed loading the language at all, and Zed
only says so in its log. For a grammar change that is not pinned yet, check
against the working tree: `GRAMMAR=../tree-sitter-rx ./check-queries.sh`. CI
runs all four (`.github/workflows/zed.yml`).

Then in Zed:

- After a change, press **Rebuild** on the extension's row in
  **zed: extensions**. Queries and `config.toml` are read again, and
  `src/lib.rs` is recompiled.
- **zed: open log** shows a query or grammar that failed to load, and a failed
  npm install. `zed --foreground` from a terminal prints more.
- **dev: open language server logs** shows how the server was started (its
  command, arguments and `RXC`) and what it printed.
- **dev: open syntax tree view** shows the node under the cursor, which is what
  a query pattern has to name.

Worth trying by hand, since no check covers them: type `<div>` in a component
and see `</div>` appear; a `/** */` comment and a `//` comment keep their own
colours; `css` and `styled` templates are highlighted as CSS; the outline lists
components, sources and equations.

## Settings

All under `lsp.rx-language-server` in Zed's `settings.json`:

```json
{
  "lsp": {
    "rx-language-server": {
      "settings": {
        "rxc": { "path": "/path/to/reactivescript/compiler/target/release/rxc" },
        "typescript": { "tsdk": "/path/to/project/node_modules/typescript/lib" }
      }
    }
  }
}
```

- `settings.rxc.path`: an `rxc` binary for the server to run per request
  instead of its bundled WebAssembly build (sets `RXC`).
- `settings.typescript.tsdk`: TypeScript's `lib` folder. Unset: the worktree's
  `node_modules/typescript/lib` if there is one (the worktree root only, not a
  parent workspace's), else the server's own.
- `initialization_options`: merged over what the extension sends
  (`{ "typescript": { "tsdk": … } }`).

To run another server instead of the npm package, such as this repository's,
set `binary`. Zed then starts that command itself, without the extension: it
adds no `--stdio`, does not run a `.js` file with its Node, and does not read
`settings.rxc.path`, so name all three:

```json
{
  "lsp": {
    "rx-language-server": {
      "binary": {
        "path": "node",
        "arguments": ["/path/to/reactivescript/tooling/rx-language-server/bin/server.js", "--stdio"],
        "env": { "RXC": "/path/to/reactivescript/compiler/target/release/rxc" }
      }
    }
  }
}
```

`binary.env` without a `path` is added to the npm server's environment.
`binary.arguments` without a `path` replaces the extension's arguments (the
server's path and `--stdio`), so set it only together with a `path`.

The server's semantic tokens only show once Zed asks for them; they are off by
default:

```json
{ "languages": { "ReactiveScript": { "semantic_tokens": "combined" } } }
```
