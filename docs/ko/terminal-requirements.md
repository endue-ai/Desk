# endue Desk 터미널 요구사항

2026-10-31 · Team endue

> 터미널 플러그인(`plugins/terminal`, `endue.terminal`)이 프로덕션 수준에서 갖춰야 할 것을 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 SYSP `terminal`(2단계) · SYS-02 · CORE-01 을 한 플러그인 단위로 펼친 것이고, 그 문서의 ID 를 그대로 가리킵니다. 왜 xterm.js 를 폴더 안에 복사해 두는지는 ADR 0037 이, 코드가 하는 일은 `plugins/terminal/README.md` 가 말합니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다.

터미널은 *사용자의 셸을 데스크 안에서 돌리는 표면* 입니다. Emacs 의 `term` 과 VS Code 의 통합 터미널이 하던 일을 Desk 의 말로 옮깁니다. 프로세스는 코어가 갖고(`proc.*`, 권한 검사 뒤), 플러그인은 화면 · 키 · 세션 · 데스크 통합만 맡습니다. 사람과 에이전트가 같은 손을 쓴다는 약속 3 · 6 이 여기서 가장 직접적으로 시험됩니다.

## 한눈에

```text
 plugins/terminal (iframe, 공개 SDK 만)
 ├ view.js      xterm.js 6 (vendor/) · 탭 · 상태 live region
 ├ sessions.js  세션 · proc.* 호출 · 이벤트 · 데스크 버퍼 · 리로드 스냅샷
 ├ commands.js  endue.terminal.* · desk.buffers.show / .closed
 └ shell · keys · theme · output   기본 셸 · 키 소유 · 테마 · 출력 디코딩 (DOM 없음, Node 에서 테스트)
          │ proc.spawn{pty} · proc.write · proc.resize · proc.kill        proc.output · proc.exit
 packages/runtime  PluginHost + owners.ts: procId → 그 플러그인에게만 (turn · watch 와 같은 길)
          │
 crates/desk-core  core_proc.rs: 권한(명령 · pty) → 프로세스 테이블(호출자 소유) → 이벤트 · 정리(off · 회수)
          │
 crates/desk-sys   proc: portable-pty · 셸 없는 spawn · ConPTY(Windows) · 좀비 회수
```

## 사용자 넷의 관점

| 사용자 | 터미널에서 바라는 것 | 요구사항 |
| --- | --- | --- |
| 쓰는 사람 | 열면 내 셸이 뜨고, 평소 키가 그대로 먹고, 복사 · 붙이기 · 한글이 되고, 창을 나눠도 깨지지 않는다 | TERM-S01 · TERM-I · TERM-E |
| 꾸미는 사람 | 셸 · 글꼴 · 색 · 키를 설정과 테마로 바꾸고, 프로필 레이아웃에 터미널을 놓는다 | TERM-SET · TERM-E03 · TERM-C06 |
| 만드는 사람 | 다른 플러그인에서 "여기서 터미널 열기" · "이 프로그램 돌리기" 를 커맨드로 부른다 | TERM-C |
| 에이전트 | 프로그램을 돌리고 결과를 읽되, 사람이 허락한 범위에서, 사람이 보는 터미널 안에서 | TERM-P03 · TERM-C03 · TERM-C04 |

## 하지 않는 것

- 셸을 만들지 않습니다. 사용자의 zsh · bash · fish · pwsh 가 그대로 돕니다.
- SSH 클라이언트 · 멀티플렉서(tmux) 를 내장하지 않습니다. 분할 · 탭 · 복원은 데스크의 표면 · 버퍼 · 세션 정책이 맡습니다.
- 셸 통합 스크립트(프롬프트 표식 OSC 133 등)를 자동으로 주입하지 않습니다(v0). 쓰려면 사용자가 켭니다.
- 원격(다른 기기) 터미널은 없습니다. 데스크 밖으로 나가는 건 두뇌뿐입니다(약속 7).
- 에이전트의 명령을 자동 승인하지 않습니다. 승인 정책(AG-04)이 생길 때까지 에이전트가 돌릴 수 있는 건 사람이 묻고 허락한 프로그램뿐입니다.

## 필수 기능

