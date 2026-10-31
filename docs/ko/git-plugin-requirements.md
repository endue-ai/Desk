# endue Desk Git 플러그인 요구사항

2026-10-31 · Team endue

> 키보드로 다루는 Git 표면을 Desk 의 기본 플러그인 `endue.git`(`plugins/git`) 이 맡으려면 무엇이 있어야
> 하는지를 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 BASE 표에서 한 줄(`git`)을 차지하고, 이 문서가 그
> 줄을 펼칩니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기
> 어려운 갈림길은 ADR 로 남깁니다. *현재* 열은 이 문서와 함께 들어간 `plugins/git` 의 첫 판(0.1.0) 기준입니다.

좋은 Git 표면의 값어치는 세 가지입니다. 저장소의 *지금* 이 한 화면(상태 버퍼)에 있고, 그 위에서 글자 하나로 일하고
(`s` `u` `c` `P`), 되돌리기 어려운 일은 한 번 더 묻습니다. Desk 에서는 하나가 더 붙습니다. 모든 동작이 커맨드이므로
키와 팔레트와 Eris 와 에이전트가 같은 길로 같은 일을 합니다.

## 약속

| # | 약속 | 뜻 | 지키는 요구사항 |
| --- | --- | --- | --- |
| 1 | 셸 없이 git 만 | `proc:spawn` 은 프로그램 `git` 하나. 인자는 배열, 경로 앞엔 늘 `--`. 광역 권한을 요구하지 않는다 | NF-01 |
| 2 | 모든 동작은 커맨드 | `endue.git.*` 열넷. 키 · 팔레트 · Eris · 에이전트 · CLI 가 같은 커맨드를 부른다 | GIT-01~10 · GIT-19 |
| 3 | 되돌리기 어려우면 묻는다 | discard · 강제 push 는 사람이 고르기 전엔 돌지 않는다. `--force` 는 없고 `--force-with-lease` 만 | GIT-04 · GIT-09 |
| 4 | 화면은 버퍼다 | 상태 · 로그 · diff 가 각각 데스크 버퍼라 `Mod+B` 와 버퍼 목록이 닿는다 (Emacs 의 버퍼 모델) | GIT-07 · GIT-08 |
| 5 | 못 하면 말로 | git 의 말을 접두사 없이, 코드 없이 상태 줄과 데스크 알림에. 데스크가 아직 못 하는 것(proc)도 같은 자리에 | NF-02 · D1 |

## 빌린 개념

Emacs 식 키보드 Git 프론트의 관용을 빌립니다. 상태 버퍼 · 글자 하나 커맨드 · 되돌리기 전 확인은 그대로, 버퍼와
커맨드는 Desk 의 것으로 바꿔 답니다.

| 관용 | Desk `endue.git` | 요구사항 |
| --- | --- | --- |
| 상태 버퍼: 섹션별 목록, `TAB` 접기 | 상태 뷰: Head · Upstream · Unmerged · Untracked · Unstaged · Staged · Stashes · Recent, `Tab` 접기 | GIT-02 |
| 글자 하나 커맨드 (`s` `u` `k` `c` `F` `P` `b` `l` `d` `g`) | 뷰별 키 표(`ui/keys.js`); Mod 가 붙은 키는 데스크 키맵으로 | GIT-02 · NF-04 |
| 커맨드 앞 스위치 팝업 (`c` → `-s` `a` …) | 2단계: which-key 식 힌트 패널과 스위치 | GIT-18 |
| hunk · 영역 스테이징 | `git apply --cached -` 에 패치를 넣는다 → 브리지가 stdin 을 닫아야 한다 | GIT-05 · D3 |
| 로그 버퍼의 그래프 | `--topo-order` 레코드를 lane 으로 배치(`layoutGraph`), SVG 로 그린다 | GIT-07 |
| diff 버퍼: 줄 번호, 파일 · hunk 접기 | diff 뷰; 줄 하나도 항목이라 `s` 가 그 파일을 스테이징한다 | GIT-08 |
| 편집기에서 쓰는 커밋 메시지 | 표면 안 에디터(Mod+Enter · Escape); 3단계에 `GIT_EDITOR` 를 `desk` CLI 로 | GIT-06 · GIT-20 |
| 실행 기록 버퍼 | 실행 기록은 `log.write` 로 채널에(명령과 종료 코드만, 출력은 남기지 않는다) | NF-01 |
| 저장소 전환 (상태 커맨드 + 디렉터리) | 최근 저장소 목록(store) + 자유 입력 | GIT-01 |

