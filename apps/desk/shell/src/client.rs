//! The main browser's client: it tells the event loop when the browser closed and, in development
//! builds, prints the page's console to the terminal (CSP reports land there too).

use cef::*;

use crate::pump::{Pump, Wake};

wrap_life_span_handler! {
    pub struct MainLifeSpan {
        pump: Pump,
    }

    impl LifeSpanHandler {
        fn on_before_close(&self, _browser: Option<&mut Browser>) {
            self.pump.wake(Wake::BrowserClosed);
        }
    }
}

wrap_display_handler! {
    pub struct MainDisplay;

    impl DisplayHandler {
        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            message: Option<&CefString>,
            source: Option<&CefString>,
            line: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            if cfg!(debug_assertions)
                && let Some(message) = message
            {
                let source = source.map(|s| s.to_string()).unwrap_or_default();
                eprintln!("shell console: {message} ({source}:{line})");
            }
            0
        }
    }
}

wrap_client! {
    pub struct MainClient {
        life_span: LifeSpanHandler,
        display: DisplayHandler,
    }

    impl Client {
        fn life_span_handler(&self) -> Option<LifeSpanHandler> {
            Some(self.life_span.clone())
        }

        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display.clone())
        }
    }
}

/// The client of the main window's browser.
pub fn main_client(pump: Pump) -> Client {
    MainClient::new(MainLifeSpan::new(pump), MainDisplay::new())
}
