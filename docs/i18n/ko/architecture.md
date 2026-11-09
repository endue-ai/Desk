> 이 문서는 [영문판](../../architecture.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다. 설계의 한국어 원본은 [desk-structure.md](../../ko/desk-structure.md)입니다.

# endue Desk 아키텍처

이 문서는 설계의 영문 요약입니다. 기준 문서는 `docs/ko/desk-structure.md`이며, 되돌리기 어려운 결정은
`docs/adr/`에 있습니다.

Desk는 하나의 앱으로 만든 하나의 OS입니다. Tauri 셸과 작은 Rust 코어가 웹 런타임을 싣고, 그 런타임 위의
설정과 키바인딩을 제외한 기능은 플러그인입니다. Emacs처럼 코어는 프리미티브만 갖고, 나머지는 모두 앱이 실행되는 동안 바꿀 수 있습니다.

설정 UI, 기본 키바인딩과 개인 설정 저장은 플러그인이 아닌 런타임 코어 기능입니다. 플러그인을 모두 꺼도 사용할 수 있으며, 플러그인은 추가 단축키를 제공할 수 있습니다. [ADR 0055](../../adr/0055-core-settings-and-keybindings.md).

셸과 화면은 바뀌는 중입니다. Desk는 Tauri와 OS 웹뷰에서 Chromium(CEF) 위의 Rust 셸로, 그다음 모든 창이
자기 프로세스에서 그리는 Desk만의 컴포지터로 옮겨 갑니다([ADR 0140](../../adr/0140-a-wgpu-compositor-over-cef-off-screen-surfaces.md)).
1단계가 진행 중이며, 그것이 나오기 전까지 도는 것은 아래에서 설명하는 Tauri 셸입니다. 단계는 계층 표 아래의
"셸과 화면이 가는 곳"에 있습니다.

## 한눈에 보기

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
 │ Tauri shell  windows · webviews · primitives (fs, proc, net,   │  rebuild
 │              audio)                                            │
 ├────────────────────────────────────────────────────────────────┤
 │ OS           macOS · Windows · Linux (signing, notarisation,   │  —
 │              OS permissions)                                   │
 └────────────────────────────────────────────────────────────────┘
```

위쪽 계층은 앱이 실행되는 동안 바뀌고, 아래쪽 계층은 앱 업데이트가 필요합니다. 기기 밖에 있는 것은 endue AI뿐입니다.
나머지는 모두 사용자의 컴퓨터에서 실행됩니다.

| 계층 | 폴더 |
| --- | --- |
| endue AI (클라우드) | 저장소 밖에 있습니다. 이 저장소에는 `specs/brain`과 `crates/desk-brain-endue`만 있습니다 |
| 플러그인 | `plugins/` · `packages/plugin-sdk` · `specs/plugin` · `specs/wit` · `examples/` |
| 웹 런타임 | `packages/runtime`: 컴포지터, UI 플러그인 호스트(ADR 0012), 그리고 ADR 0026이 정해질 때까지 데스크 셸(ADR 0025) · `packages/ui` |
| Desk 브리지 | `specs/bridge` · 통합 계층의 계약인 `specs/item`, `specs/view`, `specs/connector`(ADR 0032) · `packages/bridge` · `crates/desk-bridge` (이 계약들과 `specs/plugin`에서 생성한 타입) |
| Rust 코어 | `crates/desk-core`(통합 계층의 `data.*`, `connector.*`, `view.*`, `catalog.get`도 제공하고 OS 캘린더 위에 내장 커넥터 `desk.calendar`와 `desk.reminders`를 정의, 아직 제안 상태인 ADR 0036. http 커넥터는 매니페스트대로 코어가 직접 실행하고 토큰도 코어만 읽는다, ADR 0106) · `crates/desk-index`(SQLite 파일 하나에 두는 아이템 색인, ADR 0033) · `crates/desk-plugin-host`(로직 플러그인과 Wasm 커넥터를 Wasmtime에서 실행, ADR 0019 · 아직 제안 상태인 ADR 0034) · `crates/desk-vm` · `crates/desk-brain*` |
| Tauri 셸 | `apps/desk/src-tauri` · `crates/desk-sys` · `crates/desk-computer`(macOS의 컴퓨터 사용: 스크린샷, 접근성 트리, 입력, 앱). 코어가 이를 `computer:see`와 `computer:control` 아래 `computer.*`로 제공하며, 에이전트의 모든 동작은 사람의 승인을 기다립니다(ADR 0120, ADR 0123) |
| OS | `apps/desk/src-tauri/capabilities` · 릴리스 워크플로 (서명, 공증) |

## 셸과 화면이 가는 곳

지금 Desk는 OS 웹뷰 하나를 가진 Tauri 창 하나이고, 플러그인 창은 모두 그 한 페이지 안의 샌드박스 iframe입니다.
셸과 모든 플러그인이 한 프로세스와 한 메인 스레드를 나눠 쓰므로, 루프에 빠진 플러그인 하나가 데스크 전체를
멈추고, Linux에는 WebGPU가 없습니다. ADR 0140이 이것을 바꿉니다. 모든 창이 자기 프로세스에서 그리고, wgpu 위의
Desk 자체 컴포지터가 그 결과를 배치합니다.

```text
 desk (Rust, one process): winit · compositor (wgpu) · CEF host · core · updater
        │ surface             │ surface             │ surface              │ no surface
 web plugin             web plugin            native plugin          logic plugin
 (CEF renderer)         (WebGPU, 3D)          (its own process)      (Wasm, unchanged)
 each: its own process · its own main thread · its own GPU queue · a crash empties one window
```

| 단계 | 바뀌는 것 | 상태 |
| --- | --- | --- |
| 0 | Tauri 앱 위에서: 표면마다 `desk-plugin` 스킴의 자기 origin. 살아 있는 프레임은 보이는 창과 최근 포커스한 8개만. 무거운 작업은 worker로. 응답하지 않는 프레임은 그 창에서만 "기다리기" 또는 "멈추기"를 제안 | 진행 중 |
| 1 | 셸이 winit과 CEF 위의 Rust 바이너리(`apps/desk/shell`, ADR 0143)가 되어 지금의 셸 페이지를 띄우고, Tauri는 없어짐. 플러그인 iframe은 각각 자기 Chromium 렌더러. 앱 단위 e2e는 Chromium 원격 디버깅으로 구동(ADR 0144) | 진행 중 |
| 2 | 컴포지터(`crates/desk-compositor`)가 데스크를 그리고 표면마다 텍스처를 배치. 표면은 하나의 프로토콜로 말함(`specs/surface`, ADR 0141). CEF는 플러그인마다 화면 밖에서 렌더링. 창 관리자는 `packages/runtime`에서 Rust로 옮겨 감 | 예정 |
| 3 | 네이티브 플러그인: 표면 프로토콜과 브리지를 `desk.sock`으로 말하는 프로세스 | 예정 |

어느 단계에서도 플러그인 코드는 바뀌지 않습니다. 매니페스트, SDK, 브리지의 전송 형식은 그대로입니다. 플러그인은
자기 프로세스와 origin, 그리고 모든 OS에서의 WebGPU를 얻습니다. 살아 있는 프로세스는 보이는 창과 최근 포커스한
8개만 갖고, 나머지는 상태를 지닌 채 잠듭니다(ADR 0142). macOS의 개념 증명은 화면 밖 CEF 표면 30개를 wgpu로
합성하고 그 안에서 WebGPU를 돌렸으며, 렌더러 하나를 죽이는 동안에도 나머지 표면은 계속 그렸습니다. 가벼운
렌더러는 약 40 MiB였습니다(`spikes/compositor/README.md`). Windows와 Linux는 아직입니다.

## Emacs처럼, OS처럼

Emacs는 작은 C 코어 위에서 거의 모든 것을 Elisp로 실행하며, 실행 중에도 바꿀 수 있습니다. Desk도 같은 형태를
취하고, 각 부분에 운영체제식 이름을 붙입니다.

| 역할 | 운영체제 | Emacs | Desk |
| --- | --- | --- | --- |
| 커널 | 커널 | C 코어 | Rust 코어 |
| 시스템 콜 | syscall | Lisp 프리미티브 | Desk 브리지 API |
| 드라이버 | 디바이스 드라이버 | OS 연동 코드 | Tauri 셸 + Rust 크레이트 |
| 창 관리자 | 창 관리자 | 프레임 · 창 | 3D 캔버스 컴포지터 |
| 셸 | 터미널 셸 | M-x | Eris · 명령 팔레트 |
| 앱 | 애플리케이션 | 패키지 (Elisp) | 플러그인 (UI · Wasm · MCP) |
| 연결한 데이터 | 마운트한 파일 시스템 · 검색 색인 | Gnus 백엔드 · Org agenda | 커넥터 · 색인 하나에 모이는 아이템 · 뷰 (ADR 0032) · YAML 형식 하나면 어떤 출처든 그리는 유니버설 뷰 (ADR 0087) |
| 부트 설정 | init | init.el | `init.yaml` (프로필 + 플러그인 + 설정) |
| 패키지 관리자 | apt · brew | package.el · MELPA | 마켓플레이스 |
| 동작 재정의 | 없음 | advice · hook | 이벤트 훅 · 명령 재정의 |
| 계정 | 사용자 계정 | 없음 | endue ID |

여기서 여섯 가지 원칙이 나옵니다.

1. **작은 코어.** Rust 코어는 기능이 아니라 프리미티브(fs, proc, net, audio, ui)를 담습니다.
2. **내장 기능도 플러그인입니다.** Eris, 사이드바, 툴바, 프로필 전환은 커뮤니티 플러그인과 같은 API를 쓰므로,
   API에 빈틈이 없고 내장 기능조차 교체할 수 있습니다. 데스크의 기본 정책(화면을 둘 곳, 파일, 테마, 알림)도
   데이터만 가진 `desk.*` 플러그인입니다(ADR 0017). 데스크 셸(`mountDesk`)은 아직 아닙니다. 셸은 `packages/runtime`
   안의 코드이고(ADR 0025), 어디에 둘지는 아직 제안 상태인 ADR 0026이 정합니다. 그때까지 Eris는 `plugins/eris`와
   셸 안에 하나씩 두 번 있고(ADR 0027), 데스크의 가장자리도 독 · 툴바 · 사이드바 플러그인과 셸의 아래 가장자리 ·
   레일 · 에이전트 바로 두 번 있습니다(ADR 0028).
3. **모든 것은 명령입니다.** 클릭, 음성, 단축키, 에이전트가 모두 같은 명령을 호출합니다. 사람이 할 수 있는
   일은 Eris와 에이전트도 할 수 있습니다.
4. **실행 중에 바꿉니다.** 플러그인을 저장하면 다시 로드됩니다. 플러그인 상태는 코어 스토리지에 있으므로
   교체 후에도 유지됩니다.
5. **무엇에든 훅을 겁니다.** 어떤 명령이든 실행 전후에 훅을 붙이거나, Emacs의 advice처럼 아예 대체할 수
   있습니다.
6. **보기 전에 묻습니다.** 사람이 하든 에이전트가 하든, 모든 프리미티브 호출은 브리지의 권한 검사를
   거칩니다.

## 무엇이 얼마나 빨리 바뀌는가

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

안쪽으로 갈수록 변경 비용이 낮습니다. 사용자에게 재빌드는 자동 업데이트 후 재시작 한 번이고, 개발자에게는
컴파일, 서명, 공증까지 뜻합니다.

| 범위 | 다시 로드되는 것 | 목표 | 유지되는 것 |
| --- | --- | --- | --- |
| 즉시 (instant) | 변경된 플러그인 (iframe, Wasm 인스턴스 또는 MCP 프로세스) | 1초 미만 | 다른 서피스, 실행 중인 작업, 음성 대기 상태 |
| 재시작 (restart) | 웹 런타임 (창 새로고침) | 약 2초 | Rust 코어, MCP 도구, 실행 중인 CLI |
| 재빌드 (rebuild) | 앱 전체 (자동 업데이트 후 재실행) | 다운로드 시간 + 몇 초 | 저장된 상태, 프로필, 설치된 플러그인 |

개발도 같은 세 단계를 따릅니다. 플러그인 폴더는 저장하면 다시 로드되고, 웹 런타임은 Vite HMR을 쓰며,
Rust 코어는 `cargo watch`로 재빌드됩니다.

## 계약

`specs/`가 공개된 부분과 비공개 부분의 경계를 긋습니다. 브리지, 브레인, 플러그인 타입은 이 디렉터리에서
Rust와 TypeScript로 생성되며, 양쪽은 같은 벡터로 테스트합니다. 자세한 내용은 `specs/README.md`에 있습니다.
