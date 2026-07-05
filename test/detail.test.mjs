// 상세 뷰 3구성 생성 검증 — 전문 기반(#4/#6) 포함
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDetail, generateDetailsAll } from '../src/pipeline/detail.mjs';
import { extractArticleText } from '../src/pipeline/extract.mjs';

const ALL_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER'];
function withEnv(setKeys, fn) {
  return async () => {
    const saved = Object.fromEntries(ALL_KEYS.map(k => [k, process.env[k]]));
    for (const k of ALL_KEYS) delete process.env[k];
    Object.assign(process.env, setKeys);
    try { await fn(); } finally {
      for (const k of ALL_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };
}
const withKey = fn => withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, fn);

// Anthropic 응답 형태로 감싼 mock
const asContent = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const llmRes = obj => ({ ok: true, status: 200, statusText: 'OK', async json() { return asContent(obj); }, async text() { return JSON.stringify(asContent(obj)); } });
const htmlRes = html => ({ ok: true, status: 200, statusText: 'OK', headers: new Headers(), async text() { return html; } });

// URL로 라우팅: LLM 엔드포인트면 순차 응답, 기사 URL이면 HTML
function routedFetch({ articleHtml, llmResponses }) {
  const calls = { llm: 0, article: 0 };
  return async (url) => {
    if (url.includes('api.anthropic.com') || url.includes('api.openai.com') || url.includes('googleapis') || url.includes('api.x.ai')) {
      const r = llmResponses[Math.min(calls.llm, llmResponses.length - 1)];
      calls.llm++;
      return r;
    }
    calls.article++;
    return htmlRes(articleHtml);
  };
}

const ARTICLE = '<html><body><article>' + '<p>This is a full article paragraph with real content. </p>'.repeat(20) + '</article></body></html>';
const enItem = { source: 'physorg', title: 'Optical writing', summary: 'short abstract', url: 'https://phys.org/x.html' };
const arxivItem = { source: 'arxiv', title: 'A paper', summary: 'the abstract text', url: 'https://arxiv.org/abs/2607.1' };
const koItem = { source: 'geeknews', title: '루프 엔지니어링', summary: '한국어 요약', url: 'https://news.hada.io/topic?id=1' };

// ── extractArticleText ────────────────────────────────────────

test('extract: article 본문 추출, script/style 제거', () => {
  const html = '<html><head><style>.x{}</style></head><body><nav>메뉴</nav>'
    + '<article><h1>제목</h1><p>본문 문단 하나.</p><script>evil()</script><p>본문 문단 둘.</p></article></body></html>';
  const text = extractArticleText(html);
  assert.match(text, /본문 문단 하나/);
  assert.match(text, /본문 문단 둘/);
  assert.doesNotMatch(text, /evil/);
  assert.doesNotMatch(text, /\.x\{/);
});

test('extract: 빈/비문자열 → 빈 문자열', () => {
  assert.equal(extractArticleText(''), '');
  assert.equal(extractArticleText(null), '');
});

test('extract: maxChars 상한', () => {
  const html = '<body><p>' + 'a'.repeat(50000) + '</p></body>';
  assert.ok(extractArticleText(html, { maxChars: 1000 }).length <= 1000);
});

// ── 전문 기반 생성 ────────────────────────────────────────────

test('전문 소스(physorg): 기사 전문 추출 후 번역/요약+블로그 2콜', withKey(async () => {
  const fetchImpl = routedFetch({
    articleHtml: ARTICLE,
    llmResponses: [
      llmRes({ translation: '전문 번역본(길다)' }),          // 1콜: 번역
      llmRes({ summary: '핵심 요약', blog: '# 블로그\n\n본문' }), // 2콜: 요약+블로그
    ],
  });
  const d = await generateDetail(enItem, { fetchImpl });
  assert.equal(d.usedFullText, true);
  assert.equal(d.translation, '전문 번역본(길다)');
  assert.equal(d.summary, '핵심 요약');
  assert.match(d.blog, /블로그/);
}));

test('전문 추출 실패(짧은 HTML) → 초록 기반 1콜 폴백', withKey(async () => {
  const fetchImpl = routedFetch({
    articleHtml: '<html><body>tiny</body></html>',            // < 400자 → 폴백
    llmResponses: [llmRes({ translation: '초록 번역', summary: '요약', blog: '블로그' })],
  });
  const d = await generateDetail(enItem, { fetchImpl });
  assert.equal(d.usedFullText, false);
  assert.equal(d.translation, '초록 번역');
}));

test('arxiv: 전문 미시도(초록 기반 1콜)', withKey(async () => {
  let articleFetched = false;
  const fetchImpl = async (url) => {
    if (url.includes('api.anthropic.com')) return llmRes({ translation: '초록번역', summary: '요약', blog: '블로그' });
    articleFetched = true;
    return htmlRes(ARTICLE);
  };
  const d = await generateDetail(arxivItem, { fetchImpl });
  assert.equal(articleFetched, false);      // arxiv는 기사 원문 안 가져옴
  assert.equal(d.usedFullText, false);
  assert.equal(d.translation, '초록번역');
}));

test('geeknews: 정제 모드(전문 미시도)', withKey(async () => {
  let articleFetched = false;
  const fetchImpl = async (url) => {
    if (url.includes('api.anthropic.com')) return llmRes({ translation: '정제됨', summary: '요약', blog: '블로그' });
    articleFetched = true;
    return htmlRes(ARTICLE);
  };
  const d = await generateDetail(koItem, { fetchImpl });
  assert.equal(articleFetched, false);
  assert.equal(d.usedFullText, false);
  assert.equal(d.translation, '정제됨');
}));

test('키 없음: 전부 null', withEnv({}, async () => {
  const d = await generateDetail(enItem, { fetchImpl: async () => htmlRes(ARTICLE) });
  assert.deepEqual({ t: d.translation, s: d.summary, b: d.blog }, { t: null, s: null, b: null });
}));

test('전문 생성 중 번역 콜 실패 → 전부 null + detailError', withKey(async () => {
  const fetchImpl = routedFetch({
    articleHtml: ARTICLE,
    llmResponses: [{ ok: false, status: 429, statusText: 'x', async text() { return 'rate'; } }],
  });
  const d = await generateDetail(enItem, { fetchImpl });
  assert.equal(d.translation, null);
  assert.match(d.detailError, /API 오류 429/);
}));

test('generateDetailsAll: detail* 부착 + 통계(fullText 카운트)', withKey(async () => {
  const fetchImpl = routedFetch({
    articleHtml: ARTICLE,
    llmResponses: [llmRes({ translation: 'T' }), llmRes({ summary: 'S', blog: 'B' })],
  });
  const { items, stats } = await generateDetailsAll([enItem], { fetchImpl });
  assert.equal(items[0].detailTranslation, 'T');
  assert.equal(items[0].detailSummary, 'S');
  assert.equal(stats.total, 1);
  assert.equal(stats.generated, 1);
  assert.equal(stats.fullText, 1);
  assert.equal(stats.failed, 0);
}));
