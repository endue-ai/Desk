# Handoff: the must-have feature list for daily use (UI / UX)

2026-11-15 · branch `handoff/ui-ux-daily-features` · based on `main` 097a983d

A working note to resume a session on another computer. It is not a design document and is not meant
to merge: delete it (or the branch) once the list is delivered.

## The request

The person asked (in Korean; answer in Korean):

> UI / UX 구상해보자. 사용자가 Daily 로 사용하기 위해서 필요한 기능, Desk 네이티브 기능, 전체적인
> UI / UX 위한 기능 및 완전 베이스에 구성되어 있는 기능 등 정말 필요한 현재 필수적으로 구현해야 하는
> 기능 (꼭 플러그인이 아니어도 됨) 을 리스트업해봐 우선순위 단위로

So the deliverable is one prioritized list (P0, P1, P2 ...) of what must be built now, across four
axes. An item need not be a plugin.

1. What a person needs to use Desk daily.
2. Desk-native features (what only Desk gives: canvas, windows in and out, island, Eris, agents).
3. Features for the overall UI / UX.
4. What belongs in the very base (core, shell, runtime).

The answer goes in the chat. No file was asked for, and no code was changed.

## State of the work

Stopped during research, before any list was written.

- Done: read `docs/architecture.md`, `docs/ko/desk-roadmap.md`, `docs/ko/desk-requirements.md`
  (lines 1-305 of 367), the ADR titles 0109-0229, the plugin folders, the open issues.
- Not done: checking in code what exists today. Three read-only searches were started for this and
  stopped before they reported, so nothing from them is known. Their checklists are below; run them
  again first.
- Not done: the list itself.

## Checked so far

Each line was read from the repository or GitHub on 2026-11-15.

- No release exists: `git tag` is empty and `CHANGELOG.md` holds only its heading. ADR 0229 (a GitHub
  release a person publishes carries the macOS app) is on `main`.
- The Korean design documents are behind the code. `desk-requirements.md` gives its "현재" column as
  of 2026-10-29 and `desk-roadmap.md` its audit as of 2026-11-05. Do not copy a "없음" from them.
  Examples: the roadmap says `specs/agent`, `specs/market` and `specs/memory` are missing, and all
  three folders exist now; the requirements say there is no settings UI, and
  `packages/runtime/src/settings-ui/` exists.
