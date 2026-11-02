# endue Desk 구조

2026-10-31 · Team endue

> 이 문서가 Desk 설계의 단일 진실입니다. 코드와 어긋나면 ADR 로 결정을 남기고 이 문서를 고칩니다. 영어 요약은 `docs/architecture.md`, 되돌리기 어려운 결정은 `docs/adr/` 에 있습니다.

Desk 는 Tauri 셸과 작은 Rust 코어 위에 웹 런타임을 얹고, 그 위의 모든 기능을 런타임 플러그인으로 만드는 하나의 OS 입니다. Emacs 처럼 코어는 원시 기능만 갖고, 나머지는 앱을 켠 채 바꿉니다.

## 한눈에

```text
 기기 밖 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 ┆  endue AI (클라우드 두뇌: 에이전틱 루프 · 모델 · 크레딧)            서버에서 바꿈 ┆
 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│ specs/brain ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
 사용자 컴퓨터                     │                                 바꾸는 비용
 ┌────────────────────────────────┴──────────────────────────────┐
 │ 플러그인   UI(iframe) · 로직(Wasm) · 도구(MCP, 가벼운 VM 안)     │  즉시
 │            · 커넥터(Wasm · MCP) · 뷰(데이터)                     │
 ├───────────────────────────────────────────────────────────────┤
 │ 웹 런타임  compositor(3D/2D) · surfaces · input · layout · theme │  재시작
 │            · UI 플러그인 호스트 · 데스크 셸 (ADR 0026 까지)      │
 ├───────────────────────────────────────────────────────────────┤
 │ Desk 브리지  specs/bridge · specs/plugin · specs/item            │  재빌드
 │              · specs/view · specs/connector 에서 생성된 타입     │
 │              (TS 클라이언트 · Rust 타입)                         │
 ├───────────────────────────────────────────────────────────────┤
 │ Rust 코어  권한 · 이벤트 버스 · 저장소 · 항목 색인 · VM · 두뇌   │  재빌드
 │            · 로직(Wasm) 플러그인과 커넥터 호스트 · 내장 커넥터   │
 ├───────────────────────────────────────────────────────────────┤
 │ Tauri 셸   창 · 웹뷰 · 원시 기능(fs · proc · net · audio)        │  재빌드
 ├───────────────────────────────────────────────────────────────┤
 │ 운영체제   macOS · Windows · Linux (서명 · 공증 · OS 권한)        │  —
 └───────────────────────────────────────────────────────────────┘
```

위로 갈수록 실행 중에 바뀌고, 아래로 갈수록 앱 업데이트가 필요합니다. endue AI 만 기기 밖(점선)에 있고, 나머지는 모두 사용자 컴퓨터에서 돕니다.

## Emacs 처럼, 하나의 OS 처럼

Emacs 는 작은 C 코어 위에서 거의 모든 기능이 Elisp 로 돌고, 실행 중에 고칠 수 있습니다. Desk 는 같은 구조를 운영체제의 말로 옮깁니다.

| 역할 | 운영체제 | Emacs | Desk |
| --- | --- | --- | --- |
| 커널 | 커널 | C 코어 | Rust 코어 |
| 시스템 호출 | 시스템 콜 | Lisp 원시 함수 | Desk 브리지 API |
| 드라이버 | 장치 드라이버 | OS 연동 코드 | Tauri 셸 + Rust crate |
| 창 관리자 | 윈도 매니저 | 프레임 · 윈도 | 3D 캔버스 컴포지터 |
| 셸 | 터미널 셸 | M-x | Eris · 명령 팔레트 |
| 앱 | 응용 프로그램 | 패키지 (Elisp) | 플러그인 (UI · Wasm · MCP) |
| 연결한 데이터 | 마운트한 파일 시스템 · 검색 색인 | Gnus 백엔드 · Org agenda | 커넥터 · 색인 하나에 모이는 항목 · 뷰 (ADR 0032) |
| 부팅 설정 | init | init.el | 프로필 (플러그인 묶음 + 설정) |
| 패키지 관리자 | apt · brew | package.el · MELPA | 마켓플레이스 |
| 동작 바꿔치기 | 없음 | advice · hook | 이벤트 훅 · 커맨드 덮어쓰기 |
| 계정 | 사용자 계정 | 없음 | endue ID |

1. 코어는 작게. Rust 코어에는 기능이 아니라 원시 기능(fs · proc · net · audio · ui)만 넣습니다.
2. 기본 기능도 플러그인. Eris, 왼쪽 바, 툴바, 프로필 전환도 사용자와 같은 API 로 만듭니다. 그래야 API 에 빠진 구멍이 없고, 기본 기능까지 갈아끼울 수 있습니다. 화면 배치 · 키 · 파일 · 테마 · 알림 같은 기본 정책도 데이터만 가진 `desk.*` 플러그인입니다 (ADR 0017). 데스크 셸은 아직 아닙니다. 셸(`packages/runtime` 의 `src/shell · surface · system · modes · eris`, ADR 0025)은 ADR 0026(제안)이 자리를 정할 때까지 런타임 안의 코드이고, 그동안 Eris 는 `plugins/eris` 와 셸에 두 번 있으며(ADR 0027), 가장자리도 `plugins/{dock,toolbar,sidebar}` 와 셸의 아래 가장자리 · 레일 · 에이전트 바로 겹칩니다(ADR 0028).
3. 모든 것은 커맨드. 클릭, 음성, 단축키, 에이전트가 같은 커맨드를 부릅니다. 사용자가 할 수 있는 일은 Eris 와 에이전트도 할 수 있습니다.
4. 실행 중에 고친다. 저장하면 바로 반영되고, 플러그인 상태는 코어 저장소에 남아 교체 뒤에도 이어집니다.
5. 끼어들 수 있다. 어떤 커맨드든 앞뒤에 훅을 걸거나 통째로 덮어쓸 수 있습니다. Emacs 의 advice 와 같습니다.
6. 들여다보기 전에 묻는다. 원시 기능 호출은 사람이든 에이전트든 모두 브리지의 권한 검사를 거칩니다.

## 기술 스택 장단점

Rust 가 맡는 일이 무거울수록 Tauri 가 유리하고, 위험은 OS 마다 다른 웹뷰에 몰려 있습니다. 모든 OS 에서 Chromium 이 꼭 필요해지면 브리지 구현만 바꿔 Electron 이나 CEF 로 옮깁니다.

