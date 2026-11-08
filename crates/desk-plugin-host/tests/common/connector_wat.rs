//! Connector-world test components in component WAT. `sync` runs a given body; the other exports
//! succeed: `status` ok, `query` an empty page, `act` the JSON text `null`.

/// A component of the `desk:connector/connector` world whose `sync` runs `body`, then answers ok
/// with no changes, no cursor and `done`.
///
/// Return areas in its memory: `sync` at 1024 (`done` is the byte at 1048), `status` and `query` at
/// 2048 (zeroes: ok, an empty page), `act` at 3072 (ok, a string at 3088 of length 4). Strings the
/// host passes in land past 4096, through a bump `realloc` that never frees.
pub fn connector(body: &str) -> Vec<u8> {
    let wat = format!(
        r#"(component
  (core module $m
    (memory (export "memory") 1)
    (global $next (mut i32) (i32.const 4096))
    (data (i32.const 1048) "\01")
    (data (i32.const 3072) "\00\00\00\00\10\0c\00\00\04\00\00\00\00\00\00\00null")
    (func (export "realloc") (param i32 i32 i32 i32) (result i32) (local $at i32)
      (local.set $at (i32.and
        (i32.add (global.get $next) (i32.sub (local.get 2) (i32.const 1)))
        (i32.sub (i32.const 0) (local.get 2))))
      (global.set $next (i32.add (local.get $at) (local.get 3)))
      (local.get $at))
    (func (export "sync") (param i32 i32 i32 i32 i32 i32 i32) (result i32) {body} (i32.const 1024))
    (func (export "query") (param i32) (result i32) (i32.const 2048))
    (func (export "act") (param i32 i32 i32 i32 i32 i32 i32 i32) (result i32) (i32.const 3072))
    (func (export "status") (param i32 i32 i32 i32) (result i32) (i32.const 2048)))
  (core instance $i (instantiate $m))
  (type $code (enum "permission-denied" "invalid-params" "not-found" "already-exists" "io-error"
    "timeout" "cancelled" "unsupported" "internal"))
  (export $code-out "error-code" (type $code))
  (type $error (record (field "code" $code-out) (field "message" string)))
  (export $error-out "error" (type $error))
  (type $kind (enum "event" "message" "task" "note" "file" "person" "entry" "metric" "record"))
  (export $kind-out "item-kind" (type $kind))
  (type $instance (record (field "id" string) (field "settings" string)))
  (export $instance-out "instance" (type $instance))
  (type $item (record (field "id" string) (field "kind" $kind-out) (field "title" string)
    (field "updated-at" string) (field "created-at" (option string))
    (field "deep-link" (option string)) (field "body" (option string))
    (field "details" string) (field "raw" (option string))))
  (export $item-out "item" (type $item))
  (type $change (variant (case "upserted" $item-out) (case "removed" string)))
  (export $change-out "item-change" (type $change))
  (type $sync-result (record (field "changes" (list $change-out))
    (field "cursor" (option string)) (field "done" bool)))
  (export $sync-result-out "sync-result" (type $sync-result))
  (type $query (record (field "kinds" (list $kind-out)) (field "text" (option string))
    (field "conditions" (option string)) (field "sort" (option string))
    (field "cursor" (option string)) (field "limit" u32)))
  (export $query-out "item-query" (type $query))
  (type $page (record (field "items" (list $item-out)) (field "cursor" (option string))))
  (export $page-out "item-page" (type $page))
  (func $sync (param "instance" $instance-out) (param "cursor" (option string))
    (result (result $sync-result-out (error $error-out)))
    (canon lift (core func $i "sync") (memory (core memory $i "memory"))
      (realloc (core func $i "realloc"))))
  (func $query (param "instance" $instance-out) (param "query" $query-out)
    (result (result $page-out (error $error-out)))
    (canon lift (core func $i "query") (memory (core memory $i "memory"))
      (realloc (core func $i "realloc"))))
  (func $act (param "instance" $instance-out) (param "action" string) (param "args-json" string)
    (result (result string (error $error-out)))
    (canon lift (core func $i "act") (memory (core memory $i "memory"))
      (realloc (core func $i "realloc"))))
  (func $status (param "instance" $instance-out) (result (result (error $error-out)))
    (canon lift (core func $i "status") (memory (core memory $i "memory"))
      (realloc (core func $i "realloc"))))
  (export "sync" (func $sync))
  (export "query" (func $query))
  (export "act" (func $act))
  (export "status" (func $status)))"#
    );
    wat::parse_str(wat).expect("the test connector is valid WAT")
}
