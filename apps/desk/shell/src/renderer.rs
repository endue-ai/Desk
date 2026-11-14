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

/// The key in a browser's extra info that marks it a web view's (#273, ADR 0216): a remote page's,
/// so its frames get nothing of the desk's.
pub const WEB_VIEW: &str = "desk.web";

/// The browsers of this renderer process that are web views', by identifier.
static WEB_VIEWS: std::sync::Mutex<std::collections::BTreeSet<i32>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

fn web_views() -> std::sync::MutexGuard<'static, std::collections::BTreeSet<i32>> {
    WEB_VIEWS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether a frame at `url` of browser `browser` is a remote page's: its browser is a web view's,
/// or its document came from the web. The desk's own pages load from its schemes alone
/// (`desk_web::guard`), so a page from the web is never one of them, whatever browser shows it.
fn remote(browser: Option<i32>, url: &str) -> bool {
    let scheme = url.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
    browser.is_some_and(|id| web_views().contains(&id))
        || matches!(scheme.as_deref(), Some("http" | "https"))
}

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
        fn on_browser_created(
            &self,
            browser: Option<&mut Browser>,
            extra_info: Option<&mut DictionaryValue>,
        ) {
            let web = extra_info.is_some_and(|info| info.bool(Some(&WEB_VIEW.into())) == 1);
            if let (true, Some(browser)) = (web, browser) {
                web_views().insert(browser.identifier());
            }
        }

        fn on_browser_destroyed(&self, browser: Option<&mut Browser>) {
            if let Some(browser) = browser {
                web_views().remove(&browser.identifier());
            }
        }

        fn on_context_created(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            // A remote page gets no `__deskNative`, no ask for frames and no shim (ADR 0216).
            let url = frame.as_ref().map(|f| CefString::from(&f.url()).to_string());
            if remote(browser.map(|b| b.identifier()), url.as_deref().unwrap_or_default()) {
                return;
            }
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

#[cfg(test)]
mod tests {
    use super::{remote, web_views};

    #[test]
    fn a_frame_from_the_web_or_of_a_web_views_browser_gets_nothing_of_the_desk() {
        // The desk's own pages, in a browser that is no web view's: they get the bridge.
        for url in [
            "desk-app://app/index.html",
            "desk-plugin://main.endue-notes/endue.notes/ui/index.html",
            "about:blank",
            "",
        ] {
            assert!(!remote(Some(-41), url), "{url}");
            assert!(!remote(None, url), "{url}");
        }
        // A document from the web is remote in any browser.
        for url in [
            "https://example.com/",
            "HTTP://example.com/a",
            "http://127.0.0.1:8787/",
        ] {
            assert!(remote(Some(-41), url), "{url}");
            assert!(remote(None, url), "{url}");
        }
        // Every frame of a web view's browser, an empty one and one a page made itself included.
        web_views().insert(-42);
        for url in [
            "about:blank",
            "data:text/html,hi",
            "blob:https://example.com/1",
            "",
        ] {
            assert!(remote(Some(-42), url), "{url}");
            assert!(!remote(Some(-41), url), "{url}");
        }
        web_views().remove(&-42);
        assert!(!remote(Some(-42), "about:blank"));
    }
}
