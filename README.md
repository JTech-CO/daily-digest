# daily-digest

해외/국내 5개 소스(Hacker News · GeekNews · arXiv · Phys.org · TechXplore)에서 매일 소스당 1건(결손 시 재분배)을 선별해 한국어로 제공하는 데일리 테크·사이언스 다이제스트.

- 파이프라인·백엔드 설계: [기술 백서](daily-tech-digest-technical-whitepaper-v0.1.md)
- 화면·컬러·컴포넌트 설계: [디자인 백서](daily-tech-digest-design-whitepaper-v0.1.md)

## 실행

Node 22+ (의존성: `rss-parser`).

```sh
npm install
npm start          # 수집 → 중복제거 → 선별/재분배 → 번역 → SQLite 적재
npm run build      # DB → 정적 사이트(public/) 생성
npm run serve      # public/ 로컬 미리보기 (http://localhost:4173)
npm run monitor    # 엔드포인트 헬스체크 (§9 리스크 항목 실측)
npm test           # dedup·select·번역·저장·폴백 테스트셋 (node:test, 42개)
```

### LLM 프로바이더

번역(M3)과 4차 dedup(애매 구간 LLM 판정)은 아래 중 **API 키가 설정된 프로바이더**를 자동 선택한다.
각각의 "최상위이면서 빠른" 모델을 기본값으로 쓰며, 모델 ID는 env로 정정할 수 있다.

| 프로바이더 | 키 환경변수 | 기본 모델 | 모델 override |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-5` (Opus 4.8 가능) | `ANTHROPIC_MODEL` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.5` | `OPENAI_MODEL` |
| Grok (xAI) | `XAI_API_KEY` / `GROK_API_KEY` | `grok-4.3` | `XAI_MODEL` |
| Gemini | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `gemini-3.5-flash` | `GEMINI_MODEL` |

키가 여럿이면 `LLM_PROVIDER`(예: `openai`)로 명시하거나, 없으면 anthropic → openai → gemini → grok
순서로 첫 키를 쓴다. **아무 키도 없으면** 애매 구간은 비중복 처리되고 번역은 원문을 유지한다(graceful fallback).

## 마일스톤 진행 상황 (기술 백서 §10)

| Phase | 범위 | 상태 |
|---|---|---|
| M0 | HN 어댑터 단독 PoC — latest+popular fetch, 공통 스키마 변환 | ✅ 완료 (2026-07-04) |
| M1 | 5개 소스 어댑터 전체 | ✅ 완료 (2026-07-04) |
| M2 | 중복 제거 + 재분배 | ✅ 완료 (2026-07-05) |
| M3 | 번역 파이프라인 (Claude Haiku 4.5) | ✅ 완료 (2026-07-05, 실 API는 키 필요) |
| M4 | 스케줄링(GitHub Actions)/SQLite 저장 | ✅ 완료 (2026-07-05) |
| M5 | 프론트엔드 최소 뷰 | ✅ 완료 (2026-07-05) |
| M6 | 모니터링/폴백 검증 | ✅ 완료 (2026-07-05) |

**로드맵 M0–M6 전체 완료.**

### 상세 뷰 (카드/제목 클릭)

카드의 **제목이나 패널을 클릭**하면 해당 소스 색상이 강조된 상세 창이 열리고 3구성을 보여준다 —
**① 원문 번역본 ② 핵심 요약 ③ 블로그 글 작성용 초안(복사 가능)**. ("원문 보기 ↗" 링크만 원문으로 이동.)

콘텐츠는 두 경로로 채워진다(파이프라인 우선):
1. **파이프라인 사전 생성 (전문 기반)** — 서버(Node)는 CORS가 없으므로 기사 원문을 가져와
   본문을 추출(`extract.mjs`)하고 **전문(full article) 기반**으로 번역/요약/블로그를 생성한다
   (번역은 잘림 방지를 위해 별도 호출). DB(`detail_*`)·`data.json`에 저장. 최고 품질.
   arxiv는 초록이 곧 콘텐츠, geeknews는 이미 한국어라 정제만.
2. **브라우저 직접 생성 (BYOK, 초록 기반)** — 사전 생성분이 없을 때 ⚙ 설정의 키로 브라우저가
   생성. 브라우저는 뉴스 원문을 CORS로 못 가져와 **초록 기반**이다(전문 기반은 파이프라인). 결과는 localStorage 캐시.

### ⚙ LLM 설정 (사이트에서 직접)

우측 상단 톱니 버튼 → 프로바이더·모델·API 키 입력. 키는 **이 브라우저(localStorage)에만** 저장되고
선택한 프로바이더로만 직접 전송된다. 브라우저 직접 호출(CORS) 지원 실측 결과:

