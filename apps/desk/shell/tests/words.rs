//! Acceptance (#360): the shell's menu bar, tray and notices speak the desk's language. Their words
//! come from the shell's catalogs (`apps/desk/shell/messages`, ADR 0276), English the fallback; the
//! language is the person's `desk.language` as the core holds it (the runtime's own `language`),
//! with `system` the OS's, and a change in the core reaches the shell without a restart.

use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use desk_bridge::{BridgeRequest, BridgeResponse};
use desk_core::{Core, Roots};
use desk_shell::language::{self, KEY, OWNER};
use desk_shell::menu::{self, Choice, Entry, Standard};
use desk_shell::tray;
use desk_shell::words::{self, Language};
use serde_json::{Value, json};

fn labels(items: &[(Choice, String)]) -> Vec<(Choice, &str)> {
    items.iter().map(|(c, text)| (*c, text.as_str())).collect()
}

#[test]
fn the_tray_is_built_in_each_language() {
    let staged = tray::items(Language::En, Some("1.4.0"));
    assert_eq!(
        labels(&staged),
        [
            (Choice::Search, "Search Desk"),
            (Choice::Eris, "Talk to Eris"),
            (Choice::Desk, "Open Desk"),
            (Choice::Update, "Restart to update (1.4.0)"),
            (Choice::Quit, "Quit Desk"),
        ]
    );
    let korean = tray::items(Language::Ko, Some("1.4.0"));
    assert_eq!(
        labels(&korean),
        [
            (Choice::Search, "Desk 검색"),
            (Choice::Eris, "Eris에게 말하기"),
            (Choice::Desk, "Desk 열기"),
            (Choice::Update, "다시 시작해 업데이트 (1.4.0)"),
            (Choice::Quit, "Desk 종료"),
        ]
    );
    for language in Language::ALL {
        let plain = tray::items(language, None);
        assert!(plain.iter().all(|(c, _)| *c != Choice::Update), "{plain:?}");
        assert_eq!(plain.len(), 4);
        for (_, text) in plain {
            assert!(
                !text.starts_with("desk."),
                "{language:?} reads an id: {text}"
            );
        }
    }
}

