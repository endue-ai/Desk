> 本文为中文译文，内容以[英文原版](../../../README.md)为准。

# endue

一个应用，就是一个操作系统。

**没有固定的界面。** endue 由基于 Chromium 的 Rust 外壳和小型 Rust 核心构成，上面承载一个 Web 运行时；再往上的每项功能，包括内置功能在内，
都是可以在应用运行时替换的插件。就像 Emacs：核心只保留原语（文件、进程、网络、音频、窗口），其余一切都是无需重启即可修改的代码。

> 状态：pre-alpha。`just dev` 会打开带有 Eris 和首次启动流程的桌面；先运行 `just brain-echo`，Eris 就会回答你输入的内容（目前只是回声）。

<!-- 截图：随首次运行场景一起添加。 -->

## 安装或升级 endue 应用

endue 是原名 Desk 的桌面应用。[v0.3.0 下载页](https://github.com/endue-ai/endue/releases/tag/v0.3.0)提供两种 macOS 磁盘映像，分别适用于 Apple 芯片（`aarch64`）和 Intel 处理器（`x86_64`）。将与 Mac 匹配的映像的 SHA-256 与发布页上的 `SHA256SUMS-macos` 核对后，打开映像，将 endue Desk 复制到“应用程序”文件夹。v0.3.0 未经 Apple 公证。如果 macOS 阻止首次打开已核对的应用，请前往“系统设置”→“隐私与安全性”，为 endue Desk 选择“仍要打开”。

首个标为 **endue app** 的桌面版本发布后，请在 [GitHub 发布页](https://github.com/endue-ai/endue/releases)选择与操作系统和处理器匹配的安装包，然后按照以下步骤操作。

- 在 macOS 上退出 Desk，打开新的 `.dmg`，运行 `Install endue.command`。安装程序通过应用包标识符在“应用程序”中找到原来的副本，即使改过名也会原地更新。如果有多个副本或其他同名应用，请在已挂载的磁盘映像中打开终端，运行 `"./Install endue.command" --to "/Applications/Studio.app"`，将示例路径替换为现有 Desk 应用或尚未使用的路径。
- 在 Windows 或 Linux 上，如果发布页提供与原安装包相同的格式，请选择该格式。Windows 会沿用安装目录，Debian 的软件包名仍为 `endue-desk`。
- 重新打开应用即可沿用 `~/.desk` 中的配置和 `plugins.lock`，以及原来的设置、授权和凭据引用。像 v0.3.0 这样只提供安装包的 Desk 版本需要运行新安装程序手动升级。

官方命令为 `endue`。可以在源码目录运行 `cargo run -p desk-cli -- --help` 试用。v0.3.0 磁盘映像未附带 CLI。在当前主版本中，现有脚本可以继续使用 `desk`。Linux 服务器的独立 CLI 发布后将作为单独的下载项列出。

## 为什么是 endue

想象一个构建者的车库：一个房间里，构建者在中间工作，助手记住并询问，机械臂动手，每一面墙都以构建者想要的
形状呈现工作。endue 就是你电脑里的那个车库。

- **每天使用的工具。** 构建者每天打开它，所以它先于一切做到可安装、可启动、能回答。
- **智能体原生。** 常驻秘书 Eris 在这台电脑上拥有自己的记忆，并协调本地与外部智能体。智能体有手，决定权在人。
- **视图优先。** 数据整理一次，就能画成任何形状：自己做一个，让 Eris 用一句话做一个，或从市场安装。
- **属于你。** 设计系统、布局和集成由构建者选择和替换。

endue 是构建者的助手：它搭建一个稳定的构建环境，让构建者自由塑造，并以始终如一的最高品质做出最好的产品。
endue 现在在哪里、要去哪里，见 `docs/roadmap.md`。

### 你的桌面就是一个文件夹

你塑造的一切都在 `~/.desk` 里：`init.yaml`、你的配置档、`keys.yaml`、你的视图和 `plugins.lock`，都是可以
阅读、编辑并放进 git 的普通文件。`endue export <文件夹|file.zip>` 把它们带到另一台电脑（`--with-data` 还带上
桌面自身的状态，但从不包含机密），`endue import` 把它们带回且不覆盖你的 `init.yaml`，`endue doctor` 列出每个
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

endue 不收集任何遥测数据。崩溃报告功能日后推出时，也需要用户主动开启，且默认关闭。

## 了解更多

- `docs/architecture.md`：各层如何协同工作
- `docs/adr/`：难以撤回的决策及其原因
- `docs/roadmap.md`：endue 为何存在、现在在哪里、要去哪里
- `AGENTS.md`：仓库地图、命令和规则（面向人和 AI 智能体）
- `CONTRIBUTING.md`：如何提交改动

## 许可证

代码采用 [Apache-2.0](../../../LICENSE) 许可。endue 和 Eris 的名称、标志以及 `brand/` 中的插图不在此许可范围内：
参见 [brand/LICENSE](../../../brand/LICENSE) 和 [TRADEMARK.md](TRADEMARK.md)。
