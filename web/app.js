// fivetabs 프론트엔드: 디자인 백서 §4, §6 구현
// data.json(빌드 시 DB에서 생성)을 읽어 날짜별 다이제스트를 렌더링한다.

// 소스 식별을 명확히 하기 위해 축약 대신 전체 명칭을 대문자로 표기
const BADGE = {
  hackernews: 'HACKER NEWS', geeknews: 'GEEKNEWS', arxiv: 'ARXIV',
  physorg: 'PHYS.ORG', techxplore: 'TECHXPLORE',
};

/** id로 요소 찾기: 이 파일에서 가장 많이 반복되던 표현 */
const $ = id => document.getElementById(id);

/** 소스의 표시 이름(모르는 소스는 원문 그대로) */
const badgeOf = source => BADGE[source] ?? source;
/** 소스 카테고리 색 CSS 변수 참조 */
const catVar = source => `var(--source-${source})`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// 렌더 시점 심층방어: 신뢰 불가 URL은 http(s)만 허용(javascript:/data: 스킴 차단).
// 파이프라인이 이미 스킴을 강제하지만, data.json이 파이프라인 밖에서 오염돼도 안전하도록.
function safeHttpUrl(url) {
  try {
    const proto = new URL(url, location.href).protocol;
    return (proto === 'http:' || proto === 'https:') ? url : null;
  } catch {
    return null;
  }
}

// ── 상대 시간 (§4.1 "3시간 전") ────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return '';
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

// 인기 신호 표기 (§7: 값 있으면 노출, 없으면 "에디터 선정")
function signalLabel(pick) {
  if (pick.popularity_signal != null) {
    const mark = pick.source === 'geeknews' ? '▲' : '★';
    return `${mark} ${pick.popularity_signal}`;
  }
  return '에디터 선정';
}

// ── 카드 렌더 (§4.1) ─────────────────────────────────────────
function renderPick(pick, index) {
  const article = el('article', 'pick');
  article.style.setProperty('--cat', catVar(pick.source));
  // 제목/패널 클릭 → 상세 뷰(원문 링크는 아래 pick__link만)
  article.tabIndex = 0;
  article.setAttribute('role', 'button');
  article.setAttribute('aria-haspopup', 'dialog');
  const open = () => openDetail(pick);
  article.addEventListener('click', (e) => { if (!e.target.closest('a')) open(); });
  article.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  const head = el('div', 'pick__head');
  head.append(
    // 검색 결과에서도 "그날의 순위"를 보여준다(검색 결과 내 순서가 아니라)
    el('span', 'pick__rank', String(pick.rank ?? index + 1).padStart(2, '0')),
    el('span', 'pick__badge', badgeOf(pick.source)),
    el('span', 'pick__signal', signalLabel(pick)),
  );

  const title = el('h3', 'pick__title', pick.title_ko || pick.title_original);

  article.append(head, title);

  const summaryText = pick.summary_ko || pick.summary_original;
  if (summaryText) article.append(el('p', 'pick__summary', summaryText));

  const meta = el('div', 'pick__meta');
  meta.append(el('time', 'pick__time', relativeTime(pick.published_at)));
  meta.append(el('span', 'pick__sep', '·'));
  const href = safeHttpUrl(pick.url);
  if (href) {
    const link = el('a', 'pick__link', '원문 보기 ↗');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    meta.append(link);
  } else {
    meta.append(el('span', 'pick__link', '원문 링크 없음'));
  }
  if (pick.selection_reason === 'redistributed') {
    meta.append(el('span', 'pick__redist', '재분배'));
  }
  // 출처 표기 의무 소스 (§7, 법적 조건): 소스명 명시
  if (pick.source === 'physorg' || pick.source === 'techxplore') {
    meta.append(el('span', 'pick__sep', '·'));
    meta.append(el('span', null, `출처: ${pick.source === 'physorg' ? 'Phys.org' : 'TechXplore'}`));
  }

  article.append(meta);
  return article;
}

// ── 상태 ───────────────────────────────────────────────────────
// query/sources가 비어 있으면 '날짜 모드', 하나라도 있으면 '검색 결과 모드'.
// 두 모드가 같은 #feed를 공유한다. 별도 인덱스 파일은 만들지 않는다. 
// data.json이 이미 전체를 담고 있어 클라이언트에서 바로 거를 수 있다.
const state = { data: null, dateIndex: 0, query: '', sources: new Set() };

