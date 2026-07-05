// daily-digest 프론트엔드 — 디자인 백서 §4, §6 구현
// data.json(빌드 시 DB에서 생성)을 읽어 날짜별 다이제스트를 렌더링한다.

import {
  PROVIDERS, defaultModelFor, getConfig, saveConfig, clearConfig, hasConfig,
  generateDetail, cachedDetail, cacheDetail,
} from './llm.js';

// 소스 식별을 명확히 하기 위해 축약 대신 전체 명칭을 대문자로 표기
const BADGE = {
  hackernews: 'HACKER NEWS', geeknews: 'GEEKNEWS', arxiv: 'ARXIV',
  physorg: 'PHYS.ORG', techxplore: 'TECHXPLORE',
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
    el('span', 'pick__rank', String(index + 1).padStart(2, '0')),
    el('span', 'pick__badge', BADGE[pick.source] ?? pick.source),
    el('span', 'pick__signal', signalLabel(pick)),
  );

  const title = el('h3', 'pick__title', pick.title_ko || pick.title_original);

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

// ── 상세 뷰(모달) ──────────────────────────────────────────────
let lastFocused = null;

// LLM 출력 마크다운을 안전하게(textContent만) DOM으로 렌더 — 제목/불릿/문단만 지원
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

function section(label, text, { markdown = false, copyable = false, fallback = null } = {}) {
  const sec = el('section', 'detail__section');
  const header = el('div', 'detail__section-head');
  header.append(el('span', 'detail__label', label));
  if (copyable && text) {
    const btn = el('button', 'detail__copy', '복사');
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = '복사'), 1500); }
      catch { btn.textContent = '복사 실패'; }
    });
    header.append(btn);
  }
  sec.append(header);
  if (text) {
    sec.append(markdown ? (() => { const d = el('div', 'detail__md'); d.append(renderMarkdown(text)); return d; })()
      : el('p', 'detail__text', text));
  } else if (fallback) {
    sec.append(el('p', 'detail__text', fallback));
  } else {
    sec.append(el('p', 'detail__missing', '아직 생성되지 않았습니다.'));
  }
  return sec;
}

// pick의 유효 상세 = 브라우저 생성 캐시(사용자의 명시적 생성이 우선) → 파이프라인 사전 생성
function effectiveDetail(pick) {
  const cached = cachedDetail(pick);
  return {
    translation: cached?.translation || pick.detail_translation || null,
    summary: cached?.summary || pick.detail_summary || null,
    blog: cached?.blog || pick.detail_blog || null,
  };
}

function renderDetailBody(pick) {
  const body = document.getElementById('detailBody');
  const d = effectiveDetail(pick);
  const summaryFallback = pick.summary_ko || pick.summary_original || null;

  body.replaceChildren(
    section('원문 번역본', d.translation, { fallback: summaryFallback }),
    section('핵심 요약', d.summary),
    section('블로그 글 작성용 초안', d.blog, { markdown: true, copyable: true }),
  );

  const incomplete = !d.translation || !d.summary || !d.blog;
  // 키가 있으면 항상 (재)생성 버튼을 둔다 — 모델/프로바이더를 바꾼 뒤 다시 생성 가능해야 함.
  // 키가 없고 비어 있으면 설정 유도 버튼을 둔다.
  if (hasConfig() || incomplete) body.prepend(generateControl(pick, incomplete));
}

function generateControl(pick, incomplete) {
  const wrap = el('div', 'detail__gen');
  if (hasConfig()) {
    const cfg = getConfig();
    const label = incomplete ? 'AI로 상세 생성' : '다시 생성';
    const btn = el('button', 'detail__generate', label);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '생성 중…';
      try {
        const detail = await generateDetail(pick);   // 캐시 무시하고 현재 설정으로 새로 생성
        cacheDetail(pick, detail);
        renderDetailBody(pick);                       // 재렌더(생성 결과 반영)
        document.getElementById('detailClose').focus(); // 포커스를 모달 내부로 유지
      } catch (err) {
        btn.disabled = false;
        btn.textContent = label;
        const hint = wrap.querySelector('.detail__gen-hint') || el('p', 'detail__gen-hint');
        hint.textContent = `생성 실패: ${err.message}`;
        wrap.append(hint);
      }
    });
    wrap.append(btn, el('span', 'detail__gen-hint', ` ${PROVIDERS[cfg.provider]?.label ?? cfg.provider} · ${cfg.model}`));
  } else {
    const btn = el('button', 'detail__generate', '⚙ 설정에서 API 키 입력');
    btn.addEventListener('click', () => { closeDetail(); openSettings(); });
    wrap.append(btn, el('p', 'detail__gen-hint', 'API 키를 입력하면 이 글의 번역·요약·블로그 초안을 브라우저에서 직접 생성합니다.'));
  }
  return wrap;
}

