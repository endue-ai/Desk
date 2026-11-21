//! The tray (ADR 0053), on `tray-icon`: Search Desk, Talk to Eris, Open Desk and Quit Desk keep the
//! app reachable when a shortcut is taken (Talk to Eris summons her as Alt+Enter does, ADR 0121). A
//! click there is the person's own, so it applies without asking, as does "Restart to update
//! (<version>)", which shows while a build is staged (ADR 0054, `update::follow`). Its words are in
//! the desk's language (ADR 0276); a change of it sets the tray a new menu. On Linux the tray needs
//! a GTK main loop the shell does not run yet: it is left out there and says so.

use tray_icon::menu::Menu;
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

use crate::menu::{Choice, item};
use crate::words::{Language, filled, text};

/// The app's icon: the bundles' 32 px PNG (`apps/desk/shell/icons`).
const ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// The tray's items in `language`: Search Desk, Talk to Eris, Open Desk, with a staged build the
/// offer to restart into it, and Quit Desk.
pub fn items(language: Language, staged: Option<&str>) -> Vec<(Choice, String)> {
    let say = |name: &str| text(language, &format!("desk.tray.{name}"));
    let mut items = vec![
        (Choice::Search, say("search")),
        (Choice::Eris, say("eris")),
        (Choice::Desk, say("desk")),
    ];
    if let Some(version) = staged {
        let offer = filled(language, "desk.tray.update", &[("version", version)]);
        items.push((Choice::Update, offer));
    }
    items.push((Choice::Quit, say("quit")));
    items
}

/// The tray's menu in `language`; with a staged build it offers to restart into it.
pub fn menu(language: Language, staged: Option<&str>) -> tray_icon::menu::Result<Menu> {
    let menu = Menu::new();
    for (choice, text) in items(language, staged) {
        menu.append(&item(choice, &text))?;
    }
    Ok(menu)
}

/// Show the menu in `language` that offers `staged`, or none.
pub fn offer(tray: &TrayIcon, language: Language, staged: Option<&str>) {
    match menu(language, staged) {
        Ok(menu) => tray.set_menu(Some(Box::new(menu))),
        Err(why) => eprintln!("endue Desk: the tray's menu did not change ({why})"),
    }
}

/// Put the desk in the tray, in `language`, offering `staged`. Call on the event loop's thread once
/// it runs; keep what it returns.
pub fn setup(language: Language, staged: Option<&str>) -> Option<TrayIcon> {
    if cfg!(target_os = "linux") {
        eprintln!("endue Desk: no tray on Linux yet (it needs a GTK loop); use the shortcuts");
        return None;
    }
    let built = menu(language, staged)
        .map_err(|why| why.to_string())
        .and_then(|menu| {
            let mut tray = TrayIconBuilder::new()
                .with_id("desk")
                .with_tooltip("endue Desk")
                .with_menu(Box::new(menu));
            if let Some(icon) = icon() {
                tray = tray.with_icon(icon);
            }
            tray.build().map_err(|why| why.to_string())
        });
    match built {
        Ok(tray) => {
            eprintln!(
                "endue Desk: the tray is set (Search Desk, Talk to Eris, Open Desk, Quit Desk)"
            );
            Some(tray)
        }
        Err(why) => {
            eprintln!("endue Desk: no tray ({why})");
            None
        }
    }
}

/// The icon as RGBA pixels.
fn icon() -> Option<Icon> {
    let (rgba, width, height) = decode(ICON)?;
    Icon::from_rgba(rgba, width, height).ok()
}

/// A PNG as RGBA pixels, its width and height.
fn decode(bytes: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().ok()?;
    let mut pixels = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut pixels).ok()?;
    pixels.truncate(frame.buffer_size());
    (frame.color_type == png::ColorType::Rgba).then_some((pixels, frame.width, frame.height))
}

#[cfg(test)]
mod tests {
    use super::{ICON, decode};

    #[test]
    fn the_icon_decodes_to_rgba_pixels() {
        let (pixels, width, height) = decode(ICON).expect("the icon is an RGBA PNG");
        assert_eq!((width, height), (32, 32));
        assert_eq!(pixels.len(), 32 * 32 * 4);
        assert!(pixels.chunks(4).any(|p| p[3] > 0), "something shows");
    }
}