| 프로바이더 | 브라우저 직접 호출 | 비고 |
|---|---|---|
| Anthropic | ✅ | `anthropic-dangerous-direct-browser-access` 헤더 자동 부착 |
| OpenAI | ✅ | — |
| Gemini | ✅ | — |
| Grok (xAI) | ⚠ | 공식 미지원 — CORS 차단 가능(설정에서 경고, 실패 시 안내) |

키를 브라우저에 노출하는 BYOK 패턴이므로 공용 PC에서는 사용 후 **지우기** 권장.

## 보안

코드베이스 전체 보안 감사(위협 차원별 병렬 + 익스플로잇 적대적 검증)를 수행했다. critical/high 확정 0건이며
(모든 DOM 렌더는 `textContent`, URL은 파이프라인에서 http(s) 강제, SQL은 파라미터 바인딩, 시크릿 유출·프로토타입 오염·SSRF 없음),
발견된 항목은 모두 방어 계층으로 반영했다:

- **응답 크기 상한**(`http.mjs`) — 신뢰 불가 외부 응답을 8MB로 캡(메모리 고갈 DoS·ReDoS 증폭 차단).
- **경로 탐색 차단**(`serve.mjs`) — `%2f` 인코딩 우회(`..` 세그먼트) 거절 + 경계 구분자 검사.
- **클라이언트 URL 스킴 검증**(`app.js`) — `pick.url`을 http(s)만 허용(`javascript:` 스킴 심층방어).
- **파싱 정규식 하드닝**(`geeknews.mjs`) — 블록 입력 상한으로 초선형 백트래킹 방지.
- **CSP**(`index.html`) — `script-src 'self'`, `connect-src`를 data.json + 4개 LLM 프로바이더로 제한.

## 구조

```
src/
├── adapters/
│   ├── http.mjs         # 공용 HTTP 헬퍼(컨텍스트 에러, 지수 백오프)
│   ├── hackernews.mjs   # Algolia HN Search API — 24h 창 내 인기순
│   ├── geeknews.mjs     # 홈페이지 투표 순위 + RSS 폴백 (한국어)
│   ├── arxiv.mjs        # Atom API + HF Daily Papers 업보트 조인
│   ├── sciencex.mjs     # Phys.org·TechXplore 공용 팩토리
│   ├── physorg.mjs      # 전체 + Spotlight(/rss-feed/breaking/) 피드
│   └── techxplore.mjs   # 〃
├── pipeline/
│   ├── normalize.mjs    # 공통 Candidate 스키마 정의·검증
│   ├── collect.mjs      # 5개 소스 병렬 수집(allSettled)
│   ├── dedup.mjs        # 4단계 중복 제거(url→arxiv_id→jaccard→llm)
│   ├── select.mjs       # 선별 + 재분배(소스당 1건, 결손 보충, 상한 3)
│   ├── translate.mjs    # 번역(영어 4소스)·정제(GeekNews) + 실패율 집계
│   ├── detail.mjs       # 상세 3구성 생성(전문 기반) — 번역/요약/블로그
│   ├── extract.mjs      # 기사 HTML → 본문 텍스트 추출(서버, 전문 확보)
│   ├── llm.mjs          # 멀티 프로바이더 클라이언트(Anthropic/OpenAI/Grok/Gemini)
│   └── run.mjs          # 오케스트레이션(수집→…→번역→상세→저장)
├── db/
│   ├── schema.sql       # daily_picks · dedup_log (§5)
│   └── index.mjs        # node:sqlite 저장·조회, 멱등 재실행
├── web/                 # 정적 프론트엔드 소스(디자인 백서 구현)
│   ├── index.html       # 상태줄·피드·아카이브·테마 토글·상세/설정 모달
│   ├── styles.css       # 다크/라이트 토큰, 카드·배지·카테고리 5색, 모달
│   ├── app.js           # data.json 렌더링, 날짜 네비, 상세 뷰, 설정
│   └── llm.js           # 브라우저 LLM 클라이언트(BYOK, 4개 프로바이더)
├── src/web/
│   ├── build.mjs        # DB → public/(정적 자산 + data.json)
│   └── serve.mjs        # 로컬 미리보기 서버
├── src/monitor.mjs      # 엔드포인트·슬러그·셀렉터 헬스체크 (§9)
└── index.mjs            # 실행 진입점 — runPipeline 1회 실행
```

스케줄링:
- `.github/workflows/daily.yml` — 매일 09:00 KST(00:00 UTC): 파이프라인 → DB 커밋 → GitHub Pages 배포. `ANTHROPIC_API_KEY`는 리포지토리 Secret으로 주입.
- `.github/workflows/healthcheck.yml` — 매주 월 10:00 KST: 테스트 + 엔드포인트 헬스체크로 §9 구조 변경 조기 감지.

Spotlight 피드 슬러그는 실측으로 확정: 양 사이트 모두 `/rss-feed/breaking/` ("Spotlight news only", 2026-07-04 확인).