| 층 | 기술 | 장점 | 단점 | 대응 |
| --- | --- | --- | --- | --- |
| 셸 | Tauri 2 | 앱이 작고 상주 메모리가 가벼움. Rust 와 같은 프로세스. 창·웹뷰 단위 권한 | OS 마다 웹뷰가 다름. 리눅스 WebKitGTK 가 약함 | Safari 기준으로 개발, 리눅스는 2D 모드부터, 브리지로 셸 교체 길을 열어 둠 |
| 커널 | Rust | 오디오·PTY·파일 감시 같은 상주 작업에 강하고 메모리 안전. 한 crate 를 다른 셸에도 재사용 | 컴파일이 느림. 바꾸면 재빌드·서명·공증 | 코어는 원시 기능만 두고 작게, 기능은 플러그인으로 |
| 화면 | OS 웹뷰 + React | AI 가 가장 잘 만드는 UI. endue 웹 디자인 시스템 재사용. 브라우저판과 코드 공유 | 엔진 차이(WKWebView · WebView2 · WebKitGTK) | Chromium 전용 API 금지, 엔진별 화면 회귀 테스트 |
| 3D | Three.js (WebGL2) | 모든 웹뷰에서 동작, 생태계가 큼 | WebGPU 보다 느림. 글자별 블러 같은 연출은 WebKit 에서 무거움 | 변화가 있을 때만 렌더, WebGPU 는 되는 곳에서만, 소울 텍스트는 셰이더로 |
| UI 플러그인 | 샌드박스 iframe | 런타임에 바로 설치·교체. 웹 개발자 누구나 만듦 | iframe 이 많으면 메모리가 늘고 화면 간 통신 비용이 생김 | 안 보이는 표면은 내리고, 브리지 메시지는 묶어서 처리 |
| 로직 플러그인 | Wasmtime (+ QuickJS 로 JS) | 격리되고 허락한 기능만 씀. 언어 자유. 즉시 교체 | Wasm 생태계가 아직 작고, 브리지 바인딩(WIT)을 직접 정의해야 함 | endue 가 플러그인 SDK 와 템플릿을 제공 |
| 도구 플러그인 | MCP 프로세스 | 아무 언어. 기존 MCP 서버를 그대로 씀. endue AI 에이전트도 같이 씀 | 프로세스마다 메모리. VM 경유라 호출 지연이 생기고 VM 이미지만큼 메모리를 더 씀 | 가벼운 Linux VM 하나에서 실행(결정). 허락한 폴더만 virtiofs 로 넣고 vsock 으로 통신, 쉬면 VM 째로 멈춤 |
| 클라우드 | endue AI | 에이전틱 루프·모델·크레딧을 서버에서 바꿔 즉시 반영 | 오프라인이면 생각을 못 함 | 오프라인 안내, 로컬 작업은 쌓아 두었다 재연결 때 처리 |

## 바뀌는 범위

```text
 ┌─ 재빌드 ─────────────────────────────────────────────────────┐
 │  Rust 코어 · Tauri 셸 · 브리지 타입            앱 업데이트 뒤 재실행 │
 │  ┌─ 재시작 ───────────────────────────────────────────────┐  │
 │  │  웹 런타임                              창 새로고침, 2초  │  │
 │  │  ┌─ 즉시 ───────────────────────────────────────────┐  │  │
 │  │  │  플러그인 하나 (iframe · Wasm · MCP)      1초 미만  │  │  │
 │  │  └──────────────────────────────────────────────────┘  │  │
 │  └────────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────────┘
```

바깥에서 안쪽으로 갈수록 바꾸는 비용이 커집니다. 사용자에게 재빌드는 자동 업데이트 뒤 재시작 한 번으로 보이지만, 개발자에게는 컴파일과 서명·공증이 따릅니다.

| 범위 | 다시 뜨는 것 | 목표 시간 | 그대로 이어지는 것 |
| --- | --- | --- | --- |
| 즉시 | 바뀐 플러그인 하나 (iframe · Wasm 인스턴스 · MCP 프로세스) | 1초 미만 | 다른 화면, 진행 중인 작업, 음성 대기 |
| 재시작 | 웹 런타임 (창 새로고침) | 2초 안팎 | Rust 코어, MCP 도구, 실행 중인 CLI |
| 재빌드 | 앱 전체 (자동 업데이트 뒤 재실행) | 업데이트를 받는 시간 + 몇 초 | 저장된 상태, 프로필, 설치한 플러그인 |

개발할 때도 같은 세 단계입니다. 플러그인 폴더는 저장하는 즉시 다시 불러오고, 웹 런타임은 Vite HMR 로, Rust 코어는 cargo watch 로 다시 빌드합니다.

## 파일 트리

하나의 모노레포에 Rust 워크스페이스(`crates/`)와 pnpm 워크스페이스(`packages/` · `apps/` · `plugins/`)를 같이 둡니다. 열림과 닫힘의 경계는 `specs/` 가 긋고, 브리지·두뇌·플러그인과 통합 계층(항목·뷰·커넥터)의 타입은 모두 거기서 생성됩니다. 깊이는 4단계를 넘지 않습니다.

