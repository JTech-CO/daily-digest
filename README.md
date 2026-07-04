# daily-digest

해외/국내 5개 소스(Hacker News · GeekNews · arXiv · Phys.org · TechXplore)에서 매일 소스당 1건(결손 시 재분배)을 선별해 한국어로 제공하는 데일리 테크·사이언스 다이제스트.

- 파이프라인·백엔드 설계: [기술 백서](daily-tech-digest-technical-whitepaper-v0.1.md)
- 화면·컬러·컴포넌트 설계: [디자인 백서](daily-tech-digest-design-whitepaper-v0.1.md)

## 실행

Node 22+ (외부 의존성 없음).

```sh
npm run m0   # = node src/index.mjs — HN 어댑터 PoC 실행
```

## 마일스톤 진행 상황 (기술 백서 §10)

| Phase | 범위 | 상태 |
|---|---|---|
| M0 | HN 어댑터 단독 PoC — latest+popular fetch, 공통 스키마 변환 | ✅ 완료 (2026-07-04) |
| M1 | 5개 소스 어댑터 전체 | ✅ 완료 (2026-07-04) |
| M2 | 중복 제거 + 재분배 | 예정 |
| M3 | 번역 파이프라인 (Claude Haiku 4.5) | 예정 |
| M4 | 스케줄링(GitHub Actions)/SQLite 저장 | 예정 |
| M5 | 프론트엔드 최소 뷰 | 예정 |
| M6 | 모니터링/폴백 검증 | 예정 |

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
│   └── normalize.mjs    # 공통 Candidate 스키마 정의·검증
└── index.mjs            # 실행 진입점 — 5개 소스 병렬 수집
```

Spotlight 피드 슬러그는 실측으로 확정: 양 사이트 모두 `/rss-feed/breaking/` ("Spotlight news only", 2026-07-04 확인).
