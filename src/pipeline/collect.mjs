// 5개 소스 병렬 수집 (기술 백서 §1)
//
// §1: 특정 소스 어댑터가 실패해도 나머지는 계속 진행한다(allSettled).
// 재사용 가능하도록 index/파이프라인 양쪽에서 부르는 순수 함수로 분리한다.

import * as hackernews from '../adapters/hackernews.mjs';
import * as geeknews from '../adapters/geeknews.mjs';
import * as arxiv from '../adapters/arxiv.mjs';
import * as physorg from '../adapters/physorg.mjs';
import * as techxplore from '../adapters/techxplore.mjs';
import { assertCandidates } from './normalize.mjs';

export const ADAPTERS = [hackernews, geeknews, arxiv, physorg, techxplore];

/**
 * @param {object} [options]
 * @param {number} [options.windowHours=24]
 * @param {typeof ADAPTERS} [options.adapters] 테스트용 주입(기본값은 실제 5개 어댑터)
 * @returns {Promise<{ candidatesBySource: Record<string, object[]>, failures: string[] }>}
 */
export async function collectAll({ windowHours = 24, adapters = ADAPTERS } = {}) {
  const settled = await Promise.allSettled(
    adapters.map(a => a.fetchCandidates({ windowHours })),
  );

  const candidatesBySource = {};
  const failures = [];

  for (const [i, result] of settled.entries()) {
    const source = adapters[i].SOURCE;
    if (result.status === 'rejected') {
      failures.push(`${source}: ${result.reason.message}`);
      candidatesBySource[source] = [];
      continue;
    }
    // 스키마 위반도 해당 소스만 실패로 격리한다(§1): 한 소스 때문에 전체 배치가 죽지 않도록
    try {
      assertCandidates(result.value);
      candidatesBySource[source] = result.value;
    } catch (err) {
      failures.push(`${source}: ${err.message}`);
      candidatesBySource[source] = [];
    }
  }

  return { candidatesBySource, failures };
}
