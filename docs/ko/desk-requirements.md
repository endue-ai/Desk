# endue Desk 요구사항

2026-10-30 · Team endue

> 프로덕션 수준의 오픈소스 뼈대가 갖춰야 할 것을 층마다 번호를 붙여 적은 문서입니다. 구조는 `desk-structure.md` 가, 첫 실행은 `first-run-scenario.md` 가, 셸 UI 는 이슈 #21 이 맡습니다. 이 문서는 그 사이의 빈 곳, 곧 *무엇이 있어야 뼈대가 완성인가* 를 채웁니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다.

Desk 는 사용자가 자기 뜻대로 짜는 데스크입니다. 자유도가 높다는 건 해야 할 게 많다는 뜻이고, 그 비용은 기본 플러그인과 마켓플레이스가 흡수합니다. Emacs 가 그랬듯 코어는 작고 기능은 조합이며, 마켓플레이스까지 전부 오픈소스입니다. 에이전트가 필요하면 endue AI 에서 만들고, 로그인 하나로 어느 데스크에서든 같은 데스크가 됩니다.

## 약속

| # | 약속 | 뜻 | 지키는 요구사항 |
| --- | --- | --- | --- |
| 1 | 고정된 화면이 없다 | 표면은 만들고 나누고 저장한다. 모드가 화면을 통째로 바꾼다 | RT-02 · RT-07 |
| 2 | 기본 기능도 플러그인이다 | 팔레트·설정·권한 창까지 같은 형식. 역할을 다른 플러그인으로 갈아끼운다 | SYSP · BR-05 |
| 3 | 모든 것은 커맨드다 | 클릭·키·음성·Eris·에이전트·CLI 가 같은 레지스트리를 부른다 | CORE-04 · RT-03 · AG-03 |
| 4 | 들여다보기 전에 묻는다 | 사람이든 에이전트든 원시 기능은 권한 검사를 거친다. 허락은 보이고 회수된다 | CORE-02 · CORE-03 |
| 5 | 로그인 하나로 같은 데스크 | 설정·모드·플러그인 목록이 endue ID 로 따라온다 | SY-01 ~ SY-05 |
| 6 | 에이전트는 사용자다 | endue AI 의 에이전트가 여기서 일하고, 도구는 로컬에서 권한대로 돈다 | AG-01 ~ AG-10 |
| 7 | 오프라인에서도 데스크는 돈다 | 네트워크가 필요한 건 두뇌뿐. 나머지는 전부 기기 안 | RT-15 · CORE-15 |

사용자는 넷입니다. 쓰는 사람(기본값으로 일함), 꾸미는 사람(플러그인과 모드를 조합함), 만드는 사람(플러그인·테마·에이전트를 만듦), 그리고 에이전트(사람과 같은 커맨드를 자기 이름으로 부름). 요구사항은 넷 모두를 겨냥하고, 단계는 쓰는 사람이 첫날부터 일할 수 있게 하는 것부터 올라갑니다.

## 빌린 개념

Emacs 에서 *작은 코어 + 모든 것은 커맨드 + 실행 중에 고친다* 를, VS Code 에서 *기여 지점 + 격리된 확장 + 마켓플레이스 운영* 을 빌립니다. 둘 다 없는 것(에이전트 · 권한 · 계정)은 Desk 가 더합니다.

