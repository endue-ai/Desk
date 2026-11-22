use super::{Context, Crashes, KEEP, Report};
use std::collections::BTreeSet;
use std::fs;
use std::sync::Barrier;
use std::time::UNIX_EPOCH;

fn with_crashes(tag: &str, test: impl FnOnce(&Crashes) + std::panic::UnwindSafe) {
    let root = std::env::temp_dir().join(format!("endue-reports-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let crashes = Crashes::in_data(&root);
    let result = std::panic::catch_unwind(|| test(&crashes));
    fs::remove_dir_all(&root).unwrap();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

fn report(n: usize) -> Report {
    Report::webview(&format!("endue {n}"), "", &Context::default())
}

#[test]
fn pruning_preserves_the_order_within_a_millisecond() {
    with_crashes("order", |crashes| {
        let first = crashes.write_at(&report(0), UNIX_EPOCH).unwrap();
        assert_eq!(first.file_name().unwrap(), "19700101T000000000Z.json");
        for n in 1..KEEP + 5 {
            let last = crashes.write_at(&report(n), UNIX_EPOCH).unwrap();
            assert_eq!(crashes.newest().unwrap().0, last);
        }
        assert_eq!(crashes.count(), KEEP);
        for (name, n) in crashes.names().iter().zip(5..KEEP + 5) {
            let bytes = fs::read(crashes.dir().join(name)).unwrap();
            let saved: Report = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(saved.message, format!("endue {n}"));
        }
        assert_eq!(
            crashes.take_unseen().unwrap()["message"],
            format!("endue {}", KEEP + 4),
        );
        assert!(crashes.take_unseen().is_none());
    });
}

#[test]
fn simultaneous_writers_keep_each_complete_report() {
    const WRITERS: usize = 8;
    with_crashes("concurrent", |crashes| {
        let barrier = Barrier::new(WRITERS);
        let paths = std::thread::scope(|threads| {
            let handles: Vec<_> = (0..WRITERS)
                .map(|n| {
                    let barrier = &barrier;
                    threads.spawn(move || {
                        barrier.wait();
                        crashes.write_at(&report(n), UNIX_EPOCH).unwrap()
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().unwrap())
                .collect::<BTreeSet<_>>()
        });
        assert_eq!(paths.len(), WRITERS);
        let saved: BTreeSet<_> = paths
            .into_iter()
            .map(|path| {
                let report: Report = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
                report.message
            })
            .collect();
        let expected = (0..WRITERS).map(|n| format!("endue {n}")).collect();
        assert_eq!(saved, expected);
    });
}
