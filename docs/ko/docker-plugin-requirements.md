# endue Desk Docker 플러그인 요구사항

2026-10-31 · Team endue

> 컨테이너 관리 표면을 Desk 의 기본 플러그인 `endue.docker`(`plugins/docker`) 가 프로덕션 수준에서 맡으려면 무엇이
> 있어야 하는지를 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 BASE 표에서 한 줄(`docker`)을 차지하고, 이 문서가
> 그 줄을 펼칩니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 왜 Engine API 소켓이 아니라 docker CLI 인지는
> ADR 0038 이, 코드가 하는 일은 `plugins/docker/README.md` 가 말합니다. *현재* 열은 이 문서와 함께 들어간 첫 판(0.1.0)
> 기준입니다.

좋은 컨테이너 표면의 값어치는 셋입니다. 엔진의 *지금*(무엇이 돌고, 무엇이 죽었고, 무엇이 자리를 차지하는지)이 한 화면에
늘 최신으로 있고, 그 위에서 글자 하나로 일하고(`s` `x` `l` `e`), 되돌리기 어려운 일은 한 번 더 묻습니다. Desk 에서는 하나가
더 붙습니다. 모든 동작이 커맨드라 키 · 팔레트 · Eris · 에이전트가 같은 길로 같은 일을 하고, 에이전트는 인자 스키마를 보고 부릅니다.

## 표준

| 표준 | 어디에 | 요구사항 |
| --- | --- | --- |
| Docker Engine API (ContainerJSON) | 상세는 `docker container inspect` 의 JSON 을 그대로 읽는다 | DOCK-07 |
| docker CLI 의 Go 템플릿 · `{{json}}` | 목록은 플러그인이 정한 필드 이름의 NDJSON 으로 받는다(버전 사이 모양이 바뀌지 않게) | DOCK-03 · NF-06 |
| OCI distribution reference 문법 | 이미지 참조(`registry[:port]/path[:tag][@digest]`) 검증 | DOCK-10 · 11 · NF-01 |
| Compose Specification | 프로젝트 이름 규칙(`[a-z0-9][a-z0-9_-]*`), 설정 파일 · `.env` 는 파일 폴더 기준 | DOCK-14 |
| Docker contexts | 엔진 선택은 `--context` 플래그로만. 전역 `docker context use` 는 쓰지 않는다 | DOCK-02 |
| RFC 3339 | 로그 줄의 시각(`--timestamps`), 에이전트용 `since` | DOCK-06 |

## 약속

| # | 약속 | 뜻 | 지키는 요구사항 |
| --- | --- | --- | --- |
| 1 | 셸 없이 docker 만 | `proc:spawn` 은 프로그램 `docker` 하나(Compose 는 `docker compose`). 인자는 배열, 모든 이름은 검사, 위치 인자 앞엔 `--` | NF-01 |
| 2 | 모든 동작은 커맨드 | `endue.docker.*` 서른여덟. `cmd.register` 로 설명과 인자 스키마를 보태 에이전트가 읽는다 | DOCK-17 |
| 3 | 되돌리기 어려우면 묻는다 | kill · rm · down · prune 은 사람이 고르기 전엔 돌지 않는다. 볼륨 삭제는 따로 묻는다 | DOCK-05 · 10 · 12~15 |
| 4 | 화면은 늘 최신 | `docker events` 를 상시 따라가 보이는 목록만 다시 읽는다. 폴링하지 않는다 | DOCK-04 |
| 5 | 못 하면 말로 | 데몬 꺼짐 · 소켓 권한 · Compose 없음 · docker 없음을 정해진 문장과 할 일로 | NF-02 |
| 6 | 비밀은 가린다 | 이름이 비밀처럼 보이는 환경 변수 값은 상세에서 가리고, 로그는 데스크 로그에 남기지 않는다 | DOCK-07 · NF-01 |

## 빌린 개념

Docker Desktop · lazydocker · Portainer · k9s 의 관용을 빌리고, 버퍼 · 커맨드 · 알림은 Desk 의 것으로 바꿔 답니다.