function currentDate() {
  return state.data.dates[state.dateIndex]?.date ?? null;
}

const isFiltering = () => state.query.trim().length > 0 || state.sources.size > 0;

/** 검색·소스 필터를 해제하고 UI도 초기 상태로 되돌린다(날짜 모드 복귀용) */
function clearFilters() {
  if (!isFiltering()) return;
  state.query = '';
  state.sources.clear();
  const input = $('search');
  if (input) input.value = '';
  for (const chip of document.querySelectorAll('.chip--on')) {
    chip.classList.remove('chip--on');
    chip.setAttribute('aria-pressed', 'false');
  }
}

/** 검색 대상 텍스트(번역·원문 모두) */
function haystack(p) {
  return [p.title_ko, p.title_original, p.summary_ko, p.summary_original, p.detail_summary]
    .filter(Boolean).join(' ').toLowerCase();
}

/** 필터에 걸리는 항목을 최신 날짜순으로 반환 */
function filteredPicks() {
  const q = state.query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const out = [];
  for (const { date } of state.data.dates) {
    for (const p of state.data.picks[date] ?? []) {
      if (state.sources.size > 0 && !state.sources.has(p.source)) continue;
      if (terms.length > 0) {
        const hay = haystack(p);
        if (!terms.every(t => hay.includes(t))) continue;
      }
      out.push({ pick: p, date });
    }
  }
  return out;
}

function render() {
  const feed = $('feed');
  const dateLabel = $('currentDate');
  feed.replaceChildren();

  if (isFiltering()) return renderResults(feed, dateLabel);

  const date = currentDate();
  if (!date) {
    feed.append(el('p', 'empty', '아직 게시된 다이제스트가 없습니다.'));
    dateLabel.textContent = '-';
    return;
  }
  dateLabel.textContent = date;
  dateLabel.dateTime = date;

  const picks = state.data.picks[date] ?? [];
  if (picks.length === 0) {
    feed.append(el('p', 'empty', '이 날짜에는 게시물이 없습니다.'));
  } else {
    picks.forEach((p, i) => feed.append(renderPick(p, i)));
  }

  // 날짜 네비 상태: dates는 최신순 정렬
  $('prevDate').disabled = state.dateIndex >= state.data.dates.length - 1;
  $('nextDate').disabled = state.dateIndex <= 0;
}

function renderResults(feed, dateLabel) {
  const results = filteredPicks();
  dateLabel.textContent = `검색 ${results.length}건`;
  dateLabel.removeAttribute('datetime');
  $('prevDate').disabled = true;
  $('nextDate').disabled = true;

  if (results.length === 0) {
    feed.append(el('p', 'empty', '조건에 맞는 항목이 없습니다.'));
    return;
  }
  results.forEach(({ pick, date }, i) => {
    const card = renderPick(pick, i);
    // 결과 카드엔 어느 날짜 것인지 표시
    card.querySelector('.pick__meta')?.prepend(el('span', 'pick__date', date), el('span', 'pick__sep', '·'));
    feed.append(card);
  });
}

// ── 아카이브 ────────────────────────────────────────────────────
// 매일 쌓이므로 날짜 목록이 길어진다. 기본은 접어두고, 월 단위로 끊어 4열 그리드로 보인다.

/** dates(최신순) → Map<'2026-09', [{date, count, index}]>: 삽입 순서가 곧 최신 월 순서 */
function groupByMonth(dates) {
  const byMonth = new Map();
  dates.forEach((d, index) => {
    const month = d.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push({ ...d, index });
  });
  return byMonth;
}

const monthLabel = m => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;

/** 날짜 칸 하나: 누르면 그 날짜의 다이제스트로 이동 */
function archiveCell(day) {
  const btn = el('button', 'archive__date');
  btn.append(el('span', 'archive__day', day.date), el('span', 'archive__count', `${day.count}건`));
  btn.addEventListener('click', () => {
    clearFilters();            // 필터가 걸려 있으면 날짜를 바꿔도 화면에 반영되지 않는다
    state.dateIndex = day.index;
    render();
    window.scrollTo(0, 0);
  });
  const li = el('li');
  li.append(btn);
  return li;
}

