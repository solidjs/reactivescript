; Embedded languages in ReactiveScript (.rx) for Zed.
;
; Based on the rx grammar's own queries/injections.scm and tree-sitter-javascript's injections.scm (both MIT).

; A <style> element's body is CSS
((style_element
  (raw_text) @injection.content)
  (#set! injection.language "css"))

; JSDoc in /** */ comments only: a // line or a plain /* */ block is prose
((comment) @injection.content
  (#match? @injection.content "^/\\*\\*[^*/]")
  (#set! injection.language "jsdoc"))

; Regex syntax in regex literals
((regex_pattern) @injection.content
  (#set! injection.language "regex"))

; Tagged templates, one pattern per tag with its language named, as Zed's TSX injections do: css`…`, html`…`,
; sql`…`, graphql`…`/gql`…`. Each text piece of the template is injected on its own. (Taking the language from a
; capture, with injection.combined, stops Zed's tag auto-close from working anywhere in the file.)
(call_expression
  function: (identifier) @_tag
  (#eq? @_tag "css")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "css")))

(call_expression
  function: (identifier) @_tag
  (#eq? @_tag "html")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "html")))

(call_expression
  function: (identifier) @_tag
  (#eq? @_tag "sql")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "sql")))

(call_expression
  function: (identifier) @_tag
  (#any-of? @_tag "graphql" "gql")
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "graphql")))

; styled.div`…`, styled(Button)`…`: CSS
(call_expression
  function: (member_expression
    object: (identifier) @_styled
    (#eq? @_styled "styled"))
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "css")))

(call_expression
  function: (call_expression
    function: (identifier) @_styled
    (#eq? @_styled "styled"))
  arguments: (template_string
    (string_fragment) @injection.content
    (#set! injection.language "css")))
