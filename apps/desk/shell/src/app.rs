//! The CEF application object of every process: the Chromium switches, the desk's URL schemes and,
//! in the browser process, the message pump schedule and the scheme handlers.

use std::path::PathBuf;

use cef::*;

use crate::pump::Pump;
use crate::renderer::ShellRenderer;
use crate::scheme;

/// The scheme plugin files load from (ADR 0012); its handler comes with #42.
pub const PLUGIN_SCHEME: &str = "desk-plugin";

/// Both desk schemes behave like `https`: standard URLs, a secure context, CORS and `fetch`.
fn scheme_options() -> i32 {
    let flags = [
        SchemeOptions::STANDARD,
        SchemeOptions::SECURE,
        SchemeOptions::CORS_ENABLED,
        SchemeOptions::FETCH_ENABLED,
    ];
    flags
        .iter()
        .fold(0, |all, flag| all | *flag.as_ref() as i32)
}

wrap_browser_process_handler! {
    pub struct ShellBrowserProcess {
        pump: Pump,
        dist: PathBuf,
    }

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            scheme::register(self.dist.clone());
        }

        fn on_schedule_message_pump_work(&self, delay_ms: i64) {
            self.pump.schedule(delay_ms);
        }
    }
}

wrap_app! {
    pub struct ShellApp {
        browser: Option<(Pump, PathBuf)>,
    }

    impl App {
        fn on_before_command_line_processing(
            &self,
            _process_type: Option<&CefStringUtf16>,
            command_line: Option<&mut CommandLine>,
        ) {
            let Some(command_line) = command_line else { return };
            for switch in ["no-startup-window", "noerrdialogs", "hide-crash-restore-bubble"] {
                command_line.append_switch(Some(&switch.into()));
            }
            // A keychain prompt for Chromium's own password store would be the desk's, not the
            // person's; the desk keeps secrets in the core (ADR 0099).
            #[cfg(target_os = "macos")]
            command_line.append_switch(Some(&"use-mock-keychain".into()));
            // One renderer per site: every plugin surface has a site of its own (#36), so each runs
            // in its own process (ADR 0140).
            command_line.append_switch(Some(&"site-per-process".into()));
            // Development builds open Chromium's DevTools protocol on request: screenshots for
            // pull requests and the app-level e2e (ADR 0144) drive the desk through it.
            if cfg!(debug_assertions)
                && let Ok(port) = std::env::var("DESK_REMOTE_DEBUGGING_PORT")
            {
                command_line.append_switch_with_value(
                    Some(&"remote-debugging-port".into()),
                    Some(&port.as_str().into()),
                );
                command_line.append_switch_with_value(
                    Some(&"remote-allow-origins".into()),
                    Some(&"*".into()),
                );
            }
        }

        fn on_register_custom_schemes(&self, registrar: Option<&mut SchemeRegistrar>) {
            let Some(registrar) = registrar else { return };
            for name in [scheme::APP_SCHEME, PLUGIN_SCHEME] {
                registrar.add_custom_scheme(Some(&name.into()), scheme_options());
            }
        }

        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(ShellRenderer::new())
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            self.browser
                .as_ref()
                .map(|(pump, dist)| ShellBrowserProcess::new(pump.clone(), dist.clone()))
        }
    }
}

impl ShellApp {
    /// The application object of a subprocess: schemes and switches only.
    pub fn subprocess() -> App {
        ShellApp::new(None)
    }

    /// The application object of the browser process, which pumps and serves the schemes.
    pub fn browser(pump: Pump, dist: PathBuf) -> App {
        ShellApp::new(Some((pump, dist)))
    }
}
