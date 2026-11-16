//! A desk notice in the OS's notifications while endue is out of sight (#306, ADR 0240). The page
//! decides which notices go (`apps/desk/src/system-notices.ts`: desk.notify.system, do not disturb,
//! the notice's first action) and sends each with `desk_notice_post`; the shell decides whether now:
//! with `when: background` only while the desk is not in front, and a notice the island already
//! shows (`island: true`, one that came as `ui.notified`) not while the island shows. The OS is
//! asked for permission on the first post that needs it, never at start, and never again once it
//! refuses. A click on the OS notification brings the desk forward and tells the page
//! `notice://activated { id, action }`, which runs the notice's action or opens it.

use std::sync::{Arc, Mutex};

use desk_sys::notification::{Authorization, Click, Notification, Notifier};
use desk_web::sender::Role;
use serde_json::{Value, json};

use crate::host::Desk;
use crate::pump::Pump;
use crate::window::Shell;

/// What the page hears when an OS notification is clicked.
pub const ACTIVATED: &str = "notice://activated";

/// When a notice may reach the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum When {
    /// Only while the desk is not in front (`desk.notify.system`'s default).
    Background,
    /// Whether or not the desk is in front.
    Always,
}

/// One notice the page asks the shell to post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Post {
    pub notification: Notification,
    pub when: When,
    /// The island shows it too while it is on screen (it came as `ui.notified`).
    pub island: bool,
}

impl Post {
    /// The page's `desk_notice_post` arguments.
    pub fn parse(args: &Value) -> Result<Self, String> {
        let text = |name: &str| args.get(name).and_then(Value::as_str).map(str::to_owned);
        let id = text("id").filter(|id| !id.is_empty());
        let id = id.ok_or("desk_notice_post needs the notice's id")?;
        let title = text("title").ok_or("desk_notice_post needs the notice's title")?;
        let level = serde_json::from_value(args.get("level").cloned().unwrap_or(json!("info")))
            .map_err(|why| format!("not a notice level: {why}"))?;
        let when = match text("when").as_deref() {
            Some("always") => When::Always,
            _ => When::Background,
        };
        Ok(Self {
            notification: Notification {
                id,
                title,
                body: text("body").filter(|body| !body.is_empty()),
                level,
                action: text("action").filter(|label| !label.is_empty()),
            },
            when,
            island: args.get("island").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

/// What the shell's windows are now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Now {
    /// The desk's main window has the keys and is on screen.
    pub front: bool,
    /// The island is on screen.
    pub island: bool,
}

/// What became of a post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Posted,
    /// Not now: the desk is in front, or the island shows it.
    Skipped,
    /// The OS does not let the desk post (or has no notifications here).
    Refused(String),
}

/// Whether `post` goes to the OS with the windows as `now` says.
pub fn wanted(post: &Post, now: Now) -> bool {
    let out_of_sight = post.when == When::Always || !now.front;
    out_of_sight && !(post.island && now.island)
}

/// The OS notifier and whether it was asked for permission.
pub struct SystemNotices {
    notifier: Option<Arc<dyn Notifier>>,
    /// Held while asking, so two first posts prompt once.
    asking: Mutex<()>,
}

impl SystemNotices {
    /// `notifier` is none where the OS has no notifications for this process (a bare build).
    /// Nothing is asked here: the first post that needs it asks. `activated` hears every click.
    pub fn new(
        notifier: Option<Arc<dyn Notifier>>,
        activated: impl Fn(Click) + Send + Sync + 'static,
    ) -> Self {
        if let Some(notifier) = &notifier {
            notifier.on_click(Box::new(activated));
        }
        Self {
            notifier,
            asking: Mutex::new(()),
        }
    }

    /// Post `post` if `now` wants it, asking the OS once when it never was. Blocks while the OS
    /// prompt waits, so it runs off the event loop's thread.
    pub fn post(&self, post: &Post, now: Now) -> Outcome {
        if !wanted(post, now) {
            return Outcome::Skipped;
        }
        let Some(notifier) = &self.notifier else {
            return Outcome::Refused("this desk has no OS notifications".to_owned());
        };
        let authorization = {
            let _asking = self.asking.lock().unwrap_or_else(|e| e.into_inner());
            match notifier.authorization() {
                Authorization::NotDetermined => notifier
                    .request_authorization()
                    .unwrap_or(Authorization::Denied),
                known => known,
            }
        };
        if !authorization.can_post() {
            return Outcome::Refused(format!("the OS does not allow it ({authorization:?})"));
        }
        match notifier.post(&post.notification) {
            Ok(()) => Outcome::Posted,
            Err(err) => Outcome::Refused(err.message),
        }
    }
}

/// What a click tells the page.
pub fn activation(click: &Click) -> Value {
    json!({ "id": click.id, "action": click.action })
}

/// The desk's notices: the OS notifier, whose click brings the desk forward and tells the page.
/// Made on the first post, so nothing of the OS's is touched at start.
fn made(pump: &Pump) -> SystemNotices {
    let notifier = match desk_sys::notification::os(crate::paths::IDENTIFIER, "endue") {
        Ok(notifier) => Some(Arc::from(notifier)),
        Err(why) => {
            eprintln!("notices: no OS notifications ({})", why.message);
            None
        }
    };
    let pump = pump.clone();
    SystemNotices::new(notifier, move |click| {
        let payload = activation(&click);
        pump.run(move |shell, _| {
            crate::palette::reveal_main(shell);
            shell.desk.pages.emit(Role::Main, ACTIVATED, payload);
        });
    })
}

/// Whether the desk is the app in front: its main window has the keys and is on screen (as the
/// island decides it).
fn desk_in_front(shell: &Shell) -> bool {
    shell.pane(Role::Main).is_some_and(|main| {
        main.visible() && main.window.has_focus() && !main.window.is_minimized().unwrap_or(false)
    })
}

/// The page's `desk_notice_post`: decided on the event loop's thread, where the windows are, and
/// posted on a thread of its own, which may wait for the OS prompt.
pub fn answer(desk: &Desk, args: &Value) -> Result<Value, String> {
    let post = Post::parse(args)?;
    let notices = Arc::clone(desk.notices.get_or_init(|| Arc::new(made(&desk.pump))));
    desk.pump.run(move |shell, _| {
        let now = Now {
            front: desk_in_front(shell),
            island: shell.pane(Role::Island).is_some_and(|pane| pane.visible()),
        };
        let spawned = std::thread::Builder::new()
            .name("desk-notice-post".to_owned())
            .spawn(move || {
                if let Outcome::Refused(why) = notices.post(&post, now) {
                    eprintln!("notices: {} not posted: {why}", post.notification.id);
                }
            });
        if let Err(why) = spawned {
            eprintln!("notices: no thread to post on ({why})");
        }
    });
    Ok(Value::Null)
}
