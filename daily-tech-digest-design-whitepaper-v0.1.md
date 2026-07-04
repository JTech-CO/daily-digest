# (가칭) 데일리 테크·사이언스 다이제스트 — 디자인 백서 (Design Whitepaper)

| | |
|---|---|
| 프로젝트 | (가칭) 데일리 테크·사이언스 다이제스트 |
| 문서 버전 | v0.1 (draft) |
| 상태 | 컬러 시스템·타이포그래피·컴포넌트 명세 초안 |
| 범위 | 다크모드 기본 레이아웃 + 라이트모드 전환, Claude Code CLI 시각 언어 기반 |
| 비범위 | 백엔드/데이터 파이프라인(기술 백서 참조), 로고·브랜드마크 제작 |
| 연계 문서 | daily-tech-digest-technical-whitepaper-v0.1.md §7(프론트엔드 최소 요구사항) |

---

## 0. 설계 방향

**왜 Claude Code CLI인가.** 이 사이트의 독자는 HN·arXiv·GeekNews를 직접 구독하는 개발자·엔지니어층이며, 하루 대부분을 터미널과 Claude Code 안에서 보내는 사람들이다. CLI 시각 언어는 이 독자층에게 장식이 아니라 익숙한 작업 환경의 연장으로 읽힌다. 여기서 차용하는 것은 "터미널처럼 보이게 꾸미기"가 아니라 Claude Code가 실제로 채택한 절제 원칙 — 단일 브랜드 액센트, 넓은 중립 베이스, 정보 밀도가 높은 텍스트를 오래 읽어도 피로하지 않게 만드는 대비 설계 — 그 자체다.

**차용하는 것 / 차용하지 않는 것.**

