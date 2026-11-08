//! desk-sys shell primitives (feature `shell`): which links may ever be opened, and what each OS is
//! asked to run to open a link or show a file. The plans are data: nothing here launches anything.

use std::path::Path;

use desk_sys::ErrorCode;
use desk_sys::shell::{Launch, Os, ShellScheme, link, open_plan, reveal_plan};

/// A program run directly, whose exit status says whether it worked.
fn program(program: &'static str, args: &[&str]) -> Launch {
    Launch::Program {
        program,
        args: args.iter().map(|arg| arg.to_string()).collect(),
        checks_status: true,
    }
}

#[test]
fn macos_opens_with_open_and_reveals_with_open_r() {
    assert_eq!(
        open_plan(Os::MacOs, "https://example.com/"),
        [program("open", &["https://example.com/"])]
    );
    assert_eq!(
        open_plan(Os::MacOs, "mailto:ada@example.com"),
        [program("open", &["mailto:ada@example.com"])]
    );
    let file = Path::new("/Users/ada/Downloads/report 2026.pdf");
    assert_eq!(
        reveal_plan(Os::MacOs, file),
        [program(
            "open",
            &["-R", "/Users/ada/Downloads/report 2026.pdf"]
        )]
    );
}

#[test]
fn linux_opens_with_xdg_open_and_reveals_through_file_manager1_or_the_folder() {
    assert_eq!(
        open_plan(Os::Linux, "https://example.com/"),
        [program("xdg-open", &["https://example.com/"])]
    );
    // FileManager1 takes file URIs: a comma would split dbus-send's array, so it is escaped too.
    let file = Path::new("/home/ada/Downloads/a, b.pdf");
    assert_eq!(
        reveal_plan(Os::Linux, file),
        [
            program(
                "dbus-send",
                &[
                    "--session",
                    "--print-reply",
                    "--reply-timeout=3000",
                    "--dest=org.freedesktop.FileManager1",
                    "--type=method_call",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                    "array:string:file:///home/ada/Downloads/a%2C%20b.pdf",
                    "string:",
                ],
            ),
            program("xdg-open", &["/home/ada/Downloads"]),
        ]
    );
}

#[test]
fn windows_opens_with_shell_execute_and_reveals_with_explorer_select() {
    assert_eq!(
        open_plan(Os::Windows, "https://example.com/"),
        [Launch::ShellExecute("https://example.com/".to_owned())]
    );
    // explorer exits 1 even when it showed the file, so its status says nothing.
    let file = Path::new("C:/Users/ada/Downloads/report 2026.pdf");
    assert_eq!(
        reveal_plan(Os::Windows, file),
        [Launch::Program {
            program: "explorer",
            args: vec![r#"/select,"C:\Users\ada\Downloads\report 2026.pdf""#.to_owned()],
            checks_status: false,
        }]
    );
}

#[test]
fn no_plan_goes_through_a_shell_and_a_url_stays_one_argument() {
    let url = "https://example.com/?q=$(touch%20x)&a=1;b=`id`|c";
    let shells = [
        "sh",
        "bash",
        "zsh",
        "dash",
        "cmd",
        "cmd.exe",
        "powershell",
        "pwsh",
    ];
    for os in [Os::MacOs, Os::Linux, Os::Windows] {
        let opens = open_plan(os, url);
        let reveals = reveal_plan(os, Path::new("/tmp/a;b $(id).txt"));
        for launch in opens.iter().chain(&reveals) {
            if let Launch::Program { program, args, .. } = launch {
                assert!(!shells.contains(program), "{os:?} runs {program}");
                assert!(
                    !args.iter().any(|a| a == "-c" || a == "/c"),
                    "{os:?}: {args:?}"
                );
            }
        }
        let whole = |launch: &Launch| match launch {
            Launch::Program { args, .. } => args.iter().any(|arg| arg == url),
            Launch::ShellExecute(file) => file == url,
        };
        assert!(opens.iter().all(whole), "{os:?}: {opens:?}");
    }
}

#[test]
fn link_takes_http_https_and_mailto_and_nothing_else() {
    let https = link("https://example.com").unwrap();
    assert_eq!(
        (https.scheme, https.url.as_str()),
        (ShellScheme::Https, "https://example.com/")
    );
    let http = link("HTTP://Example.COM/a b").unwrap();
    assert_eq!(
        (http.scheme, http.url.as_str()),
        (ShellScheme::Http, "http://example.com/a%20b")
    );
    let mail = link("mailto:ada@example.com?subject=Hello").unwrap();
    assert_eq!(
        (mail.scheme, mail.url.as_str()),
        (ShellScheme::Mailto, "mailto:ada@example.com?subject=Hello")
    );
    for refused in [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "slack://channel?team=T1",
        "vscode://file/tmp/x",
        "ftp://example.com/",
        "/etc/passwd",
        "~/Downloads/a.pdf",
        "example.com",
        "https://",
        "https://example.com/\nx",
        "https://example.com/\u{7}",
        "https://example.com/\u{85}",
        "\u{0}https://example.com",
        "",
    ] {
        let err = link(refused).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams, "{refused:?}");
    }
}
