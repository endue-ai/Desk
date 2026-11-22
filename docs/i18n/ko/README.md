> 이 문서는 [영문판](../../../README.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# endue

하나의 앱이 곧 하나의 OS입니다.

**고정된 화면이 없습니다.** endue는 Chromium 위의 Rust 셸과 작은 Rust 코어 위에 웹 런타임을 얹은 구조이며, 그 위의 모든
기능은 내장 기능까지 포함해 앱이 실행되는 동안 교체할 수 있는 플러그인입니다. Emacs처럼 코어는 프리미티브
(파일, 프로세스, 네트워크, 오디오, 창)만 갖고, 나머지는 모두 재시작 없이 바꿀 수 있는 코드입니다.

> 상태: 프리알파. `just dev`를 실행하면 Eris와 첫 실행이 있는 데스크가 열립니다. 먼저 `just brain-echo`를 띄워 두면 입력한 말에 Eris가 답합니다(지금은 에코).

<!-- 스크린샷: 첫 실행 화면과 함께 추가됩니다. -->

## endue 앱 설치 및 업그레이드

endue는 기존 Desk의 새 이름입니다. [v0.3.0 다운로드](https://github.com/endue-ai/endue/releases/tag/v0.3.0)에는 Apple silicon용(`aarch64`)과 Intel용(`x86_64`) macOS 디스크 이미지가 있습니다. Mac에 맞는 이미지를 열고 앱을 응용 프로그램 폴더에 복사하세요. 이 버전은 Desk로 표시됩니다. 이미지의 SHA-256을 릴리즈에 있는 `SHA256SUMS-macos`와 비교하세요. v0.3.0은 Apple 공증을 받지 않았습니다. 확인한 앱의 첫 실행을 macOS가 차단하면 시스템 설정 → 개인정보 보호 및 보안에서 endue Desk의 **그래도 열기**를 선택하세요.

**endue app**이라는 이름으로 첫 버전이 배포되면 [GitHub 릴리즈](https://github.com/endue-ai/endue/releases)에서 운영체제와 프로세서에 맞는 데스크톱 설치 파일을 선택한 뒤 다음 절차를 따르세요.

- macOS에서는 Desk를 종료하고 새 `.dmg`를 연 뒤 `Install endue.command`를 실행하세요. 설치기는 응용 프로그램 폴더에서 번들 ID로 기존 앱을 찾아 업데이트합니다. 앱 이름을 바꾼 경우에도 같은 위치를 사용합니다. 복사본이 여러 개이거나 다른 앱이 endue라는 이름을 사용 중이면 디스크 이미지 안에서 터미널을 열고 `"./Install endue.command" --to "/Applications/Studio.app"`를 실행하세요. 예시 경로 대신 기존 Desk 앱의 경로나 비어 있는 새 경로를 지정하세요.
- Windows와 Linux에서는 해당 릴리즈에 기존 설치본과 같은 형식의 패키지가 있으면 그 파일을 사용하세요. Windows는 기존 설치 폴더를 사용하고 Debian의 패키지 이름은 `endue-desk`입니다.
- 앱을 다시 열면 `~/.desk`에 있던 프로필과 `plugins.lock`, 기존 설정, 권한, 자격 증명 참조를 그대로 사용합니다. v0.3.0처럼 설치 파일만 제공한 Desk 버전은 새 설치 파일로 직접 업데이트하세요.

공식 명령은 `endue`입니다. 소스에서는 `cargo run -p desk-cli -- --help`로 실행할 수 있습니다. v0.3.0 디스크 이미지에는 CLI가 포함되어 있지 않습니다. 기존 스크립트에서는 현재 메이저 버전 동안 `desk`를 계속 사용할 수 있습니다. 서버용 Linux CLI는 배포가 시작되면 별도 다운로드로 제공됩니다.

## 왜 endue인가

빌더의 차고를 떠올려 보세요. 빌더가 가운데에서 일하고, 비서는 기억하고 묻고, 로봇 팔이 손이 되고, 모든 벽이
빌더가 원하는 모양으로 작업을 비춰 주는 방 하나. endue는 당신의 컴퓨터 안에 있는 그 차고입니다.

- **매일 쓰는 도구.** 빌더가 매일 여는 앱이라, 무엇보다 먼저 설치되고, 켜지고, 답합니다.
- **에이전트 네이티브.** 상주 비서 Eris 가 이 컴퓨터에 자기 기억을 갖고 로컬 · 외부 에이전트를 조율합니다.
  에이전트에게는 손이 있고, 결정은 사람이 합니다.
- **뷰가 먼저.** 데이터를 한 번 정리하면 어떤 모양으로든 그립니다. 직접 만들거나, Eris 에게 문장 하나로
  시키거나, 마켓에서 받습니다.
- **당신의 것.** 디자인 시스템, 배치, 연동은 빌더가 고르고 갈아끼웁니다.

endue는 빌더의 조력자입니다. 안정적으로 무언가를 만들 환경을 갖춰 주고, 그 안에서 자유롭게 짜게 두고, 변하지
않는 최고의 품질로 최고의 제품을 만들게 받칩니다. endue가 지금 어디에 있고 어디로 가는지는 `docs/roadmap.md`
(한국어 원본은 `docs/ko/desk-roadmap.md`)에 있습니다.

### 데스크는 폴더다

여러분이 다듬은 모든 것은 `~/.desk` 에 있습니다. `init.yaml`, 프로필, `keys.yaml`, 뷰와 `plugins.lock` 은
읽고 고치고 git 으로 관리할 수 있는 평범한 파일입니다. `endue export <폴더|file.zip>` 으로 다른 컴퓨터에
옮기고(`--with-data` 는 데스크 자체의 상태도 함께, 비밀은 빼고), `endue import` 로 `init.yaml` 을 덮어쓰지
않고 되돌리며, `endue doctor` 는 모든 파일과 각 파일이 스펙대로 읽히는지를 보여 줍니다.

## 빌드

```bash
pnpm install
just check && just test
just dev
```

Rust(버전은 `rust-toolchain.toml`에 고정되어 있습니다), Node 22+, pnpm, `just`, 그리고 앱의 Chromium(CEF)을
위한 cmake와 ninja가 필요합니다. CEF는 첫 빌드 때 내려받습니다. Linux에서는 GTK 3, xdo, AppIndicator, ALSA
헤더도 필요합니다. 런타임 테스트는 앱과 같은 버전의 헤드리스 Chromium에서 돌며, `just test-e2e`가 처음 한 번
`~/.cache/desk`에 받아 둡니다. 테스트는 Playwright를 직접 부르지 말고 `just test-e2e`로 실행합니다.

## 개인정보

endue에는 텔레메트리가 없습니다. 크래시 리포트는 도입되더라도 옵트인 방식이며 기본적으로 꺼져 있습니다.

## 더 알아보기

- `docs/architecture.md`: 각 계층이 어떻게 맞물리는지
- `docs/adr/`: 되돌리기 어려운 결정과 그 이유
- `docs/roadmap.md`: endue가 왜 있고, 지금 어디에 있고, 어디로 가는지
- `AGENTS.md`: 저장소 지도, 명령, 규칙 (사람과 AI 에이전트 모두를 위한 문서)
- `CONTRIBUTING.md`: 변경 사항을 보내는 방법

## 라이선스

코드는 [Apache-2.0](../../../LICENSE) 라이선스를 따릅니다. `brand/`에 있는 endue와 Eris의 이름, 로고,
일러스트레이션은 예외입니다. 자세한 내용은 [brand/LICENSE](../../../brand/LICENSE)와 [TRADEMARK.md](TRADEMARK.md)에 있습니다.
