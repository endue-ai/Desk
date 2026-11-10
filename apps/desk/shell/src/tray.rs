//! The tray (ADR 0053), on `tray-icon`: Search Desk, Talk to Eris, Open Desk and Quit Desk keep the
//! app reachable when a shortcut is taken (Talk to Eris summons her as Alt+Enter does, ADR 0121). A
//! click there is the person's own, so it applies without asking, as does "Restart to update
//! (<version>)", which shows while a build is staged (ADR 0054, `update::follow`). On Linux the tray
//! needs a GTK main loop the shell does not run yet: it is left out there and says so.

use tray_icon::menu::Menu;
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

use crate::menu::{Choice, item};

/// The app's icon: the bundles' 32 px PNG (`apps/desk/shell/icons`).
const ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// The tray's menu; with a staged build it offers to restart into it.
pub fn menu(staged: Option<&str>) -> tray_icon::menu::Result<Menu> {
    let menu = Menu::new();
    menu.append(&item(Choice::Search, "Search Desk"))?;
    menu.append(&item(Choice::Eris, "Talk to Eris"))?;
    menu.append(&item(Choice::Desk, "Open Desk"))?;
    if let Some(version) = staged {
        menu.append(&item(
            Choice::Update,
            &format!("Restart to update ({version})"),
        ))?;
    }
    menu.append(&item(Choice::Quit, "Quit Desk"))?;
    Ok(menu)
}

/// Show the menu that offers `staged`, or none.
pub fn offer(tray: &TrayIcon, staged: Option<&str>) {
    match menu(staged) {
        Ok(menu) => tray.set_menu(Some(Box::new(menu))),
        Err(why) => eprintln!("endue Desk: the tray's menu did not change ({why})"),
    }
}

/// Put the desk in the tray, offering `staged`. Call on the event loop's thread once it runs; keep
/// what it returns.
pub fn setup(staged: Option<&str>) -> Option<TrayIcon> {
    if cfg!(target_os = "linux") {
        eprintln!("endue Desk: no tray on Linux yet (it needs a GTK loop); use the shortcuts");
        return None;
    }
    let built = menu(staged)
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