| 관용 | Desk `endue.docker` | 요구사항 |
| --- | --- | --- |
| 프로젝트별로 묶인 컨테이너 목록(Docker Desktop) | 컨테이너 뷰: Compose 프로젝트 섹션(서비스 이름) + 나머지, 접기 | DOCK-03 |
| 탭 사이를 숫자로(lazydocker) | `1` 컨테이너 · `2` Compose · `3` 이미지 · `4` 볼륨 · `5` 네트워크 · `6` 엔진 | DOCK-03 · 10~15 |
| 따라가는 로그(`logs -f`) | 로그 버퍼: 링 버퍼 · stderr 색 · 필터 · 시각 토글 · 끝에 붙어 있기 | DOCK-06 |
| `exec -it` 셸 | 터미널 플러그인의 PTY 로(`endue.terminal.run`) | DOCK-09 |
| 컨테이너 상세(Portainer) | 상세 버퍼: 개요 · 상태와 헬스 · 포트 · 마운트 · 네트워크 · 환경 · 라벨 · 한도 | DOCK-07 |
| 자원 사용(`docker stats`, k9s) | 컨테이너 행의 CPU · 메모리, 보일 때만 샘플 | DOCK-08 |
| 컨텍스트 전환(k9s 의 context) | 플러그인 안에서만 바뀌는 `--context`, store 에 기억 | DOCK-02 |

## 아키텍처 매핑

- **종류**: `kind: ui`. 파싱 · 상태는 JS, 권한 경계는 브리지 하나(git · 터미널과 같다).
- **권한**: `proc:spawn { commands: ["docker"] }`, `cmd:invoke` 다섯(`desk.palette.pick` · `desk.buffers.open` ·
  `desk.buffers.update` · `desk.files.open` · `endue.terminal.run`), `ui:notify`. `fs:*` · `net:*` 은 없다.
- **표면**: `main` 하나(`center`). 로그 · 상세는 `desk.buffers.open` 으로 버퍼가 되고 `desk.buffers.show` · `.closed` 를 답한다.
- **기여**: 커맨드 38 · 키 1(`Mod+Shift+K` → `endue.docker.open`) · 설정 13. 설정은 `init.get` 레이어에서 읽는다.
- **실행 모델**(`ui/run.js`): 명령마다 `proc.spawn` 하나, 환경 `DOCKER_CLI_HINTS=false`, 컨텍스트가 있으면 `--context`.
  읽기 15 초, 수명주기 `stop-timeout + 30` 초, pull · Compose · prune 은 무제한 + 취소. 출력 8 MiB 상한. 스트림(`logs -f`,
  `events`)은 줄 단위로 넘기고 한 줄 64 KiB 에서 자른다. docker 를 못 찾으면 잘 알려진 설치 폴더 PATH 로 한 번 더.
- **모듈**: `run` · `errors` · `parse-list` · `parse-engine` · `inspect` · `refs` · `actions` · `actions-more` · `logs` · `watch` ·
  `live` · `engine` · `lists` · `desk` · `docker`(컨트롤러) · `commands` · `schemas` · `view*` · `keys`. 파일마다 400 줄 이하.

## 요구사항

