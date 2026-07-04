// M1 실행 진입점 — 5개 소스 어댑터 병렬 수집 (기술 백서 §10 로드맵)
//
// DoD: 소스별 latest/popular 후보 정상 수집, 스키마 확정.
// §1: 특정 소스 어댑터가 실패해도 나머지는 계속 진행한다(Promise.allSettled).

import * as hackernews from './adapters/hackernews.mjs';
import * as geeknews from './adapters/geeknews.mjs';
import * as arxiv from './adapters/arxiv.mjs';
import * as physorg from './adapters/physorg.mjs';
import * as techxplore from './adapters/techxplore.mjs';
import { assertCandidates } from './pipeline/normalize.mjs';

const ADAPTERS = [hackernews, geeknews, arxiv, physorg, techxplore];
const WINDOW_HOURS = 24;

const started = Date.now();
console.log(`[M1] 5개 소스 병렬 수집 — 수집 창 ${WINDOW_HOURS}h\n`);

const settled = await Promise.allSettled(
  ADAPTERS.map(a => a.fetchCandidates({ windowHours: WINDOW_HOURS })),
);

/** @type {Record<string, import('./pipeline/normalize.mjs').Candidate[]>} */
export const candidatesBySource = {};
let failures = 0;

for (const [i, result] of settled.entries()) {
  const source = ADAPTERS[i].SOURCE;
  if (result.status === 'rejected') {
    failures++;
    candidatesBySource[source] = [];
    console.error(`✗ ${source}: ${result.reason.message}`);
    continue;
  }
  assertCandidates(result.value);
  candidatesBySource[source] = result.value;
}

console.log(`수집 완료 (${Date.now() - started}ms) — 실패 소스 ${failures}/5\n`);
console.log('소스        건수  인기픽  1순위 후보');
console.log('─'.repeat(96));
for (const [source, list] of Object.entries(candidatesBySource)) {
  const popular = list.filter(c => c.isPopularPick).length;
  const top = list[0];
  const signal = top?.popularitySignal !== null && top?.popularitySignal !== undefined
    ? `★${top.popularitySignal} ` : top ? '(에디터 선정) ' : '';
  console.log(
    `${source.padEnd(12)}${String(list.length).padStart(3)}  ${String(popular).padStart(5)}  `
    + (top ? `${signal}${top.title.slice(0, 60)}` : '(후보 없음 — 재분배 대상)'),
  );
}

// 소스별 상위 3건 상세
for (const [source, list] of Object.entries(candidatesBySource)) {
  if (list.length === 0) continue;
  console.log(`\n── ${source} 상위 3건 ──`);
  for (const [i, c] of list.slice(0, 3).entries()) {
    const signal = c.popularitySignal !== null ? `★${c.popularitySignal}` : c.isPopularPick ? 'Spotlight' : '최신';
    console.log(`${String(i + 1).padStart(2, '0')}  [${signal}] ${c.title}`);
    console.log(`    ${c.url}`);
  }
}
