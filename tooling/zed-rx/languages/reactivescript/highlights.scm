; Syntax highlighting for ReactiveScript (.rx) in Zed.
;
; Based on the rx grammar's own queries/highlights.scm, which in turn follows tree-sitter-javascript's highlights.scm
; and highlights-jsx.scm and tree-sitter-typescript's highlights.scm (all MIT). Capture names are the ones Zed's
; extension docs list for themes. When two patterns capture the same node the later one wins, so the file runs from
; the general (every identifier) to the specific (an equation's name, a JSX tag).

; ============================================================ names, general

(identifier) @variable

(property_identifier) @property
(shorthand_property_identifier) @property
(private_property_identifier) @property

; A capitalised name is most often a constructor or an error class; all-caps is a constant
((identifier) @constructor
  (#match? @constructor "^[A-Z]"))

([
  (identifier)
  (shorthand_property_identifier)
  (shorthand_property_identifier_pattern)
] @constant
  (#match? @constant "^[A-Z_][A-Z0-9_]+$"))

; Globals a browser program reads
((identifier) @variable.special
  (#match? @variable.special "^(arguments|console|window|document|globalThis)$"))

(this) @variable.special
(super) @variable.special

; ============================================================ types

(type_identifier) @type
(predefined_type) @type.builtin

; ============================================================ functions

(function_declaration
  name: (identifier) @function)

(function_expression
  name: (identifier) @function)

(method_definition
  name: (property_identifier) @function)

(pair
  key: (property_identifier) @function
  value: [(function_expression) (arrow_function) (fn_expression)])

(variable_declarator
  name: (identifier) @function
  value: [(function_expression) (arrow_function) (fn_expression)])

(call_expression
  function: (identifier) @function)

(call_expression
  function: (member_expression
    property: (property_identifier) @function))

; The prelude. A theme without `function.builtin` styles it as `function`.
(call_expression
  function: (identifier) @function.builtin
  (#any-of? @function.builtin "log" "onFlush" "onSettled"))

; ============================================================ parameters

(required_parameter
  pattern: (identifier) @variable.parameter)

(optional_parameter
  pattern: (identifier) @variable.parameter)

; A destructured parameter: `{ a, b = 1, c: d }` and `[a, b = 1]`
(required_parameter
  pattern: (object_pattern
    [
      (shorthand_property_identifier_pattern) @variable.parameter
      (object_assignment_pattern
        left: (shorthand_property_identifier_pattern) @variable.parameter)
      (pair_pattern
        value: (identifier) @variable.parameter)
    ]))

(optional_parameter
  pattern: (object_pattern
    [
      (shorthand_property_identifier_pattern) @variable.parameter
      (object_assignment_pattern
        left: (shorthand_property_identifier_pattern) @variable.parameter)
      (pair_pattern
        value: (identifier) @variable.parameter)
    ]))

(required_parameter
  pattern: (array_pattern
    [
      (identifier) @variable.parameter
      (assignment_pattern
        left: (identifier) @variable.parameter)
    ]))

(optional_parameter
  pattern: (array_pattern
    [
      (identifier) @variable.parameter
      (assignment_pattern
        left: (identifier) @variable.parameter)
    ]))

(arrow_function
  parameter: (identifier) @variable.parameter)

(for_block
  name: (identifier) @variable.parameter)

(errored_block
  parameter: (identifier) @variable.parameter)

(catch_expression
  parameter: (identifier) @variable.parameter)

(catch_clause
  parameter: (identifier) @variable.parameter)

; ============================================================ literals

(comment) @comment

; As injections.scm: `/**/` and a `/***` banner are plain comments
((comment) @comment.doc
  (#match? @comment.doc "^/\\*\\*[^*/]"))

(string) @string
(template_string) @string
(escape_sequence) @string.escape
(regex) @string.regex
(number) @number

[
  (true)
  (false)
] @boolean

[
  (null)
  (undefined)
] @constant.builtin

; ============================================================ punctuation and operators

[
  ";"
  ","
  "."
  ":"
  (optional_chain)
] @punctuation.delimiter

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

(template_substitution
  "${" @punctuation.special
  "}" @punctuation.special) @embedded

[
  "+"
  "-"
  "*"
  "/"
  "%"
  "**"
  "++"
  "--"
  "="
  "=="
  "==="
  "!="
  "!=="
  "<"
  "<="
  ">"
  ">="
  "<<"
  ">>"
  ">>>"
  "!"
  "~"
  "^"
  "&"
  "|"
  "&&"
  "||"
  "??"
  "=>"
  "..."
  "?"
  "->"
] @operator

; After the operators: a generic's angle brackets are brackets, not comparisons
(type_arguments
  [
    "<"
    ">"
  ] @punctuation.bracket)

(type_parameters
  [
    "<"
    ">"
  ] @punctuation.bracket)

; ============================================================ keywords (JavaScript, TypeScript)

[
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "import"
  "in"
  "instanceof"
  "let"
  "new"
  "of"
  "return"
  "set"
  "static"
  "switch"
  "target"
  "throw"
  "try"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
  "abstract"
  "declare"
  "enum"
  "implements"
  "interface"
  "keyof"
  "namespace"
  "private"
  "protected"
  "public"
  "readonly"
  "override"
  "satisfies"
  "type"
  "is"
  "infer"
] @keyword

; ============================================================ keywords (ReactiveScript)

[
  "source"
  "component"
  "action"
  "effect"
  "fn"
  "context"
  "provide"
  "use"
  "error"
  "server"
  "client"
  "key"
  "fails"
  "rejects"
  "instantiates"
  "guess"
  "refresh"
  "affects"
  "loading"
  "errored"
  "fallback"
  "on"
  "portal"
  "to"
  "latest"
  "peek"
  "pre"
  "pending?"
  "draft"
] @keyword

[
  (side)
  (pure)
  (deferred)
  (ref_modifier)
] @keyword

; `await* stream`
(await_expression
  "*" @keyword)

; `:=` writes a source (or seeds one)
":=" @keyword.operator

; ============================================================ ReactiveScript declarations

; A source is state: its name, and the root of every write or guess, stand out. A query cannot recurse, so the root
; is found up to four members deep (`a.b.c.d.e := …`); a deeper target's root stays a plain variable.
(source_declaration
  name: (identifier) @variable.special)

(write_statement
  target: [
    (identifier) @variable.special
    (_ object: (identifier) @variable.special)
    (_ object: (_ object: (identifier) @variable.special))
    (_ object: (_ object: (_ object: (identifier) @variable.special)))
    (_ object: (_ object: (_ object: (_ object: (identifier) @variable.special))))
  ])

(guess_statement
  target: [
    (identifier) @variable.special
    (_ object: (identifier) @variable.special)
    (_ object: (_ object: (identifier) @variable.special))
    (_ object: (_ object: (_ object: (identifier) @variable.special)))
    (_ object: (_ object: (_ object: (_ object: (identifier) @variable.special))))
  ])

(refresh_statement
  name: (identifier) @variable.special)

(affects_statement
  name: (identifier) @variable.special)

(pre_expression
  name: (identifier) @variable.special)

; An equation is a derived value, named like a constant; so is each name a destructuring equation binds
(equation
  name: (identifier) @constant)

(equation
  name: (object_pattern
    [
      (shorthand_property_identifier_pattern) @constant
      (pair_pattern
        value: (identifier) @constant)
      (object_assignment_pattern
        left: (shorthand_property_identifier_pattern) @constant)
    ]))

(equation
  name: (array_pattern
    (identifier) @constant))

; Contexts
(context_declaration
  name: (identifier) @constant)

(provide_declaration
  name: (identifier) @constant)

(use_expression
  name: (identifier) @constant)

(key_clause
  name: (identifier) @property)

; Callables
(fn_declaration
  name: (identifier) @function)

(fn_signature
  name: (identifier) @function)

(server_function_declaration
  name: (identifier) @function)

(action_declaration
  name: (identifier) @function)

(component_declaration
  name: (identifier) @function)

(error_declaration
  name: (type_identifier) @type)

; An effect's inputs, `$0` … `$n`
((identifier) @variable.special
  (#match? @variable.special "^\\$[0-9]+$"))

; ============================================================ markup

(jsx_attribute
  (property_identifier) @attribute)

; An HTML tag is a tag; a capitalised one is a component, coloured as a type
(jsx_opening_element
  name: (identifier) @tag)
(jsx_closing_element
  name: (identifier) @tag)
(jsx_self_closing_element
  name: (identifier) @tag)

(jsx_opening_element
  name: (identifier) @type
  (#match? @type "^[A-Z]"))
(jsx_closing_element
  name: (identifier) @type
  (#match? @type "^[A-Z]"))
(jsx_self_closing_element
  name: (identifier) @type
  (#match? @type "^[A-Z]"))

; `<ui.Button>`: the namespace is a variable, the last part the component
(jsx_opening_element
  name: (member_expression
    property: (property_identifier) @type))
(jsx_closing_element
  name: (member_expression
    property: (property_identifier) @type))
(jsx_self_closing_element
  name: (member_expression
    property: (property_identifier) @type))

(jsx_opening_element
  [
    "<"
    ">"
  ] @punctuation.bracket)
(jsx_closing_element
  [
    "</"
    ">"
  ] @punctuation.bracket)
(jsx_self_closing_element
  [
    "<"
    "/>"
  ] @punctuation.bracket)

; `<style>` … `</style>`
(style_element
  (identifier) @tag)

(style_element
  [
    "<"
    ">"
    "</"
  ] @punctuation.bracket)
