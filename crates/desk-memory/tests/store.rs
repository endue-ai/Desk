//! Eris's memory on disk (ADR 0095): facts in facts.yaml, episodes in a file per month, and a search
//! index derived from both that forgetting reaches as well.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::{MemoryEntry, MemoryKind, MemoryStep};
use desk_memory::{Memory, MemoryError};

fn folder(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!(
        "desk-memory-{tag}-{}-{nanos}-{n}",
        std::process::id()
    ))
}

fn ids(hits: &[desk_bridge::MemoryHit]) -> Vec<String> {
    hits.iter().map(|hit| id_of(&hit.entry)).collect()
}

fn id_of(entry: &MemoryEntry) -> String {
    match entry {
        MemoryEntry::MemoryFact(fact) => fact.id.clone(),
        MemoryEntry::MemoryEpisode(episode) => episode.id.clone(),
    }
}

#[test]
fn remembered_facts_are_listed_got_and_found() {
    let memory = Memory::open(folder("remember")).unwrap();
    let pnpm = memory
        .remember("Prefers pnpm over npm in every repository", None, "eris")
        .unwrap();
    let morning = memory
        .remember(
            "Reviews pull requests in the morning",
            Some(vec!["work".into()]),
            "person",
        )
        .unwrap();
    assert!(pnpm.id.starts_with("fact_"), "{}", pnpm.id);
    assert_eq!(pnpm.by, "eris");
    assert_eq!(morning.tags, Some(vec!["work".to_owned()]));

    let page = memory.list(None, 50, None).unwrap();
    let listed: Vec<String> = page.entries.iter().map(id_of).collect();
    assert_eq!(
        listed,
        [morning.id.clone(), pnpm.id.clone()],
        "newest first"
    );
    assert_eq!(page.next, None);
    assert_eq!(
        memory.get(&pnpm.id).unwrap(),
        MemoryEntry::MemoryFact(pnpm.clone())
    );

    let hits = memory
        .search("which package manager, pnpm?", None, 20)
        .unwrap();
    assert_eq!(ids(&hits), std::slice::from_ref(&pnpm.id));
    assert!(hits[0].snippet.contains("pnpm"), "{}", hits[0].snippet);
    assert!(matches!(
        memory.get("fact_000000000000"),
        Err(MemoryError::NotFound(_))
    ));
}

#[test]
fn a_list_comes_in_pages() {
    let memory = Memory::open(folder("pages")).unwrap();
    let kept: Vec<String> = (0..5)
        .map(|n| {
            memory
                .remember(&format!("fact number {n}"), None, "person")
                .unwrap()
                .id
        })
        .collect();
    let first = memory.list(Some(MemoryKind::Fact), 2, None).unwrap();
    assert_eq!(
        first.entries.iter().map(id_of).collect::<Vec<_>>(),
        [kept[4].clone(), kept[3].clone()]
    );
    let second = memory
        .list(Some(MemoryKind::Fact), 2, first.next.as_deref())
        .unwrap();
    assert_eq!(
        second.entries.iter().map(id_of).collect::<Vec<_>>(),
        [kept[2].clone(), kept[1].clone()]
    );
}

#[test]
fn an_edited_fact_is_found_by_its_new_words_only() {
    let memory = Memory::open(folder("edit")).unwrap();
    let fact = memory
        .remember("Standup is at nine", None, "person")
        .unwrap();
    let edited = memory
        .edit(&fact.id, "Standup is at ten on weekdays", None)
        .unwrap();
    assert_eq!(edited.id, fact.id);
    assert_eq!(edited.at, fact.at);
    assert!(edited.updated.is_some());
    assert!(memory.search("nine", None, 20).unwrap().is_empty());
    assert_eq!(
        ids(&memory.search("weekdays", None, 20).unwrap()),
        std::slice::from_ref(&fact.id)
    );
    assert!(matches!(
        memory.edit("fact_000000000000", "nothing", None),
        Err(MemoryError::NotFound(_))
    ));
}

#[test]
fn forgetting_removes_the_entry_from_disk_and_from_search() {
    let dir = folder("forget");
    let memory = Memory::open(&dir).unwrap();
    let secret = memory
        .remember("The garage code is 4711", None, "person")
        .unwrap();
    let kept = memory.remember("Likes green tea", None, "person").unwrap();
    let episode = memory
        .record(
            "what is the garage code?",
            "It is 4711.",
            Vec::new(),
            "eris",
        )
        .unwrap();
    assert_eq!(memory.forget(&secret.id).unwrap(), 1);
    assert_eq!(memory.forget(&episode.id).unwrap(), 1);
    assert_eq!(memory.forget(&secret.id).unwrap(), 0);

    assert!(memory.search("4711", None, 20).unwrap().is_empty());
    let on_disk = fs::read_to_string(dir.join("facts.yaml")).unwrap();
    assert!(
        !on_disk.contains("4711") && on_disk.contains("green tea"),
        "{on_disk}"
    );
    for month in fs::read_dir(dir.join("episodes")).unwrap() {
        let text = fs::read_to_string(month.unwrap().path()).unwrap();
        assert!(!text.contains("4711"), "{text}");
    }
    assert_eq!(memory.list(None, 50, None).unwrap().entries.len(), 1);
    assert_eq!(
        id_of(&memory.list(None, 50, None).unwrap().entries[0]),
        kept.id
    );
}

