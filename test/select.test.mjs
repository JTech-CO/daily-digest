// 선별 + 재분배 검증 (M2 DoD, 기술 백서 §0 재분배 규칙, §3.3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDaily, SOURCES } from '../src/pipeline/select.mjs';

let seq = 0;
const cand = (source, title, url = null) => ({
  source,
  sourceItemId: `${source}-${seq++}`,
  title,
  url: url ?? `https://example.com/${source}/${seq}`,
  summary: null,
  publishedAt: '2026-07-04T00:00:00.000Z',
  popularitySignal: null,
  isPopularPick: false,
});

// n건짜리 풀을 만든다(모두 서로 다른 URL·제목)
const pool = (source, n) => Array.from({ length: n }, (_, i) => cand(source, `${source} 기사 ${i}`));

const emptyAll = () => Object.fromEntries(SOURCES.map(s => [s, []]));

test('정상: 5개 소스 모두 후보 있으면 소스당 1건씩 5건', async () => {
  const input = { ...emptyAll() };
  for (const s of SOURCES) input[s] = pool(s, 3);
  const { order, deficits, unfilled } = await selectDaily(input);
  assert.equal(order.length, 5);
  assert.equal(deficits.length, 0);
  assert.equal(unfilled, 0);
  assert.ok(order.every(o => o.selectionReason === 'primary'));
});

test('재분배: arxiv 0건이면 다건 소스에서 하위 순위로 보충해 총 5건 유지', async () => {
  const input = emptyAll();
  input.hackernews = pool('hackernews', 5); // 여유 도너
  input.geeknews = pool('geeknews', 1);
  input.arxiv = [];                          // 결손
  input.physorg = pool('physorg', 1);
  input.techxplore = pool('techxplore', 1);

  const { order, picks, deficits, unfilled } = await selectDaily(input);
  assert.deepEqual(deficits, ['arxiv']);
  assert.equal(unfilled, 0);
  assert.equal(order.length, 5);               // 결손 1건을 도너가 채움
  assert.equal(picks.hackernews.length, 2);    // 1 primary + 1 redistributed
  const redistributed = order.filter(o => o.selectionReason === 'redistributed');
  assert.equal(redistributed.length, 1);
  assert.equal(redistributed[0].source, 'hackernews');
});

test('재분배: 도너의 2순위(하위 랭킹)부터 가져온다', async () => {
  const input = emptyAll();
  input.hackernews = [cand('hackernews', '1순위'), cand('hackernews', '2순위'), cand('hackernews', '3순위')];
  input.geeknews = pool('geeknews', 1);
  input.physorg = pool('physorg', 1);
  input.techxplore = pool('techxplore', 1);
  input.arxiv = [];

  const { picks } = await selectDaily(input);
  assert.equal(picks.hackernews[0].title, '1순위');       // primary는 최상위
  assert.equal(picks.hackernews[1].title, '2순위');       // 보충은 그 다음
});

test('상한: 단일 소스가 maxPerSource(3)를 넘지 않는다', async () => {
  const input = emptyAll();
  input.hackernews = pool('hackernews', 10); // 유일한 도너
  // 나머지 4개 소스 전부 결손 → 4건 보충 필요하지만 HN은 3건까지만
  const { picks, order, unfilled } = await selectDaily(input, { maxPerSource: 3 });
  assert.equal(picks.hackernews.length, 3);  // 1 primary + 2 redistributed (상한)
  assert.equal(order.length, 3);
  // 결손 4개 중 도너가 상한 탓에 2개만 보충 → 2개는 못 채움(§0: 5건 미만 허용)
  assert.equal(unfilled, 2);
});

test('총량 5건 미만 허용: 전 소스가 후보 희소하면 unfilled>0로 정상 종료', async () => {
  const input = emptyAll();
  input.hackernews = pool('hackernews', 1);
  input.geeknews = pool('geeknews', 1);
  // arxiv/physorg/techxplore 결손, 도너 잔여 없음
  const { order, unfilled, deficits } = await selectDaily(input);
  assert.equal(order.length, 2);
  assert.equal(deficits.length, 3);
  assert.equal(unfilled, 3); // 채울 여분이 없음 — 예외 아니라 정상
});

test('재분배 중에도 dedup 적용: 도너 하위 후보가 기존 픽과 중복이면 건너뛴다', async () => {
  const input = emptyAll();
  const dupUrl = 'https://dup.example.com/same';
  input.hackernews = [
    cand('hackernews', 'HN 1순위'),
    cand('hackernews', '중복될 2순위', dupUrl),  // physorg 픽과 같은 URL
    cand('hackernews', 'HN 3순위'),
  ];
  input.physorg = [cand('physorg', 'PO 기사', dupUrl)];
  input.geeknews = pool('geeknews', 1);
  input.techxplore = pool('techxplore', 1);
  input.arxiv = [];

  const { picks, dedupLog, order } = await selectDaily(input);
  // HN 2순위는 physorg 픽과 URL 중복 → 스킵, 3순위로 보충
  assert.equal(picks.hackernews[1].title, 'HN 3순위');
  assert.equal(order.length, 5);
  assert.ok(dedupLog.some(l => l.method === 'url' && l.droppedTitle === '중복될 2순위'));
});

test('1차 선별에서 소스 간 중복 제거 + dedup_log 기록', async () => {
  const input = emptyAll();
  const shared = 'https://arxiv.org/abs/2607.01283';
  input.hackernews = [cand('hackernews', 'arXiv 논문 소개', shared)];
  input.arxiv = [cand('arxiv', 'The Paper Itself', 'https://arxiv.org/abs/2607.01283v1')];
  input.geeknews = pool('geeknews', 1);
  input.physorg = pool('physorg', 1);
  input.techxplore = pool('techxplore', 1);

  const { order, dedupLog } = await selectDaily(input);
  // hackernews가 먼저 픽되고, arxiv는 같은 논문이라 결손 처리 → 재분배로 다른 소스가 채움
  const arxivPicks = order.filter(o => o.source === 'arxiv');
  assert.equal(arxivPicks.length, 0);
  assert.ok(dedupLog.some(l => l.method === 'arxiv_id'));
});