```text
desk/
├── AGENTS.md                 # AI 에이전트 진입점: 지도 · 명령 · 규칙 · 경계 (Claude Code 는 CLAUDE.md 대신 이 파일을 읽음)
├── README.md
├── LICENSE                   # Apache-2.0
├── TRADEMARK.md              # endue 이름·로고 사용 정책. 포크는 이름을 바꿈
├── CONTRIBUTING.md           # DCO
├── SECURITY.md               # 신고 메일 (endue 도메인)
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── justfile                  # 사람 · CI · AI 가 같이 쓰는 유일한 명령 진입점 (dev · test · check · codegen · release)
├── Cargo.toml                # Rust 워크스페이스
├── rust-toolchain.toml
├── package.json              # pnpm 워크스페이스 루트
├── pnpm-workspace.yaml
├── biome.json                # TS 린트 · 포맷 (한 도구)
├── .editorconfig
├── .github/
│   ├── workflows/            # 열세 개. 아래 "GitHub 와 오픈소스 뼈대" 절 참고 (PR 에서 도는 건 여섯). main 에는 지금 여섯
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
│
├── specs/                    # 열림/닫힘의 경계. 언어 중립 계약, 단일 진실
│   ├── bridge/v0/            # Desk 브리지: JSON Schema + 메서드 문서 (fs · proc · net · audio · ui · perm · plugin · store · brain · init · cmd · settings · log · events · data · connector · view · catalog)
│   ├── brain/v0/             # 두뇌 API: openapi.yaml (세션 · 턴 · 스트리밍 · 임대 · 에이전트 디렉터리, ADR 0024)
│   ├── init/v0/              # init.yaml 스키마 · 템플릿 · 동기화 규칙 (ADR 0016)
│   ├── plugin/v0/            # plugin.json 매니페스트 스키마 · 권한 어휘 · contributes (ADR 0017)
│   ├── item/v0/              # 항목: 연결한 데이터의 한 모양. 봉투 · kind 여덟 + record · 질의 · 페이지 · 변경 (ADR 0032)
│   ├── view/v0/              # 뷰: 데이터로 쓴 화면. requires · params · 컨테이너와 컴포넌트의 배치 · 동작은 커맨드 (ADR 0032)
│   ├── connector/v0/         # 커넥터가 선언하는 것(바인딩 wasm · mcp, 인증, 리소스, 동기화) · 상태 · 동기화 결과 · Desk 를 아는 MCP 서버의 프로필 (ADR 0032)
│   └── wit/                  # Wasm 인터페이스: 로직 플러그인이 import 하는 desk:host (브리지의 부분집합) · Wasm 커넥터가 빌드하는 world desk:connector (ADR 0034 제안)
│
├── crates/                   # Rust. 접두사 desk-
│   ├── desk-core/            # 커널: 권한 엔진 · 이벤트 버스 · 저장소 · 플러그인 레지스트리 · 커맨드 레지스트리(cmd.*, ADR 0017) · init.yaml · 두뇌 대화와 세션 임대 클라이언트(ADR 0014) · 통합 계층(data.* · connector.* · view.* · catalog.get)과 OS 캘린더 위의 내장 커넥터 desk.calendar · desk.reminders (ADR 0036 제안) · 브리지 핸들러
│   ├── desk-sys/             # 원시 기능: fs(notify, 원자적 쓰기) · proc(portable-pty) · net(rustls, 호스트 allowlist) (#63). feature 로 분리. audio(cpal, 호출어)는 계획
│   ├── desk-bridge/          # 브리지 Rust 측: specs/bridge · specs/plugin 에서 생성된 타입만 (src/generated.rs)
│   ├── desk-index/           # 항목 색인: 데이터 폴더의 SQLite 파일 하나(index.sqlite, FTS5). data:read 범위는 SQL 안에서 걸고, 코어는 ItemIndex 트레이트로만 앎 (ADR 0033)
│   ├── desk-plugin-host/     # Wasmtime 호스트 둘: 로직 플러그인의 LogicHost (설치 · 시작 · 리로드, ADR 0019, #68)와 Wasm 커넥터의 ConnectorHost (desk:connector · 인스턴스 · 동기화 일정 · 항목마다 출처 도장, ADR 0034 제안). 플러그인 · 커넥터마다 store 하나와 메모리 · 시간 상한. MCP 감독은 아직 없음
│   ├── desk-vm/              # 가벼운 Linux VM: 부팅 · vsock · 허락한 폴더만 virtiofs (macOS Virtualization.framework · Windows WSL2 · Linux KVM). 빈 crate, 계획
│   ├── desk-brain/           # 두뇌 트레이트 + 생성된 클라이언트 타입
│   ├── desk-brain-local/     # 로컬 두뇌 어댑터: Ollama (#42). llama.cpp 는 계획
│   ├── desk-brain-endue/     # endue AI 클라이언트 (공개 명세 기준)
│   └── desk-cli/             # `desk` CLI: plugin validate. dev · brain ping 은 계획. AI 가 쓰는 손
│
├── packages/                 # TypeScript. 스코프 @endue-ai/
│   ├── runtime/              # 창 관리자: compositor(2D. 3D 는 계획) · surfaces(iframe) · input · layout · theme · 기본 정책의 메커니즘 (ADR 0017)
│   │                         # UI 플러그인 호스트 PluginHost (src/plugins.ts): 마운트 · plugin.changed 에 리로드 · 커맨드 양방향 (ADR 0012)
│   │                         # 데스크 셸 mountDesk (src/shell · surface · system · modes · eris, ADR 0025): ADR 0026 이 정할 때까지 여기.
│   │                         # Eris 는 plugins/eris 와 두 번 (ADR 0027), 가장자리도 두 번 (ADR 0028)
│   ├── bridge/               # 브리지 TS 클라이언트 + 생성된 타입 + 어댑터 (tauri · browser 스텁)
│   ├── plugin-sdk/           # 플러그인 저자가 import 하는 전부
│   ├── ui/                   # 디자인 토큰 · tokens.css · 프레임워크 없는 custom element 여섯 (ADR 0022, #72)
│   └── create-plugin/        # `pnpm create @endue-ai/plugin` 스캐폴더 (UI 템플릿, #34)
│
├── apps/
│   └── desk/                 # Tauri 2 앱. 얇은 어댑터만
│       ├── src-tauri/        # main.rs · lib.rs · commands/ (브리지 → desk-core) · capabilities/ · tauri.conf.json · icons/
│       ├── src/              # 부트스트랩: runtime 마운트 · bridge(tauri) 연결 · 플러그인 로드. 셸(mountDesk)은 아직 아님 (#74)
│       └── index.html
│
├── plugins/                  # endue 기본 기능. 커뮤니티 플러그인과 같은 형식
│   ├── eris/                 # 비서: 자세 · 구체 · 대화 · 소울 텍스트 (assets 는 brand/ 라이선스). 셸에도 따로 하나 (ADR 0027)
│   ├── sidebar/              # 왼쪽 가장자리: 설치한 플러그인 켜고 끄기. 셸의 에이전트 바와 같은 자리 (ADR 0028)
│   ├── toolbar/              # 오른쪽 상태 패널 (서랍 목록). 셸의 레일과 같은 자리 (ADR 0028)
│   ├── dock/                 # 아래 독 (플러그인 타일). 셸의 아래 가장자리와 같은 자리 (ADR 0028)
│   ├── terminal/             # 터미널: 사용자의 셸을 코어의 PTY 에서, xterm.js 는 폴더 안에 (endue.terminal, ADR 0037)
│   ├── permissions/          # grant 목록 · 회수 · 프롬프트 창 (endue.permissions, #69)
│   ├── explorer/             # 허락한 폴더 트리 · 열기는 desk.files 로 · 감시 (endue.explorer, docs/ko/explorer-requirements.md)
│   ├── mail/                 # 색인의 message 항목을 메일함 · 스레드로, 초대장(iTIP) 읽기 · 답하기, 변경은 커넥터 커맨드로 (endue.mail, docs/ko/mail-requirements.md)
│   ├── views/                # 뷰 엔진 desk.views: 뷰 파일(specs/view)을 화면으로. data.query 로 묶고 data.subscribe 로 살려 두며 @endue-ai/ui 로 그림 (ADR 0032)
│   ├── today/                # 오늘 한눈에 desk.today: 데이터만 가진 view 플러그인, desk.views 가 그림 (Mod+T)
│   ├── item/                 # 항목 하나 desk.item: 팔레트의 Open in Desk 가 여는 view 플러그인
│   ├── profiles/             # 프로필 전환 · 저장 (desk.profiles, 예전 이름 modes)
│   ├── shell/                # 데스크 셸의 정책 desk.shell: 샘플 프로필 · 설정 · 색 (ADR 0025). 셸의 코드는 packages/runtime
│   ├── display/ · keys/ · palette/ · buffers/ · files/ · session/ · notify/ · theme/
│   │                         # 기본 정책 desk.* (ADR 0017)
│   └── onboarding/           # 첫 실행 시나리오 (장면 1–10, #41)
│       └── (각 플러그인: plugin.json · README.md · ui/ · logic/ · tool/ · tests/)
│
├── examples/                 # 한 명령으로 도는 최소 예제
│   ├── plugin-hello-ui/
│   ├── plugin-hello-wasm/    # Rust wasm32-wasip2 컴포넌트, 빌드한 결과도 커밋 (#68)
│   ├── plugin-hello-connector/ # 가장 작은 Wasm 커넥터: 폴더의 *.md 를 note 항목으로 (desk:connector), 빌드한 결과도 커밋 (ADR 0034)
│   ├── plugin-hello-mcp/     # README 만, 계획
│   └── brain-echo/           # 두뇌 명세의 최소 구현. 테스트와 AI 학습용
│
├── e2e/                      # 앱 단위 테스트 (tauri-driver, 계획 #82). 지금은 README · perf/budgets.json
│
├── docs/                     # 마크다운이 진실, 사이트는 빌드 산출물
│   ├── architecture.md
│   ├── adr/                  # 0001-tauri-over-electron.md … 되돌리기 어려운 결정마다 하나
│   ├── ko/                   # 한국어 설계 원본: 이 문서 · desk-requirements.md · terminal-requirements.md · first-run-scenario.md
│   ├── i18n/                 # 사용자용 문서의 ja · zh · fr · de · ko 번역
│   ├── plugins/              # 플러그인 저자 가이드
│   ├── brain/                # 두뇌 어댑터 작성 가이드
│   ├── qa/                   # TESTING.md: 어떤 변경에 어떤 테스트
│   ├── reference/            # 원천 자료 (Eris opening 프로토타입)
│   ├── security/             # 위협 모델 (#71)
│   └── site/                 # 문서 사이트 설정 (Starlight, 계획). API 레퍼런스는 빌드 때 specs/ 에서 생성 (#71)
│
├── brand/                    # Apache 아님. 별도 LICENSE
│   ├── LICENSE
│   ├── logo/                 # 계획
│   ├── tin/                  # 계획
│   └── eris/
│
└── scripts/                  # justfile 이 부르는 스크립트 (codegen · scope-check · lanes · docs-i18n · spec-docs. sign · release 는 계획)
```

