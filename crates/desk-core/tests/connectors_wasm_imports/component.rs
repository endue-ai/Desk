//! Test connectors in component WAT whose `sync` makes `desk:host` calls: each `Step` is one or two
//! imports, and the first import that fails makes its error `sync`'s own answer. Otherwise `sync`
//! answers ok with no changes, no cursor and `done`; `status` is ok, `query` an empty page and `act`
//! the JSON text `null`. A component imports only the interfaces its steps call.
//!
//! Memory: the steps' strings from 16, `sync`'s ok answer at 1024 (`done` at 1048), every import's
//! return area at 1536, zeroes at 2048 (`status` ok, `query` an empty page), `act`'s answer at 3072.
//! An import's error at 1536 has the layout of `sync`'s error (tag, code, message), so `sync` returns
//! that address as is. What the host hands in lands past 4096 through a bump `realloc` that never
//! frees. Memory and `realloc` live in a core module of their own, `$libc`: the lowered imports need
//! both before the module that calls them is instantiated.

/// A `desk:host/log` level.
#[derive(Debug, Clone, Copy)]
pub enum Level {
    Info,
    Warn,
}

impl Level {
    /// Its case in the WIT's `enum level { debug, info, warn, error }`.
    fn case(self) -> u32 {
        match self {
            Self::Info => 1,
            Self::Warn => 2,
        }
    }
}

