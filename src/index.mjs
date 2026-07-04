// 실행 진입점 — 수집 → 중복제거 → 선별/재분배 (기술 백서 §10 M0~M2)
//
// M2 DoD: 4단계 dedup 통과 + 인위적 중복 테스트셋 검증(test/), 재분배 동작 확인.
// 번역(M3)·저장(M4) 전까지는 선별 결과를 콘솔로 출력한다.

import { collectAll } from './pipeline/collect.mjs';
import { selectDaily } from './pipeline/select.mjs';
import { makeLlmPairClassifier, hasApiKey } from './pipeline/claude.mjs';

const WINDOW_HOURS = 24;

const started = Date.now();
console.log(`[M2] 수집 → 중복제거 → 선별/재분배 — 수집 창 ${WINDOW_HOURS}h\n`);

const { candidatesBySource, failures } = await collectAll({ windowHours: WINDOW_HOURS });

console.log('소스별 후보 수:');
for (const [source, list] of Object.entries(candidatesBySource)) {
  console.log(`  ${source.padEnd(12)} ${String(list.length).padStart(3)}건`
    + (list.length === 0 ? '  (재분배 대상)' : ''));
}
if (failures.length > 0) {
  console.log('\n수집 실패:');
  for (const f of failures) console.log(`  ✗ ${f}`);
}

const classifyPair = makeLlmPairClassifier();
console.log(`\n4차 dedup LLM 판정기: ${classifyPair ? 'ON' : 'OFF (API 키 없음 — 애매 구간 비중복 처리)'}`);

const { order, deficits, unfilled, dedupLog } = await selectDaily(candidatesBySource, { classifyPair });

console.log(`\n선별 완료 (${Date.now() - started}ms) — ${order.length}건 `
  + `(결손 소스 ${deficits.length}, 미충족 슬롯 ${unfilled})`);
if (dedupLog.length > 0) {
  console.log(`\n중복 제거 ${dedupLog.length}건:`);
  for (const l of dedupLog) {
    console.log(`  [${l.method}${l.similarityScore < 1 ? ` ${l.similarityScore.toFixed(2)}` : ''}] `
      + `"${l.droppedTitle.slice(0, 50)}" (${l.droppedSource}) ← ${l.keptSource}`);
  }
}

console.log('\n오늘의 다이제스트:');
console.log('─'.repeat(96));
for (const [i, c] of order.entries()) {
  const rank = String(i + 1).padStart(2, '0');
  const badge = c.source.slice(0, 2).toUpperCase();
  const signal = c.popularitySignal !== null ? `★${c.popularitySignal}`
    : c.isPopularPick ? 'Spotlight' : '최신';
  const tag = c.selectionReason === 'redistributed' ? ' [재분배]' : '';
  console.log(`${rank} │${badge}│ ${c.title.slice(0, 62)}   ${signal}${tag}`);
  console.log(`   ${c.url}`);
}

export { order, candidatesBySource, dedupLog };
