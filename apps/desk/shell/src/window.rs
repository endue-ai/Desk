//! The shell's winit application: the main window, the palette, the floating Eris and the
//! computer-use banner (each a `Pane`), the tray, the menu bar and the global shortcuts, and CEF's
//! message loop work when the pump says it is due. Other threads reach it through the pump's jobs.
//! Closing the main window hides it, as in the Tauri shell; the desk quits from the tray or the
//! menu, closing every browser before CEF shuts down.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use cef::*;
use desk_web::sender::Role;
use serde_json::Value;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow};
use winit::window::{Window, WindowAttributes, WindowId};

use crate::computer;
use crate::eris_window;
use crate::host::Desk;
use crate::hotkeys::{Action, Hotkeys};
use crate::menu::{self, Choice};
use crate::pane::Pane;
use crate::pump::{Pump, Wake};
use crate::{open_files, palette, tray};

/// The shell's application state for winit.
pub struct Shell {
    pub desk: Arc<Desk>,
    /// The main window's page; the palette's and Eris's are its views.
    pub url: String,
    pub hotkeys: Hotkeys,
    pump: Pump,
    panes: HashMap<Role, Pane>,
    roles: HashMap<WindowId, Role>,
    computer: Arc<Mutex<computer::Watch>>,
    tray: Option<tray_icon::TrayIcon>,
    menu_bar: Option<tray_icon::menu::Menu>,
    /// Hears the main browser's frames crash (#44), as long as it is kept.
    crash_watch: Option<Registration>,
    started: bool,
    quitting: bool,
}

impl Shell {
    /// Call on the event loop's thread, before it runs (the shortcuts' manager lives there).
    pub fn new(desk: Arc<Desk>, url: String, computer: Arc<Mutex<computer::Watch>>) -> Self {
        let pump = desk.pump.clone();
        Self {
            hotkeys: Hotkeys::new(&pump),
            desk,
            url,
            pump,
            panes: HashMap::new(),
            roles: HashMap::new(),
            computer,
            tray: None,
            menu_bar: None,
            crash_watch: None,
            started: false,
            quitting: false,
        }
    }

    /// The window of `role`, while it is open.
    pub fn pane(&self, role: Role) -> Option<&Pane> {
        self.panes.get(&role)
    }

    /// Open the window of `role` with `attributes` and its browser at `url`.
    pub fn open_pane(
        &mut self,
        event_loop: &ActiveEventLoop,
        role: Role,
        attributes: WindowAttributes,
        url: &str,
    ) -> Option<&Pane> {
        let client = crate::client::client(role, self.pump.clone(), Arc::clone(&self.desk));
        match Pane::open(event_loop, attributes, url, client) {
            Ok(pane) => {
                self.desk.pages.set(role, pane.browser.clone());
                self.roles.insert(pane.window.id(), role);
                self.panes.insert(role, pane);
                self.panes.get(&role)
            }
            Err(why) => {
                eprintln!("endue Desk: the {role:?} window did not open ({why})");
                None
            }
        }
    }

    /// The main window, its services and the other windows, once the loop runs.
    fn start(&mut self, event_loop: &ActiveEventLoop) {
        self.started = true;
        let attributes = Window::default_attributes()
            .with_title("endue Desk")
            .with_inner_size(LogicalSize::new(1280.0, 800.0))
            .with_min_inner_size(LogicalSize::new(1024.0, 500.0));
        let url = self.url.clone();
        let Some(main) = self.open_pane(event_loop, Role::Main, attributes, &url) else {
            event_loop.exit();
            return;
        };
        self.crash_watch = main.browser.as_ref().and_then(crate::crashes::watch);
        menu::listen(&self.pump);
        self.menu_bar = menu::app_menu();
        palette::setup(self, event_loop);
        self.tray = tray::setup();
        eris_window::setup(self, event_loop);
    }

    /// A global shortcut went down (`pressed`) or up.
    pub fn hotkey(&mut self, _event_loop: &ActiveEventLoop, id: u32, pressed: bool) {
        match self.hotkeys.action(id) {
            Some(Action::Palette) if pressed => palette::toggle(self),
            Some(Action::Eris) if pressed => eris_window::summon(self),
            Some(Action::StopComputer) => computer::key(self, &self.computer, pressed),
            _ => {}
        }
    }

