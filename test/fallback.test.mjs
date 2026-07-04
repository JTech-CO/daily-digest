// 폴백 경로 검증 (M6 DoD, 기술 백서 §9 리스크 완화)
// 주입 fetchImpl로 각 어댑터의 실패 상황을 재현해 폴백이 작동하는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchText } from '../src/adapters/http.mjs';
import * as geeknews from '../src/adapters/geeknews.mjs';
import { createScienceXAdapter } from '../src/adapters/sciencex.mjs';
import * as arxiv from '../src/adapters/arxiv.mjs';

const HUGE_WINDOW = 24 * 365 * 1000; // 창 필터가 폴백 검증을 방해하지 않도록

// URL 패턴 → 응답을 매핑하는 mock fetch 팩토리
function mockFetch(routes) {
  return async (url) => {
    for (const [pattern, handler] of routes) {
      if (url.includes(pattern)) return handler(url);
    }
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  };
}
const ok = body => async () => ({ ok: true, status: 200, statusText: 'OK', async text() { return body; } });
const status = code => async () => ({ ok: false, status: code, statusText: 'x', async text() { return ''; } });
const netfail = () => () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); };

// 실 GeekNews 피드 구조(feed-level title/id/updated 포함)에 맞춘 최소 Atom
const ATOM = (id, title) => `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom'>
  <title>GeekNews</title>
  <id>https://news.hada.io/rss/news</id>
  <updated>2026-07-04T09:00:00+09:00</updated>
  <entry>
    <title>${title}</title>
    <link rel='alternate' type='text/html' href='https://news.hada.io/topic?id=${id}'/>
    <id>https://news.hada.io/topic?id=${id}</id>
    <updated>2026-07-04T09:00:00+09:00</updated>
    <published>2026-07-04T09:00:00+09:00</published>
    <content type='html'>요약 내용입니다</content>
  </entry>
</feed>`;

const RSS = (title, guid) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>c</title>
  <item>
    <title>${title}</title>
    <link>https://phys.org/news/${guid}.html</link>
    <description>desc body</description>
    <pubDate>Sat, 04 Jul 2026 06:00:01 EDT</pubDate>
    <guid isPermaLink="false">${guid}</guid>
  </item>
