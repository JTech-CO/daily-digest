// 과거 게시 항목 재선택 방지 검증
//
// 배경: daily_picks는 UNIQUE(source, source_item_id)이고 ON CONFLICT가 pick_date를
// 갱신하므로, 같은 항목이 다른 날 다시 선택되면 과거 날짜에서 사라진다(실측 확인됨).
// selectDaily의 excludeKeys가 그 상황 자체를 막는지 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDaily, SOURCES } from '../src/pipeline/select.mjs';
import { openDb, savePicks, getPicksByDate, getPickedItemKeys } from '../src/db/index.mjs';

let seq = 0;
const cand = (source, id, title) => ({
  source, sourceItemId: id, title: title ?? `${source}-${id}`,
  url: `https://example.com/${source}/${id}/${seq++}`, summary: null,
  publishedAt: '2026-08-07T00:00:00.000Z', popularitySignal: 10, isPopularPick: true,
});
const emptyAll = () => Object.fromEntries(SOURCES.map(s => [s, []]));

const saveItem = (source, id) => ({
  source, sourceItemId: id, title: 't', titleKo: 't', summary: null, summaryKo: null,
  url: `https://example.com/${source}/${id}`, popularitySignal: 1,
  publishedAt: '2026-08-01T00:00:00Z', selectionReason: 'primary', isTranslated: false,
});

test('getPickedItemKeys: 저장된 항목 키를 반환하고 exceptDate는 제외', () => {
  const db = openDb(':memory:');
  savePicks(db, { pickDate: '2026-08-01', items: [saveItem('arxiv', 'P1'), saveItem('hackernews', 'H1')] });
  savePicks(db, { pickDate: '2026-08-02', items: [saveItem('arxiv', 'P2')] });

  const all = getPickedItemKeys(db);
  assert.ok(all.has('arxiv|P1') && all.has('hackernews|H1') && all.has('arxiv|P2'));

  // 오늘(08-02) 픽은 제외 → 같은 날 재실행이 자기 자신을 배제하지 않도록
  const except = getPickedItemKeys(db, { exceptDate: '2026-08-02' });
  assert.ok(except.has('arxiv|P1'));
  assert.equal(except.has('arxiv|P2'), false);
  db.close();
});

test('selectDaily: excludeKeys에 있는 항목은 후보에서 제외', async () => {
  const input = emptyAll();
  // arxiv 1순위는 어제 이미 실린 논문 → 2순위가 선택돼야 함
  input.arxiv = [cand('arxiv', 'OLD', '어제 실린 논문'), cand('arxiv', 'NEW', '새 논문')];
  for (const s of ['hackernews', 'geeknews', 'physorg', 'techxplore']) input[s] = [cand(s, `${s}-1`)];

  const { picks } = await selectDaily(input, { excludeKeys: new Set(['arxiv|OLD']) });
  assert.equal(picks.arxiv.length, 1);
  assert.equal(picks.arxiv[0].sourceItemId, 'NEW');
});

test('selectDaily: 후보가 전부 기게시면 결손 처리 → 재분배로 보충', async () => {
  const input = emptyAll();
  input.arxiv = [cand('arxiv', 'OLD1'), cand('arxiv', 'OLD2')];
  input.hackernews = [cand('hackernews', 'H1'), cand('hackernews', 'H2')]; // 도너
  input.geeknews = [cand('geeknews', 'G1')];
  input.physorg = [cand('physorg', 'P1')];
  input.techxplore = [cand('techxplore', 'T1')];

  const { picks, deficits, order } = await selectDaily(input, {
    excludeKeys: new Set(['arxiv|OLD1', 'arxiv|OLD2']),
  });
  assert.deepEqual(deficits, ['arxiv']);
  assert.equal(picks.arxiv.length, 0);
  assert.equal(order.length, 5); // HN이 재분배로 보충
  assert.equal(picks.hackernews.length, 2);
});

test('회귀: 기게시 제외가 없으면 과거 날짜 항목이 유실된다(방어 필요성 근거)', () => {
  const db = openDb(':memory:');
  savePicks(db, { pickDate: '2026-08-01', items: [saveItem('arxiv', 'P1'), saveItem('arxiv', 'P2')] });
  assert.equal(getPicksByDate(db, '2026-08-01').length, 2);

  // 같은 항목을 다음 날 저장하면 08-01에서 빠진다 — 그래서 선별 단계에서 막아야 한다
  savePicks(db, { pickDate: '2026-08-02', items: [saveItem('arxiv', 'P1')] });
  assert.equal(getPicksByDate(db, '2026-08-01').length, 1);
  assert.equal(getPicksByDate(db, '2026-08-02').length, 1);
  db.close();
});
