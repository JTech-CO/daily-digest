// 4단계 dedup 검증 — 인위적 중복 케이스 테스트셋 (M2 DoD, 기술 백서 §3.2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUrl, extractArxivBaseId, normalizeTitle, jaccardSimilarity, findDuplicate,
} from '../src/pipeline/dedup.mjs';

const cand = (source, title, url, summary = null) => ({
  source, sourceItemId: 'x', title, url, summary,
  publishedAt: '2026-07-04T00:00:00.000Z', popularitySignal: null, isPopularPick: false,
});

// ── 1차: URL 정규화 일치 ───────────────────────────────────────────

test('1차 url: 프로토콜/www/트레일링 슬래시/utm 차이를 무시하고 일치', async () => {
  const hn = cand('hackernews', 'Some Story', 'https://www.example.com/post/1/?utm_source=hn&utm_medium=social');
  const gn = cand('geeknews', '어떤 이야기', 'http://example.com/post/1');
  const dup = await findDuplicate(gn, [hn]);
  assert.equal(dup?.method, 'url');
});

test('1차 url: 의미 있는 쿼리 파라미터는 보존(다른 글로 판정)', async () => {
  const a = cand('geeknews', 'A', 'https://news.hada.io/topic?id=100');
  const b = cand('geeknews', 'B', 'https://news.hada.io/topic?id=200');
  assert.equal(await findDuplicate(b, [a]), null);
  assert.notEqual(normalizeUrl(a.url), normalizeUrl(b.url));
});

// ── 2차: arXiv ID(버전 무시) ──────────────────────────────────────

test('2차 arxiv_id: abs vs pdf 경로, 버전 차이를 무시하고 일치', async () => {
  const a = cand('arxiv', 'Paper v1', 'https://arxiv.org/abs/2607.02514v1');
  const b = cand('hackernews', 'Same paper on HN', 'https://arxiv.org/pdf/2607.02514v2');
  const dup = await findDuplicate(b, [a]);
  assert.equal(dup?.method, 'arxiv_id');
  assert.equal(extractArxivBaseId(a.url), '2607.02514');
});

test('2차 arxiv_id: 다른 논문은 통과', async () => {
  const a = cand('arxiv', 'Paper A', 'https://arxiv.org/abs/2607.02514');
  const b = cand('arxiv', 'Paper B', 'https://arxiv.org/abs/2607.09999');
  assert.equal(await findDuplicate(b, [a]), null);
});

// ── 3차: 제목 자카드 ──────────────────────────────────────────────

test('3차 jaccard: 제목 유사도 ≥0.6이면 중복(구두점·대소문자 무시)', async () => {
  const a = cand('physorg', 'New species of ghost shark found in Costa Rica', 'https://phys.org/news/a.html');
  const b = cand('techxplore', 'New Species of Ghost Shark Found in Costa Rica!', 'https://techxplore.com/news/b.html');
  const dup = await findDuplicate(b, [a]);
  assert.equal(dup?.method, 'jaccard');
  assert.ok(dup.score >= 0.6);
});

test('3차 jaccard: 무관한 제목은 통과', async () => {
  const a = cand('physorg', 'El Nino set to be strong, UN warns', 'https://phys.org/news/a.html');
  const b = cand('techxplore', 'Robots can now see touch with new tactile sensor', 'https://techxplore.com/news/b.html');
  assert.equal(await findDuplicate(b, [a]), null);
});

test('jaccard 계산 자체 검증', () => {
  assert.equal(jaccardSimilarity(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccardSimilarity(['a', 'b'], ['c', 'd']), 0);
  assert.equal(jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'd']), 0.5); // 2/4
  assert.equal(jaccardSimilarity([], []), 0);
});

test('normalizeTitle: 한글 보존, NFKC 정규화', () => {
  assert.deepEqual(normalizeTitle('루프 엔지니어링의 미학 (The Art of Loop-Engineering)'),
    ['루프', '엔지니어링의', '미학', 'the', 'art', 'of', 'loop', 'engineering']);
});

// ── 4차: 애매 구간(0.3~0.6) LLM 판정 ─────────────────────────────

// arXiv 논문이 Phys.org 기사로 다뤄진 상황(§3.2에서 3·4차 의존으로 예상한 케이스)
const paper = cand('arxiv', 'Scaling laws for grid-based nearest neighbor search', 'https://arxiv.org/abs/2607.01283');
const article = cand('physorg', 'Grid-based search: researchers discover scaling laws', 'https://phys.org/news/grid.html');

test('4차 llm: 애매 구간에서 분류기가 true면 중복 판정', async () => {
  const sim = jaccardSimilarity(normalizeTitle(paper.title), normalizeTitle(article.title));
  assert.ok(sim >= 0.3 && sim < 0.6, `애매 구간이어야 함(실제 ${sim.toFixed(2)})`);

  const calls = [];
  const dup = await findDuplicate(article, [paper], {
    classifyPair: async (a, b) => { calls.push([a.title, b.title]); return true; },
  });
  assert.equal(dup?.method, 'llm');
  assert.equal(calls.length, 1);
});

test('4차 llm: 분류기가 false면 비중복', async () => {
  const dup = await findDuplicate(article, [paper], { classifyPair: async () => false });
  assert.equal(dup, null);
});

test('4차 llm: 분류기 미주입(키 없음)이면 애매 구간은 비중복 처리', async () => {
  assert.equal(await findDuplicate(article, [paper]), null);
});

test('4차 llm: 확정 구간(1~3차)에서는 분류기를 호출하지 않음', async () => {
  const a = cand('hackernews', 'Exact same', 'https://example.com/x');
  const b = cand('geeknews', '같은 링크', 'https://example.com/x');
  let called = false;
  const dup = await findDuplicate(b, [a], { classifyPair: async () => { called = true; return false; } });
  assert.equal(dup?.method, 'url');
  assert.equal(called, false);
});
