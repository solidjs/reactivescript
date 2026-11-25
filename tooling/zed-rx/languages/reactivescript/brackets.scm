; Matching brackets for ReactiveScript (.rx) in Zed.
;
; Written against the rx grammar (tooling/tree-sitter-rx, MIT) and its JSX and TypeScript node names, which are
; tree-sitter-javascript's and tree-sitter-typescript's (MIT). Each pattern pairs an opening token with the closing
; token of the same node.

; Parentheses, square brackets and braces: calls, parameters, arrays, objects, statement blocks, view blocks,
; `{expr}` in markup, `effect (a, b)`, `rejects(E)`
("(" @open ")" @close)
("[" @open "]" @close)
("{" @open "}" @close)

; `${ … }` in a template
(template_substitution
  "${" @open
  "}" @close)

; Angle brackets of type arguments and type parameters
(type_arguments
  "<" @open
  ">" @close)
(type_parameters
  "<" @open
  ">" @close)

; Markup tags: `<p …>`, `</p>`, `<input … />`
(jsx_opening_element
  "<" @open
  ">" @close)
(jsx_closing_element
  "</" @open
  ">" @close)
(jsx_self_closing_element
  "<" @open
  "/>" @close)

; `<style>` and `</style>`
(style_element
  "<" @open
  .
  (identifier)
  .
  ">" @close)
(style_element
  "</" @open
  .
  (identifier)
  .
  ">" @close)

; Quotes: matched, but left out of rainbow colouring
((string
  "\"" @open
  "\"" @close)
  (#set! rainbow.exclude))
((string
  "'" @open
  "'" @close)
  (#set! rainbow.exclude))
((template_string
  "`" @open
  "`" @close)
  (#set! rainbow.exclude))