## 아키텍처 매핑

- **종류**: `kind: ui`. 파싱 · 레이아웃은 JS, 권한 모델은 다른 UI 플러그인과 같다. Wasm 로직 플러그인은 아니다(가정 1).
- **권한**: `proc:spawn { commands: ["git"] }` 와 `cmd:invoke` 넷(`desk.files.open` · `desk.palette.pick` · `desk.buffers.open` ·
  `desk.buffers.update`). `fs:*` · `net:*` · `ui:notify` 는 없다.
- **표면**: `main` 하나(`center`). 로그 · diff 뷰는 `desk.buffers.open` 으로 버퍼가 되고 `desk.buffers.show` · `.closed` 를 답한다.
- **기여**: 커맨드 14 · 키 1(`Mod+Shift+G` → `endue.git.status`) · 설정 6(`log-count` `diff-context` `sign-off` `pull-rebase`
  `confirm` `recent-max`). 설정은 `init.get` 레이어에서 읽는다(D6).
- **실행 모델**(`ui/run.js`): 명령마다 `proc.spawn` 하나. 고정 인자 `--no-pager -c color.ui=never -c core.quotepath=false`,
  환경 `GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 LC_ALL=C`. 출력은 `proc.output` 을 `procId` 로 모아 `proc.exit` 에서
  한 번에 디코딩(청크 경계의 멀티바이트 안전). 읽기 30 초 타임아웃, 네트워크는 무제한 + 취소(`endue.git.cancel`), 출력
  8 MiB 상한, spawn 응답보다 먼저 온 이벤트 보관, 권한 거절 시 `perm.request` 한 번.
- **모듈**: `parse-status` · `parse-log`(+ `layoutGraph`) · `parse-diff`(+ `hunkPatch`) · `actions` · `git`(컨트롤러) · `view*` ·
  `keys` · `settings`. 파일마다 400 줄 이하, DOM 없는 모듈은 전부 vitest 로.

## 요구사항

