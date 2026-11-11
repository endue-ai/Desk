//! A quit the person asks for (the menu, the tray, the Dock's Quit, the quit at logout, an update's
//! restart) asks the desk's page first (#163): the page hears `desk://quit` and asks about each
//! buffer with unsaved changes as closing it does (`apps/desk/src/quit.ts`). It answers
//! `desk_quit`: `asking` while the person decides, and the shell brings the desk forward and waits
//! as long as that takes; then `quit`, and every browser closes, or `stay`, and the desk stays. A
//! page that gives no first answer within [`ANSWER_WAIT`] (gone, hung, still starting) does not
//! hold the quit: the desk quits as it did before. A quit asked again while the person decides
//! asks the page again, so a page that died meanwhile cannot keep the desk from quitting.

use std::time::Duration;

use desk_web::sender::Role;
use serde_json::Value;
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

/// What the shell does next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// Tell the page [`EVENT`] and wait for its first answer to ask `n`; bring the desk forward
    /// first when `show` (the person was being asked).
    Ask {
        n: u64,
        show: bool,
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
    asked: Option<(u64, bool)>,
    count: u64,
}

impl Quit {
    /// The person asked to quit; `page` says whether the main page is there to ask.
    pub fn requested(&mut self, page: bool) -> Step {
        if !page {
            self.asked = None;
            return Step::Quit;
        }
        let show = self.asked.is_some_and(|(_, holding)| holding);
        self.count += 1;
        self.asked = Some((self.count, false));
        Step::Ask {
            n: self.count,
            show,
        }
    }

    /// The page answered; an answer to no quit asked (one after its wait ended) changes nothing.
    pub fn answered(&mut self, answer: Answer) -> Step {
        let Some((n, _)) = self.asked else {
            return Step::Nothing;
        };
        match answer {
            Answer::Asking => {
                self.asked = Some((n, true));
                Step::Show
            }
            Answer::Quit => {
                self.asked = None;
                Step::Quit
            }
            Answer::Stay => {
                self.asked = None;
                Step::Nothing
            }
        }
    }

    /// The wait for ask `n`'s first answer ended: with none, the desk quits.
    pub fn waited(&mut self, n: u64) -> Step {
        match self.asked {
            Some((asked, false)) if asked == n => {
                self.asked = None;
                Step::Quit
            }
            _ => Step::Nothing,
        }
    }
}

/// The person asked to quit.
pub fn requested(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    if shell.quitting {
        return;
    }
    let page = shell.pane(Role::Main).is_some();
    let step = shell.asked.requested(page);
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
        Step::Ask { n, show } => {
            if show {
                shell.focus_main();
            }
            shell.desk.pages.emit(Role::Main, EVENT, Value::Null);
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
mod tests {
    use super::{Answer, Quit, Step};

    #[test]
    fn a_quit_asks_the_page_and_goes_on_its_answer() {
        let mut quit = Quit::default();
        assert_eq!(quit.requested(true), Step::Ask { n: 1, show: false });
        assert_eq!(quit.answered(Answer::Quit), Step::Quit);
        // The person kept something: the desk stays, and the next quit asks again.
        assert_eq!(quit.requested(true), Step::Ask { n: 2, show: false });
        assert_eq!(quit.answered(Answer::Asking), Step::Show);
        assert_eq!(
            quit.waited(2),
            Step::Nothing,
            "the person takes as long as they need"
        );
        assert_eq!(quit.answered(Answer::Stay), Step::Nothing);
        assert_eq!(
            quit.answered(Answer::Quit),
            Step::Nothing,
            "no quit is asked now"
        );
    }

    #[test]
    fn a_page_that_does_not_answer_does_not_hold_the_quit() {
        let mut quit = Quit::default();
        assert_eq!(quit.requested(false), Step::Quit, "no page to ask");
        assert_eq!(quit.requested(true), Step::Ask { n: 1, show: false });
        assert_eq!(quit.waited(1), Step::Quit);
        // A wait that ends after the page answered changes nothing.
        assert_eq!(quit.requested(true), Step::Ask { n: 2, show: false });
        assert_eq!(quit.answered(Answer::Stay), Step::Nothing);
        assert_eq!(quit.waited(2), Step::Nothing);
    }

    #[test]
    fn quitting_again_while_the_person_decides_asks_the_page_again() {
        let mut quit = Quit::default();
        assert_eq!(quit.requested(true), Step::Ask { n: 1, show: false });
        assert_eq!(quit.answered(Answer::Asking), Step::Show);
        assert_eq!(quit.requested(true), Step::Ask { n: 2, show: true });
        assert_eq!(quit.waited(1), Step::Nothing, "the first wait is over");
        // A page still asking says so again; one that died meanwhile says nothing, and the desk quits.
        assert_eq!(quit.answered(Answer::Asking), Step::Show);
        assert_eq!(quit.waited(2), Step::Nothing);
        assert_eq!(quit.requested(true), Step::Ask { n: 3, show: true });
        assert_eq!(quit.waited(3), Step::Quit);
    }

    #[test]
    fn answers_read_as_the_page_sends_them() {
        assert_eq!(Answer::parse("asking"), Some(Answer::Asking));
        assert_eq!(Answer::parse("quit"), Some(Answer::Quit));
        assert_eq!(Answer::parse("stay"), Some(Answer::Stay));
        assert_eq!(Answer::parse("later"), None);
    }
}
