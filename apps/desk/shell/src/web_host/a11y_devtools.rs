//! A surface's accessibility through its browser's own DevTools agent (#57), for what CEF's
//! accessibility events do not carry: which DOM node an accessibility node is
//! (`Accessibility.getFullAXTree` maps Blink's node id, the one in CEF's tree, to its
//! `backendDOMNodeId`), the boxes an action presses (`a11y_actions.rs`), and where scrolled
//! containers are scrolled to: CEF 156 hands location changes over but not Chromium's scroll
//! changes (an empty list comes instead), so after each the scrollable nodes' offsets are read from
//! their elements (`scrollLeft`, `scrollTop`) and the boxes under them move with the next update.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

use cef::*;
use desk_compositor::input::Button;
use desk_surface::generated::{SurfaceA11yActionName as Name, SurfaceMessage};
use serde_json::{Value, json};

use super::Export;
use super::actions::{middle, perform, presses};
use crate::web_host::SurfaceSink;
use crate::web_host::view::SharedView;

/// DevTools message ids of the desk's commands, clear of anyone else's on the browser.
const FIRST_ID: i32 = 570_000;

/// A scrollable element's offsets, in CSS pixels; the document's are its scrolling element's.
const OFFSETS: &str = "function () { const e = this.nodeType === 9 ? (this.scrollingElement || \
     this.documentElement) : this; return [e.scrollLeft, e.scrollTop]; }";

/// What follows a DevTools answer.
#[derive(Clone, Debug, PartialEq)]
pub enum Then {
    /// The full tree came: do `action` (with `value`) to Blink's accessibility node `ax`.
    Resolve {
        ax: i64,
        action: Name,
        value: Option<String>,
    },
    /// The node's box came: press its middle with this button.
    Press(Button),
    /// The full tree came: read the offsets of these scrollable nodes.
    Scrollers(Vec<i64>),
    /// A scrollable node's element came: read its offsets.
    Element(i64),
    /// A scrollable node's offsets came.
    Offsets(i64),
}

