use super::{Answer, Quit, Step, Why};
use serde_json::{Value, json};

const PERSON: Why = Why::Person;
const STALLED: Why = Why::Stalled;

fn ask(n: u64, show: bool, why: Why) -> Step {
    Step::Ask { n, show, why }
}

#[test]
fn a_quit_asks_the_page_and_goes_on_its_answer() {
    let mut quit = Quit::default();
    assert_eq!(quit.requested(true, PERSON), ask(1, false, PERSON));
    assert_eq!(quit.answered(Answer::Quit), Step::Quit);
    // The person kept something: the desk stays, and the next quit asks again.
    assert_eq!(quit.requested(true, PERSON), ask(2, false, PERSON));
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
    assert!(!quit.restart(), "a person's quit starts no new desk");
}

#[test]
fn a_page_that_does_not_answer_does_not_hold_the_quit() {
    let mut quit = Quit::default();
    assert_eq!(quit.requested(false, PERSON), Step::Quit, "no page to ask");
    assert_eq!(quit.requested(true, PERSON), ask(1, false, PERSON));
    assert_eq!(quit.waited(1), Step::Quit);
    // A wait that ends after the page answered changes nothing.
    assert_eq!(quit.requested(true, PERSON), ask(2, false, PERSON));
    assert_eq!(quit.answered(Answer::Stay), Step::Nothing);
    assert_eq!(quit.waited(2), Step::Nothing);
}

#[test]
fn quitting_again_while_the_person_decides_asks_the_page_again() {
    let mut quit = Quit::default();
    assert_eq!(quit.requested(true, PERSON), ask(1, false, PERSON));
    assert_eq!(quit.answered(Answer::Asking), Step::Show);
    assert_eq!(quit.requested(true, PERSON), ask(2, true, PERSON));
    assert_eq!(quit.waited(1), Step::Nothing, "the first wait is over");
    // A page still asking says so again; one that died meanwhile says nothing, and the desk quits.
    assert_eq!(quit.answered(Answer::Asking), Step::Show);
    assert_eq!(quit.waited(2), Step::Nothing);
    assert_eq!(quit.requested(true, PERSON), ask(3, true, PERSON));
    assert_eq!(quit.waited(3), Step::Quit);
}

#[test]
fn answers_read_as_the_page_sends_them() {
    assert_eq!(Answer::parse("asking"), Some(Answer::Asking));
    assert_eq!(Answer::parse("quit"), Some(Answer::Quit));
    assert_eq!(Answer::parse("stay"), Some(Answer::Stay));
    assert_eq!(Answer::parse("later"), None);
}

#[test]
fn a_stalled_page_quits_to_start_again_only_on_its_quit() {
    let mut quit = Quit::default();
    assert_eq!(quit.requested(true, STALLED), ask(1, false, STALLED));
    assert_eq!(quit.answered(Answer::Quit), Step::Quit);
    assert!(quit.restart(), "the stalled desk's quit starts a new desk");
}

#[test]
fn a_stalled_page_with_something_unsaved_keeps_the_desk() {
    let mut quit = Quit::default();
    assert_eq!(quit.requested(true, STALLED), ask(1, false, STALLED));
    assert_eq!(quit.answered(Answer::Stay), Step::Nothing);
    assert!(!quit.restart());
    // A page that would ask the person: nobody would see the question, so the desk stays too and
    // does not wait for an answer that cannot come.
    assert_eq!(quit.requested(true, STALLED), ask(2, false, STALLED));
    assert_eq!(quit.answered(Answer::Asking), Step::Nothing);
    assert_eq!(quit.waited(2), Step::Nothing, "no quit is asked now");
    assert!(!quit.restart());
}

#[test]
fn a_stalled_page_that_does_not_answer_restarts_the_desk() {
    // Its scripts stopped as well: the desk quits as any unanswered quit does, and starts again.
    let mut quit = Quit::default();
    assert_eq!(quit.requested(true, STALLED), ask(1, false, STALLED));
    assert_eq!(quit.waited(1), Step::Quit);
    assert!(quit.restart());
}

#[test]
fn a_stalled_quit_never_brings_the_desk_forward() {
    let mut quit = Quit::default();
    assert_eq!(quit.requested(true, PERSON), ask(1, false, PERSON));
    assert_eq!(quit.answered(Answer::Asking), Step::Show);
    // The page stopped painting while the person was asked: the stalled quit asks the page again
    // without showing a question nobody can see.
    assert_eq!(quit.requested(true, STALLED), ask(2, false, STALLED));
    assert_eq!(quit.answered(Answer::Stay), Step::Nothing);
    assert!(!quit.restart());
}

#[test]
fn the_page_hears_why_the_desk_quits() {
    assert_eq!(PERSON.payload(), Value::Null);
    assert_eq!(STALLED.payload(), json!({ "why": "stalled" }));
}