| 묶음 | 지금(이 변경) | 프로덕션 필수(1단계) | 그 뒤(2 · 3단계) |
| --- | --- | --- | --- |
| 세션 | 플랫폼 기본 셸 후보 순서 · PTY · 탭 여럿 · 데스크 버퍼 · 종료 문구와 Enter 재시작 · 핫리로드 재접속 | 로그인 셸 발견(`$SHELL`) · 앱 종료 때 정리 확인 · Windows 실기 검증 | 재시작 뒤 세션 복원(cwd) · 닫기 전 전경 프로세스 확인 |
| 에뮬레이션 | xterm.js 6 · 트루컬러 · 유니코드 11 · 스크롤백 · 커서 · 테마 토큰 · 고대비 · 동작 줄이기 · 벨 → 알림 | 한글 IME 검증 · 글자 배율 · 스크린 리더 모드 · 성능 예산 측정 | 링크 열기(`shell.open`) · 검색 · 이미지 |
| 키 · 클립보드 | 키 소유 규칙(셸 ↔ 데스크) · 설정으로 데스크 키 추가 · Mod+C/V · Control+Shift+C/V | 실제 웹뷰에서 붙이기 검증(macOS · Linux · Windows) | 클립보드 권한 어휘로 붙이기 · 키 힌트 · describe |
| 권한 | 셸 7종 + pty 선언 · 범위 밖은 한 번 묻기 · `run` 의 셸+인자 거부 · 호출자 소유 · off · 회수 때 종료 | 위협 모델에 터미널 항목 · 내장 터미널의 사전 허락 여부 결정 | 에이전트 승인 정책 · 실행 기록 채널 |
| 커맨드 | new · focus · close · next · previous · clear · interrupt · restart · run, 키 2개 | — | capture(결과 읽기) · send · 폴더에서 열기 |
| 테스트 | Rust 통합 10 · vitest 52 · 벤더 드리프트 3 | 런타임 e2e(스텁의 가짜 proc) · 앱 e2e(실제 셸) | 성능 야간 · Windows CI |

## 요구사항

표의 *현재* 는 이 변경이 머지된 `main` 기준(있음 · 일부 · 없음)이고, *단계* 는 §단계의 번호입니다.

### 세션 (TERM-S)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TERM-S01 | 기본 셸: 설정 `endue.terminal.shell` 이 비면 플랫폼 후보를 순서대로 시도한다(macOS zsh · bash · sh, Linux bash · zsh · sh, Windows pwsh · powershell · cmd). `not_found` 는 다음 후보로, 다른 실패는 터미널 안에 문장으로. macOS 는 로그인 셸(`-l`), `endue.terminal.login` 으로 바꾼다 | 있음 | 0 |
| TERM-S02 | 사용자의 *로그인 셸* 을 안다: `$SHELL`(Unix) · 기본 PowerShell(Windows). 샌드박스 프레임은 환경을 못 보므로 코어가 알려 주는 원시 기능이 필요하다(§결정) | 없음 (후보 순서로 대신함) | 1 |
| TERM-S03 | PTY 시작: `pty` 크기는 뷰가 잰 값, `TERM=xterm-256color` · `COLORTERM=truecolor` · `TERM_PROGRAM=endue-desk` 위에 설정 `env`, 시작 폴더는 설정 `cwd`(기본 `~`). 셸 없이 인자 배열로 넘긴다 | 있음 | 0 |
| TERM-S04 | 세션 여럿: 한 표면에 탭으로, 각각 데스크 버퍼(`desk.buffers.open`)라서 `Mod+B` · `Mod+W` · 버퍼 목록이 그대로 먹는다. 셸이 제목(OSC 0 · 2)을 바꾸면 탭과 버퍼 이름이 따라간다 | 있음 | 0 |
| TERM-S05 | 종료: 종료 코드 또는 신호를 한 줄로 보이고(`zsh exited with code 1. Press Enter to start it again.`), Enter 또는 `endue.terminal.restart` 로 다시 시작한다. 실행 중의 restart 는 `term` 을 보내고 종료 뒤 다시 띄운다 | 있음 | 0 |
| TERM-S06 | 끝내기: 탭 닫기는 셸에 `hup`. 플러그인이 꺼지면 코어가 그 프로세스를 끝내고, grant 가 회수되면 그 grant 가 덮던 프로세스를 끝낸다(`kill`). 앱이 꺼질 때 남는 프로세스가 없다 | 있음 (off · 회수). 앱 종료 경로는 데스크의 `Core` drop 에 기대고 있어 e2e 로 확인해야 한다 | 0 · 1 |
| TERM-S07 | 핫리로드 · 표면 크래시: 세션 · procId · 마지막 32 KiB 출력(tail) 을 스냅샷으로 남기고, 다시 올라오면 같은 프로세스에 붙어 tail 을 재생하고 크기를 다시 맞춘다. 리로드 사이에 온 출력은 잃는다(한계, §열린 질문) | 있음 | 0 |
| TERM-S08 | 재시작 뒤 복원: `desk.session` 이 표면을 되살릴 때 터미널은 마지막 cwd(OSC 7 또는 셸 통합)로 새 셸을 띄운다. 스크롤백은 되살리지 않는다 | 없음 | 2 |
| TERM-S09 | 닫기 전 확인: 전경 프로세스가 있으면(셸 통합이 알려 줄 때) `desk.buffers.confirm-unsaved` 처럼 묻는다 | 없음 | 2 |
| TERM-S10 | Windows: ConPTY(desk-sys) 위에서 pwsh · powershell · cmd, `-NoLogo`, `.exe` 이름, 역슬래시 경로. 실기 검증과 CI | 일부 (코드 경로는 있음, 실기 미검증) | 1 |

