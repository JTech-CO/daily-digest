// 파이프라인 인베리언트 가드 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInvariants, checkSourceStreaks } from '../src/pipeline/guard.mjs';
import { openDb, savePicks } from '../src/db/index.mjs';

const ok = (over = {}) => ({
  items: [
    { source: 'hackernews' }, { source: 'geeknews' }, { source: 'arxiv' },
    { source: 'physorg' }, { source: 'techxplore' },
  ],
  stats: { total: 5, translated: 4, refined: 1, failed: 0, failureRate: 0 },
  detailStats: { total: 5, generated: 5, fullText: 3, failed: 0 },
  failures: [], deficits: [],
  ...over,
});
const errs = issues => issues.filter(i => i.level === 'error').map(i => i.message);

test('정상 실행: error 없음', () => {
  assert.deepEqual(errs(checkInvariants(ok(), { llmConfigured: true })), []);
});

test('게시 건수 부족 → error', () => {
  const issues = checkInvariants(ok({ items: [{ source: 'hackernews' }, { source: 'arxiv' }] }));
  assert.match(errs(issues)[0], /게시 건수 2건/);
});

test('키가 있는데 번역 0건 → error (오늘 겪은 무증상 실패)', () => {
  const issues = checkInvariants(
    ok({ stats: { total: 5, translated: 0, refined: 1, failed: 0, failureRate: 0 } }),
    { llmConfigured: true },
  );
  assert.ok(errs(issues).some(m => /번역 0건/.test(m)));
});

test('키가 없으면 번역 0건은 정상(폴백) → error 아님', () => {
  const issues = checkInvariants(
    ok({
      stats: { total: 5, translated: 0, refined: 1, failed: 0, failureRate: 0 },
      detailStats: { total: 5, generated: 0, fullText: 0, failed: 0 },
    }),
    { llmConfigured: false },
  );
  assert.deepEqual(errs(issues), []);
});

test('키가 있는데 상세 생성 0건 → error', () => {
  const issues = checkInvariants(
    ok({ detailStats: { total: 5, generated: 0, fullText: 0, failed: 0 } }),
    { llmConfigured: true },
  );
  assert.ok(errs(issues).some(m => /상세 생성 0건/.test(m)));
});

test('번역/상세 실패율 초과 → error', () => {
  const t = checkInvariants(ok({ stats: { total: 5, translated: 3, failed: 2, failureRate: 0.4 } }));
  assert.ok(errs(t).some(m => /번역 실패율 40%/.test(m)));

  const d = checkInvariants(ok({ detailStats: { total: 5, generated: 2, failed: 3 } }));
  assert.ok(errs(d).some(m => /상세 생성 실패율 60%/.test(m)));
});

test('수집 실패·결손 소스는 경고(warn)로만', () => {
  const issues = checkInvariants(ok({ failures: ['arxiv: timeout'], deficits: ['arxiv'] }));
  assert.deepEqual(errs(issues), []);
  assert.equal(issues.filter(i => i.level === 'warn').length, 2);
});

test('checkSourceStreaks: 3일 연속 결손 소스를 경고', () => {
  const db = openDb(':memory:');
  const it = (source, id) => ({
    source, sourceItemId: id, title: 't', titleKo: 't', summary: null, summaryKo: null,
    url: `https://e.com/${source}/${id}`, popularitySignal: 1,
    publishedAt: '2026-08-01T00:00:00Z', selectionReason: 'primary', isTranslated: false,
  });
  for (const d of ['2026-08-05', '2026-08-06', '2026-08-07']) {
    // arxiv만 계속 빠짐
    savePicks(db, { pickDate: d, items: [it('hackernews', `h${d}`), it('physorg', `p${d}`)] });
  }
  const issues = checkSourceStreaks(db, ['hackernews', 'arxiv', 'physorg'], 3);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /arxiv: 최근 3일 연속 게시 없음/);
  db.close();
});

test('checkSourceStreaks: 이력이 days보다 짧으면 판정하지 않음', () => {
  const db = openDb(':memory:');
  savePicks(db, {
    pickDate: '2026-08-07',
    items: [{
      source: 'hackernews', sourceItemId: 'h1', title: 't', titleKo: 't', summary: null,
      summaryKo: null, url: 'https://e.com/1', popularitySignal: 1,
      publishedAt: '2026-08-01T00:00:00Z', selectionReason: 'primary', isTranslated: false,
    }],
  });
  assert.deepEqual(checkSourceStreaks(db, ['arxiv'], 3), []);
  db.close();
});
