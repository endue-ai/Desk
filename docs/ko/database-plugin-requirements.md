# endue Desk 데이터베이스 플러그인 요구사항

2026-10-31 · Team endue · 2026-11-23 갱신(PostgreSQL 클라이언트 계획 #438 의 D 단계)

> Desk 의 기본 플러그인 `endue.database`(`plugins/database`) 가 PostgreSQL · MySQL / MariaDB · SQLite 의
> 클라이언트를 맡으려면 무엇이 있어야 하는지를 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 BASE 표에서 한
> 줄(`database`)을 차지하고, 이 문서가 그 줄을 펼칩니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와
> 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다(ADR 0038). *현재* 열은 2026-11-23 의 `main`
> (`plugins/database` 0.2.0 에 #438 의 태스크가 들어간 상태) 기준이고, 숫자의 정본은 `plugin.json` 입니다.

좋은 DB 클라이언트의 값어치는 네 가지입니다. 연결이 한 곳에 모여 있고, 스키마를 펼쳐 보며 SQL 을 쓰고, 결과가
**정확**하고(NULL 과 빈 문자열과 문자열 'NULL' 이 다르게 보이고, 숫자가 반올림되지 않고), 운영 DB 에서 실수하기 어렵습니다.
Desk 에서는 둘이 더 붙습니다. 모든 동작이 커맨드라 키 · 팔레트 · Eris · 에이전트가 같은 길로 일하고, 플러그인은 매니페스트가
선언한 권한(ADR 0260) 밖으로 한 발도 나가지 못합니다. PostgreSQL 은 데스크 코어의 세션(`db.*`, ADR 0281)으로 돌아 설치할
프로그램이 없고, MySQL / MariaDB 와 SQLite 는 각자의 공식 클라이언트를 셸 없이 돌립니다(ADR 0038). 설치 때 받는 것은
프로그램 다섯(`mysql` · `mariadb` · `sqlite3` · `pg_dump` · `pg_restore`) · `~/Downloads` 쓰기 · 플러그인 폴더 읽기 · 쓰기 ·
데스크 커맨드 여섯 · `brain:ask` 이고, 서버 · 그 밖의 프로그램 · 사람이 고른 파일은 하나씩 묻습니다.

## 약속

| # | 약속 | 뜻 | 지키는 요구사항 |
| --- | --- | --- | --- |
| 1 | 셸 없이, 프로그램 없이 | PostgreSQL 은 코어의 세션으로, 클라이언트 프로그램 없이(ADR 0281). 서버는 처음 연결할 때 `db:connect` 로 묻는다. 다른 엔진은 클라이언트를 DB 밖으로 손을 뻗지 못하는 모드로(mysql `--binary-mode`, sqlite3 `-safe`). 설정이 다른 이름이나 전체 경로를 대면 그 프로그램은 처음 돌릴 때 묻는다(`*`, ADR 0260) | NF-01 · PG-01a~c |
| 2 | 비밀번호는 플러그인에 남지 않는다 | store · state · 로그 · 인자 · 기록 어디에도 없다. PostgreSQL 은 코어가 `~/.pgpass` 를 읽고, 사람이 고르면 OS 키체인에 맡기며 플러그인은 되읽지 못한다(`passwordRef`, ADR 0311). 그 밖에는 세션 동안 메모리에만 | DB-04 · NF-01 · PG-03 · PG-14 |
| 3 | 결과는 정확하다 | NULL · `''` · `'NULL'` 이 셋으로 보이고, 값은 서버가 보낸 글자 그대로(바이너리는 16진), PostgreSQL 은 열마다 타입과 원래 테이블까지 | DB-09 · NF-10 |
| 4 | 운영 DB 에서 실수하기 어렵다 | 읽기 전용 연결은 실행 전에 거절하고 서버 쪽에서도 막는다. production 태그 · 위험한 문장 · 에이전트의 쓰기는 묻는다. 객체 · 권한 · 표 설계의 변경은 대화상자가 보여 준 스크립트만 돈다(ADR 0312 · 0324 · 0330) | DB-12 · DB-17 · PG-52 · PG-91 |
| 5 | 모든 동작은 커맨드 | `endue.database.*` 220(2026-11-23) + `cmd.register` 로 올리는 에이전트용 셋. 매니페스트의 커맨드 중 42 개가 에이전트용(인자 스키마) | DB-01~29 · PG 전부 |

## 빌린 개념

데스크톱 DB 클라이언트들과 psql 이 굳혀 온 관용을 빌립니다. 연결 트리 · 콘솔 · 결과 탭은 그대로, 버퍼와 커맨드는 Desk 의
것으로 바꿔 답니다.

| 관용 | Desk `endue.database` | 요구사항 |
| --- | --- | --- |
| 연결 목록 · 그룹 · 색 | 탐색기의 연결 줄, 환경 태그(development · staging · production)와 색, production 은 표면 위 띠 | DB-01 · NF-05 |
| 연결 문자열 붙여 넣기 · 연결 옮기기 | URI 로 새 연결(`postgresql://` `mysql://` `mariadb://` `sqlite:`), 비밀번호 없는 연결 파일과 `pg_service.conf` 가져오기 | DB-02 · PG-15 |
| 데이터베이스 탐색 트리 | 연결 → 데이터베이스(PostgreSQL) → 스키마 → 종류별 폴더 → 객체 → 열 · 키 · 인덱스 · 트리거, PostgreSQL 은 스키마 캐시에서 | DB-06 · PG-06 · PG-13 · PG-50 |
| SQL 콘솔, 커서의 문장 실행 | 연결마다 콘솔 여럿, `Mod+Enter` 커서의 문장(또는 선택 영역), `Mod+Shift+Enter` 스크립트 전체, `.sql` 파일은 그 파일의 콘솔 | DB-07 · PG-24 |
| 열린 트랜잭션 · 자동 커밋 끄기 | 콘솔의 세션이 실행 사이에 이어지고, Manual 모드 · Commit · Rollback · 격리 수준 · 세이브포인트 | DB-21 · DB-28 · PG-02 · PG-20 |
| 결과 탭 · 그리드 | 결과 집합마다 탭 + Messages 탭, 보이는 행만 그리는 그리드, 정렬 · 열 숨기기 · 고정 · 빠른 필터, 블록 선택, `Mod+C` | DB-09 · PG-42 |
| 행 상한 · "더 불러오기" | PostgreSQL 콘솔의 읽기 하나는 커서로 끝까지 스크롤, 그 밖에는 `max-rows` 만 들고 More rows 는 네 배로 다시 | DB-10 · PG-22 |
| 쿼리 취소 | PostgreSQL 은 `db.cancel` 로 서버에서, mysql 은 KILL QUERY, sqlite3 는 interrupt. 1초 뒤 SIGKILL | DB-11 |
| 테이블 데이터 보기 · 편집 | 테이블 버퍼: 필터(WHERE) · 정렬(ORDER BY) · 페이지 · 개수, 대기 변경을 미리 보기 뒤 한 트랜잭션으로 | DB-13 · DB-14 · PG-40 · PG-45 |
| 쿼리 기록 · 즐겨찾기 | 연결마다 최근 문장 · 시각 · 결과 요약을 검색해 편집기에, 이름 붙여 별표한 쿼리 | DB-15 |
| 객체 탐색기 · DDL · 리팩터링 | 모든 객체 종류, 키 · 외래 키 · 인덱스 · 트리거, DDL, 이름 바꾸기 · 지우기 · 소스 편집 · 의존 객체까지 고치는 스크립트 | DB-19 · PG-50 · PG-52 · PG-33 |
| 편집기 | 구문 강조 · 여러 캐럿 · 찾아 바꾸기 · 괄호 짝 · 접기, 문법과 이름 검사, 문맥 자동 완성, 정의로 가기, 서식 정리, 파라미터 | DB-20 · DB-26 · PG-04 · PG-30~36 |
| 실행 계획 | EXPLAIN · EXPLAIN ANALYZE 를 트리 · 불꽃 · 표로, 예상과 실제, 두 계획 비교 | DB-25 · PG-70 |
| 값 편집기 · 레코드 보기 | JSON · 텍스트 · 바이트(16진 덤프) 값 보기, 한 행을 레코드로, 타입별 셀 편집기 | DB-09 · PG-40 |
| 결과 복사 · 내보내기 · 가져오기 | TSV · CSV · JSON · Markdown · SQL INSERT · UPDATE 복사, 열 가지 형식으로 저장 대화상자가 정한 곳에, COPY 로 크기 무관 가져오기 · 내보내기 | DB-16 · DB-23 · PG-60~64 |
| 알림 듣기 | 콘솔의 `LISTEN` 채널, Notifications 탭(채널 · 페이로드 · pid · 시각), 실행 중 공지 | DB-09 · PG-25 |
| 서버 활동 · 개요 · 정비 | 세션과 잠금, 서버 개요, VACUUM · ANALYZE · REINDEX · CLUSTER 폼 | PG-71~73 |

## 아키텍처 매핑

- **종류**: `kind: ui`. 문장 나누기 · 결과 읽기 · 파싱은 JS 와 워커로 충분하고 권한 경계는 브리지 하나다(가정 1).
- **실행 모델**: PostgreSQL 은 코어의 세션(`crates/desk-pg`, 브리지 `db.*`, ADR 0281). 콘솔과 테이블 보기는 세션 하나씩을 쥐고
  (ADR 0320), 그 밖의 실행(탐색기 · 에이전트 · 기능)은 짧은 세션을 열고 닫는다. 결과는 타입 있는 페이지로 오고, 스크립트는
  `db.script` 로 묶어 보내며(ADR 0344), 공지는 그 문장의 페이지에 실린다(ADR 0334). MySQL · SQLite 는 실행 한 번 = `proc.spawn` 한 번
  = 연결 하나(ADR 0038): 문장마다 뒤에 표지(marker)를 붙여 출력을 문장별로 가른다. mysql 은 표지 이름의
  `SELECT ROW_COUNT(), @@warning_count`, sqlite3 는 표지 이름의 `SELECT total_changes()`. 표지와 NULL 글자에는 실행마다 새 난수
  (nonce)가 들어간다.
- **권한**: 매니페스트의 선언 열 개뿐이다(ADR 0260, `plugins/database/tests/manifest.test.ts` 가 고정). `net:*` 는 없다.
  - 설치 때 받는다: `proc:spawn { commands: ["mysql", "mariadb", "sqlite3", "pg_dump", "pg_restore"] }`(클라이언트 둘과 백업 · 복원),
    `fs:write { paths: ["${home}/Downloads/**"] }`(셀의 바이트와 에이전트 감사 목록 내보내기),
    `fs:read` · `fs:write { paths: ["${home}/.endue/database/**"] }`(store 의 64 KiB 를 넘는 콘솔 텍스트, 복원의 항목 목록),
    `cmd:invoke` 여섯(`desk.palette.pick` · `desk.buffers.open` · `desk.buffers.update` · `desk.buffers.close` · `desk.files.reveal` ·
    `desk.files.changed`), `brain:ask`(콘솔의 Eris, ADR 0345).
  - 묻기만 한다(설치 때 받지 않는다): `db:connect { hosts: ["*"] }` 는 서버(와 SSH 터널의 홉)마다 처음 연결할 때(ADR 0335),
    `proc:spawn { commands: ["*"] }` 는 설정이 다른 이름이나 전체 경로로 댄 프로그램과 사람이 허락한 비밀번호 명령(ADR 0354) 하나씩,
    `fs:read { paths: ["/**"] }` 는 끌어다 놓은 `.sql` · `.csv` · `.tsv` · `.json` · `.jsonl` · `.xlsx` 파일과 CA · 클라이언트 인증서 파일
    하나씩, `fs:write { paths: ["/**"] }` 는 콘솔로 연 `.sql` 파일의 첫 저장과 전체 내보내기의 임시 파일 · 폴더를 `perm.request` 로
    묻는다. 놓기는 경로를 넘길 뿐 읽을 권한을 넘기지 않는다(ADR 0119).
  - 대화상자가 준다: 내보내기 · COPY · 백업 · 연결 파일 · 스키마 스냅숏처럼 사람이 저장 · 열기 대화상자(`dialog.save` · `dialog.open`)
    에서 고른 경로는 그 경로 하나의 허가와 함께 온다(ADR 0341).
  - 더 좁힐 수 없다: ADR 0260 은 프로그램을 이름 그대로 맞추므로 설정이 대는 프로그램은 `*` 만, 경로는 루트 하나 아래에서 대소문자를
    가리는 패턴으로 맞추므로 어느 폴더 · 드라이브에서 놓인 파일이든 `/**` 만 덮는다. 데스크에서 연 파일은 그 폴더 읽기가 세션 동안
    붙어(ADR 0131) 거기서 놓인 파일은 묻지 않는다.
- **표면**: `main` 하나(`center`). 콘솔과 테이블 보기는 각각 데스크 버퍼(`desk.buffers.open`)로, `desk.buffers.show` · `.closed` 를 답한다.
  기능의 보기는 패널(`#panel-box`)로 그린다. 창을 닫으면 그 창이 연 세션이 닫힌다(ADR 0339).
- **기여**: 커맨드 220(2026-11-23) · 키 1(`Mod+Shift+B` → `endue.database.open`) · 설정 28 · 파일 4(`*.sqlite` `*.sqlite3` `*.db3`
  `*.sql`) · 팔레트 공급자 1(객체 찾기, PG-80). 에이전트용 `endue.database.connections` · `.schema` · `.query` 는 `cmd.register` 로
  인자 스키마와 함께, 나머지 42 개는 매니페스트의 `agent` 커맨드로. 설정은 `settings.get` 으로 읽고 `settings.changed` 를 바로 따른다(PG-104).
- **모듈**: 기능 하나는 `ui/features/<이름>/` 폴더 하나 + `features/index.js` 한 줄(PG-00, 폴더 43 개). 공통은 `sql/`(lexer · split ·
  classify · `parse/` 워커) · `editor/`(벤더한 편집기 위의 강조 · 완성 · 서식 · 파라미터) · `engines/`(`pg-session` · `pg-script` ·
  `pg-cursor` · `pg-tls` · `pg-options` · mysql · sqlite · 읽기) · `session/` · `schema/` · `schema-cache/` · `diagnose/` · `navigate/` ·
  `refactor/` · `edit/` · `cell-editors/` · `grid/` · `rows/` · `links/` · `explain/` · `copy/` · `import-copy/` · `export/` · `transfer/` ·
  `tunnel/` · `auth/` · `database`(컨트롤러) · `view*`. 영역별 설명은 `plugins/database/docs/*.md`. 파일마다 400 줄 이하, DOM 없는
  모듈은 전부 vitest 로, SDK 는 `main.js` 만 가져온다.

## 요구사항

### 기능 (DB)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| DB-01 | 연결: 만들기 · 고치기 · 복제 · 지우기(확인, 기록 · 별표한 쿼리 · 콘솔 텍스트도). 이름(대소문자 무시 유일) · 엔진 · 호스트 · 포트 · DB · 사용자 · TLS 모드 · CA 파일 · (SQLite) 파일 · 환경 태그 · 읽기 전용 · 그룹 · 색. 필드마다 검사하고 틀린 필드를 문장으로. store `connections`(64 KiB) | 있음 (PostgreSQL 은 인증서 · 세션 옵션 · 비밀번호 명령 · 풀러 · SSH 터널도, PG-10~14) | A |
| DB-02 | URI: `postgres(ql)://` `mysql://` `mariadb://` `sqlite:` 읽기(`sslmode` · `ssl-mode` · `sslrootcert` · `sslcert` · `sslkey` · `options` · IPv6 · 퍼센트 인코딩)와 쓰기(비밀번호 없이, `copy-uri`) | 있음 (IPv6 호스트는 URI 만: PostgreSQL 세션은 호스트 이름과 IPv4 로만 연결) | A |
| DB-03 | 연결 시험: 버전 쿼리, 걸린 시간 · 서버 버전, 실패는 서버나 클라이언트의 말로. 폼에서도 저장 전에 | 있음 | A |
| DB-04 | 비밀번호: 인증 실패 · 비밀번호 없음이면 표면 안의 가려진 입력으로 한 번 묻고 다시 실행. 메모리에만(연결 끊기 · 종료까지). PostgreSQL 은 코어가 `~/.pgpass`(Windows `pgpass.conf`)를 읽고, 키체인(PG-03) · 비밀번호 명령(PG-14)이 있다. MySQL 은 `MYSQL_PWD` · `~/.my.cnf` | 있음 | A |
| DB-05 | 클라이언트 점검: PostgreSQL 은 없음. `mysql` · `mariadb` · `sqlite3` 와 백업의 `pg_dump` · `pg_restore` 를 찾고(데스크 PATH → 설정 `path` → 시스템마다 설치되는 폴더), `--version` 으로 종류와 최소 버전, 없으면 설치 안내 | 있음 (Windows 의 탐색 폴더는 PostgreSQL 프로그램만, NF-08) | A |
| DB-06 | 탐색기: 연결 → (PostgreSQL) 서버의 데이터베이스 → 스키마(MySQL 은 DB, SQLite 는 main) → 종류별 폴더 → 객체 → 열(타입 · PK · NOT NULL · 기본값). 노드별 새로고침(`g`), 이름 필터(`/`), 서버 추정 행 수와 정확한 행 수(`c`), 시스템 스키마는 설정으로. 키보드 트리 | 있음 (PostgreSQL 은 스키마 캐시에서, PG-06 · PG-13 · PG-50) | A |
| DB-07 | 콘솔: 연결마다 데스크 버퍼, 텍스트는 store 에(재시작 뒤에도). 커서의 문장 · 선택 영역 · 스크립트 전체 · 한 트랜잭션으로 · 시험 실행(끝에 ROLLBACK) · EXPLAIN(SQLite 는 QUERY PLAN) | 있음 (연결마다 여럿, `.sql` 파일 실행, PG-24) | A |
| DB-08 | 문장 나누기: PG(`''` · `E''` · 달러 인용 · `""` · 중첩 주석 · 괄호 안 `;` · `CREATE FUNCTION … BEGIN ATOMIC … END`), MySQL(백슬래시 이스케이프 · 백틱 · `#` · `-- ` · `DELIMITER`), SQLite(`[]` · 백틱 · `CREATE TRIGGER … BEGIN … END`). 줄 · 열을 남겨 오류 위치를 편집기로 | 있음 | A |
| DB-09 | 결과: 결과 집합마다 탭 + Messages(문장마다 행 수 · 영향 행 · 경고 수 · 오류 코드와 DETAIL · HINT · 실행 안 됨, 공지), 요약(문장 수 · 시간 · 모드). NULL 은 따로 그린다, 숫자 열 오른쪽 정렬, 긴 값 줄임. 정렬(`s`) · 화면의 행 거르기(`/`) · 한 행을 레코드로(`t`) · 값 보기(`v`: JSON 정리, 텍스트, 바이트 16진 덤프) | 있음 (PostgreSQL 콘솔은 실행 중 공지가 오는 대로 Messages 에, `LISTEN` 한 알림은 Notifications 탭에, PG-25) | A |
| DB-10 | 행 상한: `max-rows`(500). 읽기 하나면 상한+1 행에서 멈춘다(MySQL 은 `sql_select_limit`, SQLite 는 줄 세기). More rows 는 네 배(최대 100,000). PostgreSQL 콘솔의 읽기 하나는 커서로 끝까지(PG-22) | 있음 | A |
| DB-11 | 취소 · 시간 제한: Cancel · 편집기 Escape · `endue.database.cancel`. `timeout-seconds` 는 PostgreSQL 서버의 `statement_timeout` + 클라이언트 쪽 제한 | 있음 (PostgreSQL 은 `db.cancel`, 세션은 남는다) | A |
| DB-12 | 안전: 읽기 전용 연결은 쓰기 · DDL · 읽기 전용을 푸는 SET/BEGIN 을 실행 전에 거절하고, 서버 쪽에서도(PG 세션의 `default_transaction_read_only`, MySQL `SET SESSION TRANSACTION READ ONLY`, SQLite `-readonly`). `confirm` 이 켜져 있으면 production 의 쓰기와 어디서든 DROP · TRUNCATE · WHERE 없는 UPDATE/DELETE · ALTER … DROP 을 문장을 보여 주고 묻는다 | 있음 (풀러를 거치는 연결은 플러그인의 검사만, PG-14) | A |
| DB-13 | 테이블 보기: 탐색기의 테이블 → `SELECT * … WHERE … ORDER BY … LIMIT … OFFSET …` 페이지, 앞뒤, 개수(요청 시), 열 머리글로 서버 정렬. 필터 · 정렬은 식 하나(`;` · 주석 · 짝 안 맞는 괄호 거절) | 있음 (정렬하지 않은 PostgreSQL 테이블은 PK 순, 없으면 `ctid`) | A |
| DB-14 | 데이터 편집(ADR 0115): 테이블 보기 또는 테이블 하나의 단순 SELECT 결과에서 셀 고치기 · 행 추가 · 삭제를 대기 변경으로 모아 diff 로 그리고, SQL 미리 보기(`p`) 뒤 Submit(`Mod+Enter`)으로 한 트랜잭션에. PK 로 행을 짚고 값은 열 타입의 리터럴. PK 없음 · PK 열이 결과에 없음 · 읽기 전용 연결은 거절, 실패하면 전부 롤백, 맞는 행이 없던 변경은 말한다 | 있음 (PostgreSQL 은 조인 · PK 없는 테이블 · 뷰도 열의 출처로, PG-45; 붙여 넣기 · 복제 · 되돌리기, PG-43) | B |
| DB-15 | 기록: 연결마다 최근 `history-max`(200) 문장 · 시각 · 결과 요약. 비밀번호를 담은 듯한 문장(`PASSWORD` · `IDENTIFIED BY` …)은 남기지 않는다. 팔레트로 검색해 골라 편집기에. 별표한 쿼리(이름 · 문장, 연결마다 store `saved:<id>`): 별표 · 목록 · 해제 | 있음 | A · B |
| DB-16 | 복사 · 내보내기: 결과(또는 블록)를 TSV · CSV · JSON(정확히 돌아오는 숫자만 숫자) · Markdown · SQL INSERT · SQL UPDATE(PK 로, 없으면 모든 열로) 로 복사. 파일은 데스크의 저장 대화상자가 정한 곳에(ADR 0341) `<테이블>-<시각>.<확장자>` 를 제안해 쓰고 파일 관리자에서 보여 준다 | 있음 (열 가지 형식, `.xlsx` 포함, PG-61; 팔레트에서 부른 Copy as 도 클립보드에 닿는다, PG-109 · D1) | A · B |
| DB-17 | 에이전트: `endue.database.connections`(비밀번호 없이) · `.schema` · `.query`(maxRows ≤ 1000). 쓰기는 태그와 무관하게 사람에게 묻고, 비밀번호 입력은 띄우지 않는다 | 있음 (읽기 도구 · 닫힌 연결 · 가린 열 · 감사 목록, PG-91, ADR 0346) | A |
| DB-18 | 파일 열기: `*.sqlite` `*.sqlite3` `*.db3` 를 데스크가 열면 그 파일의 연결(처음이면 추가)과 콘솔이, `*.sql` 은 그 파일에 묶인 콘솔이 그 버퍼에(ADR 0286) | 있음 | A |
| DB-19 | 객체: 테이블 · 뷰 · 머티리얼라이즈드 뷰 · 외부 테이블 · 시퀀스 · 함수 · 프로시저 · 이벤트, 테이블의 키(PK · UNIQUE · CHECK · EXCLUDE) · 외래 키 · 인덱스 · 트리거. 각각의 DDL(`d`): MySQL 은 `SHOW CREATE`, SQLite 는 `sqlite_master.sql`, PG 는 `pg_get_*def` 와 카탈로그로 | 있음 (PostgreSQL 의 나머지 종류, PG-50) | B |
| DB-20 | 편집기: 구문 강조(문장을 자르는 같은 렉서), 자동 완성(키워드 · 함수 · 스키마 · 테이블 · 뷰 · 열 · 별칭, `Ctrl+Space` 또는 `.` · 두 글자 뒤 저절로), 서식 정리(`Mod+Shift+F`). MySQL 은 DELIMITER 없이도 루틴의 BEGIN … END 를 한 문장으로 | 있음 (벤더한 편집기 컴포넌트, PG-04; PostgreSQL 은 파서 · 문제 검사 · 문맥 완성 · 트리로 서식, PG-05 · PG-30~36) | B |
| DB-21 | 세션 유지: 실행 사이에 트랜잭션 · `SET` · 임시 테이블이 이어지는 연결. 코어 드라이버 위에서(ADR 0281) | 있음 (PostgreSQL 콘솔 · 테이블 보기, ADR 0320; MySQL · SQLite 는 실행마다 연결) | C |
| DB-22 | SSH 터널: 점프 호스트, 처음 본 호스트 키는 묻고 바뀐 키는 거절 | 있음 (PostgreSQL, 코어가 여는 터널, ADR 0359; MySQL 없음; 백업 · 복원은 터널을 타지 않는다) | C |
| DB-23 | 가져오기 · 덤프: CSV 가져오기, `pg_dump` · `mysqldump` · `.dump` | 일부 (CSV · TSV · JSON 을 놓으면 INSERT 로, ADR 0119; PostgreSQL 은 크기 무관 COPY 로 · JSON lines · `.xlsx` · 새 테이블, ADR 0363; `pg_dump` · `pg_restore` 폼, ADR 0313; `mysqldump` · sqlite3 `.dump` 없음) | C |
| DB-25 | 실행 계획: EXPLAIN · EXPLAIN ANALYZE(쓰기는 끝에 롤백)를 트리로. PG `FORMAT JSON`, MySQL `FORMAT=JSON` · `EXPLAIN ANALYZE` 트리, MariaDB `FORMAT=JSON`, SQLite `QUERY PLAN`. 노드마다 비용 · 예상 행 · 실제 행 · 시간, 자기 몫이 절반 · 5분의 1 넘는 노드 표시 | 있음 (PostgreSQL 은 옵션 · 불꽃 · 표 · 비교, PG-70) | B |
| DB-26 | 파라미터: `:name`(모두) · `?`(MySQL · SQLite) · `$1`(PG)을 실행 전에 팔레트로 묻는다. 숫자 · NULL · 따옴표 친 문자열, `=` 로 시작하면 식 그대로. 세션 동안 기억 | 있음 (PostgreSQL 은 바인딩한 값, PG-21) | B |
| DB-27 | 연결 그룹(탐색기에서 접고 펴는 묶음) · 색(테마의 범주 색 여덟: 탐색기의 점, 머리글 왼쪽 띠). SSH 터널은 DB-22 | 있음 | B · C |
| DB-28 | 수동 트랜잭션 모드(Commit · Rollback 버튼, 대기 중 표시) | 있음 (PostgreSQL, PG-20) | C |
| DB-29 | ER 다이어그램: 스키마의 테이블 · 열(PK 표시) · 외래 키를 한 번에 읽어 격자에 배치(연결이 많은 테이블 먼저), 외래 키는 화살표 선. 테이블마다 Tab · 화살표로 옮겨 가고 Enter 로 행을 연다(탐색기 `r`) | 있음 (배치 유지 · 고른 테이블 · 이미지 내보내기, PG-55) | B |
| DB-24 | 다른 엔진: 파일 하나에 든 분석용 임베디드 엔진, 상용 관계형 서버, 열 지향 분석 서버 — 각자의 공식 CLI 를 DB 밖으로 손을 뻗지 못하는 모드로 | 범위 밖 — 엔진 모듈 하나씩 | — |

### 비기능 (NF)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| NF-01 | 보안: 셸 없음, 인자 배열. PostgreSQL 은 프로그램 없이 코어의 세션으로: `\` 로 시작하는 메타 커맨드는 거절, `COPY … STDIN/STDOUT` 은 콘솔에서 사람이 고른 파일로만(PG-23). mysql `--binary-mode`(`\!` · `system` · `source` 꺼짐) `--local-infile=0` `--skip-reconnect`, 연결 값은 `--opt=값` 한 인자. sqlite3 `-safe`(`.shell` · `.load` · `ATTACH` · `load_extension` 꺼짐), `.` 으로 시작하는 문장 거절. 비밀은 환경 변수나 코어로만. 권한은 매니페스트가 선언한 열 개뿐이고(ADR 0260, 아키텍처 매핑의 권한), `*` · `/**` 선언은 설치 때 받지 않아 서버 · 프로그램 · 파일마다 처음 쓸 때 묻는다 | 있음 | A |
| NF-02 | 오류 문구: PostgreSQL 은 서버의 필드(SQLSTATE · DETAIL · HINT · 위치) 그대로. 다른 엔진은 클라이언트 접두사(`ERROR 1064 (42000) at line n:` · `Error: in prepare,`)를 떼고 코드(errno · SQLite 코드)와 위치(MySQL `near '…'`, SQLite 캐럿)를 편집기 선택으로 | 있음 | A |
| NF-03 | 성능: 클라이언트 엔진은 실행당 출력 64 MiB 상한, 행 상한(DB-10), 그리드는 보이는 행만, 탐색기 지연 로딩 · 캐시, 무거운 일은 워커. PostgreSQL 은 커서 · COPY 로 크기 무관 | 있음 (예산 `just perf-database`: 백만 행 · 테이블 1만 · 열 1000 · SQL 1 MB, PG-103, ADR 0362) | A |
| NF-04 | 접근성: 키보드만으로 전부. 탐색기 `role=tree`, 결과 `role=grid` + `aria-rowcount` · `aria-colcount` · `aria-sort`, 탭 `role=tablist`, 상태 줄 live region. 편집기는 `Mod+Enter` · `Mod+Shift+Enter` 만 가로채고 Escape 는 실행 중일 때만 | 있음 | A |
| NF-05 | 테마: `--desk-*` 토큰, 환경 색 셋은 플러그인 소유, production 은 표면 위 띠. 두 테마 대비 검사 | 있음 (`tests/contrast.test.ts`, PG-107) | A · B |
| NF-06 | 국제화: 문자열은 영어 한 곳에. RT-13 번들이 오면 `locales` | 있음 (뷰 모듈의 문자열은 `ui/strings/en.json` 카탈로그 하나에, 데스크가 주는 언어로 읽고 언어는 파일 하나로 더한다; `scripts/strings-lint.mjs`, ADR 0366, PG-108) | C |
| NF-07 | 최소 버전: PostgreSQL 서버 15~19 를 지원하고 컨테이너로 시험한다(ADR 0351). mysql 8.0.19 · mariadb 10.5(`--binary-as-hex`), sqlite3 3.37(`-safe`), `pg_dump` · `pg_restore` 는 서버의 메이저 이상. 낮으면 무엇 때문인지 말한다 | 있음 | A |
| NF-08 | Windows · Linux: `.exe` · 경로 · 신호 · 비밀번호 파일 · 키체인 | 일부 (PostgreSQL 은 세 시스템 모두, PG-102; MySQL · SQLite 클라이언트의 Windows 탐색 폴더는 비어 있다) | C |
| NF-09 | 테스트: lexer · 분류 · 엔진 계획과 읽기(실제 출력 고정) · URI · 결과 · 컨트롤러(PostgreSQL 은 `StubDatabase`, 다른 엔진은 가짜 클라이언트가 실제 프로토콜로 답한다) · 매니페스트(Ajv · `desk plugin validate`). 실제 서버 통합(`*-live.test.ts`): PostgreSQL 은 코어 브리지로, `ENDUE_DB_TEST_*` URI 가 있으면 | 있음 (런타임 e2e `packages/runtime/e2e/database*.spec.ts`; PostgreSQL 15~19 `just test-pg-versions`, PG-101) | A · B |
| NF-10 | 값: 서버가 보낸 글자 그대로. 날짜 · 시간은 PG `DateStyle=ISO`, MySQL `YYYY-MM-DD hh:mm:ss`, SQLite 는 저장된 텍스트 — 로컬 시간대로 바꾸지 않는다. SQLite REAL 은 같은 double 의 가장 짧은 꼴, 정수는 2^53 너머도 그대로 | 있음 | A |

### PostgreSQL 클라이언트 계획 (D, #438)

`endue.database` 를 하루 종일 일하고 운영 DB 를 맡길 수 있는 PostgreSQL 클라이언트로 만드는 계획. 다른 엔진은 ADR 0038 그대로다.
ID 는 에픽의 것이고 `#` 은 그 Task 이슈다. 영역별 설명은 `plugins/database/docs/` 에 있다.

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| PG-00 · #506 | 기능은 명령 · 동작 · 패널을 등록하는 모듈(`ui/features/<이름>/`) | 있음 | D |
| PG-01a · #439 | 세션을 어떻게 쥐는지 스파이크로 재고 ADR 로 정한다 | 있음 (코어의 드라이버 · `db.*` · `db:connect`, ADR 0281) | D |
| PG-01b · #440 | 브리지와 코어가 세션을 연다 · 타입 있는 페이지로 돌린다 · 취소한다 · 닫는다 | 있음 (`crates/desk-pg`, `specs/bridge` `db.*`) | D |
| PG-01c · #441 | 플러그인이 PostgreSQL 을 세션으로 돌리고 클라이언트 프로그램이 필요 없다 | 있음 (`engines/pg-session.js`) | D |
| PG-01d · #540 | 긴 스크립트는 문장마다 왕복하지 않고 묶어서 | 있음 (`db.script`, ADR 0344) | D |
| PG-01e · #541 | 공지는 그것을 낸 문장과 함께, 이벤트가 어떤 순서로 오든 | 있음 (ADR 0334) | D |
| PG-01f · #562 | 세션은 연 페이지보다 오래 살지 않고, 끝낼 때 문장부터 취소 | 있음 (ADR 0339) | D |
| PG-01g · #563 | 연결은 사람이 연결할 때만 묻고, 질문은 엉뚱한 키를 받지 않는다 | 있음 (ADR 0335) | D |
| PG-01h · #564 | 실제 앱 점검에서 나온 고침: 대화상자 위치 · 시험 결과 · 테이블 보기 순서 · 활동 상세 | 있음 | D |
| PG-02 · #442 | 콘솔이 세션을 실행 사이에 유지하고 상태를 보여 준다 | 있음 (ADR 0320) | D |
| PG-03 · #443 | 비밀번호를 OS 키체인에 기억하고, 플러그인은 되읽지 못한다 | 있음 (ADR 0311) | D |
| PG-04 · #444 | 콘솔 편집기가 진짜 편집기 컴포넌트: 여러 캐럿 · 찾아 바꾸기 · 괄호 짝 · 접기 | 있음 (ADR 0282) | D |
| PG-05 · #445 | PostgreSQL 의 SQL 을 파싱하고 이름을 스키마에 묶는다 | 있음 (서버의 문법, 워커에서, ADR 0283) | D |
| PG-06 · #446 | 스키마를 한 번 읽어 재시작 뒤에도 남는 캐시에, 바뀐 만큼만 새로 | 있음 (ADR 0285 · 0295) | D |
| PG-10 · #447 | SSH 터널 | 있음 (ADR 0359) | D |
| PG-11 · #448 | TLS 클라이언트 인증서 | 있음 (ADR 0331) | D |
| PG-12 · #449 | 세션 옵션: search path · role · 시간대 · 시간 제한 · 시작 스크립트 | 있음 | D |
| PG-13 · #450 | 연결 하나가 서버의 모든 데이터베이스를 보여 준다 | 있음 (ADR 0321) | D |
| PG-14 · #451 | 명령이 주는 짧은 비밀번호, 연결 풀러 | 있음 (ADR 0354) | D |
| PG-15 · #452 | 연결을 비밀 없는 파일로 내보내고 가져온다 | 있음 (ADR 0332, `pg_service.conf` 도) | D |
| PG-20 · #453 | 콘솔이 트랜잭션을 열어 둔다: 수동 커밋 · Commit · Rollback · 격리 수준 · 세이브포인트 | 있음 | D |
| PG-21 · #454 | 파라미터는 바인딩한 값으로, 문장은 실행하지 않고 서버가 검사 | 있음 (ADR 0353) | D |
| PG-22 · #455 | 어떤 크기의 결과든 스크롤: 서버에서 페이지로, 출력 상한 없음 | 있음 (커서, ADR 0352) | D |
| PG-23 · #456 | 콘솔의 `COPY FROM STDIN` · `COPY TO STDOUT`, 가져오기 · 내보내기의 바탕 | 있음 (ADR 0356) | D |
| PG-24 · #457 | 연결마다 콘솔 여럿, `.sql` 파일을 연결에 대고 실행 | 있음 (ADR 0286) | D |
| PG-25 · #458 | 공지는 문장이 도는 동안 오고, 콘솔이 알림을 LISTEN 한다 | 있음 (`db.call.notice` 로 실행 중 공지, Notifications 탭 · 배지 · 1,000 개 상한 · 지우기 · 내보내기 · Listen again, 풀러 · 에이전트는 거절, ADR 0358) | D |
| PG-26 · #459 | 결과 탭 고정, 두 결과 비교 | 있음 (ADR 0329) | D |
| PG-30 · #460 | 입력하는 동안 문법 오류와 아무것에도 묶이지 않는 이름에 밑줄 | 있음 (ADR 0294) | D |
| PG-31 · #461 | 문장을 아는 자동 완성: 외래 키로 조인 · 열 목록 · `*` 펼치기 · 함수 인자 · 스니펫 | 있음 (ADR 0327) | D |
| PG-32 · #462 | 이름에서 정의로 가기 · 쓰인 곳 찾기 · 설명 카드 | 있음 | D |
| PG-33 · #463 | 이름 바꾸기 리팩터링: 별칭 · CTE, 의존 객체를 살리는 스크립트와 함께 객체 | 있음 | D |
| PG-34 · #464 | 서식 정리가 설정한 스타일로 줄바꿈 · 들여쓰기 · 정렬 | 있음 (파스 트리로, ADR 0292) | D |
| PG-35 · #465 | PL/pgSQL 본문 안에서도 강조 · 완성 · 문제 검사 | 있음 (ADR 0343) | D |
| PG-36 · #466 | 실수로 보이는 문장을 경고하고, 안전하면 고침도 | 있음 (ADR 0328) | D |
| PG-40 · #467 | 셀을 타입대로 편집: boolean · enum · 날짜 · 시간 · JSON · 배열 · 바이트 · DEFAULT | 있음 (ADR 0287) | D |
| PG-41 · #468 | 그리드에서 외래 키를 따라가기, 양쪽으로 | 있음 (ADR 0322) | D |
| PG-42 · #469 | 열 숨기기 · 옮기기 · 고정 · 너비, 빠른 필터 · 여러 열 정렬 · 찾기 | 있음 (ADR 0288) | D |
| PG-43 · #470 | 여러 셀 · 행 붙여 넣기, 행 복제 | 있음 | D |
| PG-44 · #471 | 선택 영역의 합계, 결과를 차트로 | 있음 (ADR 0336) | D |
| PG-45 · #472 | 조인 결과와 PK 없는 테이블의 편집 | 있음 (ADR 0350) | D |
| PG-46 · #473 | geometry · geography 값을 지도에 | 있음 (ADR 0325) | D |
| PG-50 · #474 | 탐색기가 PostgreSQL 의 모든 객체 종류를 보여 준다 | 있음 (ADR 0295) | D |
| PG-51 · #475 | 테이블을 만들고 바꾸는 폼, 실행 전 ALTER 스크립트 | 있음 (ADR 0324) | D |
| PG-52 · #476 | 탐색기에서 이름 바꾸기 · 지우기 · 비우기 · 주석 · 소스 편집 | 있음 (ADR 0312) | D |
| PG-53 · #477 | 두 스키마 비교와 그 사이의 마이그레이션 스크립트 | 있음 (ADR 0338) | D |
| PG-54 · #478 | 역할 · 멤버십 · 권한 읽고 바꾸기 | 있음 (ADR 0330) | D |
| PG-55 · #479 | ER 다이어그램이 배치를 기억하고, 고른 테이블 · 이미지 내보내기 | 있음 (ADR 0315) | D |
| PG-56 · #480 | 함수 · 프로시저를 인자 폼으로 실행 | 있음 | D |
| PG-60 · #481 | 어떤 크기의 파일이든 COPY 로 가져오기, 있는 테이블이나 새 테이블로 | 있음 (ADR 0363) | D |
| PG-61 · #482 | 내보내기는 사람이 고른 곳에, `.xlsx` 도 | 있음 (ADR 0341) | D |
| PG-62 · #483 | `pg_dump` · `pg_restore` 로 백업 · 복원하는 폼 | 있음 (ADR 0313) | D |
| PG-63 · #484 | 테이블이나 쿼리 결과를 다른 데이터베이스나 새 테이블로 복사 | 있음 (`ui/transfer/`) | D |
| PG-64 · #485 | 테이블 · 쿼리 전체를 크기 무관 파일로 바로 내보내기 | 있음 (한 스냅숏, 임시 이름, ADR 0365) | D |
| PG-70 · #486 | 읽기 쉬운 실행 계획: 옵션 · 예상과 실제 · 불꽃 · 두 계획 비교 | 있음 (ADR 0289) | D |
| PG-71 · #487 | 서버의 세션과 잠금, 세션 취소 · 끝내기 | 있음 (ADR 0290) | D |
| PG-72 · #488 | 서버 개요: 크기 · 안 쓰는 인덱스 · 무거운 문장 · vacuum · 복제 상태 | 있음 | D |
| PG-73 · #489 | VACUUM · ANALYZE · REINDEX · CLUSTER 폼, 무엇을 잠그는지 | 있음 (ADR 0293) | D |
| PG-80 · #490 | 팔레트가 모든 연결의 캐시에서 객체를 찾는다 | 있음 | D |
| PG-81 · #491 | 스키마의 테이블들에서 값을 찾는다 | 있음 | D |
| PG-82 · #492 | 루틴 · 뷰 · 트리거의 소스 검색 | 있음 | D |
| PG-90 · #493 | Eris 가 콘솔에서 SQL 을 쓰고 설명하고 고친다, 사람이 허락한 스키마만 알고 | 있음 (제안만, 돌리지 않는다, ADR 0345) | D |
| PG-91 · #494 | 에이전트의 명령이 늘고, 그들이 돌린 것은 모두 감사 목록에 | 있음 (ADR 0346) | D |
| PG-100 · #495 | 쓰는 권한만 선언하고 문서도 같게 | 있음 (`tests/manifest.test.ts`) | D |
| PG-101 · #496 | 지원하는 모든 버전의 실제 서버로 시험 | 있음 (15~19, ADR 0351) | D |
| PG-102 · #497 | Windows · Linux 에서도 | 있음 (`docs/platforms.md`) | D |
| PG-103 · #498 | 큰 결과 · 큰 스키마 · 넓은 테이블의 잰 예산과 그것을 지키는 시험 | 있음 (ADR 0362) | D |
| PG-104 · #499 | 설정이 바뀌는 대로 따른다 | 있음 (`settings.get` · `settings.changed`) | D |
| PG-105 · #500 | 연결이 끊겨도 일을 잃지 않고 세션이 돌아온다 | 있음 (다시 돌리지 않는다, ADR 0355) | D |
| PG-106 · #501 | 이 문서가 이 단계를 얻고 코드와 맞는다 | 있음 (`tests/requirements-doc.test.ts`) | D |
| PG-107 · #502 | 두 테마에서 색 대비 검사 | 있음 (`tests/contrast.test.ts`) | D |
| PG-108 · #503 | 문자열을 카탈로그 하나에, 로캘 준비 | 있음 (`ui/strings/`, 복수형 · 수 · 날짜는 `Intl`, 서버의 말은 그대로 표시해 구분; ADR 0366, NF-06) | D |
| PG-109 · #504 | 팔레트에서 부른 Copy as 도 클립보드에 닿는다 | 있음 (ADR 0318, D1) | D |

## 의존: Desk 쪽에서 해야 하는 것

A~C 단계의 플러그인은 공개 API 만 썼다. D 단계는 코어 · 스펙 · 런타임도 바꿨다(PG-01b, PG-03, PG-10, PG-23 …).

| ID | 무엇 | 어디 | 상태 |
| --- | --- | --- | --- |
| D1 | 런타임이 플러그인 페이지에 클립보드 쓰기를 허용 (보안 판단과 함께) | 셸 · `packages/runtime` | 있음 (PG-109, ADR 0318): 팔레트의 명령은 그 플러그인 페이지에서 사람이 한 동작이라 셸이 페이지에 포커스와 활성화를 빌려주고, 플러그인은 클립보드 길 하나로 쓴다(`ui/clipboard.js`), 큰 복사는 먼저 묻는다 |
| D2 | 비밀 보관(SYS-06 키체인): 플러그인이 비밀번호를 코어에 맡기고 다시 꺼내지 못하는 길 | `specs/bridge` · 코어 | 됨 (PG-03, ADR 0311: `passwordRef` 로 세션이 로그인한다) |
| D3 | 좁게 묻는 `fs:write`, 또는 플러그인이 여는 저장 대화상자 | `specs/plugin` · 코어 | 됨 (`dialog.save` · `dialog.open` 이 고른 경로를 허가, ADR 0341; `fs.write` `append`, ADR 0356) |
| D4 | `browserStub` 의 가짜 `proc`(BR-07)과 가짜 세션 | `packages/bridge` | 됨: 런타임 e2e 의 테스트 페이지가 `proc.spawn` 을 스크립트 sqlite3 로, `db.*` 를 `StubDatabase` 로 답한다 |
| D5 | 코어가 `settings.*` 를 서빙 (#81) | `crates/desk-core` | 됨: `settings.get`(기본값 · init.yaml · 사람이 정한 값)으로 읽고 `settings.changed` 를 바로 따른다(PG-104). 클라이언트 · `path` 가 바뀌면 다시 찾는다 |
| D6 | 코어 DB 드라이버 — DB-21 | `crates/desk-pg` · `specs/bridge` `db.*` | 됨 (PostgreSQL 만, ADR 0281) |
| D7 | 코어가 여는 SSH 터널 | `crates/desk-pg` | 됨 (ADR 0359) |
| D8 | 실행 중인 호출의 공지 이벤트 `db.call.notice` | `specs/bridge` · 코어 | 됨 (PG-25, ADR 0358: 페이지는 호출 번호를 달고, 답이 온 뒤의 공지는 버린다) |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| A | 연결을 만들고(URI 포함) 시험하고, 스키마를 펼치고, 콘솔에서 문장 · 스크립트를 돌리고(트랜잭션 · 시험 실행 · EXPLAIN), 결과를 정확히 보고 정렬 · 복사하고, 테이블을 페이지로 보고, 운영 DB 에서 막히거나 묻는다. 에이전트가 읽고, 쓰기는 사람이 허락한다 | DB-01~13 · 15 · 16(복사) · 17 · 18, NF-01~05 · 07 · 09(단위 · 실제 클라이언트) · 10 |
| B | 날마다 쓰는 나머지: 데이터 편집, 파일로 내보내기, 객체 더 보기 · DDL, 구문 강조 · 자동 완성, 대비 검사, 런타임 e2e | DB-14 · 16(파일) · 19 · 20, NF-05 대비, NF-09 e2e |
| C | 세션 유지, SSH 터널, 가져오기 · 덤프, Windows, 국제화 | DB-21~23 · 28, NF-06 · 08 |
| D | PostgreSQL 클라이언트 계획(#438): 코어의 세션, 열어 둔 트랜잭션, 크기 무관 결과 · COPY, SQL 을 아는 편집기, 스키마 도구, 대량 데이터, 서버 보기, 같은 가드 아래의 Eris 와 에이전트 | PG-00~109 (위 표). 모두 있음 |

## 가정과 결정 (뒤집으려면 거절에 한 줄로)

1. `kind: ui`. Wasm 로직 플러그인이 더 안전하지 않다: 권한 경계는 브리지 하나다.
2. MySQL / MariaDB · SQLite 는 **공식 클라이언트**를 `proc.spawn` 으로 돌린다(ADR 0038). PostgreSQL 은 이 결정을 ADR 0281 이 바꿨다(17).
3. MySQL · SQLite 는 실행 한 번이 연결 하나다. 한 실행 안의 `BEGIN … COMMIT` 은 돈다. PostgreSQL 은 콘솔 · 테이블 보기가 세션을 쥔다(19).
4. 첫 오류에서 멈춘다(PostgreSQL 은 스크립트의 첫 오류, mysql 은 `-e` 에서 `--force` 가 듣지 않는다, sqlite3 `-bail`). "계속" 모드는 두지 않는다.
5. mysql 클라이언트는 DELIMITER 를 15 자까지만 읽는다(`char delimiter[16]`): 구분자는 `;;` + 난수 11 자 + `;;`.
6. MySQL 서버의 `SLEEP()` 은 KILL QUERY 에 오류 대신 1 을 돌려줘 클라이언트가 다음 문장으로 간다: 취소는 SIGINT 1 초 뒤 SIGKILL 로 끝내고, 그 사이 끝난 문장은 Messages 가 말한다.
7. SQLite 와 MySQL 은 행 없는 결과에 열 이름을 주지 않는다(PG 는 준다): "No rows" 와 함께 그렇게 말한다.
8. sqlite3 의 `unistr()` 출력은 원래 백슬래시를 이스케이프하지 않는다. 글자 그대로의 `\u0001` 과 제어 문자가 함께 든 값은 다르게 읽힐 수 있다.
9. `*.db` 는 SQLite 만의 확장자가 아니라 연결하지 않는다(`*.sqlite` `*.sqlite3` `*.db3` 만).
10. 표지 · NULL 글자는 실행마다 12 자 난수. 데이터가 그 글자와 같을 확률은 무시한다.
11. 에이전트의 쓰기는 `confirm` 설정과 무관하게 묻는다. 에이전트에게는 비밀번호 입력을 띄우지 않는다(사람이 콘솔에서 먼저 연결). 에이전트의 읽기는 읽기 전용 세션에서, 사람이 정한 열은 가리고, 모두 감사 목록에 남는다(ADR 0346).
12. 기본 키 `Mod+Shift+B`(비어 있음). macOS 의 `Cmd+Shift+Q`(로그아웃)는 피했다.
13. A~C 단계는 코어 · 스펙 · 런타임을 손대지 않았다. D 단계는 의존 표의 D2 · D3 · D6~D8 을 각 태스크 안에서 바꾼다.
14. 그리드 편집은 대기 변경이고, Submit 하면 방언별 SQL 로 한 트랜잭션에 실린다(ADR 0115). PostgreSQL 은 열의 출처 테이블로 행을 짚는다(ADR 0350).
15. 내보내기는 데스크의 저장 대화상자가 정한 곳 하나에, 명령 인자로는 경로를 받지 않는다: 에이전트도 넓히지 못한다(ADR 0341). `.xlsx` 는 플러그인이 직접 쓴다.
16. 수동 트랜잭션 모드는 PostgreSQL 콘솔의 세션 위에서(PG-20). 실행 하나 안의 트랜잭션 · 시험 실행 · 대기 변경의 Submit 은 모두 한 트랜잭션이다.
17. PostgreSQL 세션은 코어의 드라이버가 `db.*` 와 `db:connect` 뒤에서 쥔다(ADR 0281): TLS · SCRAM · 서버 쪽 취소 · 타입 있는 결과 · 설치할 것 없음. 다른 엔진은 ADR 0038 그대로.
18. 비밀번호는 OS 키체인에 코어가 맡고, 플러그인이나 그 프레임의 스크립트가 되읽는 길은 없다. 맡긴 비밀번호는 맡긴 서버에만 로그인한다(ADR 0311). 재시작 뒤에도 묻지 않으려면 연결마다 "기억" 을 켠다.
19. 콘솔마다 세션 하나(ADR 0320), 서버 개수 · 유휴 시간 상한(`sessions-per-connection` · `session-idle-minutes`), 끊기면 일을 잃지 않고 아무것도 다시 돌리지 않는다(ADR 0355).
20. 콘솔 편집기는 벤더한 편집기 컴포넌트 하나(고정한 버전, 라이선스 곁에)이고, 무엇이 문자열 · 주석 · 문장인지는 플러그인의 렉서가 정한다(ADR 0282).
21. PostgreSQL 의 SQL 은 서버 자신의 문법을 WebAssembly 로 빌드한 파서가 워커에서 읽고(ADR 0283), 문제 검사 · 완성 · 서식이 같은 트리를 쓴다(ADR 0292 · 0294 · 0327).
22. 스키마는 플러그인 store 의 캐시로 한 번 읽고 지문으로 바뀐 스키마만 다시 읽는다. 행과 비밀은 담지 않는다(ADR 0285).
23. 64 MiB 를 넘는 결과는 PostgreSQL 콘솔에서 커서로 스크롤하고(ADR 0352), 전체를 파일로 낼 때는 한 스냅숏의 COPY 를 임시 이름으로 흘려 끝에 이름을 바꾼다(ADR 0365). 클라이언트 엔진은 64 MiB 상한 그대로.
24. COPY 는 세션을 통해 1 MiB 조각으로 흐르고 파일은 사람이 대화상자에서 고른 것뿐이다(ADR 0356). 파일 가져오기는 플러그인이 파싱해 COPY 로 보낸다(ADR 0363).
25. SSH 터널은 코어가 세션마다 연다: 이 컴퓨터에 포트를 열지 않고, `ssh` 를 돌리지 않으며, 키 파일 내용은 플러그인에 오지 않는다(ADR 0359).
26. 객체 · 표 설계 · 역할 · 권한의 변경은 대화상자가 보여 준 스크립트만 실행하고, 에이전트의 요청은 사람의 답을 기다린다(ADR 0312 · 0324 · 0330).
27. Eris 는 제안만 하고 돌리지 않으며, 보내는 것은 범위 안의 스키마뿐이고 먼저 보여 준다. 행은 견본을 고를 때만(ADR 0345).
28. 실행 중인 호출의 공지는 `db.call.notice` 로 오는 대로 보여 주되, 기록은 끝난 문장의 페이지다(ADR 0334). 알림은 콘솔의 세션이 `LISTEN` 한 채널만, 콘솔마다 1,000 개; 다시 연결해도 저절로 다시 LISTEN 하지 않고, 에이전트 대신 듣지 않으며, 풀러를 거치면 거절한다(ADR 0358).

## Task 이슈 분할안

| 순서 | 이슈 | Scope | 선행 |
| --- | --- | --- | --- |
| T1 | `plugins/database` 편입 (A 단계, 이 문서 · ADR 0038) | `plugins/database/**` · `plugins/README.md` · `docs/ko/database-plugin-requirements.md` · `docs/ko/desk-requirements.md` · `docs/adr/0038-*` · `docs/qa/TESTING.md` | — |
| T2 | D4: 스텁의 가짜 `psql` · `sqlite3` 와 `packages/runtime/e2e/database.spec.ts` | `packages/bridge/src/**` · `packages/runtime/e2e/**` | T1 |
| T3 · T4 | DB-14 데이터 편집, DB-19 · 20 객체 · DDL · 편집기, DB-25 · 26 (#540, ADR 0115) | `plugins/database/**` | T1 |
| T5 | D3 + DB-16 파일로 내보내기 | `specs/plugin/**` · `crates/desk-core/**` · `plugins/database/**` | — |
| T6 | D1 클립보드 쓰기 허용 (보안 검토) | 셸 · `packages/runtime/**` · ADR | — |
| T7 | D 단계: 에픽 #438 의 Task 이슈들(PG-00~PG-109, 위 표). 태스크마다 좁은 기능 폴더를 Scope 로 | 태스크마다 | 에픽의 순서 |

## 열린 질문

- MySQL / MariaDB · SQLite 의 세션 유지 · SSH 터널: #438 은 PostgreSQL 만 다룬다. 코어에 드라이버를 더할지, 클라이언트 세션 프로세스로 갈지.
- 백업 · 복원(`pg_dump` · `pg_restore`)이 SSH 터널을 타는 길: 지금은 서버에 바로 간다.
- PostgreSQL 세션의 소켓 폴더 · IPv6 주소 연결: `db.open` 이 아직 받지 않는다.
- 국제화(NF-06 · PG-108): 뷰 모듈 밖(기능 폴더 · `index.html` · 명령 제목)의 문자열도 카탈로그로 옮길지, 그리고 RT-13 번들과의 관계.
