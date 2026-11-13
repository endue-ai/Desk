//! A quit the person asks for (the menu, the tray, the Dock's Quit, the quit at logout, an update's
//! restart) asks the desk's page first (#163): the page hears `desk://quit` and asks about each
//! buffer with unsaved changes as closing it does (`apps/desk/src/quit.ts`). It answers
//! `desk_quit`: `asking` while the person decides, and the shell brings the desk forward and waits
//! as long as that takes; then `quit`, and every browser closes, or `stay`, and the desk stays. A
//! page that gives no first answer within [`ANSWER_WAIT`] (gone, hung, still starting) does not
//! hold the quit: the desk quits as it did before. A quit asked again while the person decides
//! asks the page again, so a page that died meanwhile cannot keep the desk from quitting.
//!
//! The desk's own page that stopped painting (#157) asks for a quit of its own (ADR 0202): the
//! page hears `desk://quit` with `{ "why": "stalled" }`, asks nobody (a question it drew would not
//! show), and answers `quit` only with nothing unsaved. That quit ends in a start of a new desk
//! (`stall_restart.rs`); an `asking` or `stay` keeps this desk as it is.

use std::time::Duration;

use desk_web::sender::Role;
use serde_json::{Value, json};
use winit::event_loop::ActiveEventLoop;

use crate::window::Shell;

/// What the main page hears when the person quits.
pub const EVENT: &str = "desk://quit";
/// How long the shell waits for the page's first answer.
pub const ANSWER_WAIT: Duration = Duration::from_secs(3);

/// The page's answer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Answer {
    /// The person is asked; wait for them.
    Asking,
    Quit,
    Stay,
}

impl Answer {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "asking" => Some(Self::Asking),
            "quit" => Some(Self::Quit),
            "stay" => Some(Self::Stay),
            _ => None,
        }
    }
}

/// Why the desk quits.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Why {
    /// The person asked.
    #[default]
    Person,
    /// The desk's own page stopped painting: quit, then start a new desk (ADR 0202).
    Stalled,
}

impl Why {
    /// What the page hears with [`EVENT`].
    pub fn payload(self) -> Value {
        match self {
            Why::Person => Value::Null,
            Why::Stalled => json!({ "why": "stalled" }),
        }
    }
}

/// What the shell does next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Tell the page [`EVENT`] and wait for its first answer to ask `n`; bring the desk forward
    /// first when `show` (the person was being asked).
    Ask {
        n: u64,
        show: bool,
        why: Why,
    },
    /// Bring the desk forward: the page asks the person there.
    Show,
    /// Close every browser.
    Quit,
    Nothing,
}

/// Where a quit is: none asked, or ask `n` waiting for the page, `holding` once it is asking.
#[derive(Debug, Default)]
pub struct Quit {
    asked: Option<(u64, bool, Why)>,
    count: u64,
    /// The quit that ended this desk was a stalled page's: start a new one.
    restart: bool,
}

impl Quit {
    /// A quit is asked for `why`; `page` says whether the main page is there to ask.
    pub fn requested(&mut self, page: bool, why: Why) -> Step {
        if !page {
            self.asked = None;
            return self.quit(why);
        }
        let show = why == Why::Person && self.asked.is_some_and(|(_, holding, _)| holding);
        self.count += 1;
        self.asked = Some((self.count, false, why));
        Step::Ask {
            n: self.count,
            show,
            why,
        }
    }

    /// The page answered; an answer to no quit asked (one after its wait ended) changes nothing.
    pub fn answered(&mut self, answer: Answer) -> Step {
        let Some((n, _, why)) = self.asked else {
            return Step::Nothing;
        };
        match (answer, why) {
            // Nobody sees a question on a page that does not paint: the desk stays as it is.
            (Answer::Asking, Why::Stalled) | (Answer::Stay, _) => {
                self.asked = None;
                Step::Nothing
            }
            (Answer::Asking, Why::Person) => {
                self.asked = Some((n, true, why));
                Step::Show
            }
            (Answer::Quit, _) => {
                self.asked = None;
                self.quit(why)
            }
        }
    }

    /// The wait for ask `n`'s first answer ended: with none, the desk quits.
    pub fn waited(&mut self, n: u64) -> Step {
        match self.asked {
            Some((asked, false, why)) if asked == n => {
                self.asked = None;
                self.quit(why)
            }
            _ => Step::Nothing,
        }
    }

    /// Whether the quit that ended this desk asks for a new one (a stalled page's).
    pub fn restart(&self) -> bool {
        self.restart
    }

    fn quit(&mut self, why: Why) -> Step {
        self.restart = why == Why::Stalled;
        Step::Quit
    }
}

impl Shell {
    /// Whether the desk quit to start again because its own page stopped painting (ADR 0202).
    pub fn restarts_for_stall(&self) -> bool {
        self.asked.restart()
    }
}

/// The person asked to quit.
pub fn requested(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    ask(shell, event_loop, Why::Person);
}

/// The desk's own page stopped painting (ADR 0202): quit and start again, unless the page says
/// something is unsaved or a desk started for a stall a short while ago already.
pub fn stalled(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    let last = std::env::var(crate::stall_restart::ENV).ok();
    if !crate::stall_restart::may(last.as_deref(), std::time::SystemTime::now()) {
        eprintln!(
            "endue Desk: this desk started for a stall less than {} min ago, so it does not start again: \
             quit and start it by hand",
            crate::stall_restart::BETWEEN.as_secs() / 60
        );
        return;
    }
    ask(shell, event_loop, Why::Stalled);
}

fn ask(shell: &mut Shell, event_loop: &ActiveEventLoop, why: Why) {
    if shell.quitting {
        return;
    }
    let page = shell.pane(Role::Main).is_some();
    let step = shell.asked.requested(page, why);
    take(shell, event_loop, step);
}

/// The page's answer (`desk_quit`).
pub fn answered(shell: &mut Shell, event_loop: &ActiveEventLoop, answer: Answer) {
    if shell.quitting {
        return;
    }
    let step = shell.asked.answered(answer);
    take(shell, event_loop, step);
}

fn waited(shell: &mut Shell, event_loop: &ActiveEventLoop, n: u64) {
    if shell.quitting {
        return;
    }
    let step = shell.asked.waited(n);
    take(shell, event_loop, step);
}

fn take(shell: &mut Shell, event_loop: &ActiveEventLoop, step: Step) {
    match step {
        Step::Ask { n, show, why } => {
            if show {
                shell.focus_main();
            }
            shell.desk.pages.emit(Role::Main, EVENT, why.payload());
            let pump = shell.desk.pump.clone();
            let wait = std::thread::Builder::new()
                .name("desk-quit-wait".to_owned())
                .spawn(move || {
                    std::thread::sleep(ANSWER_WAIT);
                    pump.run(move |shell, event_loop| waited(shell, event_loop, n));
                });
            // Without a thread to end the wait, the desk would never quit: it quits now.
            if wait.is_err() {
                shell.quit_now(event_loop);
            }
        }
        Step::Show => shell.focus_main(),
        Step::Quit => shell.quit_now(event_loop),
        Step::Nothing => {}
    }
}

#[cfg(test)]
#[path = "quit_tests.rs"]
mod tests;