### 기능 (DOCK)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| DOCK-01 | 엔진 연결과 진단: 시작 때 `docker version --format '{{json .}}'`(종료 1 이어도 클라이언트를 읽는다). 헤더에 엔진 버전 · 플랫폼 · 컨텍스트 · live 점. docker 없음 · 데몬 꺼짐 · 소켓 권한 · proc 미지원을 각각 다른 문장으로, 읽기가 되면 지운다 | 있음 | A |
| DOCK-02 | 컨텍스트: `context ls` 목록 pick(“CLI 의 현재” 포함), 이후 모든 호출에 `--context`. 선택은 store `context`, 설정 `context` 가 기본값. 바꾸면 이벤트 스트림을 새 엔진에 다시 붙인다 | 있음 | A |
| DOCK-03 | 컨테이너 목록: `ps --no-trunc` 한 번(템플릿, `.Size` 없음). 상태 점(running · paused · restarting · exited · created · dead, health), 이름(프로젝트 안에선 서비스), 이미지, 상태 문구, 게시 포트, CPU · 메모리. 실행 중만/전부(`a`, 리로드 뒤에도 유지). Compose 프로젝트 섹션 접기 | 있음 | A |
| DOCK-04 | 실시간 갱신: `docker events`(container · image · volume · network)를 상시 따라가 250 ms 조용해지면 화면의 목록 · 상세만 다시 읽고, 안 보이는 목록은 다음에 보일 때 읽는다. 스트림이 끝나면 1 → 30 초 백오프(30 초 넘게 건강했으면 처음부터), 다시 붙으면 엔진을 확인하고 화면을 다시 읽는다(Docker Desktop 재시작). docker 없음 · 권한 거절 · 없는 컨텍스트면 멈춘다 | 있음 | A |
| DOCK-05 | 수명주기: start · stop(`-t stop-timeout`) · restart · pause/unpause(`P` 토글) · kill(확인) · rm(확인, 실행 중이면 `-f` 를 문구에 밝힘, `volumes: true` 면 `-v`). 끝나면 새로고침과 결과 문장 | 있음 | A |
| DOCK-06 | 로그: `logs --timestamps --tail N [--follow]` 스트림을 로그 버퍼에. stdout/stderr 구분, ANSI 제거, 시각 토글(`t`), 따라가기 토글(`f`), 필터(`/`, 낱말 모두 · 대소문자 무시), `log-max` 줄 링 버퍼(DOM 은 덧붙이기만), 대상이 바뀌거나 버퍼를 닫으면 프로세스 종료. Compose 프로젝트 로그는 서비스 접두를 따로 읽는다 | 있음 | A |
| DOCK-07 | 상세: `container inspect` → 개요 · 상태(헬스 마지막 5회) · 포트 · 마운트 · 네트워크 · 환경(비밀 같은 값 가림, 설정 `reveal-env`) · 라벨 · 한도. 버퍼. 이 컨테이너의 이벤트에 다시 읽고, 사라지면 목록으로 | 있음 | A |
| DOCK-08 | 자원 사용: 컨테이너 뷰가 보이고 실행 중인 것이 있을 때만 `stats --no-stream` 을 `stats-interval` 초마다(0 이면 끔). 실패한 샘플은 지난 값을 둔다 | 있음 | A |
| DOCK-09 | 셸: `endue.terminal.run { command: "docker", args: [--context?, exec, -it, --, id, …shell] }`. 셸은 설정 `shell`, 에이전트는 `command` 배열. 터미널 플러그인이 꺼져 있으면 그렇게 말한다 | 있음 | A |
| DOCK-10 | 이미지: 목록(참조 · id · 크기 · 생성 · 쓰는 컨테이너 수, dangling 은 뒤로), pull(OCI 참조 검증, 무제한 + 취소), 삭제(쓰는 컨테이너가 있으면 먼저 거절, 확인), prune(dangling, `all` 이면 안 쓰는 전부, 확인) | 있음 | A |
| DOCK-11 | 컨테이너 실행: `{ image, name?, ports?, env?, volumes?, restart?, command? }` 를 검사해 `run -d --label ai.endue.desk.created-by=endue.docker … -- IMAGE cmd…`. 키보드는 이미지 행 `R` → 이름 · 포트 pick. privileged · cap-add · host 네트워크/PID 같은 권한 넓히기는 제공하지 않는다. 맨 키 `-e KEY`(데스크 환경 유출)는 거절 | 있음 | A |
| DOCK-12 | 볼륨: 목록(익명 표시, 프로젝트), 삭제(확인, “데이터는 사라진다”), prune(익명만, `all` 이면 이름 있는 것도, 확인) | 있음 | A |
| DOCK-13 | 네트워크: 목록(드라이버 · 범위 · internal · 기본), 삭제(확인, bridge · host · none 거절), prune(확인) | 있음 | A |
| DOCK-14 | Compose: `compose ls --all` 목록(상태, 설정 파일, 서비스 행). up(`-f` 파일들, 파일 폴더에서) · down(확인, `volumes` 는 따로) · start · stop · restart(라벨로, 루트에서 — 엉뚱한 폴더의 compose 파일을 읽지 않게) · pull · logs. 파일 경로로 up(`{ file }`), 설정 파일 열기(`desk.files.open`) | 있음 | A |
| DOCK-15 | 엔진 화면: 서버 · 클라이언트 버전, 컨텍스트, `system df`(크기 · 회수 가능). 정리 `system prune -f`(확인, `all` · `volumes` 는 인자 + 문구) | 있음 | A |
| DOCK-16 | 알림: 스스로 0 아닌 코드로 끝남(누가 stop · kill 한 직후는 제외) · OOM · unhealthy 를 `ui.notify` 로. 같은 컨테이너 같은 종류는 60 초에 한 번(재시작 루프). 설정 `notify` | 있음 | A |
| DOCK-17 | 커맨드와 에이전트: 모든 동작이 커맨드, 읽기 커맨드는 구조화된 JSON 을 돌려준다(목록 · 상세 · stats · `tail`). 매니페스트의 제목 · 키워드와 같은 값으로 `cmd.register` 해 설명 · `argsSchema` 를 보탠다 | 있음 | A |
| DOCK-18 | 취소: pull · Compose · prune 등 돌고 있는 명령을 `endue.docker.cancel` 로 SIGTERM | 있음 | A |
| DOCK-19 | 여러 개 표시(mark) 후 한꺼번에 동작, 목록 필터 · 정렬 | 없음 | B |
| DOCK-20 | 빌드: `docker build`(Dockerfile 열기, BuildKit 진행을 버퍼로), `compose build` | 없음 | B |
| DOCK-21 | 이미지 이력 · 레이어, `docker scout` 취약점 요약 | 없음 | B |
| DOCK-22 | 파일: `docker cp` 들이고 내보내기, 컨테이너 안 파일 탐색(explorer 와 이어서) | 없음 | C |
| DOCK-23 | 레지스트리 로그인: 자격 증명을 키체인(SYS-06)에, `--password-stdin`(D2 뒤) | 없음 | C |
| DOCK-24 | Swarm · Kubernetes | 범위 밖 — 별도 플러그인 | — |