/// One thing `sync` does, in order.
#[derive(Debug, Clone, Copy)]
pub enum Step<'a> {
    /// net.fetch GET of the URL with a 5 s timeout, then log.write (info) of the response body.
    FetchAndLog(&'a str),
    /// settings.set of the key to the JSON text.
    Set(&'a str, &'a str),
    /// settings.get of the plugin's own key, then log.write (info) of the JSON text it read, or of
    /// `none` when the key was never set.
    GetAndLog(&'a str),
    /// log.write of the level, the message and the fields (JSON object text).
    Log(Level, &'a str, Option<&'a str>),
}

/// Where every import writes what it returns.
const RET: u32 = 1536;

/// A connector component whose `sync` runs `steps`.
pub fn connector(steps: &[Step]) -> Vec<u8> {
    let mut strings = Strings {
        next: 16,
        data: String::new(),
    };
    let mut body = String::new();
    let (mut net, mut settings, mut log) = (false, false, false);
    for step in steps {
        match *step {
            Step::FetchAndLog(url) => {
                (net, log) = (true, true);
                let (url, url_len) = strings.add(url);
                let (get, get_len) = strings.add("GET");
                body.push_str(&format!(
                    "(call $fetch (i32.const {url}) (i32.const {url_len}) (i32.const {get})
                       (i32.const {get_len}) (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)
                       (i32.const 0) (i32.const 1) (i32.const 5000) (i32.const {RET}))
                     {check}
                     {write}",
                    check = check(),
                    write = write(Level::Info, &load(RET + 16), &load(RET + 20), None),
                ));
            }
            Step::Set(key, value) => {
                settings = true;
                let (key, key_len) = strings.add(key);
                let (value, value_len) = strings.add(value);
                body.push_str(&format!(
                    "(call $set (i32.const {key}) (i32.const {key_len}) (i32.const {value})
                       (i32.const {value_len}) (i32.const {RET}))
                     {check}",
                    check = check(),
                ));
            }
            Step::GetAndLog(key) => {
                (settings, log) = (true, true);
                let (key, key_len) = strings.add(key);
                let (none, none_len) = strings.add("none");
                body.push_str(&format!(
                    "(call $get (i32.const {key}) (i32.const {key_len}) (i32.const 0) (i32.const 0)
                       (i32.const 0) (i32.const {RET}))
                     {check}
                     (if (i32.load8_u (i32.const {some}))
                       (then {found})
                       (else {missing}))",
                    check = check(),
                    some = RET + 4,
                    found = write(Level::Info, &load(RET + 8), &load(RET + 12), None),
                    missing = write(Level::Info, &konst(none), &konst(none_len), None),
                ));
            }
            Step::Log(level, message, fields) => {
                log = true;
                let (message, message_len) = strings.add(message);
                let fields = fields.map(|fields| strings.add(fields));
                body.push_str(&write(level, &konst(message), &konst(message_len), fields));
            }
        }
    }
    let mut imports = String::new();
    let mut lowered = String::new();
    let mut core_imports = String::new();
    let mut host = String::new();
    let mut lower = |name: &str, func: &str, params: usize| {
        lowered.push_str(&format!(
            "  (core func ${name}-low (canon lower (func {func}) (memory (core memory $libc \"memory\"))
      (realloc (core func $libc \"realloc\"))))\n"
        ));
        let params = vec!["i32"; params].join(" ");
        core_imports.push_str(&format!(
            "    (import \"host\" \"{name}\" (func ${name} (param {params})))\n"
        ));
        host.push_str(&format!(" (export \"{name}\" (func ${name}-low))"));
    };
    if net {
        imports.push_str(&NET.replace("{ERRORS}", ERRORS));
        // request: url, method, headers, body (tag, pointer, length), timeout (tag, value); then the
        // return area.
        lower("fetch", "$host-fetch", 12);
    }
    if settings {
        imports.push_str(&SETTINGS.replace("{ERRORS}", ERRORS));
        lower("get", "$host-get", 6);
        lower("set", "$host-set", 5);
    }
    if log {
        imports.push_str(&LOG.replace("{ERRORS}", ERRORS));
        lower("log", "$host-write", 7);
    }
    let data = strings.data;
    let wat = format!(
        r#"(component
{imports}
  (core module $libc
    (memory (export "memory") 1)
    (global $next (mut i32) (i32.const 4096))
    (func (export "realloc") (param i32 i32 i32 i32) (result i32) (local $at i32)
      (local.set $at (i32.and
        (i32.add (global.get $next) (i32.sub (local.get 2) (i32.const 1)))
        (i32.sub (i32.const 0) (local.get 2))))
      (global.set $next (i32.add (local.get $at) (local.get 3)))
      (local.get $at)))
  (core instance $libc (instantiate $libc))
{lowered}
  (core module $m
    (import "libc" "memory" (memory 1))
{core_imports}
    (data (i32.const 1048) "\01")
    (data (i32.const 3072) "\00\00\00\00\10\0c\00\00\04\00\00\00\00\00\00\00null")
{data}
    (func (export "sync") (param i32 i32 i32 i32 i32 i32 i32) (result i32) {body} (i32.const 1024))
    (func (export "query") (param i32) (result i32) (i32.const 2048))
    (func (export "act") (param i32 i32 i32 i32 i32 i32 i32 i32) (result i32) (i32.const 3072))
    (func (export "status") (param i32 i32 i32 i32) (result i32) (i32.const 2048)))
  (core instance $i (instantiate $m
    (with "libc" (instance $libc))
    (with "host" (instance{host}))))
{EXPORTS}
)"#
    );
    wat::parse_str(&wat)
        .unwrap_or_else(|e| panic!("the test connector is not valid WAT: {e}\n{wat}"))
}

/// Strings in the module's data, one after the other from 16.
struct Strings {
    next: u32,
    data: String,
}

impl Strings {
    /// Place `text` and answer its address and length.
    fn add(&mut self, text: &str) -> (u32, u32) {
        let (at, len) = (self.next, u32::try_from(text.len()).unwrap());
        assert!(at + len <= 1024, "the steps' strings fit below 1024");
        let escaped: String = text
            .bytes()
            .map(|b| match b {
                b'"' | b'\\' => format!("\\{b:02x}"),
                0x20..0x7f => char::from(b).to_string(),
                _ => format!("\\{b:02x}"),
            })
            .collect();
        self.data
            .push_str(&format!("    (data (i32.const {at}) \"{escaped}\")\n"));
        self.next = at + len;
        (at, len)
    }
}

/// Return the import's error as `sync`'s when its result is an error.
fn check() -> String {
    format!("(if (i32.load8_u (i32.const {RET})) (then (return (i32.const {RET}))))")
}