구조도의 층과 폴더

| 층 | 폴더 |
| --- | --- |
| endue AI (클라우드) | 저장소 밖. `specs/brain` 과 `crates/desk-brain-endue` 만 여기 |
| 플러그인 | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| 웹 런타임 | `packages/runtime` (컴포지터, UI 플러그인 호스트 ADR 0012, ADR 0026 이 정할 때까지 데스크 셸 ADR 0025) · `packages/ui` |
| Desk 브리지 | `specs/bridge` · 통합 계층의 계약 `specs/item` · `specs/view` · `specs/connector` (ADR 0032) · `packages/bridge` · `crates/desk-bridge` (이 명세들과 `specs/plugin` 에서 생성된 타입) |
| Rust 코어 | `crates/desk-core` (통합 계층 `data.*` · `connector.*` · `view.*` · `catalog.get` 과 내장 커넥터 `desk.calendar` · `desk.reminders`, ADR 0036 제안) · `crates/desk-index` (항목 색인, SQLite, ADR 0033) · `crates/desk-plugin-host` (로직 플러그인 ADR 0019 · Wasm 커넥터 ADR 0034 제안, Wasmtime) · `crates/desk-vm` · `crates/desk-brain*` |
| Tauri 셸 | `apps/desk/src-tauri` · `crates/desk-sys` |
| 운영체제 | `apps/desk/src-tauri/capabilities` · `.github/workflows/release.yml` (서명 · 공증) |

사람과 AI 가 같이 쓰는 규칙

1. 진입점은 `AGENTS.md` 하나. 저장소 지도(최상위 폴더마다 한 줄), 명령 세 개(`just dev` · `just test` · `just check`), 규칙, 경계(비밀 금지, `brand/` 는 Apache 아님, 닫힌 서비스는 저장소 밖)를 담습니다.
2. 명세 우선. `specs/` 를 고치고 `just codegen` 을 돌린 뒤 구현합니다. 생성 파일은 커밋하고 머리에 GENERATED 를 적습니다. 빌드 없이 타입을 읽을 수 있어야 합니다. CI 가 생성 파일과 명세의 어긋남을 잡습니다.
3. 패키지마다 README 40줄 이내: 목적, 공개 API, 테스트 방법.
4. 한 파일 한 관심사, 400줄 이내. AI 는 파일을 통째로 읽습니다.
5. 접두사 고정: `desk-` (crate) · `@endue-ai/` (package) · `plugin-` (예제). 이름만으로 검색이 됩니다.
6. 테스트는 소스 옆에. Rust 는 모듈 안 + `crates/*/tests`, TS 는 `*.test.ts`. 앱 단위는 `e2e/`.
7. 되돌리기 어려운 결정은 `docs/adr/` 에 한 장씩. 왜 그렇게 했는지를 AI 도 읽습니다.
8. `examples/` 는 한 명령으로 돌아야 합니다. 플러그인 처음 만드는 사람과 AI 모두 여기서 복사합니다.
9. `plugins/` 의 기본 기능은 커뮤니티 플러그인과 같은 폴더 형식을 지킵니다. 형식이 두 개면 API 에 구멍이 생깁니다.

## GitHub 와 오픈소스 뼈대

뼈대는 파일 스무 개 남짓과 저장소 설정 몇 개입니다. 워크플로는 열세 개이고, PR 에서 도는 건 그중 가벼운 여섯이고, 사람만 건드릴 수 있는 곳(워크플로 · `specs/` · `brand/` · 서명 키)은 CODEOWNERS 와 보호 환경으로 잠급니다. 파일 트리의 `.github/` 를 펼치면 이렇습니다.

