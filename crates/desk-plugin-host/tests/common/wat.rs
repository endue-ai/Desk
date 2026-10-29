//! Small test components written in component WAT. Each exports all three functions of the
//! `plugin` world, since instantiation looks every export up.

/// What each export of a test component runs before it returns the result stored at offset 1024
/// of its memory, which `data` (WAT string escapes) fills; zeroes there mean `ok`.
#[derive(Debug, Default, Clone, Copy)]
pub struct Exports<'a> {
    pub start: &'a str,
    pub on_command: &'a str,
    pub on_event: &'a str,
    pub data: &'a str,
}

/// A component whose exports run the given bodies. `on-command` and `on-event` take strings, so
/// the core module also exports a bump `realloc` (from offset 4096, never freed) to lift them.
pub fn exports(exports: Exports) -> Vec<u8> {
    let Exports {
        start,
        on_command,
        on_event,
        data,
    } = exports;
    let wat = format!(
        r#"(component
  (core module $m
    (memory (export "memory") 1)
    (global $next (mut i32) (i32.const 4096))
    (data (i32.const 1024) "{data}")
    (func (export "realloc") (param i32 i32 i32 i32) (result i32) (local $at i32)
      (local.set $at (i32.and
        (i32.add (global.get $next) (i32.sub (local.get 2) (i32.const 1)))
        (i32.sub (i32.const 0) (local.get 2))))
      (global.set $next (i32.add (local.get $at) (local.get 3)))
      (local.get $at))
    (func (export "start") (result i32) {start} (i32.const 1024))
    (func (export "on-command") (param i32 i32 i32 i32 i32 i32) (result i32)
      {on_command} (i32.const 1024))
    (func (export "on-event") (param i32 i32 i32 i32) (result i32) {on_event} (i32.const 1024)))
  (core instance $i (instantiate $m))
  (type $code (enum "permission-denied" "invalid-params" "not-found" "already-exists" "io-error"
    "timeout" "cancelled" "unsupported" "internal"))
  (export $code-out "error-code" (type $code))
  (type $error (record (field "code" $code-out) (field "message" string)))
  (export $error-out "error" (type $error))
  (func $start (result (result (error $error-out)))
    (canon lift (core func $i "start") (memory (core memory $i "memory"))))
  (func $on-command
    (param "invocation-id" string) (param "command-id" string) (param "args-json" string)
    (result (result (error $error-out)))
    (canon lift (core func $i "on-command") (memory (core memory $i "memory"))
      (realloc (func $i "realloc"))))
  (func $on-event (param "name" string) (param "data-json" string)
    (result (result (error $error-out)))
    (canon lift (core func $i "on-event") (memory (core memory $i "memory"))
      (realloc (func $i "realloc"))))
  (export "start" (func $start))
  (export "on-command" (func $on-command))
  (export "on-event" (func $on-event)))"#
    );
    wat::parse_str(wat).expect("the test component is valid WAT")
}

/// `start` runs `body`, then returns what `data` holds; the other exports return `ok`.
pub fn component(body: &str, data: &str) -> Vec<u8> {
    exports(Exports {
        start: body,
        data,
        ..Exports::default()
    })
}

/// `on-command` runs `body`; every export returns `ok`.
pub fn on_command(body: &str) -> Vec<u8> {
    exports(Exports {
        on_command: body,
        ..Exports::default()
    })
}

/// `on-event` runs `body`; every export returns `ok`.
pub fn on_event(body: &str) -> Vec<u8> {
    exports(Exports {
        on_event: body,
        ..Exports::default()
    })
}

/// Every export succeeds.
pub fn fine() -> Vec<u8> {
    component("", "")
}

/// `start` returns the guest error `internal` with `message` (at most 16 ASCII bytes).
pub fn failing(message: &str) -> Vec<u8> {
    assert!(message.len() <= 16 && message.is_ascii());
    // result tag 1 at 1024, enum case 8 (internal) at 1028, string pointer 1040 and length at 1032.
    let len = message.len();
    component(
        "",
        &format!(r"\01\00\00\00\08\00\00\00\10\04\00\00\{len:02x}\00\00\00{message}"),
    )
}
