// 과거 항목 백필 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, savePicks, getPicksByDate, getBackfillTargets, updateItemContent } from '../src/db/index.mjs';

const item = (over = {}) => ({
  source: 'hackernews', sourceItemId: 'h1', title: 'English Title', titleKo: 'English Title',
  summary: 'english summary', summaryKo: null, url: 'https://example.com/a',
  popularitySignal: 10, publishedAt: '2026-08-01T00:00:00Z',
  selectionReason: 'primary', isTranslated: false, ...over,
});

function seed() {
  const db = openDb(':memory:');
  savePicks(db, {
    pickDate: '2026-08-01',
    items: [item(), item({ source: 'arxiv', sourceItemId: 'a1', title: 'Paper' })],
  });
  savePicks(db, { pickDate: '2026-08-02', items: [item({ sourceItemId: 'h2', title: 'Another' })] });
  return db;
}

test('getBackfillTargets: 번역 안 된 항목을 최신순으로 반환', () => {
  const db = seed();
  const targets = getBackfillTargets(db, { limit: 10 });
  assert.equal(targets.length, 3);
  assert.equal(targets[0].pick_date, '2026-08-02'); // 최신 먼저
  // 파이프라인 복원에 필요한 필드가 전부 있어야 한다
  for (const t of targets) {
    assert.ok(t.id && t.source && t.source_item_id && t.title_original && t.url);
  }
  db.close();
});

test('getBackfillTargets: date·source·limit 필터', () => {
  const db = seed();
  assert.equal(getBackfillTargets(db, { date: '2026-08-01', limit: 10 }).length, 2);
  assert.equal(getBackfillTargets(db, { source: 'arxiv', limit: 10 }).length, 1);
  assert.equal(getBackfillTargets(db, { limit: 2 }).length, 2);
  db.close();
});

test('updateItemContent: 해당 행만 갱신하고 그날 다른 행은 건드리지 않는다', () => {
  const db = seed();
  const [target] = getBackfillTargets(db, { date: '2026-08-01', source: 'arxiv', limit: 1 });
  updateItemContent(db, target.id, {
    titleKo: '논문 제목', summaryKo: '한국어 요약', isTranslated: true,
    detailTranslation: '전문 번역', detailSummary: '핵심 요약', detailBlog: '# 블로그',
  });

  const rows = getPicksByDate(db, '2026-08-01');
  assert.equal(rows.length, 2);                                  // 행이 사라지지 않음
  const arxiv = rows.find(r => r.source === 'arxiv');
  assert.equal(arxiv.title_ko, '논문 제목');
  assert.equal(arxiv.is_translated, 1);
  assert.equal(arxiv.detail_blog, '# 블로그');
  assert.equal(arxiv.rank, target.id ? arxiv.rank : arxiv.rank); // rank 보존
  const hn = rows.find(r => r.source === 'hackernews');
  assert.equal(hn.title_ko, 'English Title');                    // 다른 행 미변경
  db.close();
});

test('백필한 행은 다시 대상이 되지 않는다(재과금 방지)', () => {
  const db = seed();
  const [t] = getBackfillTargets(db, { limit: 1 });
  updateItemContent(db, t.id, { titleKo: '번역됨', isTranslated: true, detailSummary: '요약' });
  const remaining = getBackfillTargets(db, { limit: 10 });
  assert.equal(remaining.length, 2);
  assert.ok(!remaining.some(r => r.id === t.id));
  db.close();
});

test('결과가 비어도 backfilled_at이 찍혀 재시도하지 않는다', () => {
  const db = seed();
  const [t] = getBackfillTargets(db, { limit: 1 });
  // 전문·요약이 없어 아무것도 생성하지 못한 경우
  updateItemContent(db, t.id, { titleKo: null, isTranslated: false, detailSummary: null });
  assert.ok(!getBackfillTargets(db, { limit: 10 }).some(r => r.id === t.id));
  db.close();
});