### 기능 (GIT)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| GIT-01 | 저장소 열기: `{ path }` 인자, 없으면 최근 목록(store `recent`, `recent-max` 개) + 자유 입력 pick. `rev-parse --show-toplevel` 로 루트를 잡고, 저장소가 아니면 `Not a Git repository: <path>.` | 있음 | A |
| GIT-02 | 상태 뷰: `status --porcelain=v2 --branch -z`. Head(브랜치 · detached · 첫 커밋 전) · Upstream(↑↓) · Unmerged(코드의 말) · Untracked · Unstaged · Staged(rename 은 `old → new`, 서브모듈 표시) · Stashes · Recent commits 10. 섹션 접기, 커서, `n`/`p`/화살표 | 있음 | A |
| GIT-03 | 새로고침: `g` · 모든 변경 동작 뒤 · 버퍼가 다시 보일 때. 자동 새로고침(`.git` 감시)은 좁은 `fs:read` 요청 모델이 선 뒤 | 일부 (수동 · 동작 뒤) | A · B |
| GIT-04 | 스테이징: 파일 · 섹션 · 전체 `add`, unstage `restore --staged`(첫 커밋 전엔 `rm --cached`), discard 는 확인 뒤 `restore --worktree` 또는 `clean -fdq` | 있음 | A |
| GIT-05 | 부분 스테이징: hunk · 선택 영역을 `git apply --cached -`(`--reverse` 로 unstage). `hunkPatch` 는 있으나 브리지가 stdin 을 닫지 못해 돌지 않는다 | 일부 (패치 생성만; D3) | B |
| GIT-06 | 커밋: 에디터(메시지 · amend · sign-off), `commit -q --cleanup=strip -m`, 빈 메시지 · 빈 인덱스 거절, 결과 sha 를 말한다. `{ message }` 인자로는 에디터 없이 즉시 | 있음 | A |
| GIT-07 | 로그 그래프: `--topo-order` 레코드(`%x1f` · `%x1e` 구분)를 lane 으로 배치. 공유 부모는 왼쪽 lane 에 두어 first-parent 선이 곧다. refs 배지(branch · remote · tag · current), 상대 시간, `+` 더 보기(`--skip`), `a` 모든 브랜치 | 있음 | A |
| GIT-08 | diff: unstaged · staged · 파일 · 커밋(`show --format=`). 파일 · hunk 접기, 옛/새 줄 번호, binary · rename · mode 표시, `-U<diff-context>` | 있음 | A |
| GIT-09 | 원격: `fetch --prune`, `pull --ff-only`(설정으로 `--rebase`), `push`(upstream 없으면 리모트 pick 뒤 `-u <remote> HEAD`), 강제는 확인 뒤 `--force-with-lease` 만. 돌아가는 동안 취소 | 있음 | A |
| GIT-10 | 브랜치: `for-each-ref` 목록 pick → `switch`, 원격은 `--track`, 새 이름은 `check-ref-format --branch` 뒤 `switch -c` | 있음 | A |
| GIT-11 | 파일 열기: 선택한 파일을 `desk.files.open { path }` 로 데스크의 opener 에. diff 줄에서 열면 그 줄로 | 일부 (줄 번호는 D4) | A · B |
| GIT-12 | 스태시: `stash push`(메시지 · `--include-untracked`) · `pop` · `apply` · `drop`(확인) | 일부 (목록만) | B |
| GIT-13 | 충돌: ours · theirs 택하기, 열어서 고친 뒤 해결 표시(`add`), 머지 · 리베이스 중단과 계속 | 일부 (목록과 라벨) | B |
| GIT-14 | 역사 손보기: cherry-pick · revert · reset(soft · mixed · hard 는 확인) · 대화형 리베이스(GIT-20 뒤) | 없음 | B · C |
| GIT-15 | blame 과 파일 이력(`log --follow -- path`) | 없음 | B |
| GIT-16 | 태그: 목록 · 만들기(주석) · 삭제(확인) · push | 없음 | B |
| GIT-17 | 서브모듈 · 워크트리 목록과 열기 | 없음 | C |
| GIT-18 | transient 메뉴: 커맨드 앞에 스위치(`--amend` `--signoff` `--force-with-lease` …)를 고르는 which-key 식 패널 | 없음 (`?` 는 키 목록만) | B |
| GIT-19 | Eris · 에이전트: 커맨드마다 `argsSchema`(`cmd.register` 로 보강) · 자연어 → 커맨드 · 되돌리기 어려운 동작은 AG-04 승인 정책 · 활동 기록 | 일부 (커맨드 · 인자만) | C |
| GIT-20 | `GIT_EDITOR` · `GIT_SEQUENCE_EDITOR` 를 `desk` CLI 로(ADR 0030): git 이 편집기를 부르면 데스크의 에디터 표면이 열리고 답이 돌아간다 | 없음 | C |
| GIT-21 | 포지(GitHub · GitLab 의 PR · MR · 이슈) | 범위 밖 — 별도 플러그인 | — |

### 비기능 (NF)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| NF-01 | 보안: 셸 없음, 인자 배열, 경로 앞 `--`, 빈 경로 거절, 프로그램은 `git` 하나(광역 권한 없음), 프롬프트 금지(`GIT_TERMINAL_PROMPT=0`), 출력은 로그에 남기지 않는다, 되돌리기 어려운 동작은 확인(설정 `confirm`, 팔레트가 꺼져 있으면 거절) | 있음 (로그 채널은 `log.*` 가 서빙되면) | A |
| NF-02 | 오류 문구: git 의 `fatal:` `error:` `hint:` 를 떼고 세 줄 이내, 코드 없는 문장. 상태 줄(`role=status`)과 커맨드 답 둘 다 | 있음 | A |
| NF-03 | 성능: 상태의 세 읽기는 병렬. 로그는 `log-count`(200)씩, 1,000 커밋 레이아웃 100 ms 이내. 출력 8 MiB 상한, 읽기 30 초, 네트워크 취소. 큰 diff 는 상한과 "그래도 열기" | 일부 (상한 · 타임아웃 · 페이지; 큰 diff 상한은 없음) | A · B |
| NF-04 | 접근성: 키보드만으로 전부, `role=tree` + `aria-level` · `aria-expanded` · `aria-selected`, 커서 행이 포커스, 상태 줄은 live region, Mod 키는 가로채지 않는다 | 있음 | A |
| NF-05 | 테마: `--desk-*` 토큰, lane 색 8종은 플러그인 소유. 두 테마에서 글자 대비 4.5:1 | 일부 (대비 테스트 없음) | A · B |
| NF-06 | 국제화: 문자열은 영어 한 곳에. RT-13 번들이 오면 `locales` | 없음 | C |
| NF-07 | git 2.25 이상(porcelain v2 · `restore` · `switch`). 저장소를 열 때 `git --version` 을 보고 낮으면 말한다 | 없음 | B |
| NF-08 | Windows: 경로 구분자 · 신호 · `/dev/null` 없이. 앱 e2e 가 Linux 를 먼저 덮는다 | 없음 | C |
| NF-09 | 테스트: 파서 · 레이아웃 · 실행기 · 동작 단위(`plugins/git/tests`, 57), 매니페스트는 Ajv 와 `desk plugin validate`. 런타임 e2e 는 스텁의 가짜 proc(D5) 뒤, 앱 e2e 는 임시 저장소로 | 일부 (단위만) | A · B |

