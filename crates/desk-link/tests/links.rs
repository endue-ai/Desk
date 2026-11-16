//! The v1 grammar of endue:// links (#310, ADR 0244): three verbs parse, everything else is refused
//! whole with a sentence, and a parsed link formats back to its canonical string.

use desk_link::{Link, Refused, is_link, parse};

fn open(path: &str) -> Link {
    Link::Open {
        path: path.to_owned(),
    }
}

#[test]
fn the_three_link_kinds_parse() {
    assert_eq!(
        parse("endue://v1/open?path=%2FUsers%2Fa%2Fb.md"),
        Ok(open("/Users/a/b.md"))
    );
    assert_eq!(
        parse("endue://v1/open?path=/Users/a/b%20c.md"),
        Ok(open("/Users/a/b c.md"))
    );
    assert_eq!(
        parse("endue://v1/open?path=C%3A%2FUsers%2Fa%2Fb.md"),
        Ok(open("C:/Users/a/b.md"))
    );
    assert_eq!(
        parse("endue://v1/open?path=C%3A%5CUsers%5Ca.md"),
        Ok(open("C:/Users/a.md"))
    );
    let plugin = |surface: Option<&str>| Link::Plugin {
        id: "endue.notes".to_owned(),
        surface: surface.map(str::to_owned),
    };
    assert_eq!(parse("endue://v1/plugin/endue.notes"), Ok(plugin(None)));
    assert_eq!(
        parse("endue://v1/plugin/endue.notes?surface=main"),
        Ok(plugin(Some("main")))
    );
    let command = Link::Command {
        id: "endue.notes.new".to_owned(),
    };
    assert_eq!(
        parse("endue://v1/command/endue.notes.new"),
        Ok(command.clone())
    );
    // The scheme, version and verb in any case.
    assert_eq!(parse("ENDUE://V1/Command/endue.notes.new"), Ok(command));
    assert!(is_link("endue://v1/plugin/endue.notes") && is_link("Endue:x"));
    assert!(!is_link("/Users/a/endue.md") && !is_link("end"));
}

#[test]
fn unknown_and_malformed_links_are_refused() {
    let long = format!("endue://v1/open?path=/{}", "a".repeat(9000));
    let refused = [
        "https://endue.ai/v1/open?path=/a.md",
        "endue:v1/open?path=/a.md",
        "endue://open?path=/a.md",
        "endue://v2/open?path=/a.md",
        "endue://v1/settings/theme",
        "endue://v1/auth/callback?code=1",
        "endue://v1/install/endue.notes",
        "endue://v1/open",
        "endue://v1/open?path=/a.md&then=run",
        "endue://v1/open?path=/a.md&path=/b.md",
        "endue://v1/open?path=a.md",
        "endue://v1/open?path=/Users/../etc/passwd",
        "endue://v1/open?path=/a%00.md",
        "endue://v1/open?path=/a%2.md",
        "endue://v1/open?path=/a.md#top",
        "endue://me@v1/plugin/endue.notes",
        "endue://v1:80/plugin/endue.notes",
        "endue://v1/plugin/Endue.Notes",
        "endue://v1/plugin/notes",
        "endue://v1/plugin/endue.notes?surface=Main",
        "endue://v1/plugin/endue.notes/main",
        "endue://v1/command/endue.notes.new?args=%7B%7D",
        "endue://v1/command/rm%20-rf",
        "endue://v1/open?path=/a b.md",
        long.as_str(),
    ];
    for link in refused {
        let Err(Refused(why)) = parse(link) else {
            panic!("{link} was not refused")
        };
        assert!(why.ends_with('.') && why.len() > 10, "{link}: {why}");
    }
}

#[test]
fn a_link_round_trips() {
    for (given, canonical) in [
        (
            "ENDUE://V1/OPEN?path=/Users/a/b%20c.md",
            "endue://v1/open?path=%2FUsers%2Fa%2Fb%20c.md",
        ),
        (
            "endue://v1/open?path=C%3A%5Ca.md",
            "endue://v1/open?path=C%3A%2Fa.md",
        ),
        (
            "endue://v1/plugin/endue.notes?surface=main",
            "endue://v1/plugin/endue.notes?surface=main",
        ),
        (
            "endue://v1/Command/endue.notes.new",
            "endue://v1/command/endue.notes.new",
        ),
        (
            "endue://v1/open?path=/%ED%95%9C.md",
            "endue://v1/open?path=%2F%ED%95%9C.md",
        ),
    ] {
        let link = parse(given).unwrap_or_else(|why| panic!("{given}: {why}"));
        assert_eq!(link.to_string(), canonical);
        assert_eq!(parse(canonical), Ok(link), "{canonical}");
    }
}

#[test]
fn hidden_characters_and_loose_escapes_are_refused() {
    for link in [
        "endue://v1/open?path=/a%E2%80%AEgpj.exe",
        "endue://v1/open?path=/a\u{202E}gpj.exe",
        "endue://v1/open?path=/a%E2%80%8B.md",
        "endue://v1/open?path=/a%0A.md",
        "endue://v1/open?path=/a%+A.md",
        "endue://v1/open?path=/a%-1.md",
        "endue://v1/plugin/endue.notes?surface=%EF%BB%BFmain",
    ] {
        assert!(parse(link).is_err(), "{link} was not refused");
    }
}

/// A refusal is the desk's own sentence: nothing of the link, which anyone could have written,
/// reaches the notice.
#[test]
fn refusals_never_repeat_the_link() {
    let bait = "PleaseCallSupportAt5550100";
    for link in [
        format!("endue://{bait}/open?path=/a.md"),
        format!("endue://v1/open?path=/a.md&{bait}=1"),
        format!("endue://v1/plugin/{bait}"),
        format!("endue://v1/plugin/endue.notes?surface={bait}"),
        format!("endue://v1/command/{bait}"),
        format!("endue://v1/{bait}"),
    ] {
        let Err(Refused(why)) = parse(&link) else {
            panic!("{link} was not refused")
        };
        assert!(!why.contains(bait), "{link}: {why}");
        assert!(why.len() < 120, "{why}");
    }
}