### 비기능 (NF)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| NF-01 | 보안: 셸 없음, 인자 배열, 프로그램은 `docker` 하나, 이름 · 참조 · 포트 · 환경 · 볼륨 검사(앞이 `-` 인 값은 없다), 위치 인자 앞 `--`, 권한을 넓히는 run 옵션 없음, 전역 상태(`context use`)를 바꾸지 않음, 비밀 같은 환경 값 가림, 로그 출력은 데스크 로그에 안 남김, 되돌리기 어려운 동작은 확인(설정 `confirm`, 팔레트가 꺼져 있으면 거절) | 있음 | A |
| NF-02 | 오류 문구: `Error response from daemon:` · `Error:` · `docker:` 접두와 사용법 힌트를 떼고 세 줄 이내. 데몬 · 소켓 · Compose · 컨텍스트 · docker 없음은 고정 문장과 할 일. 상태 줄(`role=status`) · 헤더(`role=alert`) · 커맨드 답 | 있음 | A |
| NF-03 | 성능: 목록은 한 번 호출, 이벤트는 묶어서, stats 는 보일 때만, 로그는 링 버퍼 + 덧붙이기 렌더, 출력 8 MiB 상한, 한 줄 64 KiB. 같은 목록의 읽기가 겹치면 마지막 것만 그린다. 동작 뒤 새로고침 실패는 동작을 실패로 만들지 않는다 | 있음 | A |
| NF-04 | 접근성: 키보드만으로 전부, `role=tree` + `aria-level` · `aria-expanded` · `aria-selected`, 탭은 `role=tab`, 상태 점에 낱말 라벨, 로그는 `role=log`, Mod 키는 가로채지 않는다 | 있음 | A |
| NF-05 | 테마: `--desk-*` 토큰, 상태 색 넷은 플러그인 소유, 줄인 모션. 두 테마 대비 테스트 | 일부 (대비 테스트 없음) | A · B |
| NF-06 | 호환: docker CLI 20.10+ · Compose v2(`compose ls` 의 배열 · NDJSON 둘 다), Docker Desktop · Colima · OrbStack · Rancher Desktop(dockerd) · SSH 컨텍스트 · rootless. 옛 CLI 는 상태를 상태 문구에서 읽는다 | 있음 (실측: Docker 29.8 · Compose 5.5) | A |
| NF-07 | 찾기: Finder 로 띄운 앱의 PATH 에 docker 가 없으면 잘 알려진 설치 폴더로 한 번 더, 설정 `path` | 있음 | A |
| NF-08 | Podman: `docker` 호환 shim 경로만. `podman` 직접 실행은 열린 질문 | 없음 | C |
| NF-09 | 국제화: 문자열은 영어 한 곳에. RT-13 번들이 오면 `locales` | 없음 | C |
| NF-10 | Windows: named pipe · 경로 · 신호. 앱 e2e 가 Linux 를 먼저 덮는다 | 없음 | C |
| NF-11 | 테스트: 파서는 실제 Docker 29 출력에서 뜬 픽스처, 검사 · 실행기 · 로그 · 감시 · 동작 · 컨트롤러 · 렌더러 · 키 · 설정 · 매니페스트(`plugins/docker/tests`, 110). 실제 엔진 스모크(실행 · 로그 · 상세 · 정지 · 삭제 · Compose up/down)는 사람이 돌린다. 런타임 e2e 는 스텁의 가짜 proc(D4) 뒤 | 일부 (단위만) | A · B |

## 의존: Desk 쪽에서 해야 하는 것