    /// A choice in the tray or the menu bar.
    pub fn menu(&mut self, event_loop: &ActiveEventLoop, choice: Choice) {
        match choice {
            Choice::Search => palette::show(self),
            Choice::Eris => eris_window::summon(self),
            Choice::Desk => palette::reveal_main(self),
            Choice::Update => eprintln!("endue Desk: updates on the CEF shell come with #47"),
            Choice::Quit => self.quit(event_loop),
        }
    }

    /// Files opened with the desk: queue them, tell the main window's page, bring it forward.
    pub fn open_files(&mut self, paths: Vec<String>) {
        if self.desk.opened.push(paths) {
            self.desk
                .pages
                .emit(Role::Main, open_files::EVENT, Value::Null);
            self.focus_main();
        }
    }

    /// A second start handed over its arguments: its files, and the desk in front either way.
    pub fn handed(&mut self, args: Vec<String>) {
        self.open_files(open_files::argument_paths(args));
        self.focus_main();
    }

    /// A click on the Dock icon.
    pub fn reopen(&mut self, has_visible_windows: bool) {
        let main_visible = self.pane(Role::Main).is_some_and(Pane::visible);
        if crate::run_event::reopen_shows_main(main_visible, has_visible_windows) {
            palette::reveal_main(self);
        }
    }

    fn focus_main(&self) {
        if let Some(main) = self.pane(Role::Main) {
            main.window.set_minimized(false);
            main.show_and_focus();
            eris_window::main_changed(self);
        }
    }

    /// Close every browser; the loop ends when the last one has.
    fn quit(&mut self, event_loop: &ActiveEventLoop) {
        self.quitting = true;
        for action in [Action::Palette, Action::Eris, Action::StopComputer] {
            self.hotkeys.unregister(action);
        }
        if self.panes.is_empty() {
            event_loop.exit();
        }
        for pane in self.panes.values() {
            pane.close(true);
        }
    }

    fn closed(&mut self, event_loop: &ActiveEventLoop, role: Role) {
        self.desk.pages.set(role, None);
        if role == Role::Main {
            self.crash_watch = None;
        }
        if let Some(pane) = self.panes.remove(&role) {
            self.roles.remove(&pane.window.id());
        }
        if role == Role::Main && !self.quitting {
            // The page closed its own window: the desk goes with it.
            self.quit(event_loop);
        }
        if self.quitting && self.panes.is_empty() {
            event_loop.exit();
        }
    }
}

impl ApplicationHandler<Wake> for Shell {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if !self.started {
            self.start(event_loop);
        }
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, wake: Wake) {
        match wake {
            Wake::Pump => {}
            Wake::Closed(role) => self.closed(event_loop, role),
            Wake::Run(job) => job(self, event_loop),
        }
    }

    fn window_event(&mut self, _event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let Some(&role) = self.roles.get(&id) else {
            return;
        };
        match (role, event) {
            (Role::Main, WindowEvent::CloseRequested) => {
                // Closing the window only hides it: the tray, the Dock and a second start bring it
                // back (#583).
                if let Some(main) = self.pane(Role::Main) {
                    main.hide();
                }
                eris_window::main_changed(self);
            }
            (Role::Palette, WindowEvent::CloseRequested) => {
                if let Some(pane) = self.pane(Role::Palette) {
                    pane.hide();
                }
            }
            (Role::Eris, WindowEvent::CloseRequested) => eris_window::dismiss(self),
            (_, WindowEvent::Resized(size)) => {
                if let Some(pane) = self.pane(role) {
                    pane.resized(size);
                }
                if role == Role::Main {
                    // Minimized and restored: settle reads whether it is on screen.
                    eris_window::main_changed(self);
                }
            }
            (Role::Main, WindowEvent::Occluded(_)) => eris_window::main_changed(self),
            (_, WindowEvent::Focused(focused)) => {
                if focused && let Some(host) = self.pane(role).and_then(Pane::host) {
                    host.set_focus(1);
                }
                if role == Role::Palette
                    && !focused
                    && let Some(pane) = self.pane(Role::Palette)
                {
                    pane.hide();
                }
                eris_window::focused(self, role, focused);
            }
            (Role::Eris, WindowEvent::Moved(_)) => eris_window::moved(self),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        if self.pump.take_due(Instant::now()) {
            do_message_loop_work();
        }
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.pump.due()));
    }
}
