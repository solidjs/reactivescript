; Scopes for ReactiveScript (.rx) that config.toml's [overrides.*] sections refer to, for Zed.
;
; Written against the rx grammar (tooling/tree-sitter-rx, MIT), whose string, comment and JSX nodes are
; tree-sitter-javascript's and tree-sitter-typescript's (MIT). The innermost scope at the cursor applies.

; Comments, up to and including the end of a line comment
(comment) @comment.inclusive

; Strings and templates
[
  (string)
  (template_string)
] @string

; Between a markup element's tags: comments there are `{/* … */}`
(jsx_element) @element

; Back to rx inside markup: the tags themselves and `{…}` (an expression, or a control block)
[
  (jsx_opening_element)
  (jsx_closing_element)
  (jsx_self_closing_element)
  (jsx_expression)
] @default

; `useThing<T>(…)`: the function's name when type arguments follow it
(call_expression
  function: (identifier) @function_name_before_type_arguments
  type_arguments: (type_arguments))

(call_expression
  function: (member_expression
    property: (property_identifier) @function_name_before_type_arguments)
  type_arguments: (type_arguments))
