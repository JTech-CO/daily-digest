# daily-digest

> **매일 5개 기술·과학 소스에서 가장 주목할 글을 하나씩 골라 한국어로 읽는 데일리 다이제스트**

## 1. 소개 (Introduction)

Hacker News · GeekNews · arXiv · Phys.org · TechXplore — 개발자·엔지니어가 챙겨보는 다섯 소스를
매일 일일이 훑어보긴 번거롭습니다. **daily-digest**는 이 소스들에서 **하루 소스당 1건**씩(어떤 소스가
비면 다른 소스에서 보충) 가장 인기 있고 새로운 글을 자동으로 골라 **한국어로 번역·정리**해 한 페이지로
보여주는 웹 애플리케이션입니다.

각 카드를 누르면 **원문 번역본 · 핵심 요약 · 기술 블로그 초안** 3구성의 상세 뷰가 열려, 읽고 넘기는 것을
넘어 글을 정리하고 재가공하는 데까지 이어집니다.

**주요 기능**
- **자동 큐레이션**: 5개 소스 병렬 수집 → 4단계 중복 제거 → 소스당 1건 선별(결손 시 재분배).
- **한국어 상세 뷰**: 카드 클릭 시 원문 번역본·핵심 요약·블로그 초안(파이프라인은 기사 **전문 기반** 생성).
- **멀티 LLM 프로바이더**: Anthropic · OpenAI · Grok(xAI) · Gemini 중 설정된 키로 동작. 사이트 우측 상단
  ⚙에서 본인 키를 직접 넣는 브라우저 생성(BYOK)도 지원.
- **읽기 좋은 UI**: 다크/라이트 테마, 날짜별 아카이브, 소스별 색상 구분(단일 컬럼, 정보 밀도 중심).
- **매일 자동화**: GitHub Actions로 매일 실행하고 GitHub Pages로 정적 배포.

## 2. 기술 스택 (Tech Stack)

- **Frontend**: Vanilla JS (ES Modules), CSS (프레임워크 없음), Pretendard · JetBrains Mono
- **Pipeline / Backend**: Node.js 22+ (ESM). 외부 의존성은 `rss-parser` 하나뿐
- **Database**: SQLite (Node 내장 `node:sqlite`, 단일 파일)
- **LLM**: Anthropic · OpenAI · Grok(xAI) · Gemini (멀티 프로바이더, env로 선택)
- **Automation / Deployment**: GitHub Actions (cron) · GitHub Pages (정적 호스팅)

## 3. 설치 및 실행 (Quick Start)

**요구 사항**: Node.js 22 이상

1. **설치 (Install)**
   ```bash
   git clone https://github.com/mjwbryan/daily-digest.git
   cd daily-digest
   npm install
   ```

2. **환경 변수 (Environment)** — *선택*
   `.env.example`을 `.env`로 복사하고 사용할 LLM 프로바이더 키를 하나 이상 입력합니다.
   키가 없어도 파이프라인은 원문을 그대로 두고 동작합니다(번역·상세 생성만 생략).
   ```bash
   cp .env.example .env
   # .env 예시 (하나만 채워도 됨)
   # ANTHROPIC_API_KEY=sk-ant-...
   # LLM_PROVIDER=anthropic
   ```

3. **실행 (Run)**
   ```bash
   npm start        # 수집 → 중복제거 → 선별/재분배 → 번역 → SQLite 적재
   npm run build    # DB → 정적 사이트(public/) 생성
   npm run serve    # 로컬 미리보기 → http://localhost:4173
   ```
   그 밖에: `npm test` (테스트) · `npm run monitor` (소스 엔드포인트 헬스체크)

> **배포**: `git push` 후 GitHub Pages를 켜면 `.github/workflows/daily.yml`이 매일 09:00 KST에
> 파이프라인을 실행하고 사이트를 자동 갱신합니다. LLM 키는 리포지토리 Secret으로 주입합니다.

## 4. 폴더 구조 (Structure)

```text
daily-digest/
├── src/
│   ├── adapters/     # 5개 소스 수집(HN·GeekNews·arXiv·Phys.org·TechXplore) + 공용 HTTP
│   ├── pipeline/     # 수집·중복제거·선별·번역·상세생성·LLM·오케스트레이션
│   ├── db/           # SQLite 스키마·저장(node:sqlite)
│   ├── web/          # 정적 사이트 빌드 · 로컬 미리보기 서버
│   ├── monitor.mjs   # 소스 엔드포인트 헬스체크
│   └── index.mjs     # 파이프라인 실행 진입점
├── web/              # 프론트엔드 소스(index.html · styles.css · app.js · llm.js)
├── test/             # node:test 테스트 스위트
├── .github/workflows/# 일일 파이프라인 + 주간 헬스체크
└── .env.example      # 환경 변수 템플릿
```

## 5. 정보 (Info)

- **License**: 개인 프로젝트(비공개). 각 기사의 저작권은 원 출처(Hacker News · GeekNews · arXiv ·
  Phys.org · TechXplore)에 있으며, 본 서비스는 **요약·번역과 원문 링크**만 제공하고 전문을 재게시하지 않습니다.
  Phys.org·TechXplore 항목은 출처 표기를 유지합니다.
- **Contact**: mjwbryan131@gmail.com
