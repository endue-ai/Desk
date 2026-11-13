//! The shell's winit application: the main window, the palette, the floating Eris, the island and
//! the computer-use banner (each a `Pane`), the tray, the menu bar and the global shortcuts, and CEF's
//! message loop work when the pump says it is due. Other threads reach it through the pump's jobs.
//! Closing the main window hides it, as in the Tauri shell; the desk quits from the tray or the
//! menu, once its page has asked about unsaved changes (`quit.rs`), closing every browser before
//! CEF shuts down.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use cef::*;
use desk_web::sender::{Role, System};
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
    /// Windows dropped for a closing browser whose `OnBeforeClose` has not come yet.
    closing: HashSet<Role>,
    computer: Arc<Mutex<computer::Watch>>,
    tray: Option<tray_icon::TrayIcon>,
    /// The staged build the tray offers to restart into (#47).
    offered: Option<String>,
    menu_bar: Option<tray_icon::menu::Menu>,
    /// The main window's scene and its off-screen surfaces (#52, #83).
    pub compositor: Option<crate::compositor_window::CompositorWindow>,
    started: bool,
    /// The browsers are closing: the desk quits.
    pub(crate) quitting: bool,
    /// A quit the page is asked about (`quit.rs`).
    pub(crate) asked: crate::quit::Quit,
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
            closing: HashSet::new(),
            computer,
            tray: None,
            offered: None,
            menu_bar: None,
            compositor: None,
            started: false,
            quitting: false,
            asked: crate::quit::Quit::default(),
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
        match Pane::open(event_loop, role, attributes, url, client) {
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

    /// The main window is a wgpu scene (#52, #83): the compositor opens first, then the desk's
    /// system surface in it, the runtime's page, off screen (ADR 0160).
    fn open_compositor(
        &mut self,
        event_loop: &ActiveEventLoop,
        attributes: WindowAttributes,
        url: &str,
    ) -> Option<&Pane> {
        let opened = event_loop
            .create_window(attributes.with_visible(false))
            .map_err(|why| why.to_string())
            .and_then(|window| {
                let window = Arc::new(window);
                crate::compositor_window::CompositorWindow::open(
                    event_loop,
                    window,
                    Arc::clone(&self.desk),
                )
            });
        let mut compositor = match opened {
            Ok(compositor) => compositor,
            Err(why) => {
                eprintln!("endue Desk: the compositor window did not open ({why})");
                return None;
            }
        };
        compositor.open_page(url);
        let pane = Pane {
            window: Arc::clone(&compositor.window),
            browser: compositor.browser.clone(),
            windowed: false,
        };
        self.desk.pages.set(Role::Main, pane.browser.clone());
        self.roles.insert(pane.window.id(), Role::Main);
        self.panes.insert(Role::Main, pane);
        self.compositor = Some(compositor);
        self.panes.get(&Role::Main)
    }

    /// The main window, its services and the other windows, once the loop runs: the compositor,
    /// then the system surfaces in their order (`System::ALL`, ADR 0160).
    fn start(&mut self, event_loop: &ActiveEventLoop) {
        self.started = true;
        let attributes = Window::default_attributes()
            .with_title("endue Desk")
            .with_inner_size(LogicalSize::new(1280.0, 800.0))
            .with_min_inner_size(LogicalSize::new(1024.0, 500.0));
        // Where the person left it, and as large (#163).
        let attributes = crate::main_frame::opened(event_loop, &self.pump, attributes);
        let url = self.url.clone();
        // Each surface's own browser reports its renderer's death (#52, `crashes.rs`).
        if self.open_compositor(event_loop, attributes, &url).is_none() {
            event_loop.exit();
            return;
        }
        menu::listen(&self.pump);
        self.menu_bar = menu::app_menu();
        self.tray = tray::setup(self.offered.as_deref());
        for system in System::ALL {
            match system {
                // Opened with the compositor, in its window.
                System::Desk => {}
                System::Palette => palette::setup(self, event_loop),
                System::Eris => eris_window::setup(self, event_loop),
                System::Island => crate::island::setup(self, event_loop),
            }
        }
    }

    /// The tray offers to restart into `version`, or no longer offers it.
    pub fn offer_update(&mut self, version: Option<String>) {
        self.offered = version;
        if let Some(tray) = &self.tray {
            tray::offer(tray, self.offered.as_deref());
        }
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
            // The person's own click: it applies without asking (ADR 0054).
            Choice::Update => {
                if let Some(Err(why)) = self.desk.updater.as_ref().map(|u| u.apply()) {
                    eprintln!("endue Desk: no update to restart into ({why})");
                }
            }
            Choice::Quit => crate::quit::requested(self, event_loop),
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

    pub(crate) fn focus_main(&self) {
        if let Some(main) = self.pane(Role::Main) {
            main.window.set_minimized(false);
            main.show_and_focus();
            eris_window::main_changed(self);
        }
    }

    /// Close every browser; the loop ends when the last one has.
    pub(crate) fn quit_now(&mut self, event_loop: &ActiveEventLoop) {
        // Asked again (the menu, then the Dock's Quit): the browsers are closing already.
        if self.quitting {
            return;
        }
        self.quitting = true;
        crate::main_frame::keep(self);
        for action in [Action::Palette, Action::Eris, Action::StopComputer] {
            self.hotkeys.unregister(action);
        }
        if let Some(compositor) = &self.compositor {
            compositor.close();
        }
        if self.done_quitting() {
            event_loop.exit();
        }
        for pane in self.panes.values() {
            pane.close(true);
        }
    }

    /// The browser of `role` agreed to close: drop its window, which takes the browser's view and
    /// so the browser with it (`OnBeforeClose` follows).
    fn closing(&mut self, role: Role) {
        if let Some(pane) = self.panes.remove(&role) {
            pane.let_go();
            self.roles.remove(&pane.window.id());
            self.closing.insert(role);
        }
    }

    fn closed(&mut self, event_loop: &ActiveEventLoop, role: Role) {
        self.closing.remove(&role);
        self.desk.pages.set(role, None);
        if let Some(pane) = self.panes.remove(&role) {
            self.roles.remove(&pane.window.id());
        }
        if role == Role::Main && !self.quitting {
            // The page closed its own window: the desk goes with it.
            self.quit_now(event_loop);
        }
        if self.done_quitting() {
            event_loop.exit();
        }
    }

    /// Whether every browser has closed, the compositor's surfaces' too.
    fn done_quitting(&self) -> bool {
        let surfaces = self.compositor.as_ref().map_or(0, |c| c.host.browsers());
        self.quitting && self.panes.is_empty() && self.closing.is_empty() && surfaces == 0
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
            Wake::Closing(role) => self.closing(role),
            Wake::Closed(role) => self.closed(event_loop, role),
            Wake::Run(job) => job(self, event_loop),
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let Some(&role) = self.roles.get(&id) else {
            return;
        };
        // Compositor mode (#56, #57): its events reach the accessibility adapter, then the router.
        if role == Role::Main
            && let Some(compositor) = self.compositor.as_mut()
        {
            compositor.window_event(event_loop, &event);
        }
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
            (Role::Main, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. })
                if self.compositor.is_some() =>
            {
                if let Some(compositor) = self.compositor.as_mut() {
                    compositor.resized();
                }
                crate::main_frame::moved();
                eris_window::main_changed(self);
            }
            (Role::Main, WindowEvent::Occluded(occluded)) if self.compositor.is_some() => {
                if let Some(compositor) = self.compositor.as_mut() {
                    compositor.occluded(occluded);
                }
                eris_window::main_changed(self);
            }
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
                if role == Role::Main
                    && let Some(compositor) = self.compositor.as_mut()
                {
                    compositor.focused(focused);
                }
                if role == Role::Palette
                    && !focused
                    && let Some(pane) = self.pane(Role::Palette)
                {
                    pane.hide();
                }
                eris_window::focused(self, role, focused);
                crate::island::focused(self, role, focused);
            }
            (Role::Eris, WindowEvent::Moved(_)) => eris_window::moved(self),
            (Role::Island, WindowEvent::Moved(_)) => crate::island::moved(self),
            (Role::Main, WindowEvent::Moved(_)) => crate::main_frame::moved(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.pump.turn(Instant::now());
        let mut next = None;
        if let Some(compositor) = self.compositor.as_mut() {
            compositor.tick(Instant::now(), event_loop);
            next = compositor.next_frame();
        }
        if self.done_quitting() {
            event_loop.exit();
        }
        // CEF's work when it asks, and its poll on the desk's own next wake-up (#129, `pump.rs`).
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.pump.wake_at(next)));
    }
}