```text
.github/
├── workflows/
│   ├── ci.yml               # PR: Linux 에서 just check → 단위 → 계약 → red-on-base → 런타임(Playwright). macOS · Windows 는 check + 단위만. src-tauri · desk-sys 를 건드리면 3 OS 빌드까지
│   ├── e2e.yml              # main 병합 뒤와 야간: tauri-driver (Linux · Windows) 전체 + macOS 패키지 스모크. PR 에서는 e2e/ · plugins/ 를 건드릴 때만
│   ├── review.yml           # 작업 PR 의 검토 AI. 코드 변경은 전부, 문서 · 의존성 PR 은 건너뜀. specs · 권한 · 워크플로를 건드리면 강한 모델로
│   ├── scope-check.yml      # PR 이 이슈 Scope 밖 파일을 건드리면 실패. As-is/To-be 표의 행과 변경 파일이 서로 대응되는지도 확인
│   ├── security.yml         # PR: cargo deny · cargo audit · pnpm audit · gitleaks · dependency-review. CodeQL 은 main 과 주 1회
│   ├── plugin-validate.yml  # plugins/* · examples/* 변경 때만 (desk plugin validate)
│   ├── labeler.yml          # 경로 기준 자동 라벨 (area:* · size:*)
│   ├── release-build.yml    # canary · release 가 부름: 4 target 빌드 → updater 서명 · 공증 → 정규 이름 (ADR 0054)
│   ├── canary.yml           # main 마다: 빌드 → R2 업로드 → canary 인덱스, 2주 지난 canary 정리 (signing 환경, 사람 없음)
│   ├── promote.yml          # 주 1회 · 수동: 3일 넘게 canary 에 있던 가장 새 판을 beta 인덱스에 (재빌드 없음)
│   ├── release.yml          # 태그 v*: 빌드 → R2 → stable 인덱스 → GitHub Release(노트, 바이너리 없음) (stable 환경)
│   ├── rollback.yml         # 수동 실행: 한 채널 인덱스에서 한 판을 내림 (사람만, 롤포워드로 고침)
│   └── nightly.yml          # 전체 매트릭스 · 로컬 모델 적합성 · 성능 예산. 실패는 ai:ready 이슈로
├── ISSUE_TEMPLATE/
│   ├── bug_report.yml       # 폼: 재현 · 기대 · OS · 버전 · 로그
│   ├── feature_request.yml
│   ├── task.yml             # 사람이 쓰는 건 요구사항 한 칸. 계약(Scope · 인수 테스트 · 명세 변경 · 가정)은 기획 AI 가 채움
│   └── config.yml           # 질문은 Discussions, 보안은 SECURITY.md 로
├── PULL_REQUEST_TEMPLATE.md # 요구사항 원문 · As-is/To-be 표 · 가정과 결정 · 범위 밖 · 되돌리기 · 게이트 결과 (AI 작업 사이클 참고)
├── CODEOWNERS               # * 유지보수자. workflows/ · specs/ · brand/ 는 자동 병합 불가
├── dependabot.yml           # cargo · npm · github-actions 주간, 그룹으로 묶음. 패치 · 마이너는 게이트 통과 시 자동 병합
├── labels.yml               # area:* · kind:* · size:* · ai:ready · ai:needs-human · quarantine · good first issue
├── FUNDING.yml              # (선택)
└── SUPPORT.md
```

루트 문서

| 파일 | 내용 |
| --- | --- |
| README.md | 한 문단 약속(No fixed screens · Emacs 원칙) · 스크린샷 하나 · 빌드 3줄 · 텔레메트리 없음 |
| LICENSE | Apache-2.0 |
| TRADEMARK.md | endue 이름 · 로고 정책. 포크는 이름을 바꿈 |
| CONTRIBUTING.md | DCO · Conventional Commits · `just` 명령 · PR 크기 규칙 |
| SECURITY.md | 신고 메일 · 공개 기한 · 지원 버전 |
| CODE_OF_CONDUCT.md | Contributor Covenant |
| GOVERNANCE.md | 지금은 단독 유지보수자. 결정은 ADR 로 공개 |
| CHANGELOG.md | release-please 가 생성 |
| AGENTS.md | AI 진입점 (파일 트리의 규칙 참고) |

저장소 설정 (파일이 아닌 것)

- main 보호: 필수 체크 ci · scope-check · review(코드 변경 때), 스쿼시 병합만, 선형 히스토리. 작업 PR 은 사람 승인 1명 필수이고, 그 한 번이 승인 또는 거절입니다
- 환경 둘: `signing`(main 과 태그에서만 쓰는 서명 키 · updater 개인키 · R2 쓰기 토큰, 사람 승인 없음) · `stable`(태그 v* 게시 단계만, 사람 승인, 같은 키와 토큰). AI 토큰은 둘 다 접근 불가. 배포 원본은 Cloudflare R2 이고 GitHub Release 는 노트의 자리입니다(ADR 0054)
- 태그 보호: v* 태그는 유지보수자만 만듭니다. AI 토큰에는 contents:write 가 없습니다
- Secret scanning 과 push protection, Dependabot alerts 켬
- Discussions 켬: Q&A · 아이디어 · 플러그인 쇼케이스
- 포크에서 온 PR 에는 secrets 를 주지 않음 (`pull_request` 이벤트만 사용). 검토 AI 도 저장소 안 브랜치에만 돔
- Auto-merge 는 봇 PR(의존성 패치 · 마이너)에만. 작업 PR 은 사람이 승인합니다

## QA: 테스트 층

테스트는 아홉 층이지만 PR 마다 도는 건 Linux 에서 15분 안에 끝나는 다섯 층이고, 가운데의 계약 테스트가 Rust 와 TS, 로컬 두뇌와 클라우드 두뇌를 같은 벡터로 묶습니다. macOS 는 tauri-driver 가 없어서 런타임 테스트와 설치 스모크, 10분 수동 탐색으로 대신합니다.