/// A DevTools command, and what follows its answer.
pub type Command = (&'static str, Value, Option<Then>);

/// The surface's DevTools state: the observer on the browser it was made for, the commands in
/// flight, the DOM nodes found so far and the scroll read in flight.
#[derive(Default)]
pub struct DevTools {
    watch: Option<(i32, Registration)>,
    then: HashMap<i32, Then>,
    next: i32,
    backends: HashMap<i64, i64>,
    /// Offsets still to come in the read in flight, and whether another read is due after it.
    reading: usize,
    again: bool,
}

impl DevTools {
    /// Give `commands` their ids; the messages to send once the lock is let go.
    pub fn queue(&mut self, commands: Vec<Command>) -> Vec<String> {
        (commands.into_iter())
            .map(|(method, params, then)| {
                let id = FIRST_ID + self.next;
                self.next = (self.next + 1) % 100_000;
                if let Some(then) = then {
                    self.then.insert(id, then);
                }
                json!({ "id": id, "method": method, "params": params }).to_string()
            })
            .collect()
    }

    /// Whether the observer on browser `id` is there.
    pub fn watches(&self, id: i32) -> bool {
        self.watch.as_ref().is_some_and(|(of, _)| *of == id)
    }

    pub fn set_watch(&mut self, id: i32, registration: Option<Registration>) {
        self.watch = registration.map(|r| (id, r));
    }

    /// Read where the scrollable nodes `scrollers` are scrolled to (one read at a time).
    pub fn read_scrolls(&mut self, scrollers: Vec<i64>) -> Vec<Command> {
        if self.reading > 0 {
            self.again = true;
            return Vec::new();
        }
        if scrollers.iter().all(|ax| self.backends.contains_key(ax)) {
            self.reading = scrollers.len();
            return scrollers.iter().map(|ax| self.element(*ax)).collect();
        }
        self.reading = scrollers.len().max(1);
        vec![(
            "Accessibility.getFullAXTree",
            json!({}),
            Some(Then::Scrollers(scrollers)),
        )]
    }

    fn element(&self, ax: i64) -> Command {
        let node = json!({ "backendNodeId": self.backends[&ax] });
        ("DOM.resolveNode", node, Some(Then::Element(ax)))
    }

    /// One part of the read came (or failed): whether it was the last.
    fn read_one(&mut self) -> bool {
        self.reading = self.reading.saturating_sub(1);
        self.reading == 0
    }
}

/// Send `messages` to the browser.
pub fn send(host: &BrowserHost, messages: Vec<String>) {
    for message in messages {
        host.send_dev_tools_message(Some(message.as_bytes()));
    }
}

/// Remember every node's DOM node from a `getFullAXTree` answer.
fn remember(backends: &mut HashMap<i64, i64>, result: &Value) {
    for node in result
        .get("nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let ax = node
            .get("nodeId")
            .and_then(Value::as_str)
            .and_then(|s| s.parse().ok());
        let dom = node.get("backendDOMNodeId").and_then(Value::as_i64);
        if let (Some(ax), Some(dom)) = (ax, dom) {
            backends.insert(ax, dom);
        }
    }
}

wrap_dev_tools_message_observer! {
    pub struct DevToolsWatch {
        export: Weak<Mutex<Export>>,
        sink: Arc<dyn SurfaceSink>,
        surface: String,
        view: SharedView,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_method_result(
            &self,
            browser: Option<&mut Browser>,
            message_id: ::std::os::raw::c_int,
            success: ::std::os::raw::c_int,
            result: Option<&[u8]>,
        ) {
            let Some(host) = browser.and_then(|b| b.host()) else { return };
            let result = (success == 1)
                .then(|| result.and_then(|r| serde_json::from_slice::<Value>(r).ok()))
                .flatten();
            self.answered(&host, message_id, result);
        }
    }
}

impl DevToolsWatch {
    fn answered(&self, host: &BrowserHost, id: i32, result: Option<Value>) {
        let Some(export) = self.export.upgrade() else {
            return;
        };
        let scale = f64::from(self.view.lock().scale);
        let mut export = export.lock().unwrap_or_else(|e| e.into_inner());
        let Some(then) = export.devtools.then.remove(&id) else {
            return;
        };
        let mut commands = Vec::new();
        let mut press = None;
        let mut update = None;
        let devtools = &mut export.devtools;
        match (then, &result) {
            (Then::Resolve { ax, action, value }, Some(result)) => {
                remember(&mut devtools.backends, result);
                if let Some(dom) = devtools.backends.get(&ax) {
                    commands = perform(*dom, action, value);
                }
            }
            (Then::Press(button), Some(result)) => press = middle(result).map(|at| (at, button)),
            (Then::Scrollers(scrollers), Some(result)) => {
                remember(&mut devtools.backends, result);
                let known: Vec<i64> = scrollers
                    .into_iter()
                    .filter(|ax| devtools.backends.contains_key(ax))
                    .collect();
                devtools.reading = known.len();
                commands = known.iter().map(|ax| devtools.element(*ax)).collect();
            }
            (Then::Element(ax), Some(result)) => {
                match result.pointer("/object/objectId").cloned() {
                    Some(object) => {
                        let call = json!({ "objectId": object, "functionDeclaration": OFFSETS, "returnByValue": true });
                        commands = vec![("Runtime.callFunctionOn", call, Some(Then::Offsets(ax)))];
                    }
                    None => {
                        devtools.backends.remove(&ax);
                        devtools.read_one();
                    }
                }
            }
            (Then::Offsets(ax), result) => {
                let at = result
                    .as_ref()
                    .and_then(|r| r.pointer("/result/value"))
                    .and_then(Value::as_array);
                let xy: Vec<f64> = at.into_iter().flatten().filter_map(Value::as_f64).collect();
                if let [x, y] = xy.as_slice() {
                    export.tree.scrolled(
                        ax,
                        (x * scale).round() as i64,
                        (y * scale).round() as i64,
                    );
                }
                if export.devtools.read_one() {
                    update = export.tree.update(&self.surface, scale);
                    if std::mem::take(&mut export.devtools.again) {
                        let scrollers = export.tree.scrollers();
                        commands = export.devtools.read_scrolls(scrollers);
                    }
                }
            }
            // A failed part of a scroll read ends it as if it came.
            (Then::Scrollers(_) | Then::Element(_), None) => {
                devtools.reading = 0;
                devtools.again = false;
            }
            _ => {}
        }
        let messages = export.devtools.queue(commands);
        drop(export);
        send(host, messages);
        if let Some(update) = update {
            self.sink.message(SurfaceMessage::SurfaceA11yUpdate(update));
        }
        for press in press
            .map(|(at, b)| presses(&self.surface, at, b))
            .unwrap_or_default()
        {
            crate::web_host::input::deliver(host, &press, &mut None, 0.0);
        }
    }
}

/// The observer for a surface's browser: it answers into `export`.
pub fn observer(
    export: &Arc<Mutex<Export>>,
    sink: &Arc<dyn SurfaceSink>,
    surface: &str,
    view: &SharedView,
) -> DevToolsMessageObserver {
    DevToolsWatch::new(
        Arc::downgrade(export),
        Arc::clone(sink),
        surface.to_owned(),
        view.clone(),
    )
}
