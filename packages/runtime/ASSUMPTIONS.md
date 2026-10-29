# Shell UI: assumptions

Decisions the brief left open, or where it disagreed with itself or with the repository. Each one is
cheap to change.

## Stack and placement

1. **No React.** The brief asks for React only when `packages/runtime` does not exist. It exists, and ADR
   0010 keeps the runtime free of a UI framework, so the shell is plain TypeScript and DOM with a small
   `h()` helper. The brief's `.tsx` names became `.ts` (`Desk.ts`, `Modes.ts`, ...).
2. **The shell lives in the runtime, not in `plugins/`.** The design doc wants built-in features written
   as plugins; the brief puts them in `packages/runtime/src/shell`. They can move into `plugins/` once
   the plugin API covers chrome placement. The first-run Eris plugin (`plugins/eris`) is unchanged.
3. **`pnpm dev`** (root or package) starts the shell on the browser stub; `just dev` still starts the
   Tauri app, which does not mount the shell yet.
4. **Snapshots are render trees** (ADR 0011), not pixels. Boxes are recorded only for elements that CSS
   sizes, never for text-sized ones. The Eris canvas is captured as `data-mesh` (front, back and dot
   counts plus a hash of the rounded frame) and `data-rings` (displacement per ring, % of R).
5. **Animations** are computed in JS from the injected clock (`Ticker`). CSS transitions are kept only
   for hover and theme changes, and the test fixture switches them off.

## Design values

6. **Light-theme status colours.** The brief's `status-attention-text` (#fa8aa1) is 2.3:1 on white, and
   the `warning` and `status-active` dots are under 3:1 there. Light uses `status-attention-text #b23a55`
   (5.8:1) and outlines status dots with the `input` colour (`--dot-outline`). Design should confirm.
7. **Eris colours** named in the mesh recipe (#f5e2b4, #d4a85f, #d9c79f, #a88a58, #2c2836, #8f87a8, white)
   became `--persona-eris-*` tokens, so no hex sits outside `tokens.css`.
8. **Mesh line width** is 1.3 px at 520 px, which is 0.3 px at 128 px; it is floored at 0.6 px.
9. **Halo** "diameter 1.25R" would hide behind the body, so it is radius 1.25R.
10. **Core glow** is a 48 px element (brief 2.4) rather than 0.4R (≈20 px, brief 3.1).
11. **Rim vertices** get no radius jitter, so the silhouette stays round. Faces count: the balanced mesh has
    830 triangles in total, of which about 530 face the viewer (the "≈520").
12. **Speaking pulse:** "45 ms per ring" and "reaches the rim after 220 ms" cannot both hold for 9 rings. The
    front reaches the rim at 220 ms (27.5 ms per ring) and each ring rises for 45 ms. Glyphs appear at the
    word time + 220 ms.
13. **User wave** per ring mixes its band with overall loudness so speech with little high end still
    reaches the inner rings.
14. **Interruption** is both voices active for 150 ms; Eris then scatters her line and drops later pulses.
15. **Soul text dissolve:** each glyph scatters over 1150 ms after its 0–450 ms delay (1.6 s in total).
    Rise, drift and rotation come from fixed formulas of glyph and line number.
16. **Progress bars** use `primary` but are 2 px lines, not fills; the one-lavender-fill check skips
    elements 2 px high or less. The new-mode dialog's Save button is the only primary fill.
17. **Recent drawer items** fade only their thumbnail, so the name keeps 4.5:1 until the item leaves at 24 h.

## Behaviour

18. **Desktop "+"** jumps to the first empty desktop (a mode has exactly four); it is disabled if none is empty.
19. **Mode menu:** "save to this mode" and "revert" are disabled while nothing changed. Saving bumps the
    minor version. A new mode extends `base` and stores all four desktops.
20. **Mode switch** sends every open surface the next mode does not place on any desktop to the drawer.
21. **Layouts** are stored in the 1440×900 frame and mapped into the area between the bars; below that
    size surfaces move in and shrink (minimum 240×160). Eris's position is stored in window pixels and
    clamped to the screen.
22. **Resize** is from the bottom-right corner only. Pinned surfaces cannot be dragged.
23. **Typing anywhere** (a printable key with nothing focused) focuses the composer; Space does not.
24. **Composer:** matching commands come first and "Tell Eris · ..." is always last; Enter runs the
    selected row. The fake brain answers with an echo and word timings proportional to letters.
25. **Agent click** opens that agent's screen as a surface in the middle; **space switch** selects the first
    agent of that space.
26. **Copy** ships in Korean (default) and English (`lang: "en"`).
27. **Tab order** follows the DOM. WebKit only tabs to buttons with Safari's "Tab highlights each item" on,
    so the e2e test checks the DOM focus order, not Tab presses.
28. **Test fonts:** the fixture uses a local system stack so runs stay offline; the dev page loads Inter
    from Google Fonts. SUIT is used only if installed.

## System layer, agent directory, windows and key bindings

29. **"Core layer" is named the system layer.** "Core" already means the Rust core (`desk-core`). It holds
    the mode switcher, the desktop switcher and the agent bar (ADR 0019). The desktop switcher went in
    too: it moves between a mode's slots and is not part of any one of them.
30. **Night hides the rail** (`modes/sample/night/layout/desktop.json`), to show what a mode may change.
31. **The agent list comes from specs/brain/v0** (ADR 0020), mirroring endue AI's `AgentGetResponse`, A2A
    card and task, and `UserSpaceGetResponse` in camelCase. Working = a `working` A2A task targets the
    agent; waiting at the edge = `inactive`; archived agents are hidden. `personalColor` is not painted
    (tokens only). Only the first 100 agents and tasks are read.
32. **Running chips and the rail's task list** now come from A2A tasks too (goal, `insertedAt`, `progress`),
    newest first as the contract lists them. A task without `progress` shows no bar.
33. **More than six agents:** five show, the sixth place is "+N" and opens the rest in a popover.
34. **⌘N opens a surface on the desk** (a window inside the desk, not a second OS window). It starts with
    a launcher pane and cascades from the middle. ⌘D splits right, ⇧⌘D down, ⌘W closes a pane (the last
    one closes the surface), ⌘] and ⌘[ move between panes. Dividers drag or take arrow keys (15 to 85 %).
35. **Panes are layout**, stored in the mode as `panes` on a surface; a surface without `panes` is one pane
    showing the view named by its id, so older mode files still load.
36. **Opening a view** fills the focused launcher pane if there is one, else focuses a pane already showing
    it, else opens its own surface.
37. **One key per command when rebinding.** A key taken from another command leaves that command unbound,
    and the shortcut list says where it came from. Only overrides are saved (`keybindings` in storage).
    Plain keys never fire inside text fields; chords and Esc do. In Chrome, ⌘N and ⌘W are kept by the
    browser, so on the dev page rebind them or use the palette; the Tauri webview receives them.
38. **Korean copy** calls a window a 표면 (the product term) and a pane a 칸.
