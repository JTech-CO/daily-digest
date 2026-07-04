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
│   ├── llm.mjs          # 멀티 프로바이더 클라이언트(Anthropic/OpenAI/Grok/Gemini)
│   └── run.mjs          # 오케스트레이션(수집→…→번역→저장)
├── db/
│   ├── schema.sql       # daily_picks · dedup_log (§5)
│   └── index.mjs        # node:sqlite 저장·조회, 멱등 재실행
├── web/                 # 정적 프론트엔드 소스(디자인 백서 구현)
│   ├── index.html       # 상태줄·피드·아카이브·테마 토글
│   ├── styles.css       # 다크/라이트 토큰, 카드·배지·카테고리 5색
│   └── app.js           # data.json 렌더링, 날짜 네비, 테마 전환
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
