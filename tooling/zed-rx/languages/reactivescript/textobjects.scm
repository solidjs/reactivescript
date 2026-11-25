; Text objects (Vim mode) for ReactiveScript (.rx) in Zed.
;
; Written against the rx grammar (tooling/tree-sitter-rx, MIT), whose function and class nodes are
; tree-sitter-javascript's and tree-sitter-typescript's (MIT). "Inside" is what lies between a body's braces, or an
; expression body as a whole.

; ============================================================ rx callables

(component_declaration
  body: (view_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(fn_declaration
  body: (fn_body
    "{"
    (_)* @function.inside
    "}")) @function.around

(fn_declaration
  "=>"
  body: (_) @function.inside) @function.around

; A `.d.rx` row has no body
(fn_signature) @function.around

(server_function_declaration
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(action_declaration
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(effect_declaration
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(server_fn_expression
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(fn_expression
  body: (_) @function.inside) @function.around

; ============================================================ JavaScript functions

(function_declaration
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(function_expression
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(method_definition
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(arrow_function
  body: (statement_block
    "{"
    (_)* @function.inside
    "}")) @function.around

(arrow_function
  body: (expression) @function.inside) @function.around

; ============================================================ classes

(error_declaration) @class.around

(class_declaration
  body: (class_body
    "{"
    (_)* @class.inside
    "}")) @class.around

(class
  body: (class_body
    "{"
    (_)* @class.inside
    "}")) @class.around

; ============================================================ comments

(comment)+ @comment.around
