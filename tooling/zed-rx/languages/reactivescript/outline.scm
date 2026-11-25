; Outline (symbols) for ReactiveScript (.rx) in Zed.
;
; Written against the rx grammar (tooling/tree-sitter-rx, MIT), after the definitions tree-sitter-javascript's and
; tree-sitter-typescript's tags.scm (MIT) list. Each entry: the declaring keyword as @context, the name as @name, the
; whole declaration as @item.

(comment) @annotation

; ============================================================ callables

(component_declaration
  "component" @context
  name: (_) @name) @item

(fn_declaration
  "fn" @context
  name: (_) @name) @item

; A `.d.rx` row: `server pure fn f(…)`
(fn_signature
  (side)? @context
  (pure)? @context
  "fn" @context
  name: (_) @name) @item

; `server fn f(…) { … }`
(server_function_declaration
  (side) @context
  "fn" @context
  name: (_) @name) @item

(action_declaration
  "action" @context
  name: (_) @name) @item

; ============================================================ errors, contexts, types

(error_declaration
  "error" @context
  name: (_) @name) @item

(context_declaration
  "context" @context
  name: (_) @name) @item

(type_alias_declaration
  "type" @context
  name: (_) @name) @item

(interface_declaration
  "interface" @context
  name: (_) @name) @item

; ============================================================ sources and equations
;
; Listed at module level (bare or exported) and directly in a component's body, not in fn bodies or control blocks.

(program
  (source_declaration
    "source" @context
    name: (_) @name) @item)

(program
  (export_statement
    declaration: (source_declaration
      "source" @context
      name: (_) @name) @item))

(component_declaration
  body: (view_block
    (source_declaration
      "source" @context
      name: (_) @name) @item))

; `x = e`, `deferred x = e`
(program
  (equation
    (deferred)? @context
    name: (identifier) @name) @item)

(program
  (export_statement
    declaration: (equation
      (deferred)? @context
      name: (identifier) @name) @item))

(component_declaration
  body: (view_block
    (equation
      (deferred)? @context
      name: (identifier) @name) @item))

; `{ a, b: c } = e` and `[a, b] = e`: one entry per bound name
(program
  (equation
    name: [
      (object_pattern
        [
          (shorthand_property_identifier_pattern) @name @item
          (pair_pattern
            value: (identifier) @name @item)
          (object_assignment_pattern
            left: (shorthand_property_identifier_pattern) @name @item)
        ])
      (array_pattern
        (identifier) @name @item)
    ]))

(program
  (export_statement
    declaration: (equation
      name: [
        (object_pattern
          [
            (shorthand_property_identifier_pattern) @name @item
            (pair_pattern
              value: (identifier) @name @item)
            (object_assignment_pattern
              left: (shorthand_property_identifier_pattern) @name @item)
          ])
        (array_pattern
          (identifier) @name @item)
      ])))

(component_declaration
  body: (view_block
    (equation
      name: [
        (object_pattern
          [
            (shorthand_property_identifier_pattern) @name @item
            (pair_pattern
              value: (identifier) @name @item)
            (object_assignment_pattern
              left: (shorthand_property_identifier_pattern) @name @item)
          ])
        (array_pattern
          (identifier) @name @item)
      ])))
