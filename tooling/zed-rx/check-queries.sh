#!/bin/sh
# Runs every query in languages/reactivescript over examples/*.rx. A query that names a node or field the grammar
# does not have stops Zed loading the language at all, and Zed only says so in its log.
#
# The grammar is the one extension.toml pins, since that is what Zed compiles: its commit is unpacked into
# target/grammar, fetched from the repository extension.toml names when this checkout does not have it (CI's never
# does, so there the pin is also checked to be a commit that repository has).
#
# GRAMMAR=../tree-sitter-rx ./check-queries.sh checks against a grammar folder instead (relative to this folder),
# for a grammar change that is not pinned yet.
set -eu
cd "$(dirname "$0")"
here=$(pwd)

if [ -z "${GRAMMAR:-}" ]; then
  pin() { sed -n "/^\[grammars\.rx\]/,\$ s/^$1 = \"\(.*\)\"/\1/p" extension.toml; }
  repository=$(pin repository)
  path=$(pin path)
  rev=$(pin rev)
  git cat-file -e "$rev^{commit}" 2>/dev/null || git fetch --quiet --depth 1 "$repository" "$rev"
  rm -rf target/grammar
  mkdir -p target/grammar
  # -m: files dated now, so tree-sitter does not reuse a parser it built from another copy of the grammar
  # From the repository's root: in a subfolder, git archive only writes what lies under that subfolder.
  git -C "$(git rev-parse --show-toplevel)" archive "$rev:$path" | tar -xmf - -C target/grammar
  GRAMMAR=target/grammar
  echo "grammar: $repository at $rev"
else
  echo "grammar: $GRAMMAR"
fi

# A config of our own, so tree-sitter does not read the user's and does not warn that no parser directories are
# configured. The folder it names stays empty: the grammar is the current directory.
mkdir -p "$here/target/tree-sitter/parsers"
config="$here/target/tree-sitter/config.json"
printf '{ "parser-directories": ["%s"] }\n' "$here/target/tree-sitter/parsers" > "$config"

cd "$GRAMMAR"
pnpm install --frozen-lockfile --silent
for query in "$here"/languages/reactivescript/*.scm; do
  echo "$(basename "$query")"
  pnpm exec tree-sitter query --config-path "$config" "$query" "$here"/../../examples/*.rx > /dev/null
done