| ID | 무엇 | 어디 | 없으면 |
| --- | --- | --- | --- |
| D1 | 앱이 로그인 셸의 PATH 를 읽어 프로세스에 넘긴다(VS Code 의 셸 환경 해석) | `apps/desk` · `crates/desk-sys` | 플러그인마다 설치 폴더를 추측한다(NF-07) |
| D2 | 브리지가 stdin 을 닫는 길(git 요구사항 D3 과 같다) | `specs/bridge/v0` (메인테이너) | `login --password-stdin` · `compose -f -` · `load` 불가 |
| D3 | `desk.buffers.close` 를 쓸 수 있게(사라진 컨테이너의 상세 버퍼를 닫기) | 권한 · `plugins/buffers` | 버퍼가 남고, 다시 보이면 목록을 보여 준다 |
| D4 | `browserStub` 의 가짜 proc(BR-07): 스크립트로 답하는 `docker` | `packages/bridge` | `pnpm dev` 와 런타임 e2e 에서 플러그인을 못 돌린다 |
| D5 | 코어가 `settings.*` 변경을 알린다 | `crates/desk-core` | 설정 변경은 다시 열어야 반영된다 |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| A | 엔진을 보고, 컨테이너 · Compose · 이미지 · 볼륨 · 네트워크를 키 하나로 다루고, 로그를 따라가고, 상세를 읽고, 셸을 열고, 정리하고, 실패를 알림으로 듣는다. 에이전트가 같은 커맨드를 스키마와 함께 쓴다 | DOCK-01~18, NF-01~04 · 06 · 07, NF-11(단위) |
| B | 일괄 동작 · 필터, 빌드, 이미지 이력과 취약점, 대비 테스트, e2e | DOCK-19~21, NF-05, NF-11(e2e) |
| C | 파일 복사와 탐색, 레지스트리 로그인, Podman, 국제화, Windows | DOCK-22 · 23, NF-08~10 |

## 가정과 결정 (뒤집으려면 거절에 한 줄로)

1. `kind: ui`, id `endue.docker`, 이름 Docker, 표면 하나. 로그 · 상세는 같은 표면의 버퍼다.
2. CLI 를 쓴다(ADR 0038). 소켓 · `net.fetch` 는 쓰지 않는다.
3. 키 `Mod+Shift+K`(`D` 는 방해 금지가 쓴다). 목록 안에서 `n`/`p` 는 이동이라 일시정지는 `P`.
4. 컨텍스트는 플러그인 안에서만 바뀐다. 전역 `docker context use` 는 사람의 터미널까지 바꾸므로 쓰지 않는다.
5. `rm` 기본은 익명 볼륨을 남긴다(`-v` 는 `volumes: true`). `down` 기본은 볼륨 · 이미지를 남긴다. `system prune` 기본은 볼륨을 남긴다.
6. 라벨로 부르는 Compose 명령(start · stop · restart · down · logs)은 루트(`/`)에서 돈다. 데스크 작업 폴더의 다른 compose 파일을 읽지 않게.
7. `-e KEY`(값 없는 환경 변수)는 거절한다. docker 가 데스크 프로세스의 값을 컨테이너에 넘기기 때문이다.
8. 플러그인이 시작한 컨테이너에는 `ai.endue.desk.created-by=endue.docker` 라벨을 붙인다.
9. 비밀 같은 환경 이름: pass · secret · token · key · credential · auth · private · salt · cookie · session · dsn · cert(대소문자 무시).
10. 알림은 stop · kill 이벤트 뒤 60 초 안의 종료, 플러그인이 멈춘 컨테이너(id 나 이름)는 말하지 않는다.
11. 확인은 `desk.palette.pick` 두 항목(`yes` · `no`). 자유 입력에서 빈 답은 “없음”, 취소는 취소다.

## Task 이슈 분할안

| 순서 | 이슈 | Scope | 선행 |
| --- | --- | --- | --- |
| T1 | `plugins/docker` 편입 (A 단계, 이 문서, ADR 0038) | `plugins/docker/**` · `plugins/README.md` · `docs/ko/docker-plugin-requirements.md` · `docs/ko/desk-requirements.md` · `docs/adr/0038-*` · `docs/qa/TESTING.md` | — |
| T2 | D1: 로그인 셸 PATH 해석 | `apps/desk/src-tauri/**` · `crates/desk-sys/**` | — |
| T3 | D4: 스텁의 가짜 `docker` 와 `packages/runtime/e2e/docker.spec.ts` | `packages/bridge/src/**` · `packages/runtime/e2e/**` | — |
| T4 | DOCK-19 일괄 동작 · 필터 | `plugins/docker/**` | T1 |
| T5 | DOCK-20 빌드 | `plugins/docker/**` | T1 |

## 열린 질문

- Podman: `podman` 을 직접 부를지(권한에 프로그램 하나 더), `docker` shim 만 믿을지.
- 에이전트가 부르는 파괴 동작: AG-04 승인 정책과 이 플러그인의 `confirm` 중 어느 쪽이 묻는가. 둘 다 묻지는 않아야 한다.
- 원격 컨텍스트(SSH)에서 이벤트 스트림이 끊길 때 백오프 상한(30 초)이 맞는가.
