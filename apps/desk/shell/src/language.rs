//! The language the shell speaks (ADR 0250, ADR 0276): the person's `desk.language`, which the core
//! holds as the runtime's own setting `language` (owner `desk`, as `desk.palette.shortcut` is
//! `palette.shortcut`): init.yaml's `desk.language` reads there, and the runtime writes the choice
//! made in Settings there once its settings are in. `system`, nothing or a language the desk does
//! not speak is the first of the OS's languages it does, else English. It is read once the core is
//! up, before the shell words anything, and each `settings.changed` for it re-words the menu bar and
//! the tray at once.

use std::sync::atomic::{AtomicU8, Ordering::Relaxed};
use std::sync::{Arc, Weak};

use desk_bridge::BridgeEvent;
use desk_core::Core;
use serde_json::json;

use crate::pump::Pump;
use crate::window::Shell;
use crate::words::Language;

/// Whose setting it is: the runtime's (`desk_web::sender::RUNTIME`).
pub const OWNER: &str = "desk";
/// Its key under its owner.
pub const KEY: &str = "language";

/// The language in force, as `Language as u8`.
static IN_FORCE: AtomicU8 = AtomicU8::new(Language::En as u8);

/// The language the shell speaks now.
pub fn in_force() -> Language {
    match IN_FORCE.load(Relaxed) {
        1 => Language::Ko,
        _ => Language::En,
    }
}

/// Speak `language` from now on; whether that changed it.
fn speak(language: Language) -> bool {
    IN_FORCE.swap(language as u8, Relaxed) != language as u8
}

/// The language in force for `choice` (`system`, `en`, `ko`, or none): the one chosen, else the
/// first of the OS's `preferred` (BCP 47 tags, or POSIX locales such as `ko_KR.UTF-8`) the desk
/// speaks, else English, as `resolveLanguage` (`@endue-ai/bridge`) decides it.
pub fn resolve(choice: Option<&str>, preferred: &[String]) -> Language {
    if let Some(chosen) = choice.and_then(Language::of) {
        return chosen;
    }
    (preferred.iter())
        .filter_map(|tag| {
            let primary = tag.split(['-', '_', '.', '@']).next()?;
            Language::of(&primary.to_ascii_lowercase())
        })
        .next()
        .unwrap_or_default()
}

/// The OS's languages, the person's first: macOS's preferred languages; elsewhere `LANGUAGE`
/// (a `:` list), `LC_ALL`, `LC_MESSAGES` and `LANG`.
pub fn os_languages() -> Vec<String> {
    #[cfg(target_os = "macos")]
    return mac_languages();
    #[cfg(not(target_os = "macos"))]
    {
        let var = |name: &str| std::env::var(name).unwrap_or_default();
        let listed = var("LANGUAGE");
        (listed.split(':').map(str::to_owned))
            .chain(["LC_ALL", "LC_MESSAGES", "LANG"].map(var))
            .filter(|tag| !tag.is_empty())
            .collect()
    }
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn mac_languages() -> Vec<String> {
    use objc2::rc::{Retained, autoreleasepool};
    use objc2::{class, msg_send};
    use objc2_foundation::{NSArray, NSString};
    // The follower asks from a thread of its own, which has no pool of its own.
    autoreleasepool(|_| {
        // SAFETY: `+[NSLocale preferredLanguages]` returns an array of strings and may be called
        // from any thread.
        let languages: Retained<NSArray<NSString>> =
            unsafe { msg_send![class!(NSLocale), preferredLanguages] };
        (languages.to_vec().iter())
            .map(|tag| tag.to_string())
            .collect()
    })
}

/// The choice the core holds (`system`, `en`, `ko`), if any layer has one.
pub fn chosen(core: &Core) -> Option<String> {
    let request = json!({ "id": 0, "method": "settings.get", "params": { "key": KEY } });
    let value = crate::eris_window::calls::call(core, OWNER, request).ok()?;
    value.get("value")?.as_str().map(str::to_owned)
}

/// The language in force for what the core holds now.
fn read(core: &Core) -> Language {
    resolve(chosen(core).as_deref(), &os_languages())
}

/// Call `heard` with the language in force after each change of the desk's `language` in the
/// core, on a thread of its own, for as long as the core lives.
pub fn follow(core: &Arc<Core>, heard: impl Fn(Language) + Send + 'static) -> std::io::Result<()> {
    let events = core.events().subscribe();
    let core: Weak<Core> = Arc::downgrade(core);
    std::thread::Builder::new()
        .name("desk-language".to_owned())
        .spawn(move || {
            for event in events {
                let BridgeEvent::SettingsChanged(changed) = event else {
                    continue;
                };
                if changed.data.owner != OWNER || changed.data.key != KEY {
                    continue;
                }
                let Some(core) = core.upgrade() else {
                    return;
                };
                heard(read(&core));
            }
        })?;
    Ok(())
}

/// Read the language in force and follow it: a change re-words the menu bar and the tray on the
/// event loop's thread. Call once the core is up, before anything is worded.
pub fn start(core: &Arc<Core>, pump: &Pump) {
    speak(read(core));
    let pump = pump.clone();
    let followed = follow(core, move |language| {
        if speak(language) {
            pump.run(|shell, _| reword(shell));
        }
    });
    if let Err(why) = followed {
        eprintln!("endue: desk.language is not followed ({why})");
    }
}

/// The menu bar's items in the language in force, in place, and the tray's menu made again.
pub(crate) fn reword(shell: &mut Shell) {
    let language = in_force();
    if let Some(bar) = &shell.menu_bar {
        bar.reword(language);
    }
    if let Some(tray) = &shell.tray {
        crate::tray::offer(tray, language, shell.offered.as_deref());
    }
}