function openDetail(pick) {
  lastFocused = document.activeElement;
  const modal = document.getElementById('detail');
  const panel = modal.querySelector('.detail__panel');
  panel.style.setProperty('--cat', `var(--source-${pick.source})`);

  document.getElementById('detailBadge').textContent = BADGE[pick.source] ?? pick.source;
  document.getElementById('detailBadge').style.color = `var(--source-${pick.source})`;
  document.getElementById('detailSignal').textContent = signalLabel(pick);
  document.getElementById('detailTitle').textContent = pick.title_ko || pick.title_original;
  const orig = document.getElementById('detailOrig');
  // 번역된 항목만 원제 병기(GeekNews 등 원문=한국어면 생략)
  orig.textContent = pick.is_translated && pick.title_original ? pick.title_original : '';
  orig.hidden = !orig.textContent;
  document.getElementById('detailSource').href = pick.url;

  renderDetailBody(pick);

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('detailClose').focus();
}

function closeDetail() {
  const modal = document.getElementById('detail');
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}

function setupDetail() {
  const modal = document.getElementById('detail');
  document.getElementById('detailClose').addEventListener('click', closeDetail);
  modal.querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', closeDetail));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDetail(); closeSettings(); } });
}

// ── LLM 설정 모달 ──────────────────────────────────────────────
let settingsLastFocused = null;

// ⚙ 버튼: 키가 설정돼 있으면 액센트 색으로 표시
function syncSettingsIndicator() {
  document.getElementById('settingsBtn').dataset.configured = hasConfig() ? 'true' : 'false';
}

function openSettings() {
  settingsLastFocused = document.activeElement;
  const cfg = getConfig();
  const providerSel = document.getElementById('settingsProvider');
  const modelInput = document.getElementById('settingsModel');
  const keyInput = document.getElementById('settingsKey');

  providerSel.value = cfg?.provider || 'anthropic';
  modelInput.value = cfg?.model || defaultModelFor(providerSel.value);
  keyInput.value = cfg?.apiKey || '';
  document.getElementById('settingsStatus').textContent = '';

  document.getElementById('settings').hidden = false;
  document.body.style.overflow = 'hidden';
  providerSel.focus();
}

function closeSettings() {
  const modal = document.getElementById('settings');
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  if (settingsLastFocused && settingsLastFocused.focus) settingsLastFocused.focus();
}

function setupSettings() {
  const providerSel = document.getElementById('settingsProvider');
  const modelInput = document.getElementById('settingsModel');
  const keyInput = document.getElementById('settingsKey');
  const status = document.getElementById('settingsStatus');

  syncSettingsIndicator();

  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('settingsClose').addEventListener('click', closeSettings);
  document.querySelectorAll('[data-close-settings]').forEach(n => n.addEventListener('click', closeSettings));

  // 프로바이더 변경 시 모델 입력을 그 기본값으로 채운다(비었거나 다른 프로바이더 기본값일 때만)
  providerSel.addEventListener('change', () => {
    const current = modelInput.value.trim();
    const isDefault = Object.values(PROVIDERS).some(p => p.defaultModel === current);
    if (!current || isDefault) modelInput.value = defaultModelFor(providerSel.value);
    const risk = PROVIDERS[providerSel.value]?.corsRisk;
    status.textContent = risk ? '⚠ 이 프로바이더는 브라우저 직접 호출이 CORS로 막힐 수 있습니다.' : '';
  });

  document.getElementById('settingsSave').addEventListener('click', () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey) { status.textContent = 'API 키를 입력하세요.'; return; }
    saveConfig({ provider: providerSel.value, model: modelInput.value, apiKey });
    syncSettingsIndicator();
    status.textContent = '저장되었습니다.';
    setTimeout(closeSettings, 700);
  });

  document.getElementById('settingsClear').addEventListener('click', () => {
    clearConfig();
    keyInput.value = '';
    syncSettingsIndicator();
    status.textContent = '지워졌습니다.';
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
  setupDetail();
  setupSettings();
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
