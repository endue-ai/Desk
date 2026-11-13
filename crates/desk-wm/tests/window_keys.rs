//! A plugin's several windows (ADR 0212): each is adopted, seated and named by its key (the plugin
//! id for the first, `<plugin>@<n>` after), and the snapshot names the plugin that draws each.

use desk_wm::{Adopted, Desk, Frame, Seen};

/// Every frame live but the second window's, which sleeps.
struct Runtime;

impl Seen for Runtime {
    fn frame(&self, key: &str) -> Frame {
        if key == "endue.images@2" {
            Frame::Asleep
        } else {
            Frame::Live
        }
    }
}

fn three_images() -> Desk {
    let mut desk = Desk::default();
    desk.set(|d| {
        d.adopted = ["endue.images", "endue.images@2", "endue.images@3"]
            .iter()
            .enumerate()
            .map(|(slot, id)| Adopted {
                id: (*id).into(),
                title: "Images".into(),
                slot: Some(slot),
                at: None,
                area: None,
            })
            .collect();
    });
    desk
}

#[test]
fn each_window_of_a_plugin_is_its_own_window_and_names_the_plugin() {
    let shot = three_images().snapshot_seen(1440.0, 900.0, &Runtime);
    let mut seen: Vec<_> = (shot.windows.iter())
        .map(|w| {
            let pane = &w.panes[0];
            (
                w.id.clone(),
                pane.plugin.clone(),
                pane.title.clone(),
                pane.asleep == Some(true),
            )
        })
        .collect();
    seen.sort();
    let image = |id: &str, asleep| {
        let (plugin, title) = (Some("endue.images".into()), Some("Images".into()));
        (id.to_owned(), plugin, title, asleep)
    };
    assert_eq!(
        seen,
        vec![
            image("endue.images", false),
            image("endue.images@2", true),
            image("endue.images@3", false),
        ]
    );
}
