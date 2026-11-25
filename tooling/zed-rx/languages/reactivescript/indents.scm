; Auto-indentation for ReactiveScript (.rx) in Zed.
;
; Written against the rx grammar (tooling/tree-sitter-rx, MIT), whose expression, type and JSX nodes are
; tree-sitter-javascript's and tree-sitter-typescript's (MIT).
;
; Every rx block has its own braces: a component's body and the bodies of `if`/`for`/`loading`/`errored`/`portal` are
; `view_block`s, `action`/`effect`/server fn bodies are `statement_block`s, a `fn`'s body is an `fn_body`. So the
; bracket rules below already indent them, and there are no separate rules for those declarations (a second range
; over the same lines would indent twice).

; Anything between a pair of brackets, closing on the closing bracket
(_ "{" "}" @end) @indent
(_ "[" "]" @end) @indent
(_ "(" ")" @end) @indent

; `${ … }` broken across lines
(template_substitution "}" @end) @indent

; A markup element's children, between its tags
(jsx_element
  (jsx_opening_element) @start
  (jsx_closing_element)? @end) @indent

; Attributes of a tag broken across lines
(jsx_opening_element ">" @end) @indent
(jsx_self_closing_element "/>" @end) @indent

; A `<style>`'s CSS
(style_element
  ">" @start
  "</" @end) @indent

; `fn f(x) =>` with its expression on the next line
(fn_declaration
  "=>" @start
  body: (_)) @indent

; An arrow function or `fn (…) =>` whose body is an expression on the next line
(arrow_function
  "=>" @start
  body: (expression)) @indent
(fn_expression
  "=>" @start
  body: (_)) @indent
