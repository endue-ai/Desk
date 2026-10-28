> 本文为中文译文，内容以[英文原版](../../architecture.md)为准。

# endue Desk 架构

本文是设计的英文摘要。权威来源是 `docs/ko/desk-structure.md`；难以撤回的决策记录在 `docs/adr/` 中。

Desk 是以一个应用构建的一个操作系统：Tauri 外壳和小型 Rust 核心承载一个 Web 运行时，运行时之上的每项功能都是插件。
与 Emacs 一样，核心只保留原语，其余一切都能在应用运行时修改。

## 概览

```text
 off the device ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (cloud brain: agentic loop · models · credits)      changed on the server ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 the user's computer               │                           cost of change
 ┌─────────────────────────────────┴──────────────────────────────┐
 │ Plugins      UI (iframe) · logic (Wasm) · tools (MCP, in a VM) │  instant
 ├────────────────────────────────────────────────────────────────┤
 │ Web runtime  compositor (3D/2D) · surfaces · input · layout    │  restart
 ├────────────────────────────────────────────────────────────────┤
 │ Desk bridge  specs/bridge → TS client · Rust traits            │  rebuild
 ├────────────────────────────────────────────────────────────────┤
 │ Rust core    permissions · event bus · storage · plugin host   │  rebuild
 │              · VM · brain clients                              │
 ├────────────────────────────────────────────────────────────────┤
 │ Tauri shell  windows · webviews · primitives (fs, proc, net,   │  rebuild
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
| Web 运行时 | `packages/runtime` · `packages/ui` |
| Desk 桥接层 | `specs/bridge` · `packages/bridge` · `crates/desk-bridge` |
| Rust 核心 | `crates/desk-core` · `crates/desk-plugin-host` · `crates/desk-vm` · `crates/desk-brain*` |
| Tauri 外壳 | `apps/desk/src-tauri` · `crates/desk-sys` |
| 操作系统 | `apps/desk/src-tauri/capabilities` · 发布工作流（签名、公证） |

## 像 Emacs，也像操作系统

Emacs 在小型 C 核心之上用 Elisp 运行几乎所有功能，而且可以在运行时修改。Desk 采用同样的结构，并按操作系统的方式为各部分命名。

| 角色 | 操作系统 | Emacs | Desk |
| --- | --- | --- | --- |
| 内核 | 内核 | C 核心 | Rust 核心 |
| 系统调用 | syscall | Lisp 原语 | Desk 桥接层 API |
| 驱动程序 | 设备驱动程序 | 操作系统胶水代码 | Tauri 外壳 + Rust crate |
| 窗口管理器 | 窗口管理器 | frame · window | 3D 画布合成器 |
| Shell | 终端 shell | M-x | Eris · 命令面板 |
| 应用 | 应用程序 | 包（Elisp） | 插件（UI · Wasm · MCP） |
| 启动配置 | init | init.el | `init.yaml`（模式 + 插件 + 设置） |
| 包管理器 | apt · brew | package.el · MELPA | 插件市场 |
| 行为覆盖 | 无 | advice · hook | 事件钩子 · 命令覆盖 |
| 账户 | 用户账户 | 无 | endue ID |

由此得出六条原则：

1. **小核心。** Rust 核心承载的是原语（fs、proc、net、audio、ui），而不是功能。
2. **内置即插件。** Eris、侧边栏、工具栏和模式切换使用与社区插件相同的 API，因此 API 没有缺口，
   连内置功能也能被替换。
3. **一切皆命令。** 点击、语音、快捷键和智能体调用的是同一套命令。人能做的，Eris 和智能体也都能做。
4. **运行时即可修改。** 保存插件就会重新加载它；插件状态保存在核心存储中，替换后依然保留。
5. **处处可挂钩。** 任何命令都可以在执行前后挂上钩子，或被直接替换，就像 Emacs 的 advice。
6. **先询问，再查看。** 每一次原语调用，无论来自人还是智能体，都要经过桥接层的权限检查。

## 什么会变，多快生效

```text
 ┌─ rebuild ──────────────────────────────────────────────────────┐
 │  Rust core · Tauri shell · bridge types   restart after update │
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
| 重新构建 | 整个应用（自动更新后重新启动） | 下载时间 + 几秒 | 已保存的状态、模式、已安装的插件 |

开发时也使用同样的三级：插件目录在保存时重新加载，Web 运行时使用 Vite HMR，Rust 核心通过 `cargo watch` 重新构建。

## 契约

`specs/` 划定了开放与封闭之间的界线。桥接层、大脑和插件的类型都由它生成为 Rust 和 TypeScript 代码，两端针对同一组测试向量进行测试。
参见 `specs/README.md`。
