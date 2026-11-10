//! `desk-wm` for a desk without the compositor (#83): the runtime's unit tests and its fixture
//! pages hold no window manager of their own, so they run this one, built for
//! `wasm32-unknown-unknown`, as the app's shell runs it natively. One window manager per instance,
//! reached through one call: the page writes a JSON request into `input(len)`'s buffer, `call`
//! answers its length, and `output` is where the answer is.
//!
//! - `{"edit": {"seq", "edits"}}`: the runtime's edits (`desk_wm::edits`); answers the desks
//!   published (`{"published": [...]}`).
//! - `{"took": {"applied", "screen"}}`: the page laid out a revision on an app this size.
//! - `{"run": {"op", "window"}}`: a window command, as a test's stand-in for the compositor's input.
//! - `{"snapshot": {"titles", "frames"}}`: what `desk.windows.list` answers.
//!
//! [`answer`] is the call itself, in plain Rust, which the tests drive.

// The exports' symbols must keep their names (`no_mangle`), which the lint counts as unsafe; no
// pointer is dereferenced here: the page writes into a buffer this module owns, between calls.
#![allow(unsafe_code)]

use std::cell::RefCell;

use desk_wm::Size;
use desk_wm::interact::{Op, Out, Wm};
use desk_wm::{Told, snapshot::Seen};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Request {
    Edit {
        seq: u64,
        edits: Vec<Value>,
    },
    Took {
        applied: u64,
        screen: Size,
    },
    Run {
        #[serde(flatten)]
        op: Op,
        #[serde(default)]
        window: Option<String>,
    },
    Snapshot(Told),
}

/// The desks `outs` published.
fn published(outs: Vec<Out>) -> Value {
    let all: Vec<Value> = outs
        .into_iter()
        .filter_map(|out| match out {
            Out::Publish(p) => serde_json::to_value(&*p).ok(),
            _ => None,
        })
        .collect();
    json!({ "published": all })
}

/// Answer the JSON request `text` on `wm`.
pub fn answer(wm: &mut Wm, text: &str) -> Value {
    let request: Request = match serde_json::from_str(text) {
        Ok(r) => r,
        Err(why) => return json!({ "error": why.to_string() }),
    };
    match request {
        Request::Edit { seq, edits } => published(wm.edit_json(seq, &edits)),
        Request::Took { applied, screen } => published(wm.took(applied, screen)),
        Request::Run { op, window } => published(wm.run(&op, window.as_deref())),
        Request::Snapshot(told) => {
            let screen = wm.screen();
            let seen: &dyn Seen = &told;
            serde_json::to_value(wm.desk().snapshot_seen(screen.w, screen.h, seen))
                .unwrap_or(Value::Null)
        }
    }
}

thread_local! {
    static WM: RefCell<Wm> = RefCell::new(Wm::new());
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// A buffer of `len` bytes for the next request; where it starts in the module's memory.
#[unsafe(no_mangle)]
pub extern "C" fn input(len: u32) -> *mut u8 {
    INPUT.with_borrow_mut(|buf| {
        buf.clear();
        buf.resize(len as usize, 0);
        buf.as_mut_ptr()
    })
}

/// Answer the request in the input buffer; the answer's length in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn call() -> u32 {
    let text = INPUT.with_borrow(|buf| String::from_utf8_lossy(buf).into_owned());
    let value = WM.with_borrow_mut(|wm| answer(wm, &text));
    let bytes = serde_json::to_vec(&value).unwrap_or_default();
    let len = u32::try_from(bytes.len()).unwrap_or(0);
    OUTPUT.with_borrow_mut(|out| *out = bytes);
    len
}

/// Where the last answer starts in the module's memory.
#[unsafe(no_mangle)]
pub extern "C" fn output() -> *const u8 {
    OUTPUT.with_borrow(|out| out.as_ptr())
}

#[cfg(test)]
mod tests {
    use super::answer;
    use desk_wm::interact::Wm;
    use serde_json::json;

    #[test]
    fn an_edit_publishes_the_whole_desk_with_its_answers() {
        let mut wm = Wm::new();
        let request = json!({ "edit": { "seq": 3, "edits": [{ "op": "new-window" }] } });
        let out = answer(&mut wm, &request.to_string());
        let p = &out["published"][0];
        assert_eq!(p["rev"], 1);
        assert_eq!(p["answered"]["seq"], 3);
        assert_eq!(p["answered"]["values"][0], "window-1");
        assert_eq!(p["view"]["windows"]["1"][0]["id"], "window-1");
        assert_eq!(p["desk"]["focused"], "window-1");
    }

    #[test]
    fn a_window_command_and_a_snapshot_read_the_same_desk() {
        let mut wm = Wm::new();
        answer(
            &mut wm,
            &json!({ "edit": { "seq": 1, "edits": [{ "op": "new-window" }] } }).to_string(),
        );
        let run = json!({ "run": { "op": "snap", "fill": "left", "window": "window-1" } });
        let out = answer(&mut wm, &run.to_string());
        assert_eq!(out["published"][0]["view"]["front"][0]["rect"]["x"], 0.0);
        let snap = answer(
            &mut wm,
            &json!({ "snapshot": { "titles": { "launcher": "Launcher" } } }).to_string(),
        );
        assert_eq!(snap["windows"][0]["state"], "snapped");
        assert_eq!(snap["windows"][0]["panes"][0]["title"], "Launcher");
    }

    #[test]
    fn an_edit_it_cannot_read_answers_null_and_the_rest_of_its_batch_applies() {
        let mut wm = Wm::new();
        let batch =
            json!({ "edit": { "seq": 2, "edits": [{ "op": "nothing" }, { "op": "new-window" }] } });
        let out = answer(&mut wm, &batch.to_string());
        let values = &out["published"][0]["answered"]["values"];
        assert_eq!(values, &json!([null, "window-1"]));
    }

    #[test]
    fn a_request_it_cannot_read_says_why() {
        let out = answer(&mut Wm::new(), "{\"nothing\": 1}");
        assert!(out["error"].is_string());
    }
}