| 차용 | 차용하지 않음 |
|---|---|
| 절제된 단일 브랜드 액센트(테라코타) + 중립 다크 베이스 | 순수 검정(#000) + 채도 100% 시안/그린(사이버펑크 클리셰) |
| 숫자·타임스탬프·소스 태그의 모노스페이스 표기 | 본문까지 전부 모노스페이스로 통일(가독성 저하) |
| 얇은 1px 테두리로 패널 구분(그림자 대신) | 그림자·글로우 도배 |
| 소스 5종의 카테고리 색상 코딩(Claude Code의 서브에이전트 색상 시스템과 동일한 발상 — 병렬 항목을 시각적으로 구분) | 가짜 터미널 프롬프트·롤플레이 텍스트("$ initializing...") |
| 수동 전환 시 그 선택이 이후 항상 우선하는 테마 모델(Claude Code `/theme` 수동 오버라이드와 동일 발상) | ASCII 아트, 스캔라인, CRT 노이즈, 박스 드로잉 문자를 실제 UI 요소로 렌더링 |

**2차 레퍼런스.** Claude Code CLI 자체가 1차 기준이며, 같은 "개발자 툴" 계열로 GitHub·Railway·Resend(1px 보더, 절제된 컬러, 데이터 중심 레이아웃)를 보조 참고로 삼는다.

---

## 1. 컬러 시스템

원칙: **중성색 1 family(zinc) + 브랜드 액센트 1색 + 카테고리색 5색(소스 식별용, 기능적 예외로 명시)**. 카테고리색은 장식이 아니라 5개 소스를 한눈에 구분하기 위한 필수 정보이므로 "액센트 1색" 원칙의 예외로 별도 관리한다.

### 1.1 베이스 토큰

| 토큰 | 다크(기본) | 라이트 | 용도 |
|---|---|---|---|
| `--bg` | `#09090b` | `#fafafa` | 페이지 배경 |
| `--bg-elevated` | `#18181b` | `#ffffff` | 카드·패널 배경 |
| `--border` | `#27272a` | `#e4e4e7` | 카드 테두리, 구분선 |
| `--border-hover` | `#3f3f46` | `#d4d4d8` | 호버·포커스 시 테두리 |
| `--text` | `#f4f4f5` | `#18181b` | 본문·제목 |
| `--text-muted` | `#a1a1aa` | `#71717a` | 메타 정보(시간, 출처, 배지) |
| `--text-dim` | `#52525b` | `#a1a1aa` | 구분자, 보조 텍스트 |
| `--accent` | `#d97757` | `#c15f3c` | 링크, 포커스 링, 토글 활성 |
| `--accent-subtle` | `rgba(217,119,87,.12)` | `rgba(193,95,60,.10)` | 액센트 배경 틴트(호버 등) |

`#09090b`는 순수 `#000`이 아니다 — 완전한 검정은 밝은 텍스트와의 대비가 과해 장시간 읽기에 눈이 피로하다. 라이트모드 액센트는 흰 배경 대비 확보를 위해 다크모드 값보다 약 10% 어둡게 조정한다.

### 1.2 소스 카테고리 색상

| 소스 | 토큰 | 색상(다크 기준) | 계열 |
|---|---|---|---|
| Hacker News | `--source-hn` | `#6c93bf` | 청색 |
| GeekNews | `--source-gn` | `#6fa96c` | 녹색 |
| arXiv | `--source-ax` | `#9b87c4` | 보라 |
| Phys.org | `--source-po` | `#5fadaa` | 청록 |
| TechXplore | `--source-tx` | `#c97fa0` | 로즈 |

라이트모드에서는 명도를 10~15% 낮춰 흰 배경 대비를 확보한다(예: HN `#6c93bf` → `#4e7099`). 다섯 색 모두 채도를 중간 이하로 눌러 서로 부딪히지 않도록 한다 — 카테고리 색은 카드 좌측 4px 보더와 소스 배지 텍스트에만 쓰고, 배경 전체를 채우거나 그라데이션으로 섞지 않는다.

---

## 2. 타이포그래피

| 역할 | 폰트 스택 | 비고 |
|---|---|---|
| 본문(한글 sans) | `Pretendard, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | 한글 시스템 폰트와 자연스럽게 어울리는 가변 폰트 |
| 데이터·라벨(mono) | `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace` | 숫자·타임스탬프·소스 태그·통계 전용 |

최대 2개 family. 세리프는 사용하지 않는다(터미널 지향과 상충). 본문에 모노스페이스를 쓰지 않고, 반대로 숫자·코드성 정보에 sans를 쓰지 않는다 — 역할을 엄격히 분리한다.

| 스케일 | 크기 | 용도 | weight |
|---|---|---|---|
| xs | 13px | 배지, 타임스탬프(mono) | 500 |
| sm | 14px | 메타 텍스트, 캡션 | 400 |
| base | 16px | 본문(요약문) | 400 |
| lg | 18px | 카드 제목 | 600 |
| xl | 22px | 섹션 헤딩 | 600 |
| 2xl | 28px | 페이지 타이틀(날짜) | 600 |

숫자에는 `font-variant-numeric: tabular-nums`를 적용해 순위·통계가 세로로 흔들리지 않게 정렬한다. line-height는 본문 1.6, 제목 1.3.

---

## 3. 레이아웃

단일 컬럼 리스트. 카드 그리드(3열 피처 그리드류)는 쓰지 않는다 — 콘텐츠가 원래 하루 5~8건의 순차 목록이고, HN 자체도 다단 그리드가 아닌 1열 리스트다. 순번(01, 02...)은 장식이 아니라 실제 인기·최신 결합 랭킹 순서를 인코딩하므로 표시한다.

| 항목 | 값 |
|---|---|
| 간격 스케일 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 (px) |
| 콘텐츠 최대 폭 | 680px, 중앙 정렬 |
| 카드 내부 패딩 | 20px (모바일 16px) |
| 카드 간 간격 | 16px |
| 브레이크포인트 | 640px 미만에서 좌우 패딩만 축소(원래 1열이므로 구조 변화 없음) |
| 카드 radius | 8px |
| 배지·버튼 radius | 4px |
| 토글 트랙 radius | 999px(pill) |

### 3.1 페이지 와이어프레임

```
┌──────────────────────────────────────────────────────┐
│  daily-digest            ‹ 2026-07-04 ›        ☀/☾    │  statusline
├──────────────────────────────────────────────────────┤
│  01 │HN│ 제목(번역)                        ★ 812      │
│     요약 2~3줄...                                     │
│     3시간 전 · 원문 ↗                                  │
│                                                        │
│  02 │GN│ 제목(번역)                        ▲ 41       │
│     ...                                               │
│                                                        │
│  03 │AX│ 제목(번역)                    HF Papers ★    │
│     ...                                               │
│                                                        │
│  04 │PO│ 제목(번역)                     Spotlight     │
│     ...                                    재분배      │
├──────────────────────────────────────────────────────┤
│  이전 날짜 →                                           │
└──────────────────────────────────────────────────────┘
```

박스 드로잉 문자는 이 문서 안에서 레이아웃을 설명하기 위한 와이어프레임 표기일 뿐, 실제 화면에는 일반 CSS 보더로 구현한다(§8 참조).

---

## 4. 컴포넌트 명세

### 4.1 다이제스트 카드

- 배경 `--bg-elevated`, 테두리 1px `--border`, radius 8px
- 좌측 4px 보더 = 소스 카테고리 색(§1.2)
- 헤더 행: 소스 배지 + 순번(mono, `--text-dim`) + 인기 신호(mono, 우측 정렬)
- 본문: 제목(lg, 600) → 요약(base, 400, 최대 3줄 후 말줄임)
- 푸터 행: 상대 시간(sm, mono, `--text-muted`) · 구분자 `·` · "원문 보기 ↗"(`--accent`, 외부 링크 아이콘은 Lucide `external-link`)
- 재분배 항목은 푸터에 `재분배` 텍스트 태그 추가(별도 색 없이 `--text-dim` + 점선 보더 1px)
- 호버: `--border` → `--border-hover`, 150ms ease-out. scale·shadow 변화 없음(anti-cliche §2.7 준수)

### 4.2 소스 배지

- mono, xs, letter-spacing 0.02em, uppercase
- 텍스트 색 = 해당 카테고리 색, 배경 없음(배경 채우면 카드마다 5색이 면적으로 부딪힘 — 텍스트 색으로만 표현해 절제)

### 4.3 상태줄(statusline) + 날짜 내비게이션

- 페이지 최상단, `--bg` 배경에 하단 1px `--border`
- 좌: 사이트명(mono, sm) · 중앙: `‹ YYYY-MM-DD ›` 날짜 내비(mono) · 우: 테마 토글(§4.4)
- Claude Code 하단 상태줄(모델·경로·브랜치 표시)과 같은 발상 — 여기서는 "오늘 날짜 · 총 건수 · 마지막 갱신 시각"을 담당

### 4.4 다크/라이트 토글

- Lucide `sun`/`moon` 아이콘 기반 pill 토글, 폭 44px·높이 24px
- 활성 상태 노브 색 `--accent`, 트랙 `--border`
- 상태 전환 150ms ease-out, `prefers-reduced-motion: reduce` 시 즉시 전환(애니메이션 생략)

### 4.5 아카이브 리스트

- 리스트 최하단, 날짜 + 건수만 표시하는 텍스트 링크 목록(mono 날짜 + sans 건수)
- 카드 형태 아님 — 정보 밀도가 낮으므로 리스트로 충분

---

## 5. 모션

| 항목 | 값 |
|---|---|
| duration | 100~250ms |
| easing | `ease-out` |
| 적용 대상 | 호버 보더 색, 테마 전환, 포커스 링 등장 |
| 적용하지 않는 대상 | 카드 진입 stagger, scale/rotate, 무한 반복 애니메이션 |

`prefers-reduced-motion: reduce`에서는 모든 transition을 `0ms`로 낮춘다.

---

## 6. 다크/라이트 전환 메커니즘

```css
:root {
  --bg: #09090b; --bg-elevated: #18181b; --border: #27272a;
  --text: #f4f4f5; --text-muted: #a1a1aa; --accent: #d97757;
  /* ...§1.1 다크 값 전체 */
}
[data-theme="light"] {
  --bg: #fafafa; --bg-elevated: #ffffff; --border: #e4e4e7;
  --text: #18181b; --text-muted: #71717a; --accent: #c15f3c;
  /* ...§1.1 라이트 값 전체 */
}
```

```javascript
// 기본값은 항상 다크다(요구사항 — 다크모드 레이아웃 우선). 시스템 설정은 보지 않는다.
// 사용자가 한 번이라도 수동 전환했다면 그 선택만 기억한다.
const saved = localStorage.getItem('theme');
document.documentElement.dataset.theme = saved ?? 'dark';

toggleBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
});
```

시스템 다크/라이트 감지(`prefers-color-scheme`)는 적용하지 않는다 — 라이트 시스템 사용자에게도 첫 방문은 다크로 보여야 요구사항에 맞는다. 감지 로직을 넣고 싶다면 `saved ?? 'dark'`를 `saved ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')`로 바꾸면 되지만, 이 프로젝트는 기본값을 다크로 고정하는 쪽을 권장한다.

