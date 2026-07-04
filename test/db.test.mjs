// SQLite 저장 계층 검증 (M4 DoD, 기술 백서 §5)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, savePicks, listDates, getPicksByDate, latestDate, kstDateString } from '../src/db/index.mjs';

const item = (over = {}) => ({
  source: 'hackernews', sourceItemId: 'a1', title: 'Original Title', titleKo: '번역 제목',
  summary: 'orig summary', summaryKo: '요약', url: 'https://example.com/a',
  popularitySignal: 714, publishedAt: '2026-07-04T00:00:00.000Z',
  selectionReason: 'primary', isTranslated: true, ...over,
});

test('kstDateString: UTC 15:00은 KST 익일 00:00', () => {
  assert.equal(kstDateString(new Date('2026-07-04T15:00:00Z')), '2026-07-05');
  assert.equal(kstDateString(new Date('2026-07-04T14:59:59Z')), '2026-07-04');
});

test('savePicks: 삽입 후 조회, rank/필드 매핑 확인', () => {
  const db = openDb(':memory:');
  const items = [
    item({ source: 'hackernews', sourceItemId: 'h1', titleKo: '1위' }),
    item({ source: 'geeknews', sourceItemId: 'g1', titleKo: '2위', isTranslated: false, selectionReason: 'redistributed' }),
  ];
  const r = savePicks(db, { pickDate: '2026-07-05', items, dedupLog: [] });
  assert.equal(r.inserted, 2);
  assert.equal(r.updated, 0);

  const rows = getPicksByDate(db, '2026-07-05');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].title_ko, '1위');
  assert.equal(rows[0].is_translated, 1);
  assert.equal(rows[1].rank, 2);
  assert.equal(rows[1].is_translated, 0);          // GeekNews 정제-only
  assert.equal(rows[1].selection_reason, 'redistributed');
  db.close();
});

test('savePicks: 같은 항목 재실행은 멱등(UPDATE), 중복 행 생성 안 함', () => {
  const db = openDb(':memory:');
  savePicks(db, { pickDate: '2026-07-05', items: [item({ titleKo: '초안' })] });
  const r2 = savePicks(db, { pickDate: '2026-07-05', items: [item({ titleKo: '재번역' })] });
  assert.equal(r2.inserted, 0);
  assert.equal(r2.updated, 1);

  const rows = getPicksByDate(db, '2026-07-05');
  assert.equal(rows.length, 1);                    // 중복 행 없음
  assert.equal(rows[0].title_ko, '재번역');         // 최신 번역으로 갱신
  db.close();
});

test('dedup_log: 저장되고 재실행 시 해당 날짜분만 교체', () => {
  const db = openDb(':memory:');
  const dedupLog = [{
    keptSource: 'hackernews', keptItemId: 'h1', droppedSource: 'geeknews',
    droppedTitle: '중복 글', method: 'url', similarityScore: 1,
  }];
  savePicks(db, { pickDate: '2026-07-05', items: [item()], dedupLog });
  savePicks(db, { pickDate: '2026-07-05', items: [item()], dedupLog }); // 재실행

  const logs = db.prepare('SELECT * FROM dedup_log WHERE pick_date = ?').all('2026-07-05');
  assert.equal(logs.length, 1);                    // 중복 누적 안 됨
  assert.equal(logs[0].method, 'url');
  db.close();
});

test('listDates/latestDate: 날짜별 집계·최신 날짜', () => {
  const db = openDb(':memory:');
  savePicks(db, { pickDate: '2026-07-04', items: [item({ sourceItemId: 'd1' }), item({ sourceItemId: 'd2' })] });
  savePicks(db, { pickDate: '2026-07-05', items: [item({ sourceItemId: 'd3' })] });

  // node:sqlite는 null-prototype 행을 반환하므로 값만 뽑아 비교
  const dates = listDates(db).map(({ date, count }) => ({ date, count }));
  assert.deepEqual(dates, [
    { date: '2026-07-05', count: 1 },
    { date: '2026-07-04', count: 2 },
  ]);
  assert.equal(latestDate(db), '2026-07-05');
  db.close();
});

test('summary null 허용', () => {
  const db = openDb(':memory:');
  savePicks(db, { pickDate: '2026-07-05', items: [item({ summary: null, summaryKo: null })] });
  const rows = getPicksByDate(db, '2026-07-05');
  assert.equal(rows[0].summary_original, null);
  assert.equal(rows[0].summary_ko, null);
  db.close();
});
