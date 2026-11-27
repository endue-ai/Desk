//! A window's title bar is as high in the compositor's chrome as the window manager lays it out
//! (#298, ADR 0255): the theme's `title_height` is desk-wm's `TITLE`, so the frame's title, its
//! divider and where a window's content starts land on the rows the page and the grips use. No GPU.

use desk_compositor::{Chrome, ChromeTheme, Rect, Scene};

#[test]
fn the_chrome_draws_the_title_bar_as_high_as_the_window_manager_lays_it() {
    let theme = ChromeTheme::default();
    assert_eq!(theme.window.title_height, 36.0);
    assert_eq!(f64::from(theme.window.title_height), desk_wm::host::TITLE);
    let mut scene = Scene::new(800, 600);
    let mut chrome = Chrome::new(theme);
    let root = scene.root();
    let rect = Rect::new(100.0, 80.0, 400.0, 300.0);
    let made = chrome
        .window(&mut scene, root, rect, "Notes", None, true)
        .expect("a window's chrome");
    assert_eq!(made.content.y, 36.0);
    let divider = scene
        .node(made.divider)
        .and_then(|node| node.rect())
        .expect("the title bar's divider");
    // The bar's last pixel row, in the window's own units.
    assert_eq!((divider.y, divider.height), (35.0, 1.0));
}