function renderArchive() {
  const section = $('archive');
  if (state.data.dates.length <= 1) { section.hidden = true; return; }
  section.hidden = false;

  const byMonth = groupByMonth(state.data.dates);
  const grid = $('archiveList');
  const tabs = $('archiveMonths');

  const showMonth = month => {
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.month === month));
    grid.replaceChildren(...byMonth.get(month).map(archiveCell));
  };

  tabs.replaceChildren(...[...byMonth].map(([month, days]) => {
    const tab = el('button', 'archive__month', `${monthLabel(month)} · ${days.length}일`);
    tab.dataset.month = month;
    tab.addEventListener('click', () => showMonth(month));
    return tab;
  }));
  showMonth(byMonth.keys().next().value);   // 기본은 가장 최근 월

  $('archiveTotal').textContent = `${state.data.dates.length}일`;
  const toggle = $('archiveToggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    $('archiveBody').hidden = open;
  });
}

// ── 모달 공통 ──────────────────────────────────────────────────
// 포커스 저장·복원과 배경 스크롤 잠금은 모든 모달이 동일하게 지켜야 한다.
function makeModal(modalId, { fill, focusId }) {
  let lastFocused = null;
  return {
    open(...args) {
      lastFocused = document.activeElement;
      fill?.(...args);
      $(modalId).hidden = false;
      document.body.style.overflow = 'hidden';
      $(focusId)?.focus();
    },
    close() {
      const modal = $(modalId);
      if (modal.hidden) return;
      modal.hidden = true;
      document.body.style.overflow = '';
      lastFocused?.focus?.();
    },
  };
}

// ── 상세 뷰(모달) ──────────────────────────────────────────────

// LLM 출력 마크다운을 안전하게(textContent만) DOM으로 렌더: 제목/불릿/문단만 지원
function renderMarkdown(md) {
  const frag = document.createDocumentFragment();
  let list = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (bullet) {
      if (!list) { list = el('ul', 'md__list'); frag.append(list); }
      list.append(el('li', null, bullet[1]));
      continue;
    }
    list = null;
    if (heading) frag.append(el(`h${Math.min(heading[1].length + 2, 6)}`, 'md__h', heading[2]));
    else if (line.trim()) frag.append(el('p', 'md__p', line));
  }
  return frag;
}

// 콘텐츠가 있는 섹션만 만든다(생성 전에는 빈 섹션을 렌더하지 않음).
function section(label, text, { markdown = false, copyable = false } = {}) {
  const sec = el('section', 'detail__section');
  const header = el('div', 'detail__section-head');
  header.append(el('span', 'detail__label', label));
  if (copyable) {
    const btn = el('button', 'detail__copy', '복사');
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = '복사'), 1500); }
      catch { btn.textContent = '복사 실패'; }
    });
    header.append(btn);
  }
  sec.append(header);
  if (markdown) {
    const md = el('div', 'detail__md');
    md.append(renderMarkdown(text));
    sec.append(md);
  } else {
    sec.append(el('p', 'detail__text', text));
  }
  return sec;
}

// 상세 3구성은 매일 파이프라인이 미리 만든다. 실제로 생성된 구성만 표시한다(빈 섹션 방지).
function renderDetailBody(pick) {
  const sections = [];
  if (pick.detail_translation) sections.push(section('원문 번역본', pick.detail_translation));
  if (pick.detail_summary) sections.push(section('핵심 요약', pick.detail_summary));
  if (pick.detail_blog) sections.push(section('블로그 글 작성용 초안', pick.detail_blog, { markdown: true, copyable: true }));

  // 아직 없는 글(백필 전이거나 그날 생성이 실패한 글)은 안내만 한다
  $('detailBody').replaceChildren(...(sections.length ? sections
    : [el('p', 'detail__pending', '이 글의 번역·요약은 아직 준비되지 않았습니다. 원문 보기로 먼저 읽어 주세요.')]));
}