/// log.write of the message at `ptr` with `len` (WAT expressions), then `check`.
fn write(level: Level, ptr: &str, len: &str, fields: Option<(u32, u32)>) -> String {
    let (tag, at, n) = fields.map_or((0, 0, 0), |(at, n)| (1, at, n));
    format!(
        "(call $log (i32.const {case}) {ptr} {len} (i32.const {tag}) (i32.const {at})
           (i32.const {n}) (i32.const {RET}))
         {check}",
        case = level.case(),
        check = check(),
    )
}

fn load(at: u32) -> String {
    format!("(i32.load (i32.const {at}))")
}

fn konst(value: u32) -> String {
    format!("(i32.const {value})")
}

/// `desk:host/types` as each interface below sees it: wasmtime matches functions by structure and
/// skips type exports, so each import declares its own copy.
const ERRORS: &str = r#"(type $code (enum "permission-denied" "invalid-params" "not-found"
      "already-exists" "io-error" "timeout" "cancelled" "unsupported" "internal"))
    (export "error-code" (type $code-e (eq $code)))
    (type $error (record (field "code" $code-e) (field "message" string)))
    (export "error" (type $error-e (eq $error)))"#;

const NET: &str = r#"  (import "desk:host/net@0.0.0" (instance $net
    {ERRORS}
    (type $request (record (field "url" string) (field "method" string)
      (field "headers" (list (tuple string string))) (field "body" (option (list u8)))
      (field "timeout-ms" (option u32))))
    (export "request" (type $request-e (eq $request)))
    (type $response (record (field "status" u16) (field "headers" (list (tuple string string)))
      (field "body" (list u8))))
    (export "response" (type $response-e (eq $response)))
    (export "fetch" (func (param "req" $request-e) (result (result $response-e (error $error-e)))))))
  (alias export $net "fetch" (func $host-fetch))
"#;

const SETTINGS: &str = r#"  (import "desk:host/settings@0.0.0" (instance $settings
    {ERRORS}
    (export "get" (func (param "key" string) (param "owner" (option string))
      (result (result (option string) (error $error-e)))))
    (export "set" (func (param "key" string) (param "value" string)
      (result (result (error $error-e)))))))
  (alias export $settings "get" (func $host-get))
  (alias export $settings "set" (func $host-set))
"#;

const LOG: &str = r#"  (import "desk:host/log@0.0.0" (instance $log
    {ERRORS}
    (type $level (enum "debug" "info" "warn" "error"))
    (export "level" (type $level-e (eq $level)))
    (export "write" (func (param "level" $level-e) (param "message" string)
      (param "fields" (option string)) (result (result (error $error-e)))))))
  (alias export $log "write" (func $host-write))
"#;

/// The connector world's exports, lifted from `$m` with `$libc`'s memory and `realloc`.
const EXPORTS: &str = r#"  (type $code (enum "permission-denied" "invalid-params" "not-found" "already-exists"
    "io-error" "timeout" "cancelled" "unsupported" "internal"))
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
    (canon lift (core func $i "sync") (memory (core memory $libc "memory"))
      (realloc (core func $libc "realloc"))))
  (func $query (param "instance" $instance-out) (param "query" $query-out)
    (result (result $page-out (error $error-out)))
    (canon lift (core func $i "query") (memory (core memory $libc "memory"))
      (realloc (core func $libc "realloc"))))
  (func $act (param "instance" $instance-out) (param "action" string) (param "args-json" string)
    (result (result string (error $error-out)))
    (canon lift (core func $i "act") (memory (core memory $libc "memory"))
      (realloc (core func $libc "realloc"))))
  (func $status (param "instance" $instance-out) (result (result (error $error-out)))
    (canon lift (core func $i "status") (memory (core memory $libc "memory"))
      (realloc (core func $libc "realloc"))))
  (export "sync" (func $sync))
  (export "query" (func $query))
  (export "act" (func $act))
  (export "status" (func $status))"#;
