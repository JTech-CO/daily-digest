// daily-digest 프론트엔드 — 디자인 백서 §4, §6 구현
// data.json(빌드 시 DB에서 생성)을 읽어 날짜별 다이제스트를 렌더링한다.

const BADGE = {
  hackernews: 'HN', geeknews: 'GN', arxiv: 'AX', physorg: 'PO', techxplore: 'TX',
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

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

// ── 카드 렌더 (§4.1, §9) ───────────────────────────────────────
function renderPick(pick, index) {
  const article = el('article', 'pick');
  article.style.setProperty('--cat', `var(--source-${pick.source})`);

  const head = el('div', 'pick__head');
  head.append(
    el('span', 'pick__rank', String(index + 1).padStart(2, '0')),
    el('span', 'pick__badge', BADGE[pick.source] ?? pick.source),
    el('span', 'pick__signal', signalLabel(pick)),
  );

  const title = el('h3', 'pick__title');
  const titleLink = el('a', null, pick.title_ko || pick.title_original);
  titleLink.href = pick.url;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  title.append(titleLink);

  article.append(head, title);

  const summaryText = pick.summary_ko || pick.summary_original;
  if (summaryText) article.append(el('p', 'pick__summary', summaryText));

  const meta = el('div', 'pick__meta');
  meta.append(el('time', 'pick__time', relativeTime(pick.published_at)));
  meta.append(el('span', 'pick__sep', '·'));
  const link = el('a', 'pick__link', '원문 보기 ↗');
  link.href = pick.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  meta.append(link);
  if (pick.selection_reason === 'redistributed') {
    meta.append(el('span', 'pick__redist', '재분배'));
  }
  // 출처 표기 의무 소스 (§7, 법적 조건) — 소스명 명시
  if (pick.source === 'physorg' || pick.source === 'techxplore') {
    meta.append(el('span', 'pick__sep', '·'));
    meta.append(el('span', null, `출처: ${pick.source === 'physorg' ? 'Phys.org' : 'TechXplore'}`));
  }

  article.append(meta);
  return article;
}

// ── 상태 ───────────────────────────────────────────────────────
const state = { data: null, dateIndex: 0 };

function currentDate() {
  return state.data.dates[state.dateIndex]?.date ?? null;
}

function render() {
  const feed = document.getElementById('feed');
  const dateLabel = document.getElementById('currentDate');
  const date = currentDate();
  feed.replaceChildren();

  if (!date) {
    feed.append(el('p', 'empty', '아직 게시된 다이제스트가 없습니다.'));
    dateLabel.textContent = '—';
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

  // 날짜 네비 상태 — dates는 최신순 정렬
  document.getElementById('prevDate').disabled = state.dateIndex >= state.data.dates.length - 1;
  document.getElementById('nextDate').disabled = state.dateIndex <= 0;
}

function renderArchive() {
  const section = document.getElementById('archive');
  const list = document.getElementById('archiveList');
  if (state.data.dates.length <= 1) { section.hidden = true; return; }
  section.hidden = false;
  list.replaceChildren();
  state.data.dates.forEach((d, i) => {
    const li = el('li', 'archive__item');
    const btn = el('button', 'archive__date', d.date);
    btn.addEventListener('click', () => { state.dateIndex = i; render(); window.scrollTo(0, 0); });
    li.append(btn, el('span', 'archive__count', `${d.count}건`));
    list.append(li);
  });
}

// ── 테마 토글 (§6) — 수동 선택이 항상 우선, 시스템 설정 미참조 ──
function setupTheme() {
  const btn = document.getElementById('themeToggle');
  const sync = () => btn.setAttribute('aria-checked', document.documentElement.dataset.theme === 'light');
  sync();
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    sync();
  });
}

function setupNav() {
  document.getElementById('prevDate').addEventListener('click', () => {
    if (state.dateIndex < state.data.dates.length - 1) { state.dateIndex++; render(); }
  });
  document.getElementById('nextDate').addEventListener('click', () => {
    if (state.dateIndex > 0) { state.dateIndex--; render(); }
  });
}

async function main() {
  setupTheme();
  setupNav();
  try {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data.json ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    state.data = { dates: [], picks: {}, generatedAt: null };
    document.getElementById('foot').textContent = `데이터 로드 실패: ${err.message}`;
  }
  render();
  renderArchive();
  const gen = state.data.generatedAt;
  if (gen) {
    document.getElementById('foot').textContent =
      `${state.data.dates.length}일치 · 마지막 갱신 ${new Date(gen).toLocaleString('ko-KR')}`;
  }
}

main();