### 에뮬레이션과 표시 (TERM-E)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TERM-E01 | VT100 · xterm 호환 에뮬레이터: 256색 · 트루컬러 · 대체 화면 · 스크롤 영역 · 괄호 붙이기(bracketed paste) · 마우스 리포팅. xterm.js 6 을 플러그인 폴더에 복사해 쓴다(ADR 0037) | 있음 | 0 |
| TERM-E02 | 유니코드 11 폭(한글 · CJK · 이모지) 과 IME 조합 입력(한글). 한글을 치고 지우는 동안 커서와 폭이 맞는다 | 일부 (unicode11 애드온은 켬, IME 는 실기 검증 전) | 1 |
| TERM-E03 | 테마: `--desk-*` 토큰에서 배경 · 글자 · 커서 · 선택을, 밝음 · 어두움 팔레트에서 ANSI 16색을 가져온다. 고대비면 7:1 과 글자색 선택, 동작 줄이기면 커서 깜빡임 끔. 테마가 바뀌면 열린 터미널이 즉시 따라간다 | 있음 | 0 |
| TERM-E04 | 글꼴 · 크기 설정(`font-family` · `font-size`), 데스크 글자 배율(RT-12)을 따라간다 | 일부 (설정만) | 1 |
| TERM-E05 | 크기: 표면 크기에 맞춰 열 · 행을 다시 재고(`fit`) `proc.resize` 로 알린다. 분할 · 이동 · 데스크톱 전환 뒤에도 깨지지 않는다 | 있음 (런타임 e2e 로 확인은 1단계) | 0 · 1 |
| TERM-E06 | 벨: `ui.notify` 로 데스크 알림(`endue.terminal.bell`, `none` 으로 끔). 알림 정책(desk.notify)이 방해 금지를 적용한다 | 있음 | 0 |
| TERM-E07 | 링크: OSC 8 과 URL 감지, 클릭으로 기본 브라우저에. 브리지에 `shell.open` 이 없어(BR-01) 그 뒤에 | 없음 | 2 |
| TERM-E08 | 검색(스크롤백 안, `Mod+F` 는 데스크 키와 조정), 선택 복사, 선택 즉시 복사 설정 | 일부 (복사 · copy-on-select) | 2 |
| TERM-E09 | 접근성: 탭은 `role=tab` · `tabpanel`, 상태는 live region, xterm 스크린 리더 모드를 설정으로, 키보드만으로 탭 이동(커맨드) | 일부 (스크린 리더 모드 설정은 없음) | 1 |
| TERM-E10 | 성능 예산: `yes` · 큰 파일 `cat` 같은 폭주 출력에 UI 가 멈추지 않는다(입력→화면 p95 50 ms 아래, 10 MB/s 소화), 메모리는 스크롤백 상한에 묶인다. 기준값은 첫 측정으로 고정(RT-16) | 없음 (측정 없음) | 1 · 4 |

