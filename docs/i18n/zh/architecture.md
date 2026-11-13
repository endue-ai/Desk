> 本文为中文译文，内容以[英文原版](../../architecture.md)为准。

# endue Desk 架构

本文是设计的英文摘要。权威来源是 `docs/ko/desk-structure.md`；难以撤回的决策记录在 `docs/adr/` 中。

Desk 是以一个应用构建的一个操作系统：基于 Chromium（CEF）的 Rust 外壳和小型 Rust 核心承载一个 Web 运行时，运行时之上的设置和键绑定之外的功能是插件。
与 Emacs 一样，核心只保留原语，其余一切都能在应用运行时修改。

设置界面、默认键绑定和个人设置持久化属于运行时核心，而非插件。禁用所有插件后仍可使用；插件可以添加快捷键。 [ADR 0055](../../adr/0055-core-settings-and-keybindings.md).

外壳和屏幕正在改变：Desk 已从 Tauri 和操作系统 Web 视图迁移到基于 Chromium（CEF）的 Rust 外壳，接下来迁移到 Desk 自己的合成器，在其中每个窗口都在自己的进程中渲染（[ADR 0140](../../adr/0140-a-wgpu-compositor-over-cef-off-screen-surfaces.md)）。第 1 阶段以删除 Tauri 外壳告终；下文描述的外壳是 CEF 外壳。各阶段见层表下方的“外壳与屏幕的去向”。

## 概览

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 │              · connectors (Wasm · MCP · http) · views (data)   │
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 │              · UI plugin host · desk shell (until ADR 0026)    │
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge · specs/item · specs/view            │  rebuild
 │              · specs/connector → TS client · Rust types        │
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · item index    │  rebuild
 │              · logic plugin and connector host (Wasm) · VM     │
 │              · built-in connectors · brain clients             │
 ├────────────────────────────────────────────────────────────────┤
 │ Shell (CEF)  windows · browsers · primitives (fs, proc, net,   │  rebuild
 │              audio)                                            │
 ├────────────────────────────────────────────────────────────────┤
 │ OS           macOS · Windows · Linux (signing, notarisation,   │  —
 │              OS permissions)                                   │
 └────────────────────────────────────────────────────────────────┘
```

上层在应用运行时即可修改；下层则需要更新应用。只有 endue AI 位于设备之外。其余一切都在用户的计算机上运行。

| 层 | 目录 |
| --- | --- |
| endue AI（云端） | 位于仓库之外；本仓库中只有 `specs/brain` 和 `crates/desk-brain-endue` |
| 插件 | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| Web 运行时 | `packages/runtime`：桌面的系统表面（ADR 0160）：UI 插件宿主（ADR 0012）、各项策略，以及在 ADR 0026 决定之前的桌面外壳各部分（ADR 0025）；在应用中它不摆放窗口，也不持有插件的框架 · `packages/ui` |
| Desk 桥接层 | `specs/bridge` · 集成层的契约 `specs/item`、`specs/view` 和 `specs/connector`（ADR 0032） · `packages/bridge` · `crates/desk-bridge`（由这些契约和 `specs/plugin` 生成的类型） |
| Rust 核心 | `crates/desk-core`（还提供集成层的 `data.*`、`connector.*`、`view.*`、`catalog.get`，并基于操作系统日历定义内置连接器 `desk.calendar` 和 `desk.reminders`，ADR 0036，仍处于提议阶段；http 连接器按清单由核心自己运行，令牌也只由核心读取，ADR 0106） · `crates/desk-index`（存放在一个 SQLite 文件中的条目索引，ADR 0033） · `crates/desk-plugin-host`（在 Wasmtime 上运行逻辑插件和 Wasm 连接器，ADR 0019；ADR 0034 仍处于提议阶段） · `crates/desk-vm` · `crates/desk-brain*` |
| 外壳（CEF） | `apps/desk/shell`：基于 winit 和 CEF 的应用 `endue-desk`（ADR 0143），以及 `crates/desk-web`：不依赖引擎，决定其 URL 协议返回什么、每个页面是哪个调用方 · `crates/desk-sys` · `crates/desk-computer`（macOS 上的电脑操作：截图、辅助功能树、输入、应用），核心在 `computer:see` 和 `computer:control` 之下以 `computer.*` 提供；智能体的每个操作都要等用户批准（ADR 0120、ADR 0123） |
| 操作系统 | `apps/desk/shell/packager`：安装包、CEF 的辅助应用及其权限（entitlements，ADR 0145） · 发布工作流（签名、公证） |

## 外壳与屏幕的去向

在第 1 阶段之前，Desk 是一个只带一个操作系统 Web 视图的 Tauri 窗口，每个插件窗口都是这一个页面里的沙箱 iframe。外壳和所有插件共用一个进程和一个主线程，所以一个陷入死循环的插件会卡住整个桌面，而且 Linux 上没有 WebGPU。ADR 0140 改变了这一点：每个窗口都在自己的进程中渲染，由 Desk 自己基于 wgpu 的合成器摆放它们渲染的结果。从第 1 阶段起，每个插件表面都是自己的 Chromium 渲染进程，一个渲染进程崩溃只会让它自己的窗口变空。从 #83 起，合成器是唯一的桌面（ADR 0156）：每个插件表面都在自己的浏览器中于屏幕外渲染，合成器把它画在 `crates/desk-wm` 摆放其窗口的位置，desk-wm 负责窗口手势、窗口命令和活动预算。仍是网页的部分以系统表面运行，由合成器摆放在所有窗口之上（ADR 0160）：桌面自己的页面（各种栏、Eris、通知、菜单、设置和工作室，每个部分整块绘制）、命令面板的窗口和岛（island）的窗口，各自以自己窗口的调用方身份调用。没有插件在桌面的页面里运行：它的插件宿主通过外壳到达每个插件自己的浏览器。岛（ADR 0204）是桌面不在前台时浮在其他应用之上的唯一表面：显示正在工作的代理、等待答复的事项和通知，按一下就能回答权限请求或代理的审批，也能和 Eris 对话；Option+Enter 可在任何应用中呼出 Eris。岛取代了浮动的 Eris（ADR 0121）。

```text
 desk (Rust, one process): winit · compositor (wgpu) · CEF host · core · updater
        │ surface             │ surface             │ surface              │ no surface
 web plugin             web plugin            native plugin          logic plugin
 (CEF renderer)         (WebGPU, 3D)          (its own process)      (Wasm, unchanged)
 each: its own process · its own main thread · its own GPU queue · a crash empties one window