## 의존: Desk 쪽에서 해야 하는 것

플러그인은 공개 API 만 쓰므로 아래는 전부 플러그인 밖의 일이고, 이 문서와 함께 들어간 변경은 `plugins/git/**` 과 문서뿐이다.

| ID | 무엇 | 어디 | 없으면 |
| --- | --- | --- | --- |
| D1 | 코어가 `proc.*` 를 서빙 (#77) | `crates/desk-core` | 플러그인은 `This desk cannot run programs yet: proc.spawn is unsupported.` 만 말한다 |
| D2 | 런타임이 `proc.output` · `proc.exit` 를 `procId` 로 스폰한 플러그인에 보낸다 — `fs.changed` 를 `watchId` 로 보내는 `#watches` 와 같은 자리(`packages/runtime/src/plugins.ts` 의 `#claim` · `#onEvent`) | `packages/runtime` | 출력이 어느 프레임에도 닿지 않아 모든 명령이 타임아웃. `PluginHost` 단위 테스트가 없어 이 작업이 첫 테스트를 만든다 |
| D3 | 브리지가 stdin 을 닫는 길: `proc.write { end: true }` 또는 `proc.close` (스펙 · 벡터 · codegen · 코어 · 스텁 · SDK) | `specs/bridge/v0` (메인테이너) | GIT-05 부분 스테이징, `commit -F -`, `apply` 전부 불가 |
| D4 | `desk.files.open { path, line?, column? }` 과 opener 요청 `desk.files.visit` 에 줄 번호 | `plugins/files` · `packages/runtime` | diff 줄에서 열면 파일 첫 줄 |
| D5 | `browserStub` 의 가짜 proc (BR-07): 스크립트로 답하는 `git` | `packages/bridge` | `pnpm dev` 와 런타임 e2e 에서 플러그인을 못 돌린다 |
| D6 | 코어가 `settings.*` 를 서빙 (#81) | `crates/desk-core` | 지금은 `init.get` 레이어만 읽는다; 실행 중 변경이 반영되지 않는다 |
| D7 | (선택) `dialog` 브리지(BR-01) | `specs/bridge` | 확인은 `desk.palette.pick` 두 항목으로 |
| D8 | (선택) 저장소 단위로 좁게 묻는 `fs:read` — 매니페스트에 선언하지 않은 범위를 `perm.request` 로 묻는 길 | `specs/plugin` · 코어 | GIT-03 자동 새로고침 없음(`~/**` 를 선언하면 빌트인은 설치 때 통째로 허락되므로 선언하지 않는다) |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| A | 저장소를 열어 상태를 보고, 파일 단위로 스테이징 · 커밋 · fetch · pull · push · 브랜치 전환을 키 하나로 하고, 로그 그래프와 diff 를 읽는다. D1 · D2 가 들어오면 그대로 돈다 | GIT-01~04 · 06~10 · 11(파일) · 12(목록), NF-01~05, NF-09(단위) |
| B | 날마다 쓰는 나머지: hunk 스테이징, 스태시, 충돌 해결, cherry-pick · revert · reset, blame, 태그, 스위치 팝업, 자동 새로고침, e2e | GIT-05 · 12~16 · 18, GIT-03 자동, NF-03 큰 diff, NF-05 대비, NF-07, NF-09(e2e) |
| C | 대화형 리베이스와 편집기 연동, 에이전트의 git, 서브모듈 · 워크트리, Windows, 국제화 | GIT-14(리베이스) · 17 · 19 · 20, NF-06 · 08 |

## 가정과 결정 (뒤집으려면 거절에 한 줄로)

1. `kind: ui`. 파싱 · 레이아웃이 JS 로 충분하고, 권한 경계는 브리지 하나라 Wasm 이 더 안전하지도 않다.
2. id `endue.git`, 이름 Git, 표면 하나. 로그 · diff 는 새 표면이 아니라 같은 표면의 버퍼다.
3. `pull` 기본은 `--ff-only`. `endue.git.pull-rebase` 로 `--rebase`. 머지 커밋을 만드는 pull 은 없다.
4. `push --force` 는 어떤 인자로도 내지 않는다. `{ force: true }` 는 확인 뒤 `--force-with-lease`.
5. 확인은 `desk.palette.pick` 두 항목(`yes` · `no`). 팔레트가 없으면 되돌리기 어려운 동작은 돌지 않는다. `endue.git.confirm: false` 만 묻지 않는다.
6. 커밋 메시지는 `-m` 인자로(개행 포함). stdin 을 닫을 수 없어 `-F -` 는 쓰지 않는다(D3).
7. 첫 커밋 전 unstage 는 `rm --cached -q -r`(HEAD 가 없어 `restore --staged` 가 실패한다).
8. 저장소 선택은 최근 목록 + 자유 입력. `${workspace}` 루트는 코어가 아직 해석하지 않으므로 쓰지 않는다.
9. 키: 이동은 `n`/`p`/화살표, `k` 는 discard, `q` 는 상태로 돌아가기(표면 닫기는 데스크의 `Mod+W`). `a` 는 상태에선 amend, 로그에선 모든 브랜치.
10. 고정 환경: `GIT_TERMINAL_PROMPT=0`(자격 증명이 없으면 즉시 실패), `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`(파싱 가능한 메시지). `GIT_SSH_COMMAND` 는 건드리지 않는다.
11. 로그 레코드 구분자는 `%x1f` · `%x1e`. 커밋 제목에 그 제어 문자가 없다고 본다.
12. 그래프의 공유 부모는 왼쪽 lane 에 둔다. 오른쪽 lane 은 `joins` 로 왼쪽에 합류해 first-parent 선이 곧다.
13. 상태의 최근 커밋은 `log -n 10`, 종료 128(커밋 없음)은 빈 목록이다.
14. 로그 · 코어 · 스펙 · 런타임은 이 작업에서 손대지 않는다. D1~D8 은 각각 Task 이슈로 간다.

## Task 이슈 분할안

| 순서 | 이슈 | Scope | 선행 |
| --- | --- | --- | --- |
| T1 | `plugins/git` 편입 (A 단계, 이 문서) | `plugins/git/**` · `plugins/README.md` · `docs/ko/git-plugin-requirements.md` · `docs/ko/desk-requirements.md` | — |
| T2 | D2: 런타임의 `proc.*` 라우팅과 `PluginHost` 첫 단위 테스트 | `packages/runtime/src/plugins.ts` · `plugins.test.ts` | #77 와 무관하게 가능 |
| T3 | D3: `proc.write { end }` 스펙 · codegen · 코어 · 스텁 · SDK | `specs/bridge/v0/**` · 생성 파일 · `crates/desk-core/**` · `packages/bridge/**` | #77 |
| T4 | GIT-05 hunk · 영역 스테이징 | `plugins/git/**` | T3 |
| T5 | D5: 스텁의 가짜 `git` 과 `packages/runtime/e2e/git.spec.ts` | `packages/bridge/src/**` · `packages/runtime/e2e/**` | T2 |
| T6 | D4: `desk.files.open` 의 줄 번호 | `plugins/files/**` · `packages/runtime/src/policies/files.ts` · `plugins/notes/**` | — |
| T7 | GIT-12 · 13 스태시와 충돌 | `plugins/git/**` | T1 |
| T8 | GIT-18 transient 패널 | `plugins/git/**` | T1 |

## 열린 질문

- 자격 증명: HTTPS 토큰 · SSH 암호문을 데스크가 받아 줄 길(askpass 를 `desk` CLI 로, 토큰은 SYS-06 키체인에). C 단계 설계가 필요하다.
- 아주 큰 저장소: untracked 가 수천 개일 때 `-uno` 를 켤지, 섹션을 접은 채 셀지.
- 에이전트가 부르는 git: AG-04 의 승인 정책과 이 플러그인의 `confirm` 중 어느 쪽이 묻는가. 둘 다 묻지는 않아야 한다.