| 층 | 무엇을 확인하나 | 도구 · 위치 | 언제 |
| --- | --- | --- | --- |
| 정적 | fmt · clippy -D warnings · biome · tsc strict · 명세 린트(JSON Schema · spectral) · 라이선스(cargo deny) | `just check` | PR 마다 |
| 단위 | 함수 · 모듈 | cargo test · vitest, 소스 옆 | PR 마다 |
| 인수 테스트 유효성 | PR 이 추가 · 수정한 테스트를 base 커밋에서 돌려 실패하는지 확인(red-on-base). base 에서도 통과하면 아무것도 검증하지 않는 테스트 | ci 잡. `kind:refactor` 는 제외 | PR 마다 |
| 계약 | `specs/*/vectors` 를 Rust · TS 양쪽이 통과. 두뇌 적합성(brain-echo 대상) · 플러그인 매니페스트 | `crates/desk-brain/tests/conformance.rs` · `packages/bridge` 테스트 | PR 마다 |
| 통합 (Rust) | 권한 엔진 시나리오(기본 거부 · 허락 · 회수 · 경로 범위) · 플러그인 호스트 수명(설치 · 핫리로드 · 크래시 격리) · VM 수명(부팅 · 폴더 마운트 · 멈춤) · 세션 임대(획득 · 해제 · 만료) | `crates/*/tests` | PR 마다 (VM 은 main · 야간) |
| 런타임 (웹) | 컴포지터 2D 결정적 렌더 · 표면 · 입력 라우팅 · 레이아웃 저장·복원 · Opening 장면 스냅샷(고정 시각) | Playwright + 브라우저 브리지 스텁, `packages/runtime/e2e` | PR 은 Linux, main 과 야간은 3 OS |
| 앱 e2e | 첫 실행 경로 · 플러그인 설치 · 권한 프롬프트 · 레이아웃 · updater · "Hey Eris"(테스트 훅) | WebdriverIO + tauri-driver, `e2e/specs` (Linux · Windows) | main 병합 뒤 · `e2e/` `plugins/` 변경 PR · 야간 |
| 설치 스모크 | 깨끗한 러너에 설치 → 실행 → ready 로그 → 서명 · 공증 검증(spctl · signtool) → 종료 | 셸 스크립트, `e2e/smoke` | canary · beta · stable 빌드마다, 3 OS |
| 성능 예산 | 시작 시간 · 유휴 메모리 · Opening 프레임 시간(WebKit) · VM 부팅 시간. 기준값은 첫 릴리스 측정치로 고정 | `e2e/perf/budgets.json` | 야간, 넘으면 실패 |

켜는 순서

처음부터 다 켜지 않습니다. 구조적인 다섯(정적 · 단위 · 계약 · red-on-base · 설치 스모크)은 저장소를 공개할 때 켜고, 나머지는 그 층이 잡을 첫 실패가 나타나는 단계에서 켭니다. 테스트는 유지 비용이 들고, 아직 없는 기능의 테스트는 AI 가 빈 걸 쓰게 됩니다.

1. 저장소 공개: 정적 · 단위 · 계약 · red-on-base · 설치 스모크
2. 플러그인 단계: 런타임 Playwright · 플러그인 검증 · 통합(Rust)
3. 두뇌 단계: 앱 e2e(Linux · Windows) · 두뇌 적합성 야간
4. 권한 · VM 단계: VM 수명 · 성능 예산 · 크래시 리포트(opt-in)

결정성 규칙

- 테스트 훅(`desk.test.*`)은 `test-hooks` feature 로만 켜지고 릴리스 빌드에는 없습니다. CI 가 릴리스 바이너리에 훅이 없는지 확인합니다.
- 애니메이션은 주입된 시계로 돌고, 난수는 시드를 받습니다. 스냅샷은 고정 시각에서 찍습니다.
- 플레이키: 3회 재시도 뒤에도 흔들리면 `quarantine` 라벨로 격리하고 이슈를 자동 생성합니다. 격리된 테스트는 병합을 막지 않지만 야간에 계속 돕니다.
- 두뇌 적합성은 PR 에서는 brain-echo 만, 야간에는 로컬 모델과 endue 스테이징까지 돌립니다.

테스트 폴더

```text
e2e/
├── wdio.conf.ts                  # WebdriverIO + tauri-driver
├── specs/                        # onboarding · plugins · permissions · layouts · updater
├── fixtures/                     # 테스트 플러그인 · 폴더 · brain-echo 시나리오
├── smoke/                        # install-and-launch · verify-signature (sh · ps1)
└── perf/                         # budgets.json · startup · idle-memory · opening-frames
packages/runtime/e2e/             # Playwright
specs/*/vectors/                  # 계약 벡터 (Rust · TS 공용)
crates/desk-brain/tests/conformance.rs
packages/plugin-sdk/src/testing/  # 플러그인 테스트 하네스 (가짜 런타임 + 모의 브리지)
docs/qa/                          # TESTING.md (어떤 변경에 어떤 테스트) · release-checklist.md (macOS 수동 탐색 포함)
```

## AI 작업 사이클 (하네스)

```text
 [사람] 요구사항 한 칸
    │
    ▼
 기획 AI ── 계약: Scope(허용 경로) · 인수 테스트 · 명세 변경 여부 · 가정 ──▶ ai:ready
    │
    ▼
 저자 AI ── 빨간 테스트 → 구현 → 초록 → codegen · 문서 · ADR ──▶ PR (As-is/To-be 표)
    │                                                               ▲
    ▼                                                               │ 수정 (CI 3회 · 검토 2회 예산)
 게이트(CI, Linux 15분) ──▶ 검토 AI (다른 세션) ──▶ [사람] 승인 / 거절(한 줄 이유) ──┘
                                                      │ 승인 = 병합
                                                      ▼
 main ──▶ canary (자동) ──▶ beta (3일 지나면 주 1회) ──▶ [사람] stable = 태그 v* ──▶ 문제면 rollback (사람)

 사람이 손대는 곳: 요구사항 입력 · PR 승인/거절 · stable 결정 (+ 롤백). 예산을 넘긴 루프만 ai:needs-human 으로 사람을 부른다.
```

하네스는 셋입니다. 계약(요구사항을 기획 AI 가 Scope · 인수 테스트 · 가정으로 옮긴 것과 `specs/`), 게이트(CI), 분리(기획 · 저자 · 검토 AI 는 서로 다른 세션). 사람이 손대는 곳은 세 군데입니다. 요구사항 입력, 끝난 PR 의 승인 또는 거절, stable 릴리스 결정. 나머지는 돌아가고, 돌다가 막히면 예산을 넘긴 시점에만 사람을 부릅니다.