| 개념 | Emacs | VS Code | Desk | 요구사항 |
| --- | --- | --- | --- | --- |
| 작은 코어, 확장으로 기능 | C 코어 + Elisp | 코어 + 확장 호스트 | Rust 코어 + 플러그인 세 종류 | CORE |
| 화면 단위 | buffer · window · frame | editor · group · window | surface · pane · desktop · (OS 창) | RT-02 · RT-18 |
| 커맨드 | `interactive` · M-x | command · Command Palette | 커맨드 레지스트리 · 팔레트 · Eris | CORE-04 · RT-03 |
| 키맵 계층 | global · major · minor · local | keybindings.json + `when` | 전역 < 모드 < 표면 < 플러그인, `when` 문맥식 | RT-04 |
| 키 힌트 | which-key | Keyboard Shortcuts 편집기 | prefix 뒤 다음 키 목록, 팔레트에 키 표시 | RT-05 |
| 동작 바꿔치기 | hook · advice | (이벤트만) | 커맨드 before/after/around 훅 · override | CORE-05 |
| 설정 | `defcustom` · customize | settings.json + 스키마 + Settings UI | 매니페스트 스키마 → 생성된 설정 UI, 범위 | SET |
| 초기화 파일 | init.el | settings.json · profiles | `~/.desk/init.yaml`(#31) + 모드 · 키맵 · 레이아웃 파일 | SY-02 |
| 모드 | major/minor mode | profiles | 모드 = 플러그인 집합 + 설정 + 레이아웃 + 키맵 | RT-07 |
| 패키지 | package.el · MELPA · use-package | Marketplace · VSIX · extension pack | 공개 인덱스 레포 · 서명 · pack | MKT |
| 기여 지점 | autoload · define-key · add-hook | `contributes` | 매니페스트 `contributes` | BR-02 |
| 지연 로드 | autoload | `activationEvents` | `activation` | BR-03 |
| 격리 | 없음(한 프로세스) | 확장 호스트 프로세스 | iframe · Wasm · VM + 권한 엔진 | CORE-10 ~ 12 |
| 신뢰 | 없음 | Workspace Trust | grant · 광역 권한 경고 · 검증 안 된 플러그인 표시 | CORE-03 · MKT-05 |
| 자기 문서화 | `C-h k/f/v` describe | hover · 확장 상세 | describe: 키·커맨드·플러그인·권한·설정 | RT-06 |
| 메시지·로그 | `*Messages*` · `*scratch*` | Output · Log · Dev Tools | messages 표면 · scratch 표면 · 상태 검사기 | SYSP · RT-19 |
| 데몬·클라이언트 | `--daemon` · emacsclient | `code` CLI | `desk` CLI 가 소켓으로 실행 중 데스크를 부름 | PKG-02 · PKG-03 |
| 안전 모드·이등분 | `-Q` · bug-hunter | `--disable-extensions` · Extension Bisect | 안전 모드 · 플러그인 이등분 | CORE-09 |
| 테마 | custom theme | color · icon theme | 토큰 기반 테마 플러그인 | RT-09 · BR-05 |
| 터미널·파일 | term · eshell · dired | 통합 터미널 · 탐색기 | terminal · files 시스템 플러그인 | SYSP |
| 동기화 | dotfiles | Settings Sync | endue ID 가 설정 디렉터리를 옮김 | SYNC |
| 프로토콜 | — | LSP · DAP | MCP(도구) · specs/brain(두뇌) · specs/agent | AG-01 · CORE-11 |
| 온보딩 | `C-h t` tutorial | walkthroughs | onboarding 플러그인 + `walkthroughs` 기여 | SYSP · BR-02 |
| 웹 판 | — | vscode.dev | 브라우저 빌드(브리지 스텁) | BR-07 · DX-02 |
| 국제화 | — | `package.nls.json` | 플러그인 `locales` 기여 | RT-13 |

## 요구사항

표의 *현재* 는 `main` 의 `99ee07d`(2026-10-29) 기준(있음 · 일부 · 없음, 그 상태로 옮긴 PR 을 괄호에)이고, *단계* 는 아래 §단계의 번호입니다.

### Rust 코어 (CORE)

코어는 커널입니다. 기능이 아니라 원시 기능·권한·레지스트리·수명 관리만 갖고, 마켓·동기화·에이전트 런타임은 코어가 트레이트로만 아는 별도 crate 에 둡니다(PKG-01).

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CORE-01 | 브리지 v0 메서드를 전부 처리한다. `fs.write` · `fs.watch` · `proc.*` · `net.fetch` · `audio.capture.*` · `ui.*` 가 `unsupported` 가 아니다 | 일부 (37 중 14 가 통째로 `unsupported`: `net.fetch` · `audio.capture` ×2 · `ui.surface` ×2 · `perm.list` · `perm.answer` · settings ×3 · log ×2 · events ×2. `perm.request` once · always 와 남의 grant `perm.revoke` 는 일부. #43 · #55) | 1 |
| CORE-02 | grant 는 디스크에 남아 재시작 뒤 유지된다. 기간은 한 번 · 이번 세션 · 항상 중 하나. 호출자(런타임 · 플러그인 · 에이전트 · CLI)마다 따로 갖고, 사람이 언제든 목록을 보고 회수하며 `perm.changed` 로 알린다 | 일부 (메모리) | 1 |
| CORE-03 | 프롬프트 정책: 같은 요청을 반복해 묻지 않는다. 광역 권한(임의 `proc` · `net *`)은 경고 문구를 붙인다. 에이전트가 낸 요청은 에이전트 이름과 이유를 보인다. 사람이 정한 승인 정책(항상 묻기 · 세션 · 자동)을 따른다 | 일부 (#69: 광역 권한 경고 문구, 호출자 · 이유 · 기간을 보이는 프롬프트 창. 코어의 반복 질문 막기 · 승인 정책은 없음) | 1 |
| CORE-04 | 커맨드 레지스트리: id(reverse-domain) · 설명 · 인자 JSON Schema · 제공자 · 가용 조건(`when`). 등록 · 조회 · 호출은 브리지 `cmd.*` 로. 클릭 · 키 · 팔레트 · Eris · 에이전트 · CLI 가 같은 경로로 부르고, 호출마다 호출자가 기록된다 | 있음 (#55: 코어의 `cmd.*`, 인자 스키마 검사 · 호출자 기록. `when` 은 기록만 하고 아직 평가하지 않음) | 1 |
| CORE-05 | 훅과 advice: 커맨드마다 before · after · around 훅과 override. 순서와 소유자가 보이고, 플러그인이 내려가면 같이 풀린다. 남의 커맨드에 걸려면 `cmd:advise` 권한 | 없음 | 2 |
| CORE-06 | 이벤트 버스를 브리지로 연다. 코어 이벤트(perm · plugin · mode · agent · fs.changed …)를 구독 권한을 가진 호출자에게 호출자별로 거른다 | 일부 (내부 버스) | 1 |
| CORE-07 | 저장소: 호출자별 네임스페이스(있음) + 용량 상한 · 키 목록 · 삭제 · 내보내기. 플러그인을 지울 때 데이터를 남길지 묻는다. 스키마 버전과 마이그레이션 훅 | 일부 | 1 |
| CORE-08 | 플러그인 수명: 설치(폴더 · 마켓 · URL) · 갱신 · 제거 · 켜기 · 끄기 · 리비전 · 핫리로드 · 크래시 격리(하나가 죽어도 데스크는 산다) · 실패 이유 보고 | 일부 (폴더 · 핫리로드) | 1 · 2 |
| CORE-09 | 안전 모드와 이등분: `--safe` 는 시스템 플러그인만 켠다. 연속 크래시 3회면 안전 모드를 제안한다. 플러그인 이등분으로 범인을 찾는다 | 없음 | 1 · 2 |
| CORE-10 | 로직 플러그인 호스트: Wasmtime 컴포넌트. WIT `desk:host` 가 브리지 전체를 덮는다. 메모리 · CPU · 시간 상한, 핫리로드, 권한은 매니페스트에서 | 일부 (#68: Wasmtime 컴포넌트 · 메모리 · 시간 상한 · 리로드 · 매니페스트 권한. WIT `desk:host` 는 fs · net · ui.notify · perm.query · store 만) | 2 |
| CORE-11 | 도구 플러그인 감독: MCP 프로세스의 시작 · 헬스 · 재시작 · 중지, stdio 와 HTTP 전송, 도구 목록 캐시, 호출마다 권한 검사(폴더 · 호스트). VM 안 실행(ADR 0002)과 VM 없는 기기의 "격리 없음" 모드 | 없음 | 2 |
| CORE-12 | VM: 부팅 · vsock · 허락한 폴더만 virtiofs · 유휴 정지 · 이미지 갱신 · 부팅 시간 예산 | 없음 | 2 · 4 |
| CORE-13 | 두뇌 세션을 에이전트마다 하나씩 갖는다. 임대 · 전사 · 오프라인 재개는 세션마다 | 일부 (데스크에 하나) | 3 |
| CORE-14 | 도구 라우팅: 두뇌의 `tool.call` 을 로컬 도구 플러그인 또는 커맨드로 보내고, 권한 검사와 승인을 거쳐 `tool.result` 로 돌려준다 | 일부 (echo 도구 내장) | 3 |
| CORE-15 | 로컬 두뇌 어댑터(Ollama · llama.cpp)가 `specs/brain` 적합성을 통과한다. 두뇌는 설정에서 고르고 오프라인 대체가 된다 | 일부 (#42: Ollama. llama.cpp · 설정에서 고르기 · 오프라인 대체는 없음) | 3 |
| CORE-16 | 로그: 구조화(시각 · 호출자 · 레벨 · 메시지), 플러그인별 채널, 파일 순환, `log.*` 브리지로 읽기, 비밀 마스킹 | 없음 | 1 |
| CORE-17 | 데이터 배치: OS 관례 디렉터리(config · data · cache · logs). 설정은 텍스트 파일(SY-02). 전체 내보내기 · 가져오기 | 일부 | 1 |
| CORE-18 | `desk-core` 는 Tauri 없이 다른 셸(브라우저 스텁 · CLI · 테스트)에서 재사용된다 | 있음 | 1 |

### 셸과 원시 기능 (SYS)

Tauri 셸과 `desk-sys` 는 드라이버입니다. 검사는 하지 않고 코어가 허락한 호출만 실행합니다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| SYS-01 | fs: 원자적 write · notify 기반 watch(디바운스) · 심볼릭 링크와 권한 오류의 오류 코드 | 있음 (#63: 원자적 write · 디바운스 watch · 오류 코드. #55: 코어의 `fs.write` · `fs.watch`) | 1 |
| SYS-02 | proc: 셸 없는 spawn · PTY(portable-pty) · stdin/stdout/stderr 스트림 · 신호 · 환경 · cwd · 좀비 회수 | 있음 (#63: desk-sys `proc`. 터미널 변경: 코어가 `proc.*` 를 처리 — 권한 · 소유 · 이벤트 · off · 회수 때 종료, `core_proc.rs`) | 1 |
| SYS-03 | net: 호스트 allowlist · 범위 밖 리다이렉트 금지 · 타임아웃 · OS 프록시 존중. 스트리밍 바디는 뒤에 | 일부 (#63: desk-sys `net`, 호스트 allowlist · 리다이렉트 검사 · 타임아웃 · 프록시는 환경 변수. 코어는 아직 `unsupported`) | 1 |
| SYS-04 | audio: cpal 캡처 · 장치 선택 · 온디바이스 호출어 · 오디오는 브리지로 나가지 않는다(v0) | 없음 | 3 |
| SYS-05 | ui 원시: 네이티브 알림 · 파일/폴더 선택 창 · 외부 링크 열기 · 클립보드(1) · 다중 창 · 전체 화면 · 항상 위 · 트레이 · 전역 단축키(4) | 없음 | 1 · 4 |
| SYS-06 | 토큰과 비밀은 OS 키체인(Keychain · Credential Manager · libsecret)에만 | 없음 | 3 |
| SYS-07 | `endue://` 딥 링크: 로그인 콜백 · 플러그인 설치 링크 · 커맨드 호출(권한 검사 뒤) | 없음 | 3 |
| SYS-08 | Tauri capability 는 창마다 최소. 셸이 노출하는 커맨드는 `bridge_call` 하나 | 있음 | 1 |
| SYS-09 | updater: 채널(canary · beta · stable) · 서명 검증 · 재시작 시점 선택 · 롤백 | 일부 (ADR 0054, `updater-requirements.md`: #274 계약 · #294 R2 게시 · 롤백. 데스크 쪽은 #278 · #296 · #297) | 1 |
| SYS-10 | `desk-plugin://` 스킴: 플러그인 파일 서빙 · CSP · 리비전으로 캐시 무효화 | 있음 | 1 |

### 브리지와 명세 (BR)

`specs/` 가 열림과 닫힘의 경계입니다. 새 기능은 명세에 먼저 적고 `just codegen` 뒤에 구현합니다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| BR-01 | 네임스페이스 추가: `cmd`(register · unregister · list · invoke · advise) · `settings` · `log` · `dialog` · `clipboard` · `shell.open`(1), `mode` · `events`(1), `agent` · `sync`(3). 각각 권한 어휘를 같이 더한다 | 일부 (#43: `cmd` · `settings` · `log` · `events`. advise · `dialog` · `clipboard` · `shell.open` · `mode` · `agent` · `sync` 는 없음) | 1 · 3 |
| BR-02 | 매니페스트 `contributes`: commands · keybindings(`when`) · settings(JSON Schema) · surfaces(있음) · menus · themes · tools · locales · walkthroughs | 일부 (#55: commands · keys · display · files · themes · settings · profiles, surfaces. menus · tools · locales · walkthroughs · 키의 `when` 은 없음) | 1 |
| BR-03 | `activation`: onStartup · onCommand · onSurface · onEvent · onMode. 안 쓰는 플러그인은 뜨지 않는다 | 없음 (켜져 있으면 모두 마운트) | 1 |
| BR-04 | `engines.desk` 범위와 `dependencies`(다른 플러그인 id@range). validate 가 둘 다 검사한다 | 없음 | 2 |
| BR-05 | kind 추가: `theme`(토큰만) · `pack`(플러그인 묶음 + 설정 = 모드 템플릿) · `agent`(AG-01). `provides` 로 역할(`role:palette` · `role:settings-ui` …)을 선언하고 설정에서 역할의 제공자를 고른다 | 일부 (#55: kind `policy`. `theme` · `pack` · `agent` · `provides` 는 없음) | 2 |
| BR-06 | 권한 어휘 확장: `cmd:invoke`(ids glob) · `cmd:advise` · `clipboard:read` · `clipboard:write` · `dialog` · `shell:open` · `settings:read`(남의 키) · `events:subscribe`(1), `agent:*`(3) | 일부 (#43: `cmd:invoke` · `cmd:advise` · `settings:read` · `log:read` · `events:subscribe` · `perm:manage`. clipboard · dialog · shell · agent 권한은 없음) | 1 · 3 |
| BR-07 | 브라우저 어댑터 동등성: `browserStub` 이 모든 메서드를 알고, 브라우저 빌드가 Tauri 없이 데스크를 띄운다(메모리 fs · 가짜 proc) | 일부 | 1 |
| BR-08 | 벡터와 codegen 유지. 메서드 · 이벤트 · 권한 · 매니페스트 레퍼런스를 명세에서 생성해 문서 사이트에 올린다 | 일부 (codegen · #71: `just docs-api` 가 명세에서 레퍼런스를 생성. 사이트 게시는 없음) | 1 |
| BR-09 | v1 경로: `deprecated` 표시 · 호환 표 · 제거 한 버전 전 경고(ADR 0004) | 없음 | 2 |

### 웹 런타임 (RT)

런타임은 창 관리자입니다. 셸 UI 의 모양은 이슈 #21 이 정하고, 여기서는 그 위에 있어야 할 기능을 적습니다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| RT-01 | 셸 UI(#21): 모드 · 데스크톱 1–4 · 에이전트/스페이스 바 · Eris · 상태 레일 · 아래 가장자리 · 모드가 못 옮기는 시스템 레이어 · ⌘N · 분할 · 키 재바인딩 | 일부 (#70: 전부 런타임에 있고 `pnpm dev` 의 브라우저 스텁 위에서 돎. Tauri 앱은 아직 `createRuntime` 만 띄움) | 1 |
| RT-02 | 표면 모델: pane 트리(분할 · 탭 · 플로팅 · 오버레이) · 포커스 링 · 표면 간 드래그 · 크기 제약 · 데스크톱 간 이동 · 이름 붙인 레이아웃 저장 · 복원 | 일부 (placement 6종 · 레이아웃 저장 · #55 desk.session 복원 · #70 칸 분할 · 셸의 떠 있는 창 · 데스크톱 1–4. 탭 · 표면 간 드래그는 없음) | 1 |
| RT-03 | 커맨드 팔레트: 모든 커맨드를 이름 · 설명 · 키로 검색, 최근 · 빈도 정렬, 인자 입력(completing-read), 플러그인이 공급자(파일 · 설정 · 플러그인 …)를 더한다 | 일부 (#55 `desk.palette`: 이름 · 키 검색, 최근 실행 순, `desk.palette.pick`(completing-read). 플러그인 공급자는 없음) | 1 |
| RT-04 | 키맵 계층: 전역 < 모드 < 표면 < 플러그인-로컬. `when` 문맥식(포커스 표면 · 모드 · 플랫폼 · 설정) · 키 시퀀스(prefix) · 충돌 표시 · 사용자 바인딩은 텍스트 파일 | 일부 (#55 `desk.keys`: 계층 · 프레임 안의 키 · #70 재바인딩 `desk.keys.bindings`. `when` · prefix · 텍스트 파일은 없음) | 1 |
| RT-05 | 키 힌트: prefix 뒤 멈추면 다음 키 목록, 팔레트와 메뉴에 현재 키 표시 | 없음 | 2 |
| RT-06 | describe: 키 · 커맨드 · 플러그인 · 권한 · 설정 아무거나 "이게 뭐야" — 문서 · 제공자 · 현재 바인딩 · 최근 호출 | 없음 | 2 |
| RT-07 | 모드: 플러그인 집합 + 설정 + 레이아웃 + 키맵. 전환은 커맨드, 저장은 텍스트 파일, 기본값은 pack 에서 온다. 모드 안의 변경은 그 모드에만 남는다 | 일부 (#55 `desk.profiles`: 플러그인 집합 + 설정, 전환은 커맨드 · #70 `desk.shell.mode` 레이아웃. 텍스트 파일 저장 · pack 은 없음) | 1 |
| RT-08 | 설정 UI: 스키마에서 생성, 검색, 범위 표시, 즉시 적용, "파일로 열기" | 없음 | 1 |
| RT-09 | 테마: 토큰 기반 밝음 · 어두움 · 고대비, 시스템 따라가기, 테마 플러그인, iframe 에 CSS 변수로 주입 | 있음 (#55 `desk.theme`: 밝음 · 어두움 · 고대비 · 시스템 따라가기 · 테마 기여 · 프레임에 `--desk-*`. #72 `tokens.css`) | 1 · 2 |
| RT-10 | 알림 센터: `ui.notify` 수신 · 레벨 · 행동 버튼 · 기록 · 방해 금지 | 일부 (#55 `desk.notify`: 상태 줄 · 레벨 · 방해 금지 · 기록. 행동 버튼은 없음) | 1 |
| RT-11 | 입력 라우팅: 키보드 · 포인터 · 음성 · 에이전트가 같은 커맨드 큐로. IME · 포커스 트랩 · 표면 간 탭 이동 | 일부 | 1 |
| RT-12 | 접근성: 키보드만으로 전부, 스크린 리더(이름 · aria-live), 동작 줄이기, 글자 배율, 양쪽 테마 대비 테스트 | 일부 | 1 |
| RT-13 | 국제화: 런타임과 시스템 플러그인 문자열 번들(en · ko · ja · zh · fr · de), 플러그인 `locales`, 날짜 · 숫자 로케일 | 없음 | 2 |
| RT-14 | 플러그인 호스트: 활성화 이벤트 · 표면별 오류 경계(죽은 표면만 "다시 열기") · 메모리 압박 때 안 보이는 표면 내리기 · 메시지 묶음 | 일부 | 1 |
| RT-15 | 오프라인: 두뇌 연결 상태가 레일에 보이고, 로컬 커맨드는 모두 그대로 동작한다 | 일부 (offline 문장 · #70 레일의 두뇌 상태, 브라우저 스텁 위) | 1 |
| RT-16 | 성능 예산: 두 번째 실행 1.2초 · 입력→화면 16ms · 유휴 메모리 상한 · 표면 100개. 첫 릴리스 측정값을 기준으로 고정 | 일부 (opening 만) | 1 · 4 |
| RT-17 | 3D 컴포지터(Three.js): 2D 와 같은 렌더 트리, WebGL 없으면 2D, 동작 줄이기 존중 | 없음 | 4 |
| RT-18 | 다중 창: 표면을 OS 창으로 떼어 낸다 | 없음 | 4 |
| RT-19 | 상태 검사기: 렌더 트리 · 레이아웃 · 커맨드 큐 · 이벤트를 보는 개발자 표면 | 없음 | 2 |

### 기본 패키지 (PKG)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| PKG-01 | crate 분리: `desk-core` 는 커널만. `desk-market`(인덱스 · 서명 검증 · 설치) · `desk-sync`(endue ID · 동기화) · `desk-agent`(에이전트 런타임 · 도구 라우팅)는 따로 두고 코어는 트레이트로만 안다 | 없음 | 2 · 3 |
| PKG-02 | `desk` CLI: `dev` · `plugin new` · `plugin validate` · `plugin pack` · `plugin publish` · `cmd list` · `cmd run` · `perm list` · `perm revoke` · `log tail` · `doctor` · `brain ping` · `state export` · `state import`. AI 와 스크립트의 손 | 일부 (validate) | 1 · 2 |
| PKG-03 | 로컬 IPC: 실행 중 데스크와 CLI 사이 유닉스 소켓 / named pipe. 같은 사용자만, 봉투는 브리지 그대로, 권한은 CLI 호출자로 | 없음 | 1 |
| PKG-04 | `@endue-ai/plugin-sdk`: UI(있음) + 로직(WIT 바인딩 · Rust/TS 템플릿) + 도구(MCP 매니페스트 헬퍼) + `commands.register` · `keybindings` · `settings` · `i18n.t` · `theme.tokens` + 테스트 하네스 확장 | 일부 | 1 · 2 |
| PKG-05 | `@endue-ai/ui`: 토큰(있음) + CSS 시트 + 프레임워크 없는 웹 컴포넌트 소수(button · input · list · dialog · menu · toast). iframe 안에서 import map 으로 쓴다 | 있음 (#72: `tokens.css` · desk-button · input · list · dialog · menu · toast, import map 으로) | 1 |
| PKG-06 | `@endue-ai/bridge`: tauri · browser 어댑터(있음) + 소켓 어댑터, 메서드 메타(문서 · 권한) 노출 | 일부 | 1 |
| PKG-07 | `@endue-ai/create-plugin`: `pnpm create @endue-ai/plugin` — ui · logic(rust · ts) · tool(ts · python) · theme · pack 템플릿, 테스트와 validate 포함 | 일부 (#34: ui 템플릿만) | 2 |
| PKG-08 | `@endue-ai/runtime` 은 앱과 함께(ADR 0003) 배포되고, 브라우저 진입점을 따로 갖는다 | 일부 | 1 |

### 시스템 플러그인 (SYSP)

데스크가 돌려면 역할마다 제공자가 하나 있어야 합니다. endue 가 싣는 기본 제공자가 아래 목록이고, 전부 커뮤니티 플러그인과 같은 형식이며 `provides` 역할(BR-05)로 갈아끼울 수 있습니다. 다만 지금 셸의 Eris · 에이전트 바 · 레일 · 아래 가장자리는 런타임 코드입니다(ADR 0026 · 0027 · 0028, 제안).

| 플러그인 | 역할 | 기여 | 현재 | 단계 |
| --- | --- | --- | --- | --- |
| `eris` | 비서. 소울 텍스트 · 구체 · 대화 · 모든 커맨드 호출(AG-10) | `brain:converse` · 커맨드 `eris.*` | 있음 (셸에도 따로 하나, #70 · ADR 0027) | 1 |
| `agents`(옛 `sidebar`) | 왼쪽 바: 에이전트 · 스페이스 | `agent:*` · 표면 left | 일부 (`plugins/sidebar` 는 플러그인 목록 토글 · #70 셸의 에이전트 바, 런타임 코드 · ADR 0028) | 1 |
| `rail`(옛 `toolbar`) | 오른쪽 상태 레일: 연결 · 두뇌 · 작업 | 표면 right | 일부 (#35 `plugins/toolbar` 의 서랍 · #70 셸의 레일, 런타임 코드 · ADR 0028) | 1 |
| `dock` | 저장한 레이아웃 · 실행 중 작업 | 표면 bottom | 일부 (#35 `plugins/dock` 의 플러그인 타일 · #70 셸의 아래 가장자리, 런타임 코드 · ADR 0028) | 1 |
| `modes` | 모드 전환 · 저장 · pack 적용 (RT-07) | `mode.*` · 커맨드 `mode.*` | 일부 (#55 `desk.profiles` · #70 `desk.shell.mode`. pack 적용은 없음) | 1 |
| `onboarding` | 첫 실행 장면 1–10 · walkthrough | `audio:capture` · 표면 overlay | 일부 (#41: 장면 1–10. walkthrough 는 없음) | 1 |
| `palette` | 커맨드 팔레트 (RT-03) · 역할 `role:palette` | `cmd:invoke *` · 표면 overlay | 일부 (#55 `desk.palette`. 역할 `role:palette` 은 없음) | 1 |
| `settings` | 설정 UI (RT-08) · 역할 `role:settings-ui` | `settings:read` · 표면 center | 없음 | 1 |
| `keybindings` | 키 편집 · 충돌 · 키 힌트 (RT-04 · 05) | 키맵 파일 쓰기 | 일부 (#55 `desk.keys` · #70 재바인딩 화면, 런타임 코드. 키 힌트 · 키맵 파일은 없음) | 1 · 2 |
| `plugins` | 설치됨 · 마켓 · 업데이트 · 권한 보기 · 안전 모드 | `plugin:manage` · 마켓 | 없음 | 1 · 2 |
| `permissions` | 모든 grant 목록 · 회수 · `perm.request` 의 사람 쪽 창 · 역할 `role:prompter` | `perm.*` | 일부 (#69 `endue.permissions`: grant 목록 · 회수 · 프롬프트 창. 코어는 `perm.list` · `perm.answer` 가 아직 `unsupported`) | 1 |
| `notifications` | 알림 센터 (RT-10) · 역할 `role:notifier` | `ui.notify` 수신 | 일부 (#55 `desk.notify`: 상태 줄 · 레벨 · 방해 금지 · 기록. 역할 `role:notifier` 는 없음) | 1 |
| `messages` | `*Messages*`: 로그 · 오류 · 최근 커맨드 | `log.*` | 없음 | 1 |
| `theme-endue` | 기본 테마 밝음 · 어두움 | kind `theme` | 있음 (#55 `desk.theme`: 밝음 · 어두움 · 고대비. kind `theme` 대신 `contributes.themes`) | 1 |
| `help` | describe (RT-06) · 단축키 치트시트 · walkthrough 목록 | `cmd.list` · 키맵 읽기 | 없음 | 2 |
| `files` | 허락한 폴더 보기(dired): 열기 · 드래그 · 감시 | `fs:read` · `dialog` | 일부 (#55 `desk.files`: 여는 규칙 · 최근 · 저장 · 되돌리기 · 디스크 변경. 폴더 보기는 `endue.explorer`, `plugins/explorer`: 트리 · 열기 · 감시 · 드래그 내보내기 · 새 파일. 쓰기 작업과 `dialog` 는 없음, `explorer-requirements.md`) | 2 |
| `terminal` | PTY 표면(term) | `proc:spawn` pty | 일부 (터미널 변경: `endue.terminal`, 셸 · 탭 · 버퍼 · 테마 · 키 · `run`. 요구사항은 `terminal-requirements.md`, 에뮬레이터는 ADR 0037) | 2 |
| `scratch` | 빈 텍스트 표면, 저장 안 해도 남음 | store | 없음 | 2 |
| `account` | endue ID 로그인 · 상태 · 동기화 (SYNC) | `sync.*` | 없음 | 3 |

### 기본 플러그인 (BASE)

쓰는 사람이 첫날부터 일하게 하는 최소입니다. 지울 수 있고, 나머지는 마켓에서 옵니다. 목록은 첫 실행 시나리오의 장면 6–8 이 쓰는 것만 담았고, 그 밖은 Eris 가 맥락에서 권합니다(MKT-09).

| 플러그인 | 역할 | 단계 |
| --- | --- | --- |
| `notes` | 마크다운 메모 표면, 폴더에 파일로 저장 | 2 |
| `git` | 키보드 중심 Git 표면: 상태 · 스테이징 · 커밋 · 로그 그래프 · diff. 모든 동작이 커맨드. 요구사항은 `git-plugin-requirements.md` | 2 |
| `database` | PostgreSQL · MySQL / MariaDB · SQLite 클라이언트: 연결 · 탐색기 · SQL 콘솔 · 결과 · 읽기 전용과 운영 DB 보호. 엔진의 공식 CLI 를 셸 없이(ADR 0038). 요구사항은 `database-plugin-requirements.md` | 2 |
| `docker` | 컨테이너 관리 표면: 컨테이너 · Compose · 이미지 · 볼륨 · 네트워크, 따라가는 로그 · 상세 · 셸 · 정리 · 실패 알림. 모든 동작이 커맨드. 요구사항은 `docker-plugin-requirements.md`, CLI 를 쓰는 이유는 ADR 0039 | 2 |
| `sheets` | 스프레드시트를 한 그리드로: Excel(xlsx · xls · xlsb) · Numbers · ODS · CSV/TSV(구분자 · 인코딩 자동, EUC-KR 포함) · DIF · SYLK · Lotus · Quattro · Google Sheets 바로가기. 시트 탭 · 수식 바 · 찾기. SheetJS 를 vendoring(ADR 0043). 큰 통합 문서는 범위 읽기와 워커 파싱, `<desk-progress>` 와 취소 | 2 |
| `docs` | 워드 문서를 한 페이지 뷰로: Word(docx · doc) · ODF · RTF · HWPX · HWP 5.0 · AbiWord 는 서식 그대로, WordPerfect/Works 는 텍스트, Pages 는 미리보기, Google Docs 는 바로가기. 개요 · 주석 · 찾기, 링크는 `shell.open` 으로. 한 문서 모델과 자체 리더, 범위 읽기 · `<desk-progress>` · 8 MiB 넘는 파일은 워커 | 2 |
| `slides` | 프레젠테이션을 한 뷰어로: PowerPoint(pptx · ppt, 둘 다 보이는 그대로) · ODP · Keynote(미리보기) · Google Slides 바로가기. 썸네일 레일 · 발표자 노트 · 재생 모드, pptx · ODP 의 링크는 `shell.open` 으로, 슬라이드 이동은 덱 안에서. 범위 읽기 · `<desk-progress>` · 8 MiB 넘는 파일은 워커 | 2 |
| `reader` | PDF · 전자책 · 만화를 한 리더로: PDF(pdf.js vendoring, ADR 0042) · XPS · EPUB · MOBI/KF8 · FB2 · CBZ/CBT, `endue.formats` 로 CBR · CB7 · DjVu. 목차 · 검색 · 북마크 · 노트, 링크는 `shell.open` 으로. 큰 PDF 는 필요한 범위만 읽고, 디코딩은 워커, `<desk-progress>` 와 취소 | 2 |
| `images` | 이미지를 한 뷰어로: 웹 포맷 · HEIC · JPEG XL · TIFF(WebKit 이 해독하는 곳에서) · 자체 디코더(TGA · Netpbm · QOI · DDS · HDR · EXR · ICNS · KTX · DICOM · FITS · NIfTI) · RAW 내장 미리보기. 확대 · EXIF · 폴더 넘기기 · 비교. 범위 읽기 · `<desk-progress>` · 8 MiB 넘는 파일은 워커에서 해독 | 2 |
| `player` | 영상 · 음성을 한 플레이어로: `fs.url` 스트리밍(ADR 0041), WebKit 이 못 트는 컨테이너는 코덱 정보, MIDI · AU 는 플러그인이 직접 재생. 자막(SRT · VTT · ASS · SAMI 등) · 재생목록 · 이어 보기 | 2 |
| `data` | 구조화 데이터 · 설정 파일을 트리와 원문으로: JSON 계열 · YAML · TOML · XML · plist · INI · properties · dotenv · HCL · MessagePack · CBOR · BSON. 검색 · JSON Schema 검증 · 비밀 값 가림. 1 MiB 넘는 파일은 워커가 파싱 · 검색 · 검증하고 화면엔 가린 줄만 보낸다 | 2 |
| `archives` | 압축 · 패키지 · 디스크 이미지를 한 트리로: ZIP 계열 · tar(gzip · bzip2 · xz · zstd · LZ4) · 7z · RAR 4/5 · ISO · deb · rpm · gem · pkg · cab, 디스크 이미지(MBR · GPT · VHD · VHDX · VMDK · QCOW2 안의 FAT · exFAT · ext · NTFS, DMG 안의 HFS+ · APFS, SquashFS · Snap · AppImage, WIM)는 파티션과 파일까지. 미리보기와 안전한 풀기(zip-slip 차단). ARJ · LHA · MSI 는 목록만, torrent 는 상세 정보. 디코더는 `endue.formats`, 범위 읽기(ADR 0041) · `<desk-progress>` | 2 |
| `web` | 저장한 웹 페이지 · 웹 아카이브 · 링크 파일 · 피드를 안전하게: allowlist sanitizer 를 거쳐 shadow root 에(ADR 0044), MHTML · webarchive · WARC · MAFF, url · webloc · desktop · lnk 는 카드, RSS · Atom · OPML. 스크립트는 돌지 않고 네트워크는 쓰지 않는다. 바깥 링크는 `shell.open` 으로 브라우저에. 8 MB 넘는 페이지 · 아카이브는 워커에서 읽고, 큰 페이지는 조각으로 그린다 | 2 |
| `formats` | 라이브러리 플러그인(kind `library`): 파일 플러그인들이 같이 쓰는 포맷 리더 · 디코더 한 벌(codecs · 7z · RAR · DjVu · PC 디스크 · Apple 디스크 · SquashFS/WIM). 진입점 · 표면 · 권한이 없고 끌 수 없으며, 가져다 쓰는 플러그인의 프레임(이나 워커)에서 그 플러그인의 권한으로 돈다. `@endue-ai/formats/` import map 으로 가져온다(`archives` · `reader`) | 2 |
| `calendar` · `mail` | endue 커넥터 표면 (장면 6 · 7) | 3 |
| `tasks` | 할 일 보드 (장면 8 "Plan my week") | 3 |
| `agent-chat` | 에이전트별 대화와 활동 기록 표면 (AG-05) | 3 |
| `space` | 스페이스 보드: 에이전트 여럿과 사람이 함께 쓰는 표면 (AG-06) | 3 |

### 마켓플레이스 (MKT)

마켓은 서버가 아니라 공개 git 레포의 정적 인덱스입니다(MELPA · Obsidian 방식). 심사와 서명은 ADR 0005 를 따릅니다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MKT-01 | `specs/market/v0`: 항목(id · version · kind · permissions · engines · hash · signature · publisher · repo · license) · 전체 인덱스 + 증분 · 정적 파일. 인덱스 레포는 공개 | 없음 | 2 |
| MKT-02 | 게시: `desk plugin pack` → 인덱스 레포 PR → CI 자동 검사(validate · 권한 · 정적 스캔) → 마켓 서명 → 인덱스 갱신. 광역 `proc` · `net` 권한은 수동 심사 라벨 | 없음 | 2 |
| MKT-03 | 설치 검증: 서명 · 해시 · `engines` 확인. 권한 차이를 설치 전에 보이고, 업데이트가 권한을 늘리면 다시 묻는다 | 없음 | 2 |
| MKT-04 | 채널: stable · pre-release. 자동 업데이트 선택 · 버전 고정 | 없음 | 2 |
| MKT-05 | 개발 설치: 폴더 · git URL · `endue://install` 링크. "검증 안 됨" 표시가 늘 보인다 | 일부 (`DESK_DEV_PLUGINS`) | 1 · 2 |
| MKT-06 | 인덱스 URL 은 설정이고 여럿을 합친다(사내 마켓 · 미러) | 없음 | 2 |
| MKT-07 | 게시자: endue ID 연결 · 도메인 증명 · 신고와 내리기 절차 · 라이선스 필드 필수 | 없음 | 2 |
| MKT-08 | 의존성 해결과 pack 설치(= 모드 템플릿) | 없음 | 2 |
| MKT-09 | 마켓 UI 는 `plugins` 플러그인 안 탭. 검색 · 분류 · 권한 표시. Eris 추천은 사용자가 켠 경우에만 맥락에서 | 없음 | 2 |

### 에이전트 (AG)

에이전트는 endue AI 에서 만들고, 데스크에서 일합니다. 에이전틱 루프는 endue AI 에 있고(ADR 0014), 데스크는 로컬 쪽, 곧 도구 실행 · 승인 · 권한 · 표면 · 기록을 맡습니다. 로컬 두뇌일 때만 루프도 데스크가 돕니다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| AG-01 | `specs/agent/v0`: id · 이름 · 색 · 목소리 · 두뇌(endue AI 또는 로컬) · 도구 목록 · 권한 · 표면. kind `agent` 플러그인이 같은 정의를 담는다 | 없음 | 3 |
| AG-02 | 출처: 로그인 뒤 endue AI 의 에이전트 디렉터리가 데스크에 나타난다(#21 의 brain 명세 확장) + 로컬 정의(agent 플러그인) | 일부 (#70: `specs/brain/v0` 의 에이전트 디렉터리(ADR 0024) · 셸의 에이전트 바, 브라우저 스텁 위. 로컬 정의는 없음) | 3 |
| AG-03 | 에이전트는 호출자다: 커맨드와 브리지를 자기 이름으로 부르고, grant 는 사람과 같은 엔진이 따로 관리하며, 프롬프트에 에이전트 이름이 보인다 | 없음 | 3 |
| AG-04 | 승인: 되돌리기 어려운 도구(허락 폴더 밖 `fs.write` · `proc` · `net` 쓰기)는 승인 정책(항상 묻기 · 세션 · 자동)을 사용자가 에이전트마다 정한다 | 없음 | 3 |
| AG-05 | 상태와 기록: idle · working · waiting · error 가 바에 보이고, 무엇을 불렀고 무엇을 바꿨는지가 활동 기록 표면에 남는다. 되돌릴 수 있는 것은 되돌린다 | 없음 | 3 |
| AG-06 | 스페이스: 에이전트 둘 이상 + 공유 표면 + 공유 저장소 네임스페이스. 사람도 참여한다 | 없음 | 3 |
| AG-07 | 백그라운드: 데스크가 떠 있는 동안 작업 큐가 돌고, 오프라인이면 쌓았다가 재연결 때 처리한다 | 없음 | 3 |
| AG-08 | 로컬 루프: 로컬 두뇌일 때 `desk-agent` 가 도구 왕복을 돌리되, 이벤트는 endue AI 와 같은 `specs/brain` 모양 | 없음 | 3 |
| AG-09 | 외부 에이전트(Claude · Codex 같은 CLI 와 MCP)는 플러그인으로 붙이고, 사용자가 이름을 말했을 때만 권한다(첫 실행 규칙) | 없음 | 3 |
| AG-10 | Eris 가 모든 커맨드를 부른다: 자연어 → 커맨드 id + 인자(팔레트와 같은 레지스트리). 실행 전 확인은 CORE-03 정책 | 일부 (대화만) | 2 · 3 |

### 계정과 동기화 (SY)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| SY-01 | endue ID 로그인: 브라우저 + 딥 링크(SYS-07), 토큰은 키체인(SYS-06), 로그아웃 · 기기 목록 | 없음 (스텁) | 3 |
| SY-02 | 텍스트 파일이 진실: `~/.desk/init.yaml`(#31 · `specs/init/v0`)이 기본 설정 · `settings` · `plugins` 를 맡고, 모드 · 키맵 · 레이아웃은 같은 폴더의 YAML(`modes/*` · `keybindings` · `layouts/*`)로 둔다. UI 변경은 파일에 쓰고 파일 변경은 UI 에 반영된다. 사용자가 git 으로 관리할 수 있다 | 일부 (#31) | 1 |
| SY-03 | 동기화 범위: 설정 · 모드 · 키맵 · 레이아웃 · 플러그인 목록 · 에이전트 설정은 ○. grant · 비밀 · 로그는 ✗(기기 종속). 플러그인 데이터는 `sync: true` 로 선언한 키만 | 없음 | 3 |
| SY-04 | 충돌: 파일 단위 3-way. 양쪽이 바뀌면 덮어쓰지 않고 endue 사본을 `*.remote.yaml` 로 둔다(#31 의 규칙을 모든 파일에). 오프라인 우선 | 일부 (#31) | 3 |
| SY-05 | 새 기기: 로그인 → `plugins.lock` 대로 마켓에서 설치 → 모드 · 레이아웃 복원 (첫 실행 "새 기기에서 처음") | 없음 | 3 |
| SY-06 | 로그아웃 · 삭제: 로컬 사본을 남길지 고르고, 서버 데이터 삭제를 요청할 수 있다 | 없음 | 3 |

### 설정 (SET)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| SET-01 | 코어 · 런타임 · 플러그인이 `contributes.settings` JSON Schema 로 선언: 기본값 · 설명 · enum · 범위(user · mode · machine) | 일부 (#55 `contributes.settings`: 종류 · 기본값 · 설명 · choices. 범위(user · mode · machine)는 없음) | 1 |
| SET-02 | 우선순위: 기본 < 사용자 < 모드 < 기기(machine 은 동기화되지 않음) | 일부 (#55: 기본 < init.yaml < 프로필 < 실행 중 변경, 런타임 안에서. machine 은 없음) | 1 |
| SET-03 | `settings.get` · `set` · `onChange` 브리지. 플러그인은 자기 키만 쓰고, 남의 키는 `settings:read` 로 읽는다 | 없음 | 1 |
| SET-04 | 검증과 마이그레이션: 잘못된 값은 기본값 + 경고, 키 이름 변경은 `renamed` 로 자동 이전 | 없음 | 1 |

### 개발자 경험과 운영 (DX · OPS)

CI · 테스트 층 · 릴리스 파이프라인은 `desk-structure.md` 가 정합니다. 여기는 뼈대를 공개할 때 더 있어야 할 것만 적습니다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| DX-01 | `git clone` 뒤 `just dev` 까지 15분. `desk doctor` 가 빠진 의존성을 알려 준다 | 일부 | 1 |
| DX-02 | `just dev-web`: Tauri 없이 브라우저에서 데스크를 띄운다(BR-07) | 일부 (#70: `pnpm dev` 가 브라우저 스텁 위에 셸을 띄움. `just dev-web` 은 없음) | 1 |
| DX-03 | 문서 사이트에 명세에서 생성한 API 레퍼런스(BR-08)와 플러그인 가이드 로직 · 도구 편 | 일부 (UI 편 · #71: 명세에서 생성한 API 레퍼런스, `just docs-api`) | 1 · 2 |
| DX-04 | 예제 완성: hello-ui(있음) · hello-wasm · hello-mcp · hello-theme · hello-pack · brain-echo(있음). 전부 한 명령 | 일부 (hello-ui · brain-echo · #68 hello-wasm. hello-mcp · hello-theme · hello-pack 은 없음) | 2 |
| DX-05 | 플러그인 테스트 하네스: 로직 · 도구 플러그인, 커맨드 · 키 · 설정 모의, 렌더 트리 스냅샷 | 일부 (UI 만) | 2 |
| OPS-01 | 3 OS 서명 · 공증 · updater · 설치 스모크 | 일부 (#294: macOS 서명 · 공증과 updater 서명은 비밀값이 생기면 돈다. Windows Authenticode 미정) | 1 |
| OPS-02 | 위협 모델 문서: 플러그인 · 에이전트 · 마켓 · 동기화의 경계와 가정. SECURITY.md 에서 링크 | 있음 (#71: `docs/security/threat-model.md`, SECURITY.md 에서 링크) | 1 |
| OPS-03 | SBOM 과 라이선스 검사(cargo deny 있음) + 플러그인 라이선스 필드 | 일부 | 2 |
| OPS-04 | 텔레메트리 없음. 크래시는 opt-in(ADR 0007). `desk doctor --bundle` 진단 묶음은 사용자가 직접 보낸다 | 일부 | 1 |

## 단계

`desk-structure.md` 의 "켜는 순서"(공개 → 플러그인 → 두뇌 → 권한 · VM)와 같은 순서입니다. 단계마다 *쓰는 사람에게 무엇이 되는가* 로 끝을 정합니다.

| 단계 | 이름 | 끝나면 되는 것 | 주요 요구사항 |
| --- | --- | --- | --- |
| 1 | 뼈대 공개 | 낯선 사람이 받아서 빌드하고, 데스크로 하루 일하고, UI 플러그인을 만들어 쓴다. 브리지 전부 · 커맨드 · 팔레트 · 키맵 · 설정 · 모드 · 시스템 플러그인 기본 세트 · CLI · 안전 모드 · 브라우저 빌드 · 위협 모델 | CORE-01~09 · 16~18, SYS-01~03 · 08~10, BR-01~03 · 07~08, RT-01~04 · 07~12 · 14~15, PKG-02~06, SYSP 1단계, SET, SY-02, DX-01~03, OPS-01 · 02 · 04 |
| 2 | 플러그인 생태계 | 로직 · 도구 · 테마 · pack 플러그인이 돌고, 마켓에서 설치 · 갱신 · 검증된다. `create-plugin` 으로 5분 안에 첫 플러그인 | CORE-05 · 10~12, BR-04~06 · 09, RT-05 · 06 · 13 · 19, PKG-01 · 07, SYSP 2단계, BASE 2단계, MKT, DX-04 · 05 |
| 3 | 에이전트와 계정 | 로그인하면 endue AI 의 에이전트가 들어와 로컬 도구로 일하고, 설정이 기기 사이를 따라온다. 로컬 두뇌로도 돈다 | CORE-13~15, SYS-04 · 06 · 07, AG, SY, SYSP `account`, BASE 3단계 |
| 4 | 깊이 | 3D 컴포지터 · 다중 창 · 트레이 · VM 강화 · 성능 예산 고정 | RT-16~18, SYS-05(4), CORE-12(4) |

## 진행 상황

위 표의 *현재* 열은 `main` 의 `99ee07d`(2026-10-29) 기준입니다. 이 문서를 처음 쓴 2026-10-28 뒤로 움직인 요구사항과 그 이슈 · PR, 그리고 진행 중인 작업입니다. 이슈가 닫히면 해당 행의 *현재* 를 고칩니다.

| 요구사항 | 이슈 · PR | 상태 (2026-10-30) |
| --- | --- | --- |
| SY-02 · SY-04 (`init.yaml` 과 동기화 규칙) | #30 · #31 | 머지 |
| BR-01 · BR-06 의 `cmd` · `settings` · `log` · `events` 명세, CORE-02 · CORE-03 의 `perm` 명세 | #36 · #43 | 머지 (새로 더한 것 중 구현된 건 `cmd.*` 뿐, #55) |
| CORE-04 커맨드 레지스트리, BR-02 `contributes`, SET-01~04 계층 설정, BR-05 `policy` 종류 | #49 · #55 (정책 플러그인 스택) | 머지 |
| SYSP `palette` · `keybindings` · `notifications` · `theme-endue` · `files`, RT-03 · RT-04 · RT-09 · RT-10 | #50 · #51 · #52 (`desk.palette` · `desk.keys` · `desk.notify` · `desk.theme` · `desk.files` · `desk.buffers` · `desk.display`) | 머지 (#55 로 합쳐짐) |
| RT-07 모드, SYSP `modes` | #54 (`desk.profiles`, 모드를 프로필로 이름 바꿈) | 머지 (#55 로 합쳐짐) |
| RT-02 표면 세션 복원 | #53 (`desk.session`) | 머지 (#55 로 합쳐짐) |
| RT-01 셸 UI | #21 · #70 | 머지 (정책 스택 위, ADR 0023 · 0025) |
| SYS-01 ~ SYS-03 | #37 · #63 | 머지 (desk-sys. 코어의 `proc` · `net` 은 #77) |
| CORE-10 · DX-04 (hello-wasm) | #39 · #68 | 머지 (ADR 0019) |
| CORE-15 (로컬 두뇌, Ollama) | #38 · #42 | 머지 |
| PKG-07 (`create-plugin`, UI 템플릿) | #33 · #34 | 머지 |
| SYSP `rail` · `dock` | #32 · #35 | 머지 |
| SYSP `onboarding` 장면 6–10 | #40 · #41 | 머지 |
| PKG-05 (`tokens.css` 와 custom element) | #72 | 머지 (ADR 0022) |
| OPS-02 · BR-08 | #71 | 머지 |
| SYSP `permissions` | #69 | 머지 |
| 이 문서 | #67 | 머지 |
| CORE-02 · CORE-03 · CORE-06 (`perm.*` · `events.*` 를 코어가 처리, grant 가 재시작 뒤에도 남음) | #73 | 진행 중 |
| RT-01 · AG-02 (Tauri 앱이 셸을 띄우고, 에이전트 디렉터리 · 두뇌 상태가 브리지로) | #74 | 진행 중 |
| 약속 2 · SYSP `eris` · `agents` · `rail` · `dock` (ADR 0026 · 0027 · 0028 초안, 설계 문서를 `main` 에 맞춤) | #75 | 진행 중 |
| CORE-10 · DX-04 (WIT 가 브리지 전체를 덮고, hello-wasm 이 커맨드를 제공) | #76 | 진행 중 |
| CORE-01 · SYS-02 · SYS-03 (코어가 `proc.*` · `net.fetch` · `ui.surface.*` 를 처리) | #77 | 진행 중 (`proc.*` 는 터미널 변경이 먼저 처리) |
| SYSP `terminal` (`endue.terminal`, 코어의 `proc.*`, 런타임의 프로세스 이벤트 라우팅) | 터미널 변경 · `docs/ko/terminal-requirements.md` · ADR 0037 | 진행 중 |
| BASE `notes` (파일을 여는 첫 플러그인) | #78 | 진행 중 |
| PKG-04 · PKG-06 · BR-07 (SDK 와 브라우저 스텁이 브리지 v0 전부) | #79 | 진행 중 |
| PKG-02 · PKG-03 (`desk` CLI 가 로컬 소켓으로 실행 중 데스크에) | #80 | 진행 중 |
| SET-03 · CORE-16 (코어가 `settings.*` · `log.*` 를 처리) | #81 | 진행 중 |
| OPS-01 (앱 e2e 와 설치 스모크) | #82 | 진행 중 |
| BASE 파일 플러그인의 기반: `fs.read` 범위 읽기 · `fs.url` 스트리밍 · 확장자 대소문자 무시(ADR 0041) | #153 · #164 | 머지 |
| BASE `sheets` · `docs` · `slides` · `reader` · `images` · `player` · `data` · `archives` · `web` (활동별 파일 플러그인, ADR 0042 · 0043 · 0044 · 0045) | #154–#162 · #165–#172 · #174 | 머지 |
| 파일 플러그인 autoload: 시작할 때 꺼져 있고 파일을 열면 켜진다(ADR 0046) | #173 · #175 | 머지 |
| BASE 파일 플러그인의 기반 2: `<desk-progress>` · `readBytes` · `byteSource` · `startWorker`(ADR 0048), `byteSource` 의 취소와 동시 읽기 수정, BR-01 · BR-06 의 `shell.open` · `shell:open`(ADR 0047) | #180 · #198, #225 · #231, #262 · #263, #179 · #200 | 머지 |
| 라이브러리 플러그인(kind `library`)과 `endue.formats`: archives 의 codecs · 7z 를 옮기고, RAR 4 · 5(ADR 0051) · DjVu · PC 디스크(VHD · VHDX · VMDK · QCOW2 · MBR · GPT · FAT · exFAT · ext4 · NTFS) · Apple 디스크(DMG · HFS+ · APFS · LZFSE) · SquashFS · WIM | #181 · #254, #182 · #201, #183 · #202, #184 · #199, #185 · #255, #186 · #256, #258 · #259 | 머지 |
| BASE 파일 플러그인 두 번째 물결: `docs` 의 서식 있는 .doc · .hwp, `slides` 의 서식 있는 .ppt, `sheets` · `data` · `reader` 의 큰 파일, `docs` · `slides` · `web` · `images` 의 진행 표시 · 워커 · 링크, `reader` 의 DjVu · CB7 · CBR, `archives` 의 RAR 와 디스크 이미지 | #191 · #205, #192 · #203, #193 · #204, #187 · #224, #188 · #229, #189 · #240, #196 · #253, #190 · #257, #194 · #261 | 머지 |
| BASE `player` 가 WebKit 이 못 트는 것을 재생: MSE 로 remux, WebAssembly 의 FFmpeg 디코더 | #195 | 진행 중 |

파일 플러그인 두 번째 물결의 네 행은 2026-11-02 의 `main`(`98763db`) 기준입니다.

모드는 정책 스택(#54, #55 로 머지)에서 프로필로 이름이 바뀌었습니다. 이 문서의 RT-07 · SYSP `modes` 는 프로필을 뜻합니다.

## 결정이 필요한 것

ADR 후보입니다. 추천은 적되 결정은 ADR 에서 합니다.

| 질문 | 추천 | 왜 |
| --- | --- | --- |
| 커맨드 레지스트리의 자리 | 코어. 실행은 제공자(런타임 · 플러그인)에게 위임. 결정됨 (#55, ADR 0017) | CLI 와 에이전트가 런타임 없이도 목록을 보고 부른다. Emacs 의 obarray 처럼 하나 |
| `contributes` · `activation` 어휘 | VS Code 어휘를 빌리되 Desk 에 없는 것(languages · debuggers)은 빼고 `tools` · `agents` 를 더함. `contributes` 는 결정됨 (#55, ADR 0017), `activation` 은 아직 열림 | 저자가 아는 모양. 문서와 도구를 옮겨 쓴다 |
| 설정 파일 형식 | YAML. `init.yaml` 이 이미 YAML 이고(#31), 모드 · 키맵 · 레이아웃도 같은 형식. 결정됨 (#31, ADR 0016) | 형식은 하나. 주석이 살고, 검증은 `specs/init` 방식(스키마 + 벡터) 그대로 |
| 키맵 `when` 식 | VS Code 식 불리언 식(`focusedSurface == 'x' && !mode.locked`) | 익숙하고 파서가 작다 |
| 시스템 플러그인 교체 | `provides` 역할 슬롯 + 설정에서 제공자 선택. 셸의 부분이 어디로 갈지는 ADR 0026 (제안) | Emacs 의 `completing-read-function` 교체와 같다. 역할 하나에 제공자 하나 |
| 마켓 인덱스 호스팅 | 공개 git 레포 + 정적 호스팅 | 서버 없이 돌고, PR 이 곧 심사 기록이다 |
| 로컬 IPC | 유닉스 소켓 / named pipe 위에 브리지 봉투 그대로. #80 이 정함 (ADR 0030 예정) | 어댑터 하나 더 쓰면 끝. 권한 모델이 그대로 적용된다 |
| 에이전트 정의의 자리 | `specs/agent/v0` 를 따로 두고 `specs/brain` 은 디렉터리 조회만 | 에이전트는 두뇌 없이도(로컬) 정의된다 |
| 동기화 전송 | `specs/sync/v0` 로 계약을 긋고 endue AI 가 구현 | 계약만 공개하면 다른 백엔드도 가능하다 |
| 로직 플러그인의 JS | QuickJS-in-Wasm 템플릿을 SDK 가 제공 | Wasm 생태계가 작아 JS 저자를 받아야 한다 |

## 하지 않는 것

- IDE 가 아닙니다. LSP · 디버거 · 코드 편집기를 내장하지 않습니다. 플러그인으로는 가능합니다.
- 자체 스크립트 언어가 없습니다. Elisp 의 자리는 플러그인 세 종류와 커맨드 레지스트리가 맡습니다.
- 브라우저 엔진을 내장하지 않습니다. 웹 표면은 OS 웹뷰입니다.
- 텔레메트리가 없습니다. 크래시 리포트는 opt-in 입니다.
- 두뇌 말고는 클라우드 없이 안 되는 기능이 없습니다.
- 플러그인끼리 직접 통신하지 않습니다. 커맨드 · 이벤트 · 공유 저장소로만 만납니다.

## 열린 질문

- [ ] 표면 100개 예산이 iframe 메모리로 현실적인가. 안 보이는 표면을 내리는 기준은 무엇인가
- [ ] 역할 슬롯을 바꿔 끼울 때의 UX. 팔레트 제공자가 둘 설치되면 어느 쪽을 쓰는가
- [ ] 에이전트의 grant 는 사람의 grant 의 부분집합이어야 하는가, 독립인가
- [ ] 마켓 수동 심사를 누가 하는가. 초기에는 유지보수자 한 명
- [ ] 기본 플러그인 목록의 최종안. 기본 설치와 Eris 추천의 경계
- [ ] 커맨드 undo 를 레지스트리 속성(`undo` 커맨드 짝)으로 둘지, 플러그인 몫으로 둘지
