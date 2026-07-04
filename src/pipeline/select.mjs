// 선별 + 재분배 (기술 백서 §0 재분배 규칙, §3.3)
//
// 소스당 1건 기준. 후보 0건인 소스의 슬롯은 후보 2건 이상 남은 소스에서
// 순위 하위로 보충한다(소스당 최대 3건 상한 — 편중 방지).
// 총량이 5건 미만으로 끝나는 날도 정상 동작으로 허용한다(§0).
//
// 어댑터가 반환하는 배열 순서 자체가 "최신+인기" 결합 랭킹이다(어댑터 계약).
// §3.3 의사코드의 byPopularityThenRecency 정렬은 소스별 신호가 이질적이라
// (points/업보트/Spotlight 순서) 각 어댑터 내부에서 이미 수행된 상태다.

import { findDuplicate } from './dedup.mjs';

export const SOURCES = ['hackernews', 'geeknews', 'arxiv', 'physorg', 'techxplore'];

/**
 * 하루치 선별을 수행한다.
 *
 * @param {Record<string, object[]>} candidatesBySource 소스별 랭킹순 후보
 * @param {object} [options]
 * @param {string[]} [options.sources]
 * @param {number} [options.maxPerSource=3]
 * @param {null | ((a, b) => Promise<boolean>)} [options.classifyPair] 4차 dedup LLM 판정기
 * @returns {Promise<{
 *   order: Array<object & { selectionReason: 'primary'|'redistributed' }>,
 *   picks: Record<string, object[]>,
 *   deficits: string[],
 *   unfilled: number,
 *   dedupLog: Array<{ keptSource, keptItemId, droppedSource, droppedTitle, method, similarityScore }>,
 * }>}
 */
export async function selectDaily(candidatesBySource, {
  sources = SOURCES,
  maxPerSource = 3,
  classifyPair = null,
} = {}) {
  const picks = {};
  const pools = {};
  const deficits = [];
  const dedupLog = [];
  const flatPicks = () => Object.values(picks).flat();

  const logDup = (candidate, dup) => dedupLog.push({
    keptSource: dup.picked.source,
    keptItemId: dup.picked.sourceItemId,
    droppedSource: candidate.source,
    droppedTitle: candidate.title,
    method: dup.method,
    similarityScore: dup.score,
  });

  // 1) 소스당 1건 기본 선별 — 이전 소스 픽과의 중복은 풀 구축 시점에 제거(§3.3)
  for (const source of sources) {
    const pool = [];
    for (const candidate of candidatesBySource[source] ?? []) {
      const dup = await findDuplicate(candidate, flatPicks(), { classifyPair });
      if (dup) { logDup(candidate, dup); continue; }
      pool.push(candidate);
    }
    pools[source] = pool;
    if (pool.length > 0) {
      picks[source] = [pool[0]];
    } else {
      picks[source] = [];
      deficits.push(source);
    }
  }

  // 2) 재분배 — 잔여 풀이 큰 소스부터, 순위 하위로 보충(소스당 상한 유지)
  let remaining = deficits.length;
  const donors = sources
    .filter(s => !deficits.includes(s))
    .map(s => ({ source: s, pool: pools[s].slice(1) }))
    .filter(d => d.pool.length > 0)
    .sort((a, b) => b.pool.length - a.pool.length);

  for (const donor of donors) {
    while (remaining > 0 && donor.pool.length > 0 && picks[donor.source].length < maxPerSource) {
      const next = donor.pool.shift();
      // 자기 소스 1픽 포함 전체 픽과 재검(픽이 늘어난 뒤이므로)
      const dup = await findDuplicate(next, flatPicks(), { classifyPair });
      if (dup) { logDup(next, dup); continue; }
      picks[donor.source].push(next);
      remaining--;
    }
    if (remaining === 0) break;
  }

  // 3) 노출 순서 — 소스 고정 순서, 소스 내에서는 primary → redistributed
  const order = [];
  for (const source of sources) {
    for (const [i, candidate] of picks[source].entries()) {
      order.push({ ...candidate, selectionReason: i === 0 ? 'primary' : 'redistributed' });
    }
  }

  return { order, picks, deficits, unfilled: remaining, dedupLog };
}