| 누가 | 하는 일 | 드는 것 |
| --- | --- | --- |
| 사람 | 요구사항 한 칸 · PR 승인/거절(As-is/To-be 표를 보고) · stable 결정(태그 v*) · 롤백 | 하루 몇 분 |
| 기획 AI | 요구사항을 계약으로: Scope(허용 경로) · 인수 테스트 · 명세 변경 여부 · 가정. 되돌리기 어려운 갈림길에서만 질문을 모아 처음에 한 번 묻고, 아니면 가정을 적고 진행 | 이슈당 1회 |
| 저자 AI | 브랜치 `ai/<이슈>-<slug>` · 인수 테스트를 먼저 빨간 상태로 → 구현 → 초록 · codegen · 문서 · ADR 초안 · PR(As-is/To-be 표) | CI 3회 · 검토 2회 예산 |
| 검토 AI | 저자와 다른 세션. 표와 diff 일치 · 계약 충족 · 테스트가 동작을 검증하는지 · 권한 안전 · 파일 크기. specs · 권한 · 워크플로 변경이면 강한 모델 | 코드 PR 마다 1회 |
| 게이트 (CI) | scope-check · 정적 · 단위 · red-on-base · 계약 · 런타임 · (경로별) e2e · 크기 제한 | Linux 15분 |
| 릴리스 | main → canary(자동) → beta(3일 뒤 주 1회) → stable(사람이 태그). 실패는 자동 중단, 되돌리기는 사람 | R2, 데스크가 스스로 받는다 |

사이클

1. 사람이 요구사항을 씁니다. `task.yml` 의 한 칸이면 됩니다.
2. 기획 AI 가 계약으로 옮깁니다. Scope · 인수 테스트 · 명세 변경 여부 · 가정. 갈림길이 되돌리기 어려울 때만 질문을 모아 한 번 묻고, 아니면 가정을 적고 바로 `ai:ready` 가 됩니다.
3. 저자 AI 가 인수 테스트를 먼저 빨갛게 만들고(red-on-base 가 확인) 초록으로 바꿉니다. 명세가 바뀌면 같은 PR 안에서 `specs/` 커밋을 먼저 두고 codegen 과 계약 벡터를 같이 갱신합니다.
4. 게이트는 15분 안에 끝납니다. PR 은 Linux 중심이고, 3 OS 와 앱 e2e 는 경로가 걸릴 때와 main 에서 돕니다.
5. 검토 AI 가 다른 세션에서 봅니다. 수정 요청은 저자가 처리하고, 두 번 왕복해도 안 맞으면 멈추고 `ai:needs-human` 을 달습니다. 저자의 CI 재시도는 세 번까지입니다.
6. 사람이 PR 을 봅니다. 읽는 건 As-is/To-be 표와 스크린샷, 누르는 건 승인 또는 거절입니다. 거절에는 한 줄 이유를 적고, 저자 AI 가 같은 PR 에서 고칩니다.
7. 병합되면 canary 가 자동으로 빌드 · 서명 · 게시됩니다(R2, ADR 0054). canary 를 따르는 데스크는 받아 두었다가 사람이 "Restart to update" 를 누를 때 올라갑니다. 설치 스모크는 e2e 워크플로가 맡고, 3 OS 업데이트 스모크는 다음 단계입니다.
8. beta 승격은 주 1회입니다. 3일 넘게 canary 에 있던 가장 새 판이 beta 인덱스에 오릅니다. 새 크래시 조건(ADR 0007)은 크래시 리포트가 생기면 더합니다.
9. stable 은 사람의 결정 하나입니다. 유지보수자가 태그 v* 를 만들면 빌드 · 서명 · 게시 · GitHub Release 가 이어지고, 게시 단계는 `stable` 환경 승인을 기다립니다. 문제가 보이면 rollback 으로 그 판을 인덱스에서 내리고, 고친 판을 위로 냅니다.
10. 되돌림 경로: 게이트 · 검토 실패와 거절은 저자에게, 스모크 · 야간 · 크래시 실패는 `ai:ready` 이슈로. 모두 예산 안에서만 돌고 넘으면 사람을 부릅니다.

PR 의 모양

사람이 읽는 건 이 표 하나입니다. 검토 AI 와 scope-check 가 표의 행마다 변경 파일이 있고 변경 파일마다 표의 행이 있는지 확인하므로, 표에 없는 변경은 병합되지 못합니다. 아래 행은 예시입니다.

```markdown
## 요구사항
> (사람이 쓴 원문 그대로)

## As-is → To-be
| 영역 | As-is | To-be | 확인 방법 |
| --- | --- | --- | --- |
| 화면 | 설정에 해당 항목 없음 | 설정 > Eris 에 항목 추가 | 스크린샷 · 런타임 스냅샷 이름 |
| 동작 | 기본값으로만 동작 | 선택한 값으로 동작 | e2e 테스트 이름 |
| 명세 | bridge v0 에 인자 없음 | 선택 인자 추가 | 계약 벡터 파일 |
| 데이터 | 없음 | 설정 키 하나 저장 | 마이그레이션 없음 |

## 가정과 결정 (뒤집으려면 거절에 한 줄로)
## 범위 밖 (하지 않은 것)
## 되돌리기
## 게이트 결과 (자동 첨부)
```

AI 를 위한 준비물

- `AGENTS.md`(루트) 하나에 지도 · 명령 세 개 · 규칙 · 경계. 영역별로 짧은 `AGENTS.md` 는 선택. Claude Code 와 Codex 둘 다 읽습니다.
- 반복 절차는 저장소 스킬로: `.claude/skills/` 에 plan-task · new-plugin · spec-change · fix-ci · add-adr. Codex 는 같은 절차를 `AGENTS.md` 에 적습니다.
- 생성 코드는 커밋, 파일은 400줄 이내, 패키지마다 README 40줄, 결정은 ADR. AI 가 맥락을 한 번에 읽게 하는 장치들입니다.
- 예산: 이슈 하나에 저자 CI 3회 · 검토 왕복 2회 · 벽시계 24시간. 넘으면 멈추고 `ai:needs-human`. 돌고 도는 루프가 토큰을 태우지 않게 하는 장치입니다.
- 병렬 작업은 git worktree 로 이슈 하나에 하나씩. 같은 파일을 두 이슈가 만지면 기획 AI 가 순서를 정합니다.

목표 속도

- 요구사항 입력 뒤 2시간 안에 PR (기획 + 저자)
- 게이트 15분
- 사람의 PR 확인은 표 읽기 1분에서 3분
- 병합 뒤 30분 안에 canary 설치본
- 비용: PR 하나에 Linux 러너 15분 + 검토 AI 1회가 기본. macOS 러너는 main 과 야간에만

## 결정

MCP 도구는 가벼운 VM 으로 격리하고, 나머지는 데스크톱 오픈소스의 관례를 따릅니다. 결정마다 `docs/adr/` 에 한 장이 있고, 0026 · 0027 · 0028 · 0034 · 0036 은 아직 제안입니다(사람이 정함).