function fillDetail(pick) {
  const panel = document.querySelector('#detail .detail__panel');
  panel.style.setProperty('--cat', catVar(pick.source));

  const badge = $('detailBadge');
  badge.textContent = badgeOf(pick.source);
  badge.style.color = catVar(pick.source);
  $('detailSignal').textContent = signalLabel(pick);
  $('detailTitle').textContent = pick.title_ko || pick.title_original;
  const orig = $('detailOrig');
  // 번역된 항목만 원제 병기(GeekNews 등 원문=한국어면 생략)
  orig.textContent = pick.is_translated && pick.title_original ? pick.title_original : '';
  orig.hidden = !orig.textContent;
  const srcLink = $('detailSource');
  const srcHref = safeHttpUrl(pick.url);
  srcLink.href = srcHref || '#';
  srcLink.hidden = !srcHref;

  renderDetailBody(pick);
}

const detailModal = makeModal('detail', { fill: fillDetail, focusId: 'detailClose' });
const openDetail = pick => detailModal.open(pick);
const closeDetail = () => detailModal.close();

function setupDetail() {
  const modal = $('detail');
  $('detailClose').addEventListener('click', closeDetail);
  modal.querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', closeDetail));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });
}

// ── 예전 BYOK 흔적 정리 ────────────────────────────────────────
// 방문자 API 키를 브라우저에 저장하던 기능이 있었다. 이 사이트의 출처(jtech-co.github.io)는
// 같은 계정의 다른 Pages 사이트들과 공유돼 그쪽에서도 localStorage를 읽고 쓸 수 있으므로,
// 남아 있는 키와 생성 캐시를 지운다.
function purgeLegacyByok() {
  try {
    localStorage.removeItem('dd:llmConfig');
    for (const k of Object.keys(localStorage)) if (k.startsWith('dd:detail:')) localStorage.removeItem(k);
  } catch { /* 저장소에 접근할 수 없으면(프라이빗 모드 등) 지울 것도 없다 */ }
}

// ── 테마 토글 (§6): 수동 선택이 항상 우선, 시스템 설정 미참조 ──
function setupTheme() {
  const btn = $('themeToggle');
  const sync = () => btn.setAttribute('aria-checked', document.documentElement.dataset.theme === 'light');
  sync();
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    sync();
  });
}

// ── 검색 · 소스 필터 ───────────────────────────────────────────
function setupSearch() {
  const input = $('search');
  const chips = $('sourceChips');

  input.addEventListener('input', () => {
    state.query = input.value;
    render();
    window.scrollTo(0, 0);
  });
  // Esc로 검색 해제(모달이 열려 있지 않을 때만)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      input.value = '';
      state.query = '';
      render();
    }
  });

  // 소스 칩: data.json에 실제로 등장한 소스만 노출
  const present = new Set();
  for (const { date } of state.data.dates) {
    for (const p of state.data.picks[date] ?? []) present.add(p.source);
  }
  chips.replaceChildren();
  for (const source of ['hackernews', 'geeknews', 'arxiv', 'physorg', 'techxplore']) {
    if (!present.has(source)) continue;
    const chip = el('button', 'chip', badgeOf(source));
    chip.style.setProperty('--cat', catVar(source));
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (state.sources.has(source)) state.sources.delete(source);
      else state.sources.add(source);
      chip.classList.toggle('chip--on', state.sources.has(source));
      chip.setAttribute('aria-pressed', String(state.sources.has(source)));
      render();
      window.scrollTo(0, 0);
    });
    chips.append(chip);
  }
}

function setupNav() {
  $('prevDate').addEventListener('click', () => {
    if (state.dateIndex < state.data.dates.length - 1) { state.dateIndex++; render(); }
  });
  $('nextDate').addEventListener('click', () => {
    if (state.dateIndex > 0) { state.dateIndex--; render(); }
  });
}

async function main() {
  setupTheme();
  setupNav();
  setupDetail();
  purgeLegacyByok();
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data.json ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    state.data = { dates: [], picks: {}, generatedAt: null };
    $('foot').textContent = `데이터 로드 실패: ${err.message}`;
  }
  setupSearch();
  render();
  renderArchive();
  const gen = state.data.generatedAt;
  if (gen) {
    $('foot').textContent =
      `${state.data.dates.length}일치 · 마지막 갱신 ${new Date(gen).toLocaleString('ko-KR')}`;
  }
}

main();
