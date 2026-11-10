> 本文为中文译文，内容以[英文原版](../../../README.md)为准。

# endue Desk

一个应用，就是一个操作系统。

**没有固定的界面。** Desk 由基于 Chromium 的 Rust 外壳和小型 Rust 核心构成，上面承载一个 Web 运行时；再往上的每项功能，包括内置功能在内，
都是可以在应用运行时替换的插件。就像 Emacs：核心只保留原语（文件、进程、网络、音频、窗口），其余一切都是无需重启即可修改的代码。

> 状态：pre-alpha。`just dev` 会打开带有 Eris 和首次启动流程的桌面；先运行 `just brain-echo`，Eris 就会回答你输入的内容（目前只是回声）。

<!-- 截图：随首次运行场景一起添加。 -->

## 为什么是 Desk

想象一个构建者的车库：一个房间里，构建者在中间工作，助手记住并询问，机械臂动手，每一面墙都以构建者想要的
形状呈现工作。Desk 就是你电脑里的那个车库。

- **每天使用的工具。** 构建者每天打开它，所以它先于一切做到可安装、可启动、能回答。
- **智能体原生。** 常驻秘书 Eris 在这台电脑上拥有自己的记忆，并协调本地与外部智能体。智能体有手，决定权在人。
- **视图优先。** 数据整理一次，就能画成任何形状：自己做一个，让 Eris 用一句话做一个，或从市场安装。
- **属于你。** 设计系统、布局和集成由构建者选择和替换。

Desk 是构建者的助手：它搭建一个稳定的构建环境，让构建者自由塑造，并以始终如一的最高品质做出最好的产品。
Desk 现在在哪里、要去哪里，见 `docs/roadmap.md`。

### 你的桌面就是一个文件夹

你塑造的一切都在 `~/.desk` 里：`init.yaml`、你的配置档、`keys.yaml`、你的视图和 `plugins.lock`，都是可以
阅读、编辑并放进 git 的普通文件。`desk export <文件夹|file.zip>` 把它们带到另一台电脑（`--with-data` 还带上
桌面自身的状态，但从不包含机密），`desk import` 把它们带回且不覆盖你的 `init.yaml`，`desk doctor` 列出每个
文件以及它是否符合规范。

## 构建

```bash
pnpm install
just check && just test
just dev
```

你需要 Rust（版本固定在 `rust-toolchain.toml` 中）、Node 22+、pnpm、`just`，以及应用的 Chromium（CEF）所需的
cmake 和 ninja，CEF 在首次构建时下载；在 Linux 上还需要 GTK 3、xdo、AppIndicator 和 ALSA 的头文件。运行时测试在与应用
同一版本的无头 Chromium 中运行，`just test-e2e` 会在首次运行时把它下载到 `~/.cache/desk`。请用 `just test-e2e` 运行测试，
不要直接调用 Playwright。

## 隐私

Desk 不收集任何遥测数据。崩溃报告功能日后推出时，也需要用户主动开启，且默认关闭。

## 了解更多

- `docs/architecture.md`：各层如何协同工作
- `docs/adr/`：难以撤回的决策及其原因
- `docs/roadmap.md`：Desk 为何存在、现在在哪里、要去哪里
- `AGENTS.md`：仓库地图、命令和规则（面向人和 AI 智能体）
- `CONTRIBUTING.md`：如何提交改动

## 许可证

代码采用 [Apache-2.0](../../../LICENSE) 许可。endue 和 Eris 的名称、标志以及 `brand/` 中的插图不在此许可范围内：
参见 [brand/LICENSE](../../../brand/LICENSE) 和 [TRADEMARK.md](TRADEMARK.md)。