</channel></rss>`;

// ── http.fetchText 재시도 (§9 arXiv 429) ──────────────────────

test('fetchText: 429 후 200이면 재시도로 성공', async () => {
  let n = 0;
  const impl = async () => (++n === 1
    ? { ok: false, status: 429, statusText: 'Too Many', async text() { return ''; } }
    : { ok: true, status: 200, statusText: 'OK', async text() { return 'RECOVERED'; } });
  const text = await fetchText('arxiv', 'http://x', { fetchImpl: impl, retries: 2, retryDelayMs: 1 });
  assert.equal(text, 'RECOVERED');
  assert.equal(n, 2);
});

test('fetchText: 4xx(429 아님)는 재시도 없이 즉시 throw', async () => {
  let n = 0;
  const impl = async () => { n++; return { ok: false, status: 404, statusText: 'NF', async text() { return ''; } }; };
  await assert.rejects(fetchText('x', 'http://x', { fetchImpl: impl, retries: 3, retryDelayMs: 1 }),
    /API 응답 오류 404/);
  assert.equal(n, 1); // 재시도 안 함
});

test('fetchText: 네트워크 오류는 소스 컨텍스트 포함해 throw', async () => {
  await assert.rejects(fetchText('geeknews', 'http://x', { fetchImpl: netfail(), retries: 1, retryDelayMs: 1 }),
    /\[geeknews\] 요청 실패/);
});

// ── GeekNews: 홈 구조 변경 → RSS 폴백 (§9) ────────────────────

test('geeknews: 홈에 topic_row 없으면 RSS 게시 순서로 폴백', async () => {
  const impl = mockFetch([
    // 구체적 경로(RSS)를 먼저 — 'news.hada.io/'가 RSS URL까지 잡지 않도록
    ['news.hada.io/rss/news', ok(ATOM('999', '폴백 뉴스'))],
    ['news.hada.io/', ok('<html><body>구조가 바뀐 홈페이지</body></html>')],
  ]);
  const out = await geeknews.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '폴백 뉴스');
  assert.equal(out[0].isPopularPick, false); // RSS엔 인기 신호 없음
  assert.equal(out[0].sourceItemId, '999');
});

test('geeknews: 홈 정상 파싱 시 RSS 폴백 안 함(인기 신호 유지)', async () => {
  const home = `<div class='topic_row' data-topic-state-id='100' data-topic-voteable='1'>`
    + `<div class=topictitle><a href='https://ex.com/a' id='tr1'><h2 class='topic-title-heading'>홈 글</h2></a></div>`
    + `<div class='topicdesc'><a href='topic?id=100'>요약</a></div>`
    + `<div class='topicinfo'><span id='tp100'>42</span> points <time data-timestamp="1783125362"></time></div></div>`;
  const impl = mockFetch([
    ['news.hada.io/', ok(home)],
    ['rss', () => { throw new Error('RSS를 부르면 안 됨'); }],
  ]);
  const out = await geeknews.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl });
  assert.equal(out[0].title, '홈 글');
  assert.equal(out[0].popularitySignal, 42);
  assert.equal(out[0].isPopularPick, true);
});

// ── Science X: Spotlight 실패 → 전체 피드 폴백 (§9) ────────────

test('sciencex: Spotlight 피드 실패 시 전체 피드로 폴백', async () => {
  const adapter = createScienceXAdapter({ source: 'physorg', baseUrl: 'https://phys.org' });
  const impl = mockFetch([
    ['/rss-feed/breaking/', status(404)],          // Spotlight 슬러그 파손
    ['/rss-feed/', ok(RSS('전체 피드 기사', 'news123'))],
  ]);
  const out = await adapter.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, '전체 피드 기사');
  assert.equal(out[0].isPopularPick, false);       // Spotlight 없으므로 인기픽 아님
});

test('sciencex: Spotlight 정상 시 인기픽으로 표시', async () => {
  const adapter = createScienceXAdapter({ source: 'techxplore', baseUrl: 'https://techxplore.com' });
  const impl = mockFetch([
    ['/rss-feed/breaking/', ok(RSS('주목 기사', 'spot1'))],
    ['/rss-feed/', ok(RSS('일반 기사', 'all1'))],
  ]);
  const out = await adapter.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl });
  const spot = out.find(c => c.title === '주목 기사');
  assert.ok(spot);
  assert.equal(spot.isPopularPick, true);
});

test('sciencex: 전체 피드마저 실패하면 throw(파이프라인이 소스 스킵으로 처리)', async () => {
  const adapter = createScienceXAdapter({ source: 'physorg', baseUrl: 'https://phys.org' });
  const impl = mockFetch([
    ['/rss-feed/breaking/', status(500)],
    ['/rss-feed/', status(503)],
  ]);
  await assert.rejects(adapter.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl }),
    /\[physorg\] API 응답 오류 503/);
});

// ── arXiv: HF 인기 신호 실패 → 최신순만 (§9) ──────────────────

const ARXIV_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2607.02514v1</id>
    <title>Test Paper Title</title>
    <link href="https://arxiv.org/abs/2607.02514v1" rel="alternate"/>
    <summary>This is the abstract.</summary>
    <published>2026-07-04T10:00:00Z</published>
  </entry>
</feed>`;

test('arxiv: HF Daily Papers 실패해도 최신순 후보는 반환', async () => {
  const impl = mockFetch([
    ['export.arxiv.org', ok(ARXIV_ATOM)],
    ['huggingface.co', netfail()],                 // HF 인기 신호 소실
  ]);
  const out = await arxiv.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl });
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceItemId, '2607.02514v1');
  assert.equal(out[0].isPopularPick, false);       // HF 없으므로 인기픽 아님
  assert.equal(out[0].popularitySignal, null);
});

test('arxiv: HF 업보트가 있으면 조인해 인기픽으로', async () => {
  const hf = JSON.stringify([{ paper: { id: '2607.02514', upvotes: 65 } }]);
  const impl = mockFetch([
    ['export.arxiv.org', ok(ARXIV_ATOM)],
    ['huggingface.co', ok(hf)],
  ]);
  const out = await arxiv.fetchCandidates({ windowHours: HUGE_WINDOW, fetchImpl: impl });
  assert.equal(out[0].isPopularPick, true);
  assert.equal(out[0].popularitySignal, 65);       // 버전 무시 조인(2607.02514v1 ↔ 2607.02514)
});
