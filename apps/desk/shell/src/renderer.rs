//! The renderer side of the bridge (#43): every frame's script context gets `window.__deskNative`,
//! whose `send(text)` hands a call to the browser process, and whose `onMessage(text)` the page sets
//! to hear replies and events. The texts are `desk_web::wire`'s; this side never reads them.
//! `post(text)` hands a postMessage to the relay between the runtime and off-screen plugin surfaces
//! (#52, `web_host::relay`), whose pages also get `window.parent` as the desk (`web_host::shim`).
//! Development builds add `pid`, the renderer's process id, so a check can kill one surface's.

use cef::*;

/// The process message carrying a call to the browser.
pub const CALL: &str = "desk.call";
/// The process message carrying a reply or an event to the page.
pub const MESSAGE: &str = "desk.message";
/// The process message carrying a postMessage for the relay.
pub const POST: &str = "desk.post";

/// The global the page sees.
const NATIVE: &str = "__deskNative";

/// Pages may not replace `__deskNative` or its `send` (V8's `ReadOnly`).
fn read_only() -> V8Propertyattribute {
    V8Propertyattribute::from(sys::cef_v8_propertyattribute_t::V8_PROPERTY_ATTRIBUTE_READONLY)
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
                _ => return 0,
            };
            let text = arguments
                .and_then(|args| args.first())
                .and_then(|arg| arg.as_ref())
                .filter(|arg| arg.is_string() == 1)
                .map(|arg| CefString::from(&arg.string_value()).to_string());
            let (Some(text), Some(frame)) = (text, v8_context_get_current_context().and_then(|c| c.frame())) else {
                if let Some(exception) = exception {
                    *exception = "__deskNative.send and post take one string".into();
                }
                return 1;
            };
            if let Some(mut message) = process_message_create(Some(&kind.into())) {
                if let Some(list) = message.argument_list() {
                    list.set_string(0, Some(&text.as_str().into()));
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
            for name in ["send", "post"] {
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
            if CefString::from(&message.name()).to_string() != MESSAGE {
                return 0;
            }
            let text = message
                .argument_list()
                .map(|list| CefString::from(&list.string(0)).to_string())
                .unwrap_or_default();
            if let Some(context) = frame.and_then(|f| f.v8_context()) {
                deliver(&context, &text);
            }
            1
        }
    }
}

/// Call `__deskNative.onMessage(text)` in `context`, when the page set one.
fn deliver(context: &V8Context, text: &str) {
    if context.enter() != 1 {
        return;
    }
    let target = context
        .global()
        .and_then(|global| global.value_bykey(Some(&NATIVE.into())))
        .and_then(|native| {
            native
                .value_bykey(Some(&"onMessage".into()))
                .map(|on| (native, on))
        });
    if let Some((mut native, on)) = target
        && on.is_function() == 1
    {
        let argument = v8_value_create_string(Some(&text.into()));
        let _ = on.execute_function(Some(&mut native), Some(&[argument]));
    }
    context.exit();
}
