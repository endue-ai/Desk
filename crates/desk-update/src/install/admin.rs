//! macOS, when the desk cannot write where its app is (an app in `/Applications` that another user
//! installed): the update is checked as in place, in the updates folder, then macOS asks the person
//! once for an administrator, and `admin.sh` swaps the app in as root (#99, ADR 0163). The step is
//! handed the archive the updater verified and its SHA-256, and checks its own copy again before it
//! unpacks anything, so it installs exactly the bytes that were signed, owned by root.

use std::fs;
use std::path::Path;

use super::app::unpack_checked;
use super::elevate::{Elevate, Refusal, Step, declined};
use super::file::{package_path, write};
use super::io_error;
use crate::status::Chosen;
use crate::verify::sha256_hex;

/// The administrator's step: `sh -c <SCRIPT> desk-update <archive> <sha256> <app> <name> <exe>`.
pub const SCRIPT: &str = include_str!("admin.sh");

/// Install `bytes` in place of `app` through an administrator; answers the new app's executable.
/// Refused before the prompt when the archive is not a whole app of this desk.
pub fn install(
    app: &Path,
    chosen: &Chosen,
    bytes: &[u8],
    scratch: &Path,
    current: Option<&str>,
    elevate: &dyn Elevate,
) -> Result<String, String> {
    let folder = scratch.join(&chosen.version).join("check");
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir_all(&folder).map_err(|e| io_error("write to", &folder, &e))?;
    let checked = unpack_checked(bytes, &folder, current).map(|(new, executable)| {
        let name = new.file_name().map(|n| n.to_string_lossy().into_owned());
        (name.unwrap_or_default(), executable)
    });
    let _ = fs::remove_dir_all(&folder);
    let (name, executable) = checked?;
    let archive = package_path(scratch, chosen, "app.tar.gz");
    write(&archive, bytes)?;
    let step = step(
        &archive,
        &sha256_hex(bytes),
        app,
        &name,
        &executable,
        chosen,
    );
    let ran = elevate.run(&step);
    let _ = fs::remove_file(&archive);
    match ran {
        Ok(()) => Ok(executable),
        Err(Refusal::Declined) => Err(declined(&format!("replace {}", app.display()))),
        Err(Refusal::Failed(said)) => Err(format!(
            "the administrator's step did not replace {}: {said}. Nothing changed; the update stays ready",
            app.display()
        )),
    }
}

/// The step that swaps `name` (with `executable`) from `archive` in for `app`.
pub fn step(
    archive: &Path,
    sha256: &str,
    app: &Path,
    name: &str,
    executable: &str,
    chosen: &Chosen,
) -> Step {
    let text = |path: &Path| path.to_string_lossy().into_owned();
    Step {
        why: format!(
            "endue Desk needs an administrator to install its update to {}.",
            chosen.version
        ),
        program: "/bin/sh".to_owned(),
        args: vec![
            "-c".to_owned(),
            SCRIPT.to_owned(),
            "desk-update".to_owned(),
            text(archive),
            sha256.to_owned(),
            text(app),
            name.to_owned(),
            executable.to_owned(),
        ],
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::step;
    use crate::install::elevate::{Refusal, osascript_command, run};
    use crate::status::Chosen;

    fn chosen() -> Chosen {
        Chosen {
            version: "0.6.0".to_owned(),
            commit: None,
            date: None,
            notes: None,
            target: "darwin-aarch64-app".to_owned(),
            url: String::new(),
            file: "d.app.tar.gz".to_owned(),
            size: 0,
            sha256: String::new(),
            signature: String::new(),
            release: String::new(),
        }
    }

    /// `admin.sh` as the prompt hands it to `do shell script`, run without administrator
    /// privileges (so no prompt shows): the script arrives whole and its refusals come back in its
    /// own words, with nothing left beside the app.
    #[test]
    fn the_step_reaches_the_shell_whole_through_osascript() {
        let dir = std::env::temp_dir().join(format!("desk-admin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let app = dir.join("endue Desk.app");
        let archive = dir.join("it's gone.tar.gz");
        let ask = |name: &str| {
            let step = step(&archive, "00", &app, name, "endue-desk", &chosen());
            let (program, args) = osascript_command(&step, false);
            run(&program, &args)
        };
        let refused = |said: &str| Err(Refusal::Failed(said.to_owned()));
        assert_eq!(ask("../x.app"), refused("the update names no app"));
        let unread = format!("the update cannot be read at {}", archive.display());
        assert_eq!(ask("endue Desk.app"), refused(&unread));
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().collect();
        assert!(left.is_empty(), "nothing left beside the app: {left:?}");
        let _ = std::fs::remove_dir_all(dir);
    }
}