### 입력 · 키 · 클립보드 (TERM-I)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TERM-I01 | 키 소유: Escape 와 Control 코드는 셸의 것(vim · Ctrl+C · Ctrl+R). 데스크 고유 코드(팔레트 · 버퍼 · 창 · 데스크톱 · 터미널 키, `keys.js` 의 목록)는 데스크로 가고, `endue.terminal.keys-to-desk` 가 더한다. macOS 는 그 밖의 Command 코드도 데스크로. 매니페스트가 묶는 키는 그 목록에 있어야 한다(테스트가 검사) | 있음 | 0 |
| TERM-I02 | 복사 · 붙이기: `Mod+C`(선택이 있을 때) · `Mod+V`, Linux · Windows 는 `Control+Shift+C` · `Control+Shift+V` 도. 붙이기는 브라우저의 paste 이벤트(샌드박스 프레임에서 Clipboard API 없이 되는 길), 괄호 붙이기는 xterm 이 | 있음 (코드) — WKWebView · WebKitGTK · WebView2 에서 실기 검증 | 0 · 1 |
| TERM-I03 | 클립보드 권한 어휘(BR-06 `clipboard:read` · `clipboard:write`)가 생기면 붙이기를 브리지 API 로 옮긴다. 그때까지 Clipboard API 를 부르지 않는다 | 없음 | 2 |
| TERM-I04 | 마우스: 선택 · 휠 스크롤 · 마우스 리포팅(프로그램이 켠 경우) · Alt+클릭 커서 이동(xterm 기본) | 일부 (xterm 기본, 미검증) | 1 |
| TERM-I05 | 키 힌트 · describe(RT-05 · 06): 터미널 안에서 데스크 키가 왜 안 먹는지, 어느 키가 셸로 가는지를 보인다 | 없음 | 2 |

