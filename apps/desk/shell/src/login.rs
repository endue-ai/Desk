//! Start at login (#237, ADR 0225): `desk.login.start` (declared by `plugins/login`, off by
//! default) registered with the OS through `desk_sys::login`, a LaunchAgent on macOS, the Run key
//! on Windows, an XDG autostart entry on Linux. The desk's page says what the setting is when it
//! starts and each time it changes (`desk_login`, `apps/desk/src/login.ts`): the settings window
//! keeps what the person chose in the runtime's own store, which the page reads. The registration
//! starts this program with `--background`, which opens no window (`resident.rs`).
//!
//! A development build would register its own build folder's program, so it leaves the person's
//! login items alone: it writes a LaunchAgent only in the folder `DESK_LOGIN_ITEMS` names (the app
//! e2e's, under its own HOME), and nothing without it.

use std::path::Path;

use desk_sys::login::{self, Change, LoginItems};
use serde_json::{Value, json};

/// The folder a development build keeps its login item in.
pub const DIR_ENV: &str = "DESK_LOGIN_ITEMS";

/// The page's `desk_login { start }`: make the login item match, and say what was done
/// (`registered`, `removed`, `unchanged`, or `none` where this build registers nothing).
pub fn answer(args: &Value) -> Result<Value, String> {
    let start = args
        .get("start")
        .and_then(Value::as_bool)
        .ok_or("desk_login says whether to start at login")?;
    let Some(items) = items() else {
        return Ok(json!({ "change": "none" }));
    };
    let program = login::program().map_err(|why| why.message)?;
    let change = match match_setting(items.as_ref(), start, &program)? {
        Change::Registered => "registered",
        Change::Removed => "removed",
        Change::Unchanged => "unchanged",
    };
    if change != "unchanged" {
        eprintln!("endue: start at login {change} ({})", items.location());
    }
    Ok(json!({ "change": change }))
}

/// Register `program` to start in the background at login when `wanted`, else remove what is
/// registered; nothing is written when it matches already.
pub fn match_setting(
    items: &dyn LoginItems,
    wanted: bool,
    program: &Path,
) -> Result<Change, String> {
    login::apply(items, wanted, &login::desk(program)).map_err(|why| why.message)
}

/// The OS's login items; a development build's are a LaunchAgent in `DIR_ENV`'s folder, or none.
fn items() -> Option<Box<dyn LoginItems>> {
    if cfg!(debug_assertions) {
        let dir = std::env::var_os(DIR_ENV).filter(|dir| !dir.is_empty())?;
        return Some(Box::new(login::LaunchAgent::in_dir(dir, login::ID)));
    }
    login::os(login::ID)
        .map_err(|why| eprintln!("endue: no login items ({})", why.message))
        .ok()
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use desk_sys::login::{Change, ID, LaunchAgent};

    use super::match_setting;

    const PROGRAM: &str = "/Applications/endue Desk.app/Contents/MacOS/endue-desk";

    /// `<a fresh HOME under the temp folder>/Library/LaunchAgents`, not made yet.
    fn agents(name: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("desk-login-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        home.join("Library/LaunchAgents")
    }

    #[test]
    fn the_setting_on_writes_the_agent_that_starts_the_desk_in_the_background() {
        let dir = agents("on");
        let items = LaunchAgent::in_dir(&dir, ID);
        let done = match_setting(&items, true, Path::new(PROGRAM));
        assert_eq!(done, Ok(Change::Registered));
        let plist = std::fs::read_to_string(dir.join("ai.endue.desktop.plist")).expect("the agent");
        assert!(
            plist.contains(&format!("<string>{PROGRAM}</string>")),
            "{plist}"
        );
        assert!(plist.contains("<string>--background</string>"), "{plist}");
        assert!(plist.contains("<key>RunAtLoad</key>"), "{plist}");
        // On already: nothing is written again.
        let again = match_setting(&items, true, Path::new(PROGRAM));
        assert_eq!(again, Ok(Change::Unchanged));
        let _ = std::fs::remove_dir_all(dir.parent().and_then(Path::parent).expect("the home"));
    }

    #[test]
    fn the_setting_off_removes_the_agent_and_writes_none() {
        let dir = agents("off");
        let items = LaunchAgent::in_dir(&dir, ID);
        assert_eq!(
            match_setting(&items, false, Path::new(PROGRAM)),
            Ok(Change::Unchanged)
        );
        assert!(!dir.exists(), "off from the start makes no folder");
        assert_eq!(
            match_setting(&items, true, Path::new(PROGRAM)),
            Ok(Change::Registered)
        );
        assert_eq!(
            match_setting(&items, false, Path::new(PROGRAM)),
            Ok(Change::Removed)
        );
        assert!(!dir.join("ai.endue.desktop.plist").exists());
        let _ = std::fs::remove_dir_all(dir.parent().and_then(Path::parent).expect("the home"));
    }

    #[test]
    fn a_program_moved_since_is_registered_again_at_its_new_place() {
        let dir = agents("moved");
        let items = LaunchAgent::in_dir(&dir, ID);
        assert_eq!(
            match_setting(&items, true, Path::new("/old/endue-desk")),
            Ok(Change::Registered)
        );
        assert_eq!(
            match_setting(&items, true, Path::new(PROGRAM)),
            Ok(Change::Registered)
        );
        let plist = std::fs::read_to_string(dir.join("ai.endue.desktop.plist")).expect("the agent");
        assert!(!plist.contains("/old/endue-desk"), "{plist}");
        let _ = std::fs::remove_dir_all(dir.parent().and_then(Path::parent).expect("the home"));
    }
}