```

| 阶段 | 变化 | 状态 |
| --- | --- | --- |
| 0 | 在 Tauri 应用上：每个表面在 `desk-plugin` 协议上有自己的源；只有可见窗口和最近获得焦点的 8 个保留活动框架；繁重的工作移到 Worker；停止响应的框架只在自己的窗口上提供“等待”或“停止” | 已完成 |
| 1 | 外壳成为基于 winit 和 CEF 的 Rust 二进制程序（`apps/desk/shell`，ADR 0143），显示现在的外壳页面，并移除 Tauri；每个插件 iframe 都是自己的 Chromium 渲染进程；应用级 e2e 通过 Chromium 的远程调试驱动它（ADR 0144） | 已完成（#97）：CEF 桌面以 Tauri 应用的名字 `endue-desk` 取代了它，canary 构建它；Windows 和 Linux 上的 WebGPU 在这两个系统上检查（#61），第一个通过更新程序安装的 beta 随下一条发布线到来 |
| 2 | 合成器（`crates/desk-compositor`）绘制桌面并摆放每个表面的纹理；表面使用同一个协议（`specs/surface`，ADR 0141）；CEF 在屏幕外渲染每个插件；窗口管理器从 `packages/runtime` 移到 Rust | 进行中：合成器成为唯一的桌面，desk-wm 摆放每个窗口并负责其手势、命令和活动预算（#83）；仍是网页的部分以系统表面运行，桌面页面中不再有插件（#55）；接下来是展开视图的视觉效果 |
| 3 | 原生插件：通过 `desk.sock` 使用表面协议和桥接层的进程 | 计划中 |

插件代码在任何阶段都无需改动：清单、SDK 和桥接层的传输格式保持不变。插件获得的是自己的进程和源，以及所有操作系统上的 WebGPU。只有可见窗口和最近获得焦点的 8 个保留活动进程，其余带着状态休眠（ADR 0142）。在 macOS 上的概念验证用 wgpu 合成了 30 个屏幕外 CEF 表面，在其中运行了 WebGPU，并且在杀掉一个渲染进程时其他表面仍在继续绘制；一个轻量的渲染进程约占 40 MiB（`spikes/compositor/README.md`）。Windows 和 Linux 尚待验证。

## 像 Emacs，也像操作系统

Emacs 在小型 C 核心之上用 Elisp 运行几乎所有功能，而且可以在运行时修改。Desk 采用同样的结构，并按操作系统的方式为各部分命名。

| 角色 | 操作系统 | Emacs | Desk |
| --- | --- | --- | --- |
| 内核 | 内核 | C 核心 | Rust 核心 |
| 系统调用 | syscall | Lisp 原语 | Desk 桥接层 API |
| 驱动程序 | 设备驱动程序 | 操作系统胶水代码 | 外壳（winit、CEF） + Rust crate |
| 窗口管理器 | 窗口管理器 | frame · window | 3D 画布合成器 |
| Shell | 终端 shell | M-x | Eris · 命令面板 |
| 应用 | 应用程序 | 包（Elisp） | 插件（UI · Wasm · MCP） |
| 接入的数据 | 挂载的文件系统 · 搜索索引 | Gnus 后端 · Org agenda | 连接器 · 汇集在同一个索引中的条目 · 视图（ADR 0032） · 绘制同一种 YAML 格式任意来源的通用视图（ADR 0087） |
| 启动配置 | init | init.el | `init.yaml`（配置档 + 插件 + 设置） |
| 包管理器 | apt · brew | package.el · MELPA | 插件市场 |
| 行为覆盖 | 无 | advice · hook | 事件钩子 · 命令覆盖 |
| 账户 | 用户账户 | 无 | endue ID |

由此得出六条原则：

1. **小核心。** Rust 核心承载的是原语（fs、proc、net、audio、ui），而不是功能。
2. **内置即插件。** Eris、侧边栏、工具栏和配置档切换使用与社区插件相同的 API，因此 API 没有缺口，
   连内置功能也能被替换。桌面的默认策略（界面放在哪里、文件、主题、通知）也是只含数据的 `desk.*`
   插件（ADR 0017）。桌面外壳（`mountDesk`）还不是插件：它目前是 `packages/runtime` 里的代码（ADR 0025），
   放在哪里由仍处于提议阶段的 ADR 0026 决定。在此之前，Eris 有两份，`plugins/eris` 和外壳里各一份（ADR 0027）；
   桌面的边缘也有两套：程序坞、工具栏和侧边栏插件，以及外壳的底边、状态栏和智能体栏（ADR 0028）。
3. **一切皆命令。** 点击、语音、快捷键和智能体调用的是同一套命令。人能做的，Eris 和智能体也都能做。
4. **运行时即可修改。** 保存插件就会重新加载它；插件状态保存在核心存储中，替换后依然保留。
5. **处处可挂钩。** 任何命令都可以在执行前后挂上钩子，或被直接替换，就像 Emacs 的 advice。
6. **先询问，再查看。** 每一次原语调用，无论来自人还是智能体，都要经过桥接层的权限检查。

## 什么会变，多快生效

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Shell (CEF) · bridge types   restart after update │
 │  ┌─ restart ────────────────────────────────────────────────┐  │
 │  │  web runtime                         window reload, ~2 s │  │
 │  │  ┌─ instant ──────────────────────────────────────────┐  │  │
 │  │  │  one plugin (iframe · Wasm · MCP)           < 1 s  │  │  │
 │  │  └────────────────────────────────────────────────────┘  │  │
 │  └──────────────────────────────────────────────────────────┘  │
 └────────────────────────────────────────────────────────────────┘
```

越靠内层，修改的代价越低。对用户而言，重新构建就是自动更新后重启一次；对开发者而言，还意味着编译、签名和公证。

| 范围 | 重新加载的内容 | 目标 | 不受影响的部分 |
| --- | --- | --- | --- |
| 即时 | 被修改的插件（iframe、Wasm 实例或 MCP 进程） | 1 秒以内 | 其他界面、正在进行的工作、语音待命 |
| 重启 | Web 运行时（窗口重新加载） | 约 2 秒 | Rust 核心、MCP 工具、正在运行的 CLI |
| 重新构建 | 整个应用（自动更新后重新启动） | 下载时间 + 几秒 | 已保存的状态、配置档、已安装的插件 |

开发时也使用同样的三级：插件目录在保存时重新加载，Web 运行时使用 Vite HMR，Rust 核心通过 `cargo watch` 重新构建。

## 契约

`specs/` 划定了开放与封闭之间的界线。桥接层、大脑和插件的类型都由它生成为 Rust 和 TypeScript 代码，两端针对同一组测试向量进行测试。
参见 `specs/README.md`。
