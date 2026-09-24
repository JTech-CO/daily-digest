// 수집 단계의 소스 격리 검증 (기술 백서 §1)
//
// 회귀 배경: 한 어댑터가 스키마 위반 후보를 내면 assertCandidates가 throw하면서
// collectAll 전체가 죽어 그날 5개 소스가 모두 날아갔다. 소스 단위로 격리되어야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAll } from '../src/pipeline/collect.mjs';

const SOURCES = ['hackernews', 'geeknews', 'arxiv', 'physorg', 'techxplore'];

const valid = source => ({
  source, sourceItemId: `${source}-1`, title: `${source} 제목`,
  url: `https://example.com/${source}`, summary: null,
  publishedAt: '2026-09-25T00:00:00.000Z', popularitySignal: 1, isPopularPick: true,
});

/** 소스별 동작을 지정해 가짜 어댑터 배열을 만든다 */
const fakeAdapters = behavior =>
  SOURCES.map(source => ({ SOURCE: source, fetchCandidates: behavior(source) }));

const healthy = source => async () => [valid(source)];

test('스키마 위반 소스는 그 소스만 실패로 격리되고 나머지는 살아남는다', async () => {
  const adapters = fakeAdapters(source => (source === 'hackernews'
    // 잘못된 후보: title 비어 있고 url이 http(s)가 아님
    ? async () => [{ ...valid(source), title: '', url: 'javascript:alert(1)' }]
    : healthy(source)));

  const { candidatesBySource, failures } = await collectAll({ adapters });

  assert.equal(candidatesBySource.hackernews.length, 0);   // 위반 소스만 비워짐
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^hackernews: /);
  assert.match(failures[0], /스키마 검증 실패/);
  for (const s of SOURCES.slice(1)) {
    assert.equal(candidatesBySource[s].length, 1, `${s}가 살아남아야 함`);
  }
});

test('fetch 실패 소스도 격리된다(기존 동작 유지)', async () => {
  const adapters = fakeAdapters(source => (source === 'geeknews'
    ? async () => { throw new Error('네트워크 끊김'); }
    : healthy(source)));

  const { candidatesBySource, failures } = await collectAll({ adapters });

  assert.equal(candidatesBySource.geeknews.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^geeknews: 네트워크 끊김/);
  assert.equal(candidatesBySource.hackernews.length, 1);
});

test('모든 소스 정상이면 실패 없이 전부 수집', async () => {
  const { candidatesBySource, failures } = await collectAll({ adapters: fakeAdapters(healthy) });
  assert.deepEqual(failures, []);
  assert.equal(Object.values(candidatesBySource).flat().length, SOURCES.length);
});

test('windowHours가 어댑터로 전달된다', async () => {
  const seen = [];
  const adapters = SOURCES.map(source => ({
    SOURCE: source,
    fetchCandidates: async ({ windowHours }) => { seen.push(windowHours); return []; },
  }));
  await collectAll({ windowHours: 72, adapters });
  assert.deepEqual(seen, [72, 72, 72, 72, 72]);
});