#[test]
fn forget_everything_leaves_empty_files() {
    let dir = folder("forget-all");
    let memory = Memory::open(&dir).unwrap();
    memory.remember("one", None, "person").unwrap();
    memory.remember("two", None, "person").unwrap();
    memory
        .record("asked", "answered", Vec::new(), "eris")
        .unwrap();
    assert_eq!(memory.forget_all(Some(MemoryKind::Episode)).unwrap(), 1);
    assert_eq!(memory.list(None, 50, None).unwrap().entries.len(), 2);
    assert_eq!(memory.forget_all(None).unwrap(), 2);
    assert!(memory.list(None, 50, None).unwrap().entries.is_empty());
    assert!(memory.search("one", None, 20).unwrap().is_empty());
    let reopened = Memory::open(&dir).unwrap();
    assert!(reopened.list(None, 50, None).unwrap().entries.is_empty());
}

#[test]
fn a_reopened_store_knows_what_it_knew() {
    let dir = folder("reopen");
    let (fact, episode) = {
        let memory = Memory::open(&dir).unwrap();
        let fact = memory
            .remember("Works on Desk this month", None, "person")
            .unwrap();
        let steps = vec![MemoryStep {
            command: "endue.mail.latest".into(),
            ok: true,
        }];
        let episode = memory
            .record("check my latest mail", "Two new messages.", steps, "eris")
            .unwrap();
        (fact, episode)
    };
    let memory = Memory::open(&dir).unwrap();
    assert_eq!(
        memory.get(&fact.id).unwrap(),
        MemoryEntry::MemoryFact(fact.clone())
    );
    assert_eq!(
        memory.get(&episode.id).unwrap(),
        MemoryEntry::MemoryEpisode(episode.clone())
    );
    assert_eq!(ids(&memory.search("mail", None, 20).unwrap()), [episode.id]);
}

#[test]
fn a_hand_edit_of_facts_yaml_is_read_and_indexed() {
    let dir = folder("hand-edit");
    let memory = Memory::open(&dir).unwrap();
    memory.remember("Likes green tea", None, "person").unwrap();
    let mut text = fs::read_to_string(dir.join("facts.yaml")).unwrap();
    // The same style as the file: `facts:` and its items at the left edge.
    assert!(text.contains("\n- id: fact_"), "{text}");
    text.push_str("- text: Parks the bike in the garage\n");
    // A different size and a later time, so the edit is seen even on a coarse clock.
    std::thread::sleep(Duration::from_millis(20));
    fs::write(dir.join("facts.yaml"), text).unwrap();

    let hits = memory.search("bike", Some(MemoryKind::Fact), 20).unwrap();
    assert_eq!(hits.len(), 1);
    let MemoryEntry::MemoryFact(fact) = &hits[0].entry else {
        panic!("a fact")
    };
    assert!(fact.id.starts_with("fact_"));
    assert_eq!(fact.by, "person");
    // The id it was given is written back, so it stays the same.
    let again = Memory::open(&dir).unwrap();
    assert_eq!(again.get(&fact.id).unwrap(), hits[0].entry);
}

#[test]
fn episodes_are_kept_by_month_and_found() {
    let dir = folder("months");
    let october = UNIX_EPOCH + Duration::from_secs(1_793_000_000); // 2026-10-26
    let november = UNIX_EPOCH + Duration::from_secs(1_794_500_000); // 2026-11-12
    let memory = Memory::open(&dir).unwrap().with_clock(move || october);
    let old = memory
        .record("plan the release", "Done.", Vec::new(), "eris")
        .unwrap();
    let memory = memory.with_clock(move || november);
    let new = memory
        .record("plan the party", "Done too.", Vec::new(), "eris")
        .unwrap();
    assert!(dir.join("episodes/2026-10.jsonl").is_file());
    assert!(dir.join("episodes/2026-11.jsonl").is_file());
    assert!(old.at.starts_with("2026-10-26"), "{}", old.at);
    let hits = memory
        .search("plan", Some(MemoryKind::Episode), 20)
        .unwrap();
    assert_eq!(hits.len(), 2);
    let listed = memory.list(Some(MemoryKind::Episode), 50, None).unwrap();
    assert_eq!(
        listed.entries.iter().map(id_of).collect::<Vec<_>>(),
        [new.id, old.id]
    );
}

#[test]
fn a_lost_index_is_rebuilt_from_the_files() {
    let dir = folder("rebuild");
    let fact = {
        let memory = Memory::open(&dir).unwrap();
        memory
            .remember("Keeps receipts in a shoebox", None, "person")
            .unwrap()
    };
    fs::remove_file(dir.join("index.sqlite")).unwrap();
    let memory = Memory::open(&dir).unwrap();
    assert_eq!(
        ids(&memory.search("receipts", None, 20).unwrap()),
        [fact.id]
    );
}

#[test]
fn a_facts_file_from_a_newer_desk_is_refused() {
    let dir = folder("newer");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("facts.yaml"), "version: 1\nfacts: []\n").unwrap();
    assert!(matches!(Memory::open(&dir), Err(MemoryError::Invalid(_))));
}
