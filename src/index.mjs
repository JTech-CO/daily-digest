// 실행 진입점 — 전체 파이프라인 1회 실행 후 SQLite 적재 (기술 백서 §6)
//
// 수집 → 중복제거 → 선별/재분배 → 번역 → 저장.
// 상세 로직은 pipeline/run.mjs (스케줄 워크플로와 공유).

import { runPipeline } from './pipeline/run.mjs';

const BADGE = { hackernews: 'HN', geeknews: 'GN', arxiv: 'AX', physorg: 'PO', techxplore: 'TX' };

const { pickDate, items } = await runPipeline();

console.log(`\n오늘의 다이제스트 (${pickDate}):`);
console.log('─'.repeat(96));
for (const [i, c] of items.entries()) {
  const rank = String(i + 1).padStart(2, '0');
  const signal = c.popularitySignal !== null ? `★${c.popularitySignal}`
    : c.isPopularPick ? 'Spotlight' : '최신';
  const tag = c.selectionReason === 'redistributed' ? ' [재분배]' : '';
  console.log(`${rank} │${BADGE[c.source]}│ ${c.titleKo.slice(0, 62)}   ${signal}${tag}`);
  if (c.summaryKo) console.log(`   ${c.summaryKo.slice(0, 90)}`);
  console.log(`   ${c.url}`);
}
