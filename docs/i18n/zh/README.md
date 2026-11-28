> 本文为中文译文，内容以[英文原版](../../../README.md)为准。

<h1 align="center">
  <a href="https://endue.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../../../brand/endue/endue-original-dark-color-lockup.svg">
      <img src="../../../brand/endue/endue-original-light-color-lockup.svg" alt="endue" width="300">
    </picture>
  </a>
</h1>

<div align="center">

**UI Less is Ultimate UI.**

一个开源桌面：所有应用都在同一块画布上，AI 只隔一句话，没有哪个界面是固定的。

[官网](https://endue.ai) · [下载](#install) · [最初的五分钟](#your-first-five-minutes) ·
[制作插件](plugins/authoring.md) · [路线图](../../../docs/roadmap.md)

[![发布版](https://img.shields.io/github/v/release/endue-ai/endue?label=release)](https://github.com/endue-ai/endue/releases/latest)
[![许可证：Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](../../../LICENSE)
![平台：macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

<a href="#install"><img src="../../../docs/media/readme/hero.gif" alt="endue 桌面：画布在打开的窗口之间平移，输入一句话就把它们平铺并切换主题，Eris 随后说明她做了什么" width="100%"></a>

</div>

endue 是一个桌面应用，它本身就是一个操作系统：终端、浏览器、Git、数据库、文档和你的智能体都作为窗口
打开在同一块画布上，常驻其中的秘书 Eris 会跨越所有这些窗口完成你交代的事。每个界面都是插件，
应用运行时就可以换样式、重写或移除，直到只剩下你需要的东西。代码采用 Apache-2.0 许可，不收集遥测数据，
不需要账户也能使用。

> [!NOTE]
> endue 还很年轻，变化很快。macOS 应用从 0.5.0 起经过签名和公证，并会自行更新。
> Windows 和 Linux 的桌面安装包尚未发布；Linux 上可以使用命令行工具。

## 为什么是 UI Less

一个应用的大部分界面之所以存在，是因为应用不知道你想要什么。endue 朝着你自己会做出来的那个界面走三步，
然后让你把其余的都拿掉。

### 所有应用都在一处，AI 可以直接吩咐

你的工具不再是一个个独立的应用，而是同一个桌面上的窗口，所以一个请求就能触达全部。`Alt+Space` 打开对话输入栏：
输入命令的名称即可运行它，或者说出你想要什么，Eris 会用桌面自己的命令去完成，
并通过你授予的访问权限使用文件、Git、数据库、浏览器和各种查看器。她把记忆保存在这台电脑上，
做任何不可逆的事之前都会先问你，她改动的内容也可以撤销。这台电脑上已经安装的智能体程序和你的 endue 智能体
与她并肩工作。

<img src="../../../docs/media/readme/ask.gif" alt="在对话输入栏中输入一句话：Eris 把笔记放到左边、终端放到右边，把笔记的文字调大，并说明她做了什么" width="100%">

### 平移画布，而不是切换屏幕

桌面是一整块宽阔的画布。窗口留在你放下的位置，由你在它们之间移动：滚动，或按住 Shift 拖动即可平移，
角落里的地图会显示你在哪里。把窗口拖到边缘占半个屏幕，拖到角落占四分之一；把所有窗口展开来挑一个；
为不同的工作保留不同的桌面；还可以把任意窗口移出到它自己的操作系统窗口里，之后再停靠回来。

<img src="../../../docs/media/readme/canvas.gif" alt="画布平移到更多窗口再移回来，地图随之移动；一个窗口被拖到左边缘后占据半个屏幕，另一个被拖到角落后占据四分之一；所有窗口展开，供你挑选其中一个" width="100%">

### 塑造每个视图和应用，直到界面消失

屏幕上没有什么是固定的。切换主题和设计系统，重新绑定按键，或者给任意插件的页面加上你自己的样式和脚本；
可以自己动手，也可以告诉 Eris（“把笔记的文字调大”）。视图是数据，主题是不含代码的取值，
内置功能也是与你的插件采用相同文件夹格式的插件：可以替换，也可以关掉。配置档保存一组插件、设置和布局，
一步即可切换。

<img src="../../../docs/media/readme/customize.gif" alt="从对话输入栏打开主题工作室，方向键在整个桌面上预览每个内置主题，按下 Enter 后桌面停留在琥珀色终端主题" width="100%">

### 已经内置

终端、浏览器、文件管理器和笔记；Git Studio、Docker Studio、API Studio、数据库客户端和 Image Studio；
电子表格、文档、幻灯片、PDF、电子书、图片、视频、压缩包和结构化数据的查看器；日历、邮件，以及汇集在同一个界面里的所有聊天服务；
以及在这台电脑上运行的语言模型的客户端。每一个都是 [`plugins/`](../../../plugins/README.md) 中的插件。
想写自己的插件，就从 [`examples/`](../../../examples/README.md) 复制最小的那个，然后运行 `just dev`：
保存文件只会重新加载那一个插件。

<a id="your-first-five-minutes"></a>

## 最初的五分钟

1. **安装 endue。** 从[最新发布版](https://github.com/endue-ai/endue/releases/latest)获取并打开它
   （详见[安装](#install)）。
2. **认识 Eris。** 首次运行会介绍她，并请求使用麦克风（选 **Not now** 也行）和 endue ID
   （选 **Skip for now** 也行：没有任何功能需要账户）。
3. **打开点什么。** 按 `Mod+Alt+L`（在 macOS 上 `Mod` 就是 `Cmd`），输入 `term` 后按 Enter。
   再用同样的方法打开 `notes`。`Mod+K` 在一个列表里搜索插件、命令、文档和文件。
4. **四处走走。** 滚动，或按住 Shift 拖动，即可平移画布。把窗口的标题栏拖到左边缘，它就占据半个屏幕。
5. **吩咐一句。** 按 `Alt+Space`，输入 `tile` 后按 Enter，或者用一句话说出你想要什么。
6. **变成你自己的。** 在对话输入栏中输入 `theme studio`，然后用方向键和 Enter 选一个主题。

你塑造的一切都在 `~/.desk` 里：`init.yaml`、你的配置档、`keys.yaml`、你的视图和 `plugins.lock`，都是可以
阅读、编辑并放进 git 的普通文件。`endue export <folder|file.zip>` 把它们带到另一台电脑（`--with-data` 还带上
桌面自身的状态，但从不包含机密），`endue import` 把它们带回且不覆盖你的 `init.yaml`，`endue doctor` 列出每个
文件以及它是否符合规范。

<a id="install"></a>

## 安装

| 平台 | 获取方式 |
| --- | --- |
| macOS，Apple 芯片 | [最新发布版](https://github.com/endue-ai/endue/releases/latest)中的 `darwin-aarch64` 磁盘映像 |
| macOS，Intel 处理器 | [最新发布版](https://github.com/endue-ai/endue/releases/latest)中的 `darwin-x86_64` 磁盘映像 |
| Linux x86_64，命令行 | [v0.4.0 发布页面](https://github.com/endue-ai/endue/releases/tag/v0.4.0)中的 `endue-cli_0.4.0_linux-x86_64.tar.gz` |
| Windows、Linux 桌面 | 尚未发布：请[从源码构建](#build-from-source) |

在 macOS 上，将磁盘映像的 SHA-256 与发布页上的 `SHA256SUMS-macos` 核对后，打开映像，将 `endue.app` 复制到
“应用程序”文件夹。从 0.5.0 起，应用会自行提示新版本。

官方命令为 `endue`。可以在源码目录运行 `cargo run -p desk-cli -- --help` 试用。在当前主版本中，
现有脚本可以继续使用 `desk`。

<details>
<summary>从 Desk 或 0.4.0 及更早版本升级</summary>

endue 是原名 Desk 的图形界面应用。0.5.0 将应用的标识符改为 `ai.endue.desktop`，因此它不会接管早期的副本，
而是以新的配置档启动。要保留早期的配置档，请退出 endue，并在首次启动前将
`~/Library/Application Support/ai.endue.desk` 复制为 `~/Library/Application Support/ai.endue.desktop`。

[endue 0.4.0 发布版](https://github.com/endue-ai/endue/releases/tag/v0.4.0)提供适用于 Apple 芯片和 Intel
处理器的 macOS 磁盘映像，[v0.3.0 下载页](https://github.com/endue-ai/endue/releases/tag/v0.3.0)提供的映像则分别
适用于 Apple 芯片（`aarch64`）和 Intel 处理器（`x86_64`）。v0.3.0 未经 Apple 公证。如果 macOS
阻止首次打开已核对的应用，请前往“系统设置”→“隐私与安全性”，为 endue Desk 选择“仍要打开”。

- 在 macOS 上退出 Desk，打开新的 `.dmg`，运行 `Install endue.command`。安装程序通过应用包标识符在“应用程序”中
  找到原来的副本，即使改过名也会原地更新。如果有多个副本或其他同名应用，请在已挂载的磁盘映像中打开终端，
  运行 `"./Install endue.command" --to "/Applications/Studio.app"`，将示例路径替换为现有 Desk 应用或
  尚未使用的路径。
- 在 Windows 或 Linux 上，如果发布页提供与原安装包相同的格式，请选择该格式。Windows 会沿用安装目录，
  Debian 的软件包名仍为 `endue-desk`。
- 重新打开应用即可沿用 `~/.desk` 中的配置档和 `plugins.lock`，以及原来的设置、授权和凭据引用。
  像 v0.3.0 这样只提供安装包的 Desk 版本需要运行新安装程序手动升级。v0.3.0 磁盘映像未附带 CLI。

</details>

<details>
<summary>Linux x86_64 服务器上的命令行工具</summary>

从 [v0.4.0 发布页面](https://github.com/endue-ai/endue/releases/tag/v0.4.0)将
`endue-cli_0.4.0_linux-x86_64.tar.gz` 和 `SHA256SUMS-cli` 下载到空目录。运行 `sha256sum -c SHA256SUMS-cli` 校验，
再用 `tar -xzf endue-cli_0.4.0_linux-x86_64.tar.gz` 解压。将 `ENDUE_BRAIN_URL` 设为你的 brain v0 服务地址，
然后运行 `./endue-cli_0.4.0_linux-x86_64/bin/endue run "hello"`。
[验证已签名的 CLI 版本](../../../docs/releasing.md#verify-a-linux-cli-download)

</details>

## endue 与 endue.ai

[endue.ai](https://endue.ai) 是同一个团队打造的智能体平台：在云端为你工作的智能体。这个应用则是它们前来落脚的
开源桌面。用 endue ID 登录后，你的 endue 智能体和空间就会与本地的智能体一起出现在桌面上。

登录是可选的。没有账户时，Eris 运行在这台电脑上的模型上，或运行在你已有的智能体程序上，
这个仓库里的一切都能正常工作。endue AI 和 endue ID 是闭源服务；应用只通过
[`specs/brain`](../../../specs/brain) 中的公开契约访问它们。

**隐私。** endue 不收集任何遥测数据。崩溃报告功能日后推出时，也需要用户主动开启，且默认关闭。

## 为什么是 endue

想象一个构建者的车库：一个房间里，构建者在中间工作，助手记住并询问，机械臂动手，每一面墙都以构建者想要的
形状呈现工作。endue 就是你电脑里的那个车库：一件每天使用的工具，智能体原生，能把你的数据画成任何视图，
并且由你随意重塑。它现在在哪里、要去哪里，见 [`docs/roadmap.md`](../../../docs/roadmap.md)。

<a id="build-from-source"></a>

## 从源码构建

```bash
pnpm install
just check && just test
just dev
```

你需要 Rust（版本固定在 `rust-toolchain.toml` 中）、Node 22+、pnpm、`just`，以及应用的 Chromium（CEF）所需的
cmake 和 ninja，CEF 在首次构建时下载；在 Linux 上还需要 GTK 3、xdo、AppIndicator 和 ALSA 的头文件。运行时测试在与应用
同一版本的无头 Chromium 中运行，`just test-e2e` 会在首次运行时把它下载到 `~/.cache/desk`。请用 `just test-e2e` 运行测试，
不要直接调用 Playwright。

## 了解更多

| 我想…… | 从这里开始 |
| --- | --- |
| 编写插件、视图或主题 | [`docs/plugins/authoring.md`](plugins/authoring.md)、[`examples/`](../../../examples/README.md) |
| 看看内置了什么 | [`plugins/`](../../../plugins/README.md) |
| 了解各层如何协同工作 | [`docs/architecture.md`](architecture.md) |
| 了解某个决策的原因 | [`docs/adr/`](../../../docs/adr) |
| 看看 endue 要去哪里 | [`docs/roadmap.md`](../../../docs/roadmap.md) |
| 提交改动 | [`CONTRIBUTING.md`](CONTRIBUTING.md)、[`AGENTS.md`](../../../AGENTS.md)（地图，面向人和 AI 智能体） |
| 报告漏洞 | [`SECURITY.md`](SECURITY.md) |

## 许可证

代码采用 [Apache-2.0](../../../LICENSE) 许可。endue 和 Eris 的名称、标志以及 `brand/` 中的插图不在此许可范围内：
参见 [brand/LICENSE](../../../brand/LICENSE) 和 [TRADEMARK.md](TRADEMARK.md)。