### 권한과 보안 (TERM-P)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TERM-P01 | 매니페스트는 셸 7종(zsh · bash · fish · sh · pwsh · powershell · cmd) 과 `pty` 를 선언한다. 내장 플러그인이라 설치 때 코어가 그대로 허락한다(모든 내장의 정책). 셸은 CORE-03 의 광역 권한이라 permissions 창이 경고 문구를 붙인다(#69). 내장 터미널도 *첫 열기에서 묻게* 할지는 결정 후보(§결정) | 있음 (사전 허락) | 0 · 1 |
| TERM-P02 | 범위 밖 프로그램(설정의 셸, `run` 의 프로그램)은 `perm.request` 로 한 번 묻고, 거절은 터미널과 상태 줄에 문장으로(`Not allowed to run fish.`). 반복해 묻지 않는다 | 있음 | 0 |
| TERM-P03 | `endue.terminal.run` 은 셸에 인자를 붙인 호출(`zsh -c …`)을 거부한다. 셸 grant 를 빌려 아무 명령이나 조용히 돌리는 길을 막기 위해서다. 프로그램 자체는 grant 가 없으면 사람에게 묻는다. 호출자는 코어가 `cmd.invoked` 에 기록한다 | 있음 | 0 |
| TERM-P04 | 환경 위생: 자식 프로세스에 Desk 의 토큰 · 비밀 · 내부 변수를 넣지 않는다. 플러그인이 더하는 건 `TERM` 류와 사용자가 설정한 `env` 뿐이고, 환경 변수 이름은 식별자 형식만 받는다 | 있음 | 0 |
| TERM-P05 | 셸 주입 없음: 명령은 PATH 이름 또는 경로, 인자는 배열, 입력은 해석 없이 바이트로. 코어는 명령 이름에 공백 · NUL 을 받지 않는다 | 있음 | 0 |
| TERM-P06 | 소유: 프로세스는 시작한 호출자의 것. 다른 호출자의 procId 는 `not_found`, 이후 호출은 그 명령을 덮는 scope 가 필요, 이벤트는 런타임이 시작한 플러그인에게만 보낸다(owners) | 있음 | 0 |
| TERM-P07 | 위협 모델(`docs/security/threat-model.md`)에 터미널 항목: 셸은 사용자 권한 그대로이고 플러그인 격리 밖이다. 터미널이 덮는 것(화면 · 키 · 세션)과 덮지 않는 것(셸이 하는 일)을 긋는다 | 없음 | 1 |
| TERM-P08 | 기록: 에이전트 · 다른 플러그인이 `run` 으로 돌린 프로그램을 `log.write` 로 채널에 남긴다(코어 `log.*` 는 #81 뒤). 사람이 친 입력은 남기지 않는다 | 없음 | 2 |
| TERM-P09 | 리소스 상한: 플러그인 하나가 띄울 수 있는 프로세스 수 · 출력 속도에 상한을 두고 넘으면 문장으로 거절한다 | 없음 | 2 |

### 커맨드와 통합 (TERM-C)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TERM-C01 | 커맨드: `endue.terminal.new` · `.focus` · `.close` · `.next` · `.previous` · `.clear` · `.interrupt`(int) · `.restart` · `.run`. 전부 레지스트리에 있어 팔레트 · 키 · Eris · 에이전트 · CLI 가 같은 길로 부른다(약속 3). `{ session }` 인자로 특정 터미널을 가리킨다 | 있음 | 0 |
| TERM-C02 | 키: `` Control+` `` focus(없으면 연다), `Mod+Shift+T` new. 둘 다 터미널 안에서도 데스크에 닿는다 | 있음 | 0 |
| TERM-C03 | `run { command, args?, cwd?, title? }` 은 `{ session, procId }` 를 답한다. 결과를 읽어야 하는 호출자(에이전트)를 위해 종료까지의 출력을 묶어 답하는 `endue.terminal.capture`(상한과 타임아웃) 를 더한다 | 일부 (`run` 만) | 2 · 3 |
| TERM-C04 | `send { text, session? }`(타이핑): 사람의 터미널에 글자를 넣는 건 에이전트 승인 정책(AG-04) 뒤에 | 없음 | 3 |
| TERM-C05 | 다른 플러그인과: files · explorer 의 "여기서 터미널 열기"(`cwd` 인자), 두뇌의 도구 라우팅(CORE-14)에서 `run` 호출 | 일부 (`run` 의 `cwd` 는 있음) | 2 |
| TERM-C06 | 프로필 레이아웃(`desk.shell.mode`)에 `plugin: endue.terminal` 표면을 놓을 수 있고, display 규칙은 center · 포커스 | 있음 | 0 |
| TERM-C07 | CLI: `desk cmd run endue.terminal.run --args '{…}'` 가 돌고 결과가 JSON 으로 온다(PKG-02) | 있음 (CLI 는 #85) — 확인만 | 1 |

### 설정 (TERM-SET)

`contributes.settings` 에 선언하고(`plugin.json`), 지금은 `init.get` 으로 읽습니다. 코어가 `settings.*` 를 처리하면(#81) 실행 중 변경이 바로 반영되어야 합니다(1단계). 값이 종류나 범위를 벗어나면 기본값으로 떨어집니다(SET-04).

| 키 | 기본값 | 뜻 |
| --- | --- | --- |
| `shell` · `args` · `login` | `""` · `[]` · `auto` | 프로그램(비면 플랫폼 후보), 인자, 로그인 셸(`auto` = macOS 만) |
| `cwd` · `env` | `~` · `{}` | 시작 폴더(루트 있는 경로), 추가 환경 변수 |
| `scrollback` | 10000 | 화면 위에 남기는 줄(0 ~ 100000) |
| `font-family` · `font-size` | `""` · 13 | 글꼴(비면 플랫폼 고정폭), 크기(8 ~ 40) |
| `cursor-style` · `cursor-blink` | `block` · true | 커서 모양, 깜빡임(동작 줄이기면 꺼짐) |
| `bell` | `notify` | 벨: 데스크 알림 또는 `none` |
| `copy-on-select` | false | 선택하면 바로 복사 |
| `keys-to-desk` | `[]` | 셸 대신 데스크로 보낼 코드 추가(`Control+Q` 처럼) |

### 테스트 (TERM-T)

| 층 | 무엇을 | 어디 | 현재 |
| --- | --- | --- | --- |
| 통합 (Rust) | `proc.*` 가 권한 엔진을 지나고(명령 · pty · 소유), 출력과 종료가 호출자에게 순서대로 가고, off · 회수가 프로세스를 끝낸다. 자식은 테스트 바이너리 자신이라 3 OS 에서 돈다 | `crates/desk-core/tests/proc.rs`(10) · `core_proc.rs` 단위(UTF-8 쪼개짐, 2) | 있음 |
| 단위 (TS) | 세션(시작 · 후보 · 묻기 · 출력 · 입력 · 종료 · 재시작 · 탭 · 버퍼 · run · 리로드), 기본 셸 · 설정, 키 소유, 테마, 매니페스트 | `plugins/terminal/tests`(52) · `packages/runtime/src/owners.test.ts`(7) · `scripts/vendor-xterm.test.mjs`(3) | 있음 |
| 런타임 (웹) | 실제 iframe 에서 xterm 이 뜨고 키 · 크기 · 테마가 가는지. 브라우저 스텁에 가짜 `proc`(BR-07)이 있어야 한다 | `packages/runtime/e2e` | 없음 → 1 |
| 앱 e2e | 실제 셸에서 `echo hello` 가 화면에 보이고, 닫으면 프로세스가 없다(Linux) | `e2e/specs` | 없음 → 1 |
| 성능 | TERM-E10 의 예산 | 야간 | 없음 → 1 · 4 |

## 결정

| 질문 | 결정 · 추천 | 왜 |
| --- | --- | --- |
| 에뮬레이터 | **xterm.js 6 을 플러그인 폴더(`ui/vendor/`)에 고정 버전으로 복사. 결정됨 (ADR 0037)** | 플러그인은 폴더 그대로 돌아야 하고(ADR 0012), CSP 가 폴더 밖 스크립트를 막는다. 직접 만든 VT 파서는 프로덕션이 아니다 |
| 내장 터미널의 셸 grant | 추천: 내장 정책대로 사전 허락을 유지하되, permissions 창의 광역 경고를 터미널 첫 열기에서도 한 번 보인다. "첫 열기에서 묻기" 로 바꾸려면 내장 전체의 정책이라 ADR | 셸은 사용자 권한 그대로다. 묻는 건 옳지만 내장만 예외로 두면 정책이 둘이 된다 |
| 로그인 셸 발견 | 추천: `init.get` 에 `platform { os, shell }` 을 더하거나 `proc.defaultShell` 원시 기능. 명세 먼저(BR), SYS 에 한 줄 | 샌드박스 프레임은 환경을 볼 수 없고, 후보 순서는 fish 사용자를 놓친다 |
| 클립보드 | BR-06 의 `clipboard:read` · `clipboard:write` 가 오면 그걸로. 그때까지 네이티브 paste 이벤트 | 권한 모델 밖에서 Clipboard API 를 부르지 않는다 |
| 출력 묶음 | 열린 질문. 코어는 8 KiB 단위로 읽고 이벤트마다 postMessage 한 번. 폭주 때 런타임 또는 코어가 묶어야 하면 측정 뒤(TERM-E10) | 지금은 xterm 의 쓰기 버퍼가 받아 낸다. 숫자 없이 고치지 않는다 |
| `run` 의 셸+인자 | 거부. 결정됨(이 변경) | 셸 grant 로 임의 명령을 조용히 돌리는 우회를 플러그인 층에서 막는다. 코어의 grant 는 명령 이름까지만 본다 |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| 0 (이 변경) | 낯선 사람이 `just dev` 로 터미널을 열어 자기 셸을 쓰고, 탭 · 버퍼 · 테마 · 키가 데스크와 맞는다. 코어가 `proc.*` 를 처리한다 | TERM-S01 · 03 ~ 07, E01 · 03 · 05 · 06, I01 · 02, P01 ~ 06, C01 · 02 · 06 |
| 1 프로덕션 | 3 OS 실기 검증(한글 IME · 붙이기 · 크기), 로그인 셸 발견, 위협 모델, e2e 두 층, 성능 기준값, 실행 중 설정 반영 | TERM-S02 · 10, E02 · 04 · 09 · 10, I02 · 04, P07, C07, SET |
| 2 생태계 | 세션 복원 · 링크 · 검색 · capture · 폴더에서 열기 · 기록 · 상한 · 클립보드 권한 | TERM-S08 · 09, E07 · 08, I03 · 05, P08 · 09, C03 · 05 |
| 3 에이전트 | 승인 정책 아래 에이전트가 터미널에 타이핑하고 결과를 읽는다 | TERM-C03 · 04, AG-04 |

## 열린 질문

- [ ] 리로드 사이에 온 출력을 잃지 않으려면 코어가 호출자별로 짧은 출력 버퍼를 들고 있다가 재접속 때 넘겨야 하는가(`proc.attach`). 명세 변경이라 BR 에서 결정
- [ ] 폭주 출력의 묶음 단위와 자리(코어 · 런타임 · xterm) — TERM-E10 측정 뒤
- [ ] 터미널 표면이 없는 프로필에서 `endue.terminal.run` 이 불리면 표면을 어디에 열 것인가(display 규칙으로 충분한가)
- [ ] `Mod+F` 검색을 터미널이 가져갈 때 데스크의 찾기와 어떻게 나누는가
- [ ] 한 데스크의 터미널 수 상한과, 숨은 표면의 PTY 를 내릴 기준(RT-14 의 메모리 압박)
