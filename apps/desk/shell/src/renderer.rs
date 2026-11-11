//! The renderer side of the bridge (#43): every frame's script context gets `window.__deskNative`,
//! whose `send(text)` hands a call to the browser process, and whose `onMessage(text)` the page sets
//! to hear replies and events. The texts are `desk_web::wire`'s; this side never reads them.
//! `post(text)` hands a postMessage to the relay between the runtime and the plugin surfaces (#52,
//! ADR 0160, `web_host::relay`): a plugin surface's page posts to its parent (`window.parent` is the
//! desk there, `web_host::shim`), and the runtime's page posts to a surface by naming its host,
//! `post(text, host)`; the runtime's page hears what a surface posted through
//! `onSurface(host, text)`, which it sets. `wake(ms)` asks the desk for frames (#134,
//! `web_host::frame_asks`, which every frame's page runs). Development builds add `pid`, the
//! renderer's process id, so a check can kill one surface's.

use cef::*;

/// The process message carrying a call to the browser.
pub const CALL: &str = "desk.call";
/// The process message carrying a reply or an event to the page.
pub const MESSAGE: &str = "desk.message";
/// The process message carrying a postMessage for the relay: the text, and the surface it is for
/// when the runtime's page names one.
pub const POST: &str = "desk.post";
/// The process message carrying what a surface's page posted to the runtime's page: the text, and
/// the surface's host.
pub const SURFACE: &str = "desk.surface";
/// The process message by which a page asks the desk for frames: none came for a change of its own
/// while its surface rests (#134, `web_host::frame_asks`). Its integer: the milliseconds the page has
/// waited since its first ask for the want still unmet (0: a first ask, #157).
pub const WAKE: &str = "desk.wake";

/// The global the page sees.
const NATIVE: &str = "__deskNative";

/// Pages may not replace `__deskNative` or its `send` (V8's `ReadOnly`).
fn read_only() -> V8Propertyattribute {
    V8Propertyattribute::from(sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_READONLY)
}

/// The string argument `index` of a V8 call, if it is one.
fn string_arg(arguments: Option<&[Option<V8Value>]>, index: usize) -> Option<String> {
    arguments
        .and_then(|args| args.get(index))
        .and_then(|arg| arg.as_ref())
        .filter(|arg| arg.is_string() == 1)
        .map(|arg| CefString::from(&arg.string_value()).to_string())
}

/// `wake(ms)`'s milliseconds, as a whole number from 0 (none or not a number: 0).
fn waited_ms(arguments: Option<&[Option<V8Value>]>) -> i32 {
    arguments
        .and_then(|args| args.first())
        .and_then(|arg| arg.as_ref())
        .filter(|arg| arg.is_double() == 1)
        .map_or(0, |arg| {
            arg.double_value().clamp(0.0, f64::from(i32::MAX)) as i32
        })
}

wrap_v8_handler! {
    pub struct SendHandler;

    impl V8Handler {
        fn execute(
            &self,
            name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            _retval: Option<&mut Option<V8Value>>,
            exception: Option<&mut CefString>,
        ) -> ::std::os::raw::c_int {
            let kind = match name.map(|n| n.to_string()).as_deref() {
                Some("send") => CALL,
                Some("post") => POST,
                Some("wake") => WAKE,
                _ => return 0,
            };
            if kind == WAKE {
                let frame = v8_context_get_current_context().and_then(|c| c.frame());
                if let (Some(frame), Some(mut message)) = (frame, process_message_create(Some(&kind.into()))) {
                    if let Some(list) = message.argument_list() {
                        list.set_int(0, waited_ms(arguments));
                    }
                    frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
                }
                return 1;
            }
            let text = string_arg(arguments, 0);
            let to = (kind == POST).then(|| string_arg(arguments, 1)).flatten();
            let (Some(text), Some(frame)) = (text, v8_context_get_current_context().and_then(|c| c.frame())) else {
                if let Some(exception) = exception {
                    *exception = "__deskNative.send and post take a string".into();
                }
                return 1;
            };
            if let Some(mut message) = process_message_create(Some(&kind.into())) {
                if let Some(list) = message.argument_list() {
                    list.set_string(0, Some(&text.as_str().into()));
                    if let Some(to) = &to {
                        list.set_string(1, Some(&to.as_str().into()));
                    }
                }
                frame.send_process_message(ProcessId::BROWSER, Some(&mut message));
            }
            1
        }
    }
}

wrap_render_process_handler! {
    pub struct ShellRenderer;

    impl RenderProcessHandler {
        fn on_context_created(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            let Some(context) = context else { return };
            let Some(global) = context.global() else { return };
            let Some(mut native) = v8_value_create_object(None, None) else { return };
            for name in ["send", "post", "wake"] {
                let mut handler = SendHandler::new();
                if let Some(mut function) = v8_value_create_function(Some(&name.into()), Some(&mut handler)) {
                    native.set_value_bykey(Some(&name.into()), Some(&mut function), read_only());
                }
            }
            if cfg!(debug_assertions)
                && let Some(mut pid) = v8_value_create_uint(std::process::id())
            {
                native.set_value_bykey(Some(&"pid".into()), Some(&mut pid), read_only());
            }
            global.set_value_bykey(Some(&NATIVE.into()), Some(&mut native), read_only());
            // A resting surface's page asks for frames when a change of its own needs one (#134).
            crate::web_host::frame_asks::install(context);
            let (main, url) = frame
                .map(|f| (f.is_main() == 1, CefString::from(&f.url()).to_string()))
                .unwrap_or_default();
            if crate::web_host::shim::wanted(main, &url) {
                crate::web_host::shim::install(context);
            }
        }

        fn on_process_message_received(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> ::std::os::raw::c_int {
            let Some(message) = message else { return 0 };
            let name = CefString::from(&message.name()).to_string();
            let (handler, args) = match name.as_str() {
                MESSAGE => ("onMessage", 1),
                SURFACE => ("onSurface", 2),
                _ => return 0,
            };
            let strings: Vec<String> = (0..args)
                .map(|i| {
                    message
                        .argument_list()
                        .map(|list| CefString::from(&list.string(i)).to_string())
                        .unwrap_or_default()
                })
                .collect();
            if let Some(context) = frame.and_then(|f| f.v8_context()) {
                // `onSurface(host, text)`: the surface first, as the page names it.
                let ordered: Vec<&str> = match strings.as_slice() {
                    [text, host] => vec![host, text],
                    other => other.iter().map(String::as_str).collect(),
                };
                deliver(&context, handler, &ordered);
            }
            1
        }
    }
}

/// Call `__deskNative[handler](...strings)` in `context`, when the page set one.
fn deliver(context: &V8Context, handler: &str, strings: &[&str]) {
    if context.enter() != 1 {
        return;
    }
    let target = context
        .global()
        .and_then(|global| global.value_bykey(Some(&NATIVE.into())))
        .and_then(|native| {
            native
                .value_bykey(Some(&handler.into()))
                .map(|on| (native, on))
        });
    if let Some((mut native, on)) = target
        && on.is_function() == 1
    {
        let arguments: Vec<Option<V8Value>> = strings
            .iter()
            .map(|s| v8_value_create_string(Some(&(*s).into())))
            .collect();
        let _ = on.execute_function(Some(&mut native), Some(&arguments));
    }
    context.exit();
}
