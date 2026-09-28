// 실행 진입점: 전체 파이프라인 1회 실행 후 SQLite 적재 (기술 백서 §6)
//
// 수집 → 중복제거 → 선별/재분배 → 번역 → 상세 → 저장 → 인베리언트 검사.
// 상세 로직은 pipeline/run.mjs (스케줄 워크플로와 공유).

import { runPipeline } from './pipeline/run.mjs';
import { checkInvariants, checkSourceStreaks } from './pipeline/guard.mjs';
import { hasLlm } from './pipeline/llm.mjs';
import { openDb } from './db/index.mjs';
import { SOURCES } from './pipeline/select.mjs';

const BADGE = { hackernews: 'HN', geeknews: 'GN', arxiv: 'AX', physorg: 'PO', techxplore: 'TX' };
const DB_PATH = 'daily-digest.db';

const result = await runPipeline({ dbPath: DB_PATH });
const { pickDate, items } = result;

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

// ── 인베리언트 검사: "돌긴 돌았는데 결과가 빈" 상태를 실패로 만든다 ──
const issues = [...checkInvariants(result, { llmConfigured: hasLlm() })];
{
  const db = openDb(DB_PATH);
  try {
    issues.push(...checkSourceStreaks(db, SOURCES));
  } finally {
    db.close();
  }
}

if (issues.length > 0) {
  console.log('\n점검 결과:');
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.message}`);
}
const errors = issues.filter(i => i.level === 'error');
if (errors.length > 0) {
  // 종료 코드 2 = "저장은 됐으나 품질 문제". 크래시(1)와 구분한다.
  //
  // 위반의 대부분은 번역·상세가 비었다는 것인데, 그건 원래 없어도 되는 기능이다
  // (키가 없으면 원문 그대로 게시한다, 백서 §0/§4.2 폴백). 그런데 1로 죽으면
  // 워크플로가 거기서 멈춰 그날 수집한 5건까지 통째로 버려진다. 실제로 크레딧이
  // 떨어진 뒤 사흘치가 그렇게 날아갔다. 호출부가 "게시는 하되 실패로 표시"할 수
  // 있도록 코드를 나눈다.
  console.error(`\n인베리언트 위반 ${errors.length}건. 저장은 됐지만 결과 품질에 문제가 있습니다.`);
  process.exit(2);
}