---

## 7. 접근성

- 본문 대비 4.5:1 이상(WCAG AA), `--text-muted`도 배경 대비 확인 필요
- 모든 인터랙티브 요소에 `focus-visible` 시 `--accent` 2px 아웃라인
- 토글·링크는 키보드 Tab 순서에 포함, 아이콘 전용 버튼에는 `aria-label`
- 소스 구분을 색에만 의존하지 않음 — 배지 텍스트(HN/GN/AX/PO/TX)가 항상 병기되므로 색약 사용자도 구분 가능

---

## 8. 안티클리셰 자가점검

| 점검 항목 | 결과 |
|---|---|
| 그라데이션 사용 여부 | 없음 |
| `shadow-2xl` 반복 | 없음 — 1px 보더로만 구분 |
| `backdrop-blur` 사용 | 없음 |
| 과도한 hover scale/rotate | 없음 — 보더 색 전환만 |
| 장식용 이모지 | 없음 — 아이콘은 Lucide SVG만 |
| font-family 3개 이상 | 아니오 — 2개(Pretendard, JetBrains Mono) |
| 무한 반복 애니메이션 | 없음 |
| 색상 5개 이상(브랜드 액센트 기준) | 브랜드 액센트는 1개(`--accent`). 카테고리색 5개는 소스 구분 기능색으로 별도 관리(§1) |
| 순수 `#000` + 채도 100% 색 | 아니오 — `#09090b` 기반, 채도 중간 이하 |
| 가짜 터미널 텍스트·스캔라인 | 없음 |

