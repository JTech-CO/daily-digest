// 저장된 HTML 잔재 정리 (일회성 유지보수)
//
// 왜 필요한가: HN story_text가 HTML이고 GeekNews 본문에도 escape된 마크업이 섞여 온다는
// 걸 늦게 알아, 이미 저장된 행에 <a>·<p>와 &#x2F; 같은 마크업이 그대로 남아 카드에
// 노출됐다. 어댑터는 adapters/{hackernews,geeknews}.mjs에서 고쳤지만 그 전에 쌓인 행은
// 수집을 다시 하지 않는 한 영원히 깨진 채로 남는다.
//
// 사용법:
//   node src/pipeline/repair-html.mjs [--dry] [--db=daily-digest.db]
//
// 번역 상태(is_translated·backfilled_at)는 건드리지 않는다. LLM 백필 대상은 그대로 남는다.

import { pathToFileURL } from 'node:url';
import { openDb } from '../db/index.mjs';
import { htmlToText } from '../adapters/http.mjs';

// 마크업이 확실한 행만 손댄다. 평문에 그냥 들어간 꺾쇠는 건드리면 안 된다:
//  - arXiv 초록의 'responses <You are right, I made a mistake>'
//  - GeekNews 제목의 'lab | up >/conf'
// 둘 다 실제 데이터에 있다. 그래서 '<' 뒤에 진짜 태그명이 붙은 경우만 인정한다.
// 닫는 '>'는 선택: 소스가 본문을 자르며 '<a href="https://new'처럼 끊어놓기도 한다.
const HAS_MARKUP =
  /<\/?(a|p|br|div|span|img|ul|ol|li|pre|code|em|strong|b|i|h[1-6]|blockquote|table)\b[^>]*>?|&#x?[0-9a-fA-F]+;/;

const clean = s => (s == null ? null : htmlToText(s) || null);

/**
 * 마크업이 남은 summary를 평문으로 되돌린다.
 * @returns {{scanned: number, repaired: Array<{id: number, pickDate: string, source: string, before: string, after: string}>}}
 */
export function repairHtml(db, { dry = false } = {}) {
  const rows = db.prepare(
    'SELECT id, source, pick_date, summary_original, summary_ko FROM daily_picks',
  ).all();
  const update = db.prepare('UPDATE daily_picks SET summary_original = ?, summary_ko = ? WHERE id = ?');

  const repaired = [];
  for (const row of rows) {
    if (!HAS_MARKUP.test(row.summary_original ?? '') && !HAS_MARKUP.test(row.summary_ko ?? '')) continue;

    const original = clean(row.summary_original);
    const ko = clean(row.summary_ko);
    if (original === row.summary_original && ko === row.summary_ko) continue;

    if (!dry) update.run(original, ko, row.id);
    repaired.push({
      id: row.id, pickDate: row.pick_date, source: row.source,
      before: row.summary_original, after: original,
    });
  }
  return { scanned: rows.length, repaired };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dry = process.argv.includes('--dry');
  const dbArg = process.argv.find(a => a.startsWith('--db='));
  const db = openDb(dbArg ? dbArg.slice(5) : 'daily-digest.db');
  try {
    const { scanned, repaired } = repairHtml(db, { dry });
    for (const r of repaired) {
      console.log(`${r.pickDate} [${r.source}] #${r.id}`);
      console.log(`  전 ${JSON.stringify((r.before ?? '').slice(0, 90))}`);
      console.log(`  후 ${JSON.stringify((r.after ?? '').slice(0, 90))}`);
    }
    console.log(`\n${scanned}건 검사 · ${repaired.length}건 ${dry ? '수정 예정(dry)' : '수정'}`);
  } finally {
    db.close();
  }
}