/// Each section's title, then its entries as (what it is, its words, its key); separators as "-".
fn shape(language: Language) -> Vec<(String, Vec<(String, String, Option<&'static str>)>)> {
    menu::bar(language)
        .into_iter()
        .map(|section| {
            let entries = section.entries.into_iter().map(|entry| match entry {
                Entry::Item { choice, text, keys } => (format!("{choice:?}"), text, keys),
                Entry::Standard { kind, text } => (format!("{kind:?}"), text, None),
                Entry::Separator => ("-".to_owned(), String::new(), None),
            });
            (section.title, entries.collect())
        })
        .collect()
}

#[test]
fn the_menu_bar_is_built_in_each_language() {
    let english = shape(Language::En);
    let korean = shape(Language::Ko);
    let titles = |bar: &[(String, Vec<_>)]| bar.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>();
    assert_eq!(titles(&english), ["endue Desk", "Edit", "Window"]);
    assert_eq!(titles(&korean), ["endue Desk", "편집", "윈도우"]);
    let words = |bar: &[(String, Vec<(String, String, Option<&str>)>)], at: usize| {
        bar[at]
            .1
            .iter()
            .map(|(_, text, _)| text.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        words(&english, 0),
        [
            "About endue Desk",
            "",
            "Services",
            "",
            "Hide endue Desk",
            "Hide Others",
            "Show All",
            "",
            "Quit endue Desk",
        ]
    );
    assert_eq!(
        words(&korean, 0),
        [
            "endue Desk에 관하여",
            "",
            "서비스",
            "",
            "endue Desk 가리기",
            "기타 가리기",
            "모두 보기",
            "",
            "endue Desk 종료",
        ]
    );
    assert_eq!(
        words(&english, 1),
        ["Undo", "Redo", "", "Cut", "Copy", "Paste", "Select All"]
    );
    assert_eq!(
        words(&korean, 1),
        [
            "실행 취소",
            "실행 복귀",
            "",
            "오려두기",
            "복사하기",
            "붙여넣기",
            "전체 선택"
        ]
    );
    assert_eq!(
        words(&english, 2),
        ["Minimize", "Move to Desk", "Close Window"]
    );
    assert_eq!(
        words(&korean, 2),
        ["최소화", "데스크로 되돌리기", "윈도우 닫기"]
    );
    // The same items, in the same places and with the same keys, in either language.
    let kinds = |bar: &[(String, Vec<(String, String, Option<&'static str>)>)]| {
        let rows = bar.iter().flat_map(|(_, entries)| entries.iter());
        rows.map(|(kind, _, keys)| (kind.clone(), *keys))
            .collect::<Vec<_>>()
    };
    assert_eq!(kinds(&english), kinds(&korean));
    let quit = (Choice::Quit, Some("CmdOrCtrl+Q"));
    let dock = (Choice::Dock, Some("CmdOrCtrl+Shift+Backslash"));
    let items: Vec<_> = (menu::bar(Language::Ko).into_iter())
        .flat_map(|section| section.entries)
        .filter_map(|entry| match entry {
            Entry::Item { choice, keys, .. } => Some((choice, keys)),
            _ => None,
        })
        .collect();
    assert_eq!(items, [quit, dock]);
    let standard = (menu::bar(Language::En).into_iter())
        .flat_map(|section| section.entries)
        .filter(|entry| {
            matches!(
                entry,
                Entry::Standard {
                    kind: Standard::SelectAll,
                    ..
                }
            )
        })
        .count();
    assert_eq!(standard, 1);
}

#[test]
fn the_language_is_the_one_chosen_else_the_oss() {
    let os = |tags: &[&str]| tags.iter().map(|t| (*t).to_owned()).collect::<Vec<_>>();
    assert_eq!(language::resolve(Some("ko"), &os(&["en-US"])), Language::Ko);
    assert_eq!(language::resolve(Some("en"), &os(&["ko-KR"])), Language::En);
    assert_eq!(
        language::resolve(Some("system"), &os(&["ko-KR", "en-US"])),
        Language::Ko
    );
    assert_eq!(
        language::resolve(None, &os(&["fr-FR", "ko_KR.UTF-8"])),
        Language::Ko
    );
    assert_eq!(
        language::resolve(Some("fr"), &os(&["fr-FR", "de"])),
        Language::En
    );
    assert_eq!(language::resolve(Some("system"), &[]), Language::En);
    assert_eq!(language::resolve(Some("system"), &os(&["C"])), Language::En);
}

#[test]
fn a_word_korean_lacks_reads_in_english_then_as_its_id() {
    assert_eq!(words::text(Language::Ko, "desk.tray.search"), "Desk 검색");
    assert_eq!(
        words::text(Language::Ko, "desk.no.suchWord"),
        "desk.no.suchWord"
    );
    // Without parameters the text stays as written; with them each {name} is filled.
    assert_eq!(
        words::text(Language::En, "desk.tray.update"),
        "Restart to update ({version})"
    );
    assert_eq!(
        words::filled(Language::En, "desk.tray.update", &[("version", "2.0.0")]),
        "Restart to update (2.0.0)"
    );
    assert_eq!(
        words::filled(Language::En, "desk.tray.update", &[]),
        "Restart to update ()"
    );
    // Korean says nothing English does not: every Korean id is an English one.
    let english = words::catalog(Language::En);
    assert!(!english.is_empty());
    for id in words::catalog(Language::Ko).keys() {
        assert!(
            english.contains_key(id),
            "ko.json has {id}, en.json does not"
        );
    }
}

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Value {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result,
        BridgeResponse::BridgeFailure(err) => panic!("{method}: {}", err.error.message),
    }
}

#[test]
fn the_shell_hears_desk_language_change_in_the_core() {
    let home = std::env::temp_dir().join(format!("desk-words-{}", std::process::id()));
    let core = Arc::new(Core::new(Roots { home }));
    assert_eq!(language::chosen(&core), None, "nothing chosen yet: system");
    let (heard, hear) = mpsc::channel();
    language::follow(&core, move |language| {
        let _ = heard.send(language);
    })
    .unwrap();
    let choose = |value: &str| {
        call(
            &core,
            OWNER,
            "settings.set",
            json!({ "key": KEY, "value": value }),
        );
    };
    choose("ko");
    assert_eq!(language::chosen(&core).as_deref(), Some("ko"));
    let wait = Duration::from_secs(5);
    assert_eq!(hear.recv_timeout(wait), Ok(Language::Ko));
    choose("en");
    assert_eq!(hear.recv_timeout(wait), Ok(Language::En));
    // Another owner's `language` is not the desk's.
    call(
        &core,
        "example.other",
        "settings.set",
        json!({ "key": KEY, "value": "ko" }),
    );
    assert!(hear.recv_timeout(Duration::from_millis(300)).is_err());
}