---

## 9. 참고 코드

```html
<article class="pick" style="--cat: var(--source-hn)">
  <header class="pick__head">
    <span class="pick__rank">01</span>
    <span class="pick__badge">HN</span>
    <span class="pick__signal">★ 812</span>
  </header>
  <h3 class="pick__title">제목(번역)</h3>
  <p class="pick__summary">요약 텍스트...</p>
  <footer class="pick__meta">
    <time>3시간 전</time>
    <a href="#" class="pick__link">원문 보기 ↗</a>
  </footer>
</article>
```

```css
.pick {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-left: 4px solid var(--cat);
  border-radius: 8px;
  padding: 20px;
  transition: border-color 150ms ease-out;
}
.pick:hover { border-color: var(--border-hover); border-left-color: var(--cat); }
.pick__badge { font-family: "JetBrains Mono", monospace; font-size: 13px;
  color: var(--cat); letter-spacing: .02em; text-transform: uppercase; }
.pick__rank, .pick__signal { font-family: "JetBrains Mono", monospace;
  font-variant-numeric: tabular-nums; color: var(--text-dim); font-size: 13px; }
.pick__title { font-size: 18px; font-weight: 600; margin: 8px 0 4px; }
.pick__summary { font-size: 16px; line-height: 1.6; color: var(--text); }
.pick__link { color: var(--accent); }
```
