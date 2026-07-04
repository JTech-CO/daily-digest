// M0 실행 진입점 — HN 어댑터 단독 PoC (기술 백서 §10 로드맵)
//
// DoD: latest+popular 후보 fetch + 공통 스키마 변환 성공.
// 수집 창 내 인기순 후보를 가져와 스키마 검증 후 콘솔에 요약 출력한다.

import { fetchCandidates, SOURCE } from './adapters/hackernews.mjs';
import { assertCandidates } from './pipeline/normalize.mjs';

const WINDOW_HOURS = 24;
const LIMIT = 30;

const started = Date.now();
console.log(`[M0] ${SOURCE} 어댑터 PoC — 수집 창 ${WINDOW_HOURS}h, 최대 ${LIMIT}건\n`);

const candidates = await fetchCandidates({ windowHours: WINDOW_HOURS, limit: LIMIT });
assertCandidates(candidates);

console.log(`후보 ${candidates.length}건 수집, 공통 스키마 검증 통과 (${Date.now() - started}ms)\n`);

for (const [i, c] of candidates.entries()) {
  const rank = String(i + 1).padStart(2, '0');
  const points = c.popularitySignal === null ? '   -' : String(c.popularitySignal).padStart(4);
  const ageHours = ((Date.now() - Date.parse(c.publishedAt)) / 3_600_000).toFixed(1);
  console.log(`${rank}  ★${points}  ${ageHours.padStart(5)}h전  ${c.title}`);
  console.log(`    ${c.url}`);
}

// 그날의 1순위 후보(파이프라인 M2에서 selectDaily가 집는 항목) 미리보기
const top = candidates[0];
if (top) {
  console.log('\n[선별 1순위 후보 — Candidate 스키마 원본]');
  console.log(JSON.stringify(top, null, 2));
} else {
  console.log('\n수집 창 내 후보 0건 — 재분배 규칙(§0) 발동 대상 (M2에서 처리)');
}