| 질문 | 결정 | 따른 관례 | ADR |
| --- | --- | --- | --- |
| 앱 셸 | Tauri 2. 앱이 작고 Rust 코어가 같은 프로세스에서 돎. 위험은 OS 마다 다른 웹뷰 | Tauri 앱 일반 | 0001 |
| MCP 도구 격리 | 가벼운 Linux VM 하나에서 실행. 허락한 폴더만 virtiofs 로 넣고, 통신은 vsock, 쉬면 VM 째로 멈춤. VM 을 못 띄우는 기기는 설치 때 "격리 없음"을 고지하고 사용자 권한으로 | Claude Cowork · Docker Desktop (macOS Virtualization.framework · Windows WSL2 · Linux KVM) | 0002 |
| 웹 런타임 번들 배포 | 앱과 함께. 따로 배포하지 않음. 플러그인만 따로 갱신 | VS Code · Electron 앱 일반 | 0003 |
| 플러그인 API 하위 호환 | v0 는 마이너마다 깨질 수 있음을 명시. v1 부터 직전 메이저를 6개월 지원하고, 제거 한 버전 전에 경고 | semver · VS Code 확장 API | 0004 |
| 마켓 심사 · 서명 | 자동 검증(매니페스트 · 권한 · 정적 스캔) + 게시 때 마켓이 서명. proc · net 광역 권한만 수동 심사 | VS Code Marketplace · Obsidian 커뮤니티 플러그인 | 0005 |
| macOS 앱 e2e | 런타임 Playwright + 설치 스모크 + stable 전 10분 수동. tauri-driver 가 macOS 를 지원하면 전환 | Tauri 프로젝트 일반 | 0006 |
| 크래시 리포트 | Sentry, opt-in, 기본은 꺼짐. 서명별 신규 크래시가 beta 승격 조건에 들어감 | Tauri 앱 일반 | 0007 |
| 자동 병합 범위 | 봇 PR(의존성 패치 · 마이너)만. 작업 PR 은 사람이 승인 |  | 0008 |
| 명세에서 타입 | `specs/` 에서 Rust · TS 타입을 자체 생성기로 만들고 커밋. 모르는 스키마 모양은 실패 |  | 0009 |
| 웹 런타임의 UI 프레임워크 | 없음. 평범한 TypeScript 와 DOM. 플러그인은 자기 프레임 안에서 자유 |  | 0010 |
| 런타임 스냅샷 | 픽셀이 아니라 직렬화한 렌더 트리 |  | 0011 |
| UI 플러그인 로드 | `desk-plugin` 스킴 · `sandbox="allow-scripts"` iframe · import map 의 SDK. 런타임이 프레임으로 호출자를 가림 |  | 0012 |
| 플러그인 애니메이션 | 주입된 시계에 맞춘 멈춘 Web Animations |  | 0013 |
| 두뇌 대화의 자리 | 코어가 세션 · 임대 · 전사를 갖고, 플러그인은 `brain.say` 와 `brain.turn` 으로만 |  | 0014 |
| 여러 AI 의 병렬 작업 | 한 trunk · Scope 레인 · 작업마다 worktree · 머지 큐 |  | 0015 |
| 사람의 설정 | `~/.desk/init.yaml`, endue 로 파일째 3-way 동기화 | Emacs `init.el` | 0016 |
| 기본 정책 | 데이터만 가진 `policy` 플러그인 `desk.*`, 정해진 순서로 겹침. 커맨드 레지스트리는 코어 하나(`cmd.*`) | Emacs `window.el` · `bindings.el` · `init.el` | 0017 |
| 로컬 e2e | macOS 에서는 Linux 컨테이너 안에서, 기계당 두 개까지 |  | 0018 |
| 로직 플러그인 | Wasmtime 위 `desk:host` 컴포넌트, 빈 WASI 0.2. 플러그인마다 store 와 메모리 · 시간 상한 |  | 0019 |
| `@endue-ai/ui` 컴포넌트 | 프레임워크 없는 custom element, 테마 토큰만 읽음 |  | 0022 |
| 프로필이 못 바꾸는 것 | 시스템 레이어: 프로필 전환 · 데스크톱 전환 · 에이전트 바 |  | 0023 |
| 에이전트 목록의 출처 | `specs/brain/v0` 에 에이전트 · 스페이스 · A2A 작업 | endue AI 의 모델을 그대로 | 0024 |
| 셸과 정책 | 셸이 런타임을 띄우고 그 커맨드 · 키 · 프로필 · 테마 · 세션을 씀 |  | 0025 |
| 셸의 자리 | 제안: `plugins/` 로 한 부분씩, API 가 생기는 대로. 창과 칸은 런타임에 남음 |  | 0026 (제안) |
| Eris 하나 | 제안: `plugins/eris` 가 남고 셸의 Eris 가 그리로 합쳐짐 |  | 0027 (제안) |
| 데스크 가장자리 | 제안: `plugins/{dock,toolbar,sidebar}` 가 남고 셸의 레일 · 아래 가장자리 · 에이전트 바를 받아들임 |  | 0028 (제안) |
| 연결한 데이터 | 항목은 모델 하나(봉투 + kind 여덟 + `record`), 뷰는 코드가 아니라 데이터, 커넥터는 계약 하나에 바인딩 둘(Wasm · MCP), 동작은 커맨드. `data:write` 는 없음 |  | 0032 |
| 항목 색인 | 따로 crate `desk-index`, 데이터 폴더의 SQLite 파일 하나(FTS5). 시간은 UTC 순간으로 비교하고, `data:read` 범위는 SQL 안에서 걸어 페이지가 모자라지 않음 |  | 0033 |
| Wasm 커넥터 | 제안: `desk:connector` world 의 컴포넌트를 플러그인 호스트가 돌림. 항목의 출처는 호스트가 찍고, 인스턴스와 커서는 커넥터 자기 저장소에 |  | 0034 (제안) |
| 캘린더 파일 | `endue.calendar` 가 자기 iCalendar 엔진을 갖고, 읽은 것은 모르는 속성까지 그대로 다시 씀 | RFC 5545 · RFC 5546 · RFC 7986 | 0035 |
| 통합 계층의 자리 | 제안: 코어가 `data.*` · `connector.*` · `view.*` · `catalog.get` 을 제공. 내장 커넥터 `desk.calendar` · `desk.reminders` 는 코어 안, 비밀 설정은 키체인 전까지 0600 파일 |  | 0036 (제안) |

## 열린 질문

- [ ] VM 이미지 크기와 첫 실행 때 받는 시간을 어디까지 허용할지
- [ ] beta 자동 승격 조건(3일 · 새 크래시 없음)을 첫 측정 뒤 어떻게 조정할지
- [ ] 검토 AI 를 저자와 다른 모델로 섞을지 (같은 모델은 같은 맹점을 가질 수 있음)
