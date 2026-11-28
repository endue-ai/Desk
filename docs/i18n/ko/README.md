> 이 문서는 [영문판](../../../README.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

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

모든 앱이 하나의 캔버스에 살고, AI는 문장 하나면 닿으며, 고정된 화면은 없는 오픈소스 데스크톱입니다.

[웹사이트](https://endue.ai) · [다운로드](#install) · [첫 5분](#your-first-five-minutes) ·
[플러그인 만들기](plugins/authoring.md) · [로드맵](../../../docs/roadmap.md)

[![릴리스](https://img.shields.io/github/v/release/endue-ai/endue?label=release)](https://github.com/endue-ai/endue/releases/latest)
[![라이선스: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](../../../LICENSE)
![플랫폼: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

<a href="#install"><img src="../../../docs/media/readme/hero.gif" alt="endue 데스크: 캔버스가 열린 창들을 가로질러 팬되고, 입력한 문장 하나가 창들을 바둑판으로 배열하고 테마를 바꾸며, Eris가 자신이 한 일을 말합니다" width="100%"></a>

</div>

endue는 하나의 앱이 곧 하나의 OS인 데스크톱 앱입니다. 터미널, 브라우저, Git, 데이터베이스, 문서, 그리고
여러분의 에이전트가 하나의 캔버스에 창으로 열리고, 그곳에 사는 비서 Eris가 그 모두를 넘나들며 여러분이
부탁한 일을 합니다. 모든 화면은 필요한 것만 남을 때까지, 앱이 실행되는 동안 스타일을 바꾸고 다시 쓰고 없앨
수 있는 플러그인입니다. 코드는 Apache-2.0이고, 텔레메트리가 없으며, 계정 없이도 동작합니다.

> [!NOTE]
> endue는 아직 초기 단계이며 빠르게 바뀝니다. macOS 앱은 0.5.0부터 서명과 공증을 받고 스스로 업데이트합니다.
> Windows와 Linux용 데스크톱 패키지는 아직 배포하지 않습니다. Linux에는 명령줄 도구가 있습니다.

## 왜 UI Less인가

앱의 인터페이스 대부분은, 여러분이 무엇을 원하는지 앱이 모르기 때문에 있습니다. endue는 여러분이 직접
만들었을 법한 인터페이스를 향해 세 걸음 다가간 다음, 나머지는 여러분이 덜어 낼 수 있게 합니다.

### 한곳에 모인 모든 앱, 그리고 직접 부탁할 수 있는 AI

여러분의 도구는 따로 떨어진 앱이 아니라 한 데스크의 창이므로, 요청 하나가 그 모두에 닿습니다. `Alt+Space`를
누르면 말하는 줄이 열립니다. 명령 이름을 입력하면 그 명령이 실행되고, 원하는 것을 말하면 Eris가 데스크
자체의 명령으로 그 일을 합니다. 이때 Eris는 여러분이 허락한 권한을 통해 파일, Git, 데이터베이스, 브라우저,
뷰어를 씁니다. Eris는 자기 기억을 이 컴퓨터에 두고, 되돌릴 수 없는 일은 하기 전에 물으며, Eris가 바꾼 것은
되돌릴 수 있습니다. 이 컴퓨터에 이미 설치된 에이전트 프로그램과 여러분의 endue 에이전트도 Eris 곁에서 함께
일합니다.

<img src="../../../docs/media/readme/ask.gif" alt="말하는 줄에 입력한 문장 하나: Eris가 노트를 왼쪽에, 터미널을 오른쪽에 놓고, 노트 글자를 키운 다음, 자신이 한 일을 말합니다" width="100%">

### 전환하는 화면이 아니라, 팬(pan)으로 옮겨 다니는 캔버스

데스크는 넓은 캔버스 하나입니다. 창은 놓아 둔 자리에 그대로 있고, 여러분이 그 사이를 옮겨 다닙니다.
스크롤하거나 Shift를 누른 채 드래그하면 캔버스가 팬(pan)되고, 구석의 지도가 지금 어디에 있는지 보여 줍니다.
창을 가장자리로 끌면 화면의 절반을, 모서리로 끌면 4분의 1을 차지합니다. 모든 창을 펼쳐 놓고 하나를 고르고,
일마다 데스크톱을 따로 두고, 어떤 창이든 독립된 OS 창으로 꺼냈다가 다시 데스크로 되돌릴 수 있습니다.

<img src="../../../docs/media/readme/canvas.gif" alt="캔버스가 다른 창들 쪽으로 팬되었다가 돌아오는 동안 지도가 따라 움직이고, 왼쪽 가장자리로 끈 창이 화면의 절반을, 모서리로 끈 다른 창이 4분의 1을 차지하며, 창들이 펼쳐져 하나를 고릅니다" width="100%">

### UI가 사라질 때까지 모든 뷰와 앱을 다듬으세요

화면에 고정된 것은 없습니다. 테마와 디자인 시스템을 바꾸고, 키를 다시 바인딩하고, 어떤 플러그인의 페이지에든
자신만의 스타일과 스크립트를 얹을 수 있습니다. 직접 해도 되고 Eris에게 말해도
됩니다("노트 글자를 더 크게 해 줘"). 뷰는 데이터이고, 테마는 코드 없는 값이며, 내장 기능도 여러분의
플러그인과 같은 폴더 형식의 플러그인입니다. 그러니 다른 것으로 바꾸거나 끄면 됩니다. 프로필은 플러그인
묶음과 설정, 배치를 저장해 두고 한 번에 전환합니다.

<img src="../../../docs/media/readme/customize.gif" alt="말하는 줄에서 테마 스튜디오가 열리고, 화살표 키로 내장 테마를 하나씩 데스크 전체에 미리 본 뒤, Enter를 누르면 데스크에 호박색 터미널 테마가 적용됩니다" width="100%">

### 이미 들어 있는 것

터미널, 브라우저, 파일 탐색기, 노트. Git Studio, Docker Studio, API Studio, 데이터베이스 클라이언트,
Image Studio. 스프레드시트, 문서, 슬라이드, PDF, 전자책, 이미지, 동영상, 압축 파일, 구조화된 데이터를 여는
뷰어. 캘린더와 메일, 그리고 한 인터페이스에 모은 모든 채팅 서비스. 이 컴퓨터에서 도는 언어 모델을 위한 클라이언트. 이
하나하나가 [`plugins/`](../../../plugins/README.md)에 있는 플러그인입니다. 직접 만들려면
[`examples/`](../../../examples/README.md)에서 가장 작은 예제를 복사하고 `just dev`를 실행하세요. 파일을
저장하면 그 플러그인만 다시 로드됩니다.

<a id="your-first-five-minutes"></a>

## 첫 5분

1. **endue를 설치하세요.** [최신 릴리스](https://github.com/endue-ai/endue/releases/latest)에서 받아서 열면
   됩니다(자세한 내용은 [설치](#install)에 있습니다).
2. **Eris를 만나세요.** 첫 실행은 Eris를 소개하고, 마이크(**Not now**를 골라도 괜찮습니다)와
   endue ID(**Skip for now**를 골라도 괜찮습니다. 계정이 필요한 것은 없습니다)를 요청합니다.
3. **무언가를 여세요.** `Mod+Alt+L`을 누르고(`Mod`는 macOS에서 `Cmd`입니다) `term`을 입력한 뒤 Enter를
   누르세요. `notes`도 같은 방법으로 여세요. `Mod+K`는 플러그인, 명령, 문서, 파일을 한 목록에서 검색합니다.
4. **돌아다니세요.** 스크롤하거나 Shift를 누른 채 드래그해 캔버스를 팬(pan)하세요. 창의 제목을 왼쪽 가장자리로
   끌면 그 창이 화면의 절반을 차지합니다.
5. **부탁하세요.** `Alt+Space`를 누르고 `tile`을 입력한 뒤 Enter를 누르거나, 원하는 것을 문장으로 말하세요.
6. **내 것으로 만드세요.** 말하는 줄에 `theme studio`를 입력한 다음, 화살표 키와 Enter로 테마를 고르세요.

여러분이 다듬은 모든 것은 `~/.desk`에 있습니다. `init.yaml`, 프로필, `keys.yaml`, 뷰와 `plugins.lock`은 읽고
고치고 git으로 관리할 수 있는 평범한 파일입니다. `endue export <folder|file.zip>`으로 다른 컴퓨터에
옮기고(`--with-data`는 데스크 자체의 상태도 함께 담되, 비밀은 담지 않습니다), `endue import`로 `init.yaml`을
덮어쓰지 않고 다시 가져오며, `endue doctor`는 모든 파일과 각 파일이 스펙대로 읽히는지를 보여 줍니다.

<a id="install"></a>

## 설치

| 플랫폼 | 받는 방법 |
| --- | --- |
| macOS, Apple silicon | [최신 릴리스](https://github.com/endue-ai/endue/releases/latest)의 `darwin-aarch64` 디스크 이미지 |
| macOS, Intel | [최신 릴리스](https://github.com/endue-ai/endue/releases/latest)의 `darwin-x86_64` 디스크 이미지 |
| Linux x86_64, 명령줄 | [v0.4.0 릴리스](https://github.com/endue-ai/endue/releases/tag/v0.4.0)의 `endue-cli_0.4.0_linux-x86_64.tar.gz` |
| Windows, Linux 데스크톱 | 아직 배포하지 않습니다. [소스에서 빌드](#build-from-source)하세요 |

macOS에서는 디스크 이미지의 SHA-256을 릴리스 페이지에 있는 `SHA256SUMS-macos`와 비교한 뒤 이미지를 열고
`endue.app`을 응용 프로그램 폴더에 복사하세요. 0.5.0부터는 앱이 새 버전을 스스로 제안합니다.

공식 명령은 `endue`입니다. 소스 체크아웃에서는 `cargo run -p desk-cli -- --help`로 실행해 볼 수 있습니다.
기존 스크립트에서는 현재 메이저 버전 동안 `desk`를 계속 사용할 수 있습니다.

<details>
<summary>Desk에서, 또는 0.4.0 이하 버전에서 업그레이드하기</summary>

endue는 예전에 Desk라고 부르던 그래픽 앱입니다. 0.5.0은 앱의 식별자를 `ai.endue.desktop`으로 바꾸므로, 이전
설치본을 이어받지 않고 새 프로필로 시작합니다. 이전 프로필을 유지하려면 endue를 종료하고, 처음 실행하기 전에
`~/Library/Application Support/ai.endue.desk`를 `~/Library/Application Support/ai.endue.desktop`으로
복사하세요.

[endue 0.4.0 릴리스](https://github.com/endue-ai/endue/releases/tag/v0.4.0)에는 Apple silicon과 Intel용
macOS 디스크 이미지가 있고, [v0.3.0 다운로드](https://github.com/endue-ai/endue/releases/tag/v0.3.0)에는
Apple silicon용(`aarch64`)과 Intel용(`x86_64`) 디스크 이미지가 있습니다. v0.3.0은 Apple 공증을 받지
않았습니다. 확인한 앱의 첫 실행을 macOS가 차단하면 시스템 설정 → 개인정보 보호 및 보안에서 endue Desk의
**그래도 열기**를 선택하세요.

- macOS에서는 Desk를 종료하고 새 `.dmg`를 연 뒤 `Install endue.command`를 실행하세요. 설치 프로그램은 응용 프로그램
  폴더에서 번들 ID로 기존 앱을 찾아 업데이트합니다. 앱 이름을 바꾼 경우에도 같은 위치를 사용합니다. 복사본이
  여러 개이거나 다른 앱이 endue라는 이름을 사용 중이면 디스크 이미지 안에서 터미널을 열고
  `"./Install endue.command" --to "/Applications/Studio.app"`를 실행하세요. 예시 경로 대신 기존 Desk 앱의
  경로나 비어 있는 새 경로를 지정하세요.
- Windows와 Linux에서는 해당 릴리스에 기존 설치본과 같은 형식의 패키지가 있으면 그 파일을 사용하세요.
  Windows는 기존 설치 폴더를 사용하고 Debian의 패키지 이름은 계속 `endue-desk`입니다.
- 앱을 다시 열면 `~/.desk`에 있던 프로필과 `plugins.lock`, 기존 설정, 권한, 자격 증명 참조를 그대로
  사용합니다. v0.3.0처럼 설치 파일만 제공한 Desk 버전은 새 설치 파일로 직접 업데이트하세요. v0.3.0 디스크
  이미지에는 CLI가 포함되어 있지 않습니다.

</details>

<details>
<summary>Linux x86_64 서버용 명령줄 도구</summary>

[v0.4.0 릴리스](https://github.com/endue-ai/endue/releases/tag/v0.4.0)에서
`endue-cli_0.4.0_linux-x86_64.tar.gz`와 `SHA256SUMS-cli`를 빈 디렉터리에 받으세요.
`sha256sum -c SHA256SUMS-cli`로 확인한 뒤 `tar -xzf endue-cli_0.4.0_linux-x86_64.tar.gz`로 압축을 풉니다.
`ENDUE_BRAIN_URL`에 사용할 brain v0 서비스 주소를 설정하고
`./endue-cli_0.4.0_linux-x86_64/bin/endue run "hello"`를 실행하세요.
[서명된 CLI 릴리스 검증](../../../docs/releasing.md#verify-a-linux-cli-download)

</details>

## endue와 endue.ai

[endue.ai](https://endue.ai)는 같은 팀이 만든 에이전트 플랫폼입니다. 그곳의 에이전트는 클라우드에서 여러분을
위해 일합니다. 이 앱은 그 에이전트들이 찾아오는 오픈소스 데스크톱입니다. endue ID로 로그인하면 여러분의
endue 에이전트와 스페이스가 로컬의 것들과 나란히 데스크에 나타납니다.

로그인은 선택 사항입니다. 계정이 없으면 Eris는 이 컴퓨터의 모델이나 이미 갖고 있는 에이전트 프로그램으로
동작하고, 이 저장소에 있는 모든 것이 동작합니다. endue AI와 endue ID는 비공개 서비스이며, 앱은
[`specs/brain`](../../../specs/brain)의 공개 계약을 통해서만 두 서비스에 닿습니다.

**개인정보.** endue에는 텔레메트리가 없습니다. 크래시 리포트는 도입되더라도 옵트인 방식이며 기본적으로 꺼져
있습니다.

## 왜 endue인가

빌더의 차고를 떠올려 보세요. 빌더가 가운데에서 일하고, 비서는 기억하고 묻고, 로봇 팔이 손이 되고, 모든 벽이
빌더가 원하는 모양으로 작업을 비춰 주는 방 하나. endue는 여러분의 컴퓨터 안에 있는 그 차고입니다. 에이전트
네이티브이고, 여러분의 데이터를 어떤 뷰로든 그리며, 여러분이 마음대로 바꿀 수 있는, 매일 쓰는 도구입니다.
endue가 지금 어디에 있고 어디로 가는지는 [`docs/roadmap.md`](../../../docs/roadmap.md)에 있습니다.

<a id="build-from-source"></a>

## 소스에서 빌드하기

```bash
pnpm install
just check && just test
just dev
```

Rust(버전은 `rust-toolchain.toml`에 고정되어 있습니다), Node 22+, pnpm, `just`, 그리고 앱의 Chromium(CEF)을
위한 cmake와 ninja가 필요합니다. CEF는 첫 빌드 때 내려받습니다. Linux에서는 GTK 3, xdo, AppIndicator, ALSA
헤더도 필요합니다. 런타임 테스트는 앱과 같은 버전의 헤드리스 Chromium에서 돌며, `just test-e2e`가 처음 한 번
`~/.cache/desk`에 받아 둡니다. 테스트는 Playwright를 직접 부르지 말고 `just test-e2e`로 실행합니다.

## 더 알아보기

| 하고 싶은 일 | 시작할 곳 |
| --- | --- |
| 플러그인, 뷰, 테마 만들기 | [`docs/plugins/authoring.md`](plugins/authoring.md), [`examples/`](../../../examples/README.md) |
| 무엇이 내장되어 있는지 보기 | [`plugins/`](../../../plugins/README.md) |
| 각 계층이 어떻게 맞물리는지 이해하기 | [`docs/architecture.md`](architecture.md) |
| 어떤 결정을 왜 내렸는지 알기 | [`docs/adr/`](../../../docs/adr) |
| endue가 어디로 가는지 보기 | [`docs/roadmap.md`](../../../docs/roadmap.md) |
| 변경 사항 보내기 | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`AGENTS.md`](../../../AGENTS.md) (사람과 AI 에이전트를 위한 지도) |
| 취약점 제보하기 | [`SECURITY.md`](SECURITY.md) |

## 라이선스

코드는 [Apache-2.0](../../../LICENSE) 라이선스를 따릅니다. `brand/`에 있는 endue와 Eris의 이름, 로고,
일러스트레이션은 예외입니다. 자세한 내용은 [brand/LICENSE](../../../brand/LICENSE)와
[TRADEMARK.md](TRADEMARK.md)에 있습니다.