- The roadmap's M1 "Daily" ends when the team opens Desk every day, a first stable build installs and
  updates, and Eris answers offline. The order since 2026-11-14 is ADR 0205: pop-out windows (#235),
  the island (#238), the resident hub (#237), the motion gate and compositor quality (#247-#252), the
  app format (#239).
- Open issues, 14: #232, #235, #237 (ADR 0205 track), #249, #268, #284 (compositor), #291 with its
  tasks #294-#298 (the chrome's "composition D": agent bar, profile chip and desktops pill, drawer
  strip, Eris's orb in the talk line, a 36-high title bar), #301 (e2e over composition D), #61
  (Windows, Linux, signing and screen-reader checks).
- `plugins/` by name has no code editor, no settings plugin, no `tasks`, `scratch`, `help` or
  `messages` plugin, and no dock (ADR 0217: a launcher opens plugins).
- Rough source size per plugin (ts, tsx, rs, css, html, without tests): `notes` 273 lines (its
  manifest says "a plain text area"), `browser` 179, `launcher` 143, `palette` 319, `explorer` 544,
  `terminal` 749, `git` 703. The file viewers are large (`reader` 2594, `formats` 2238, `docs` 1824).
  Size is a hint, not a verdict.
- Folders that exist and whose depth is unchecked: runtime `settings-ui`, `describe`, `sequences`,
  `arrange`, `desktops`, `propose`, `design-studio`, `theme-studio`, `wallpaper`, `dnd`, `inspect`;
  shell `island`, `tray.rs`, `hotkeys.rs`, `login.rs`, `menu.rs`, `dialog.rs`, `drops.rs`,
  `open_files.rs`, `crashes.rs`, `stall_restart.rs`, `update.rs`, `displays.rs`; crates
  `desk-memory`, `desk-mcp-client`, `desk-computer`, `desk-ipc`, `desk-crash`, `desk-update`; plugins
  `github`, `pack-github`, `today`, `fleet`, `memory`, `market`, `login`, `island`, `screens`.

## To check next

For each item decide: exists, partial (what is missing), or missing. A stub, an `unsupported` answer,
a macOS-only path or a hard-coded sample counts as partial. Trust code and specs over `docs/ko`.

### A. Chrome, windows and system UX

Look in `packages/runtime/src`, `crates/desk-wm`, `crates/desk-compositor`, `apps/desk/shell/src`,
and the plugins `launcher`, `palette`, `notify`, `session`, `shell`, `profiles`, `island`.

1. The chrome today: bars, rail, agent bar, bottom edge, launcher; clock and status indicators; is
   composition D (#291-#298) built or waiting.
2. Windows: move, resize, snap, tile, cascade, spread, map, fill, put away, tabs or splits, a window
   switcher, reopening a closed window, pop-out, several displays.
3. Desktops: names, keys, moving a window between them, layouts per profile, session restore.
4. Launcher and palette: what they search (commands, plugins, files, OS apps, items, settings), the
   global hotkey, recents, argument input.
5. Settings: a real screen from schemas, search, per-plugin settings, a key editor with conflicts,
   theme and design pickers, the account page, the brain picker.
6. Keys: layers, chord sequences, hints after a prefix, a cheat sheet (`describe`), the user's file.
7. Notifications: centre and history, do not disturb, action buttons, OS notifications in the
   background, the island.
8. One search over items, files, windows, chat and mail.
9. First run: which scenes are real (sign-in, folder, connectors, agents).
10. Help, what's new, safe mode, quarantine and crash-recovery screens.
11. Tray icon, app menu, start at login, running with no window.
12. Wallpaper, theme and design-system pickers.

### B. OS primitives and input

Look in `apps/desk/shell/src` (`web_host`, `pump`, `host`, `mac.rs`), `specs/bridge/v0`, `desk-sys`,
`desk-core`, the packager and the release workflows.

1. IME composition (Korean, Japanese, Chinese) in off-screen CEF surfaces, the candidate window's
   place, dead keys, the emoji picker. ADR 0150, 0194, 0199.
2. Clipboard: text, rich text, images and files between desk windows and OS apps; `clipboard.*`.
3. Context menus, spell check, find in page, zoom, print.
4. Drag and drop: OS to desk, desk to OS, between windows (ADR 0119).
5. Native open and save dialogs; `dialog.*`.
6. Open with: OS file associations, `endue://` links, the `desk` CLI opening a file in a running desk.
7. The browser plugin and web views (ADR 0216): downloads, file inputs, camera and microphone
   prompts, popups, sign-in dialogs, tabs, history, bookmarks.
8. Audio out, microphone capture (`audio.capture`), media keys.
9. `net.fetch`, sockets (ADR 0133), proxies.
10. Secrets: OS keychain or files; where connector tokens and the endue ID token live.
11. Accessibility: the AccessKit tree (ADR 0155), screen readers, text scale, reduced motion.
12. Localisation: can runtime and plugin strings be translated, which languages ship.
13. Displays and HiDPI changes, sleep and wake, GPU loss, crash restart, `--safe`.
14. Idle CPU shown and hidden, memory per window, the live-process budget (ADR 0142).
15. What builds, packages, signs and updates on macOS, Windows and Linux today.
16. Undo across the desk, unsaved-changes prompts (ADR 0177), autosave.

### C. Data, Eris, agents, apps

Look in `crates/desk-core`, `desk-index`, `desk-brain*`, `desk-memory`, `desk-mcp*`, `specs/`, and the
plugin manifests.

1. Connectors that bring real data: GitHub, calendar, reminders, mail, chat services, Jira or Linear.
   Is there an OAuth or token screen? Which of `chat`, `mail`, `projects`, `calendar`, `today`,
   `chat-digest` have a real source, and can any of them write (send, post, move, create)?
2. Eris: where the loop runs, which brains settings offers and the default, streaming, voice in and
   out, her tools, memory across a restart, approvals, conversation history, handing work to local
   agents and getting results back.
3. Agents: what a person can do in `agents`, `local-agents` and `fleet`; adding an external MCP
   server; Desk as an MCP server.
4. Apps, each with its largest hole: `notes` (is there any real text, Markdown or code editor?),
   `explorer` (create, rename, move, trash, search, multi-select), `terminal`, `browser`, `git`,
   `calendar` (events or only `.ics` files?), `mail`, `chat`, the file viewers (view or edit?). Is
   there a screenshot tool, a quick note, a clipboard history?
5. Views: universal views, a builder screen, `desk.propose` end to end.
6. Market: installing, updating and removing a plugin, view, pack, theme or design system in the app;
   a plugin manager with permissions; dev install from a folder.
7. Account: endue ID sign-in (ADR 0111), sync, export and import of a desk.
8. Permissions: grants on disk, the prompt, per-agent approval policy, the page that revokes.
9. Release: workflows, `docs/releasing.md`, the updater end to end, per OS.
10. What a person sees after a normal start: is there a home or Today surface with real data.

## Hypotheses, not findings

Guesses from the reading above, to confirm or drop with A-C. None is checked.

- P0 is likely "it installs, it starts, typing works": a signed build with updates, IME and clipboard
  in off-screen surfaces, and the compositor quality track, since every other feature sits on them.
- A builder's day needs an editor. `notes` as a plain text area and no code editor looks like the
  largest hole among the apps.
- The index's clients (`chat`, `mail`, `projects`, `today`) may still have few real sources; a
  connector with sign-in is what makes Today worth opening.
- Composition D (#291-#298) is the chrome's pending shape, so the UI / UX part of the list should be
  written against it, not against today's chrome.
- The Desk-native items are probably windows in and out (#235), the island, the resident hub, Eris
  with a real brain and memory, and one board for agents with approvals.

## Suggested shape of the answer

Tiers P0 to P3. Each row: the feature, which of the four axes it serves, its state today with a file
or issue, and where it lives (core, shell, runtime or plugin). Put what already exists in a short
closing list so it is not proposed again.
