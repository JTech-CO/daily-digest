// 엔드포인트 헬스체크 (기술 백서 §9, §10 M6 "리스크 항목 실측 재확인")
//
// 각 소스의 실 엔드포인트와 어댑터를 점검한다:
//  - 각 어댑터가 후보를 1건 이상 반환하는가(arXiv 주말 0건은 정상으로 표시)
//  - Spotlight 슬러그(/rss-feed/breaking/)가 여전히 유효한가(§9 정기 재확인)
//  - GeekNews 홈 파싱 셀렉터가 여전히 유효한가
// 실패 항목은 비-0 종료 코드로 알려 CI에서 감지할 수 있게 한다.

import * as hackernews from './adapters/hackernews.mjs';
import * as geeknews from './adapters/geeknews.mjs';
import * as arxiv from './adapters/arxiv.mjs';
import * as physorg from './adapters/physorg.mjs';
import * as techxplore from './adapters/techxplore.mjs';
import { parseHomepage } from './adapters/geeknews.mjs';
import { fetchText, USER_AGENT } from './adapters/http.mjs';

const WINDOW_HOURS = 24;
const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

// 1) 어댑터별 수집 — arXiv는 주말 0건이 정상(§2.4)이므로 경고로만 처리
const adapters = [
  ['hackernews', hackernews, false],
  ['geeknews', geeknews, false],
  ['arxiv', arxiv, true],       // zeroOk: 주말 무발표 허용
  ['physorg', physorg, false],
  ['techxplore', techxplore, false],
];
for (const [name, mod, zeroOk] of adapters) {
  try {
    const cands = await mod.fetchCandidates({ windowHours: WINDOW_HOURS });
    if (cands.length === 0 && !zeroOk) {
      record(name, false, '후보 0건 (엔드포인트 이상 의심)');
    } else {
      const pop = cands.filter(c => c.isPopularPick).length;
      record(name, true, `${cands.length}건 (인기픽 ${pop})${cands.length === 0 ? ' — 0건이지만 정상 범위' : ''}`);
    }
  } catch (err) {
    record(name, false, err.message);
  }
}

// 2) Spotlight 슬러그 직접 확인 (§9 — 슬러그 파손 조기 감지)
for (const [name, base] of [['physorg', 'https://phys.org'], ['techxplore', 'https://techxplore.com']]) {
  const url = `${base}/rss-feed/breaking/`;
  try {
    const xml = await fetchText(`${name}-spotlight`, url);
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    record(`${name} spotlight 슬러그`, itemCount > 0, `${itemCount}개 항목 @ ${url}`);
  } catch (err) {
    record(`${name} spotlight 슬러그`, false, err.message);
  }
}

// 3) GeekNews 홈 파싱 셀렉터 유효성 (§9)
try {
  const html = await fetchText('geeknews-home', 'https://news.hada.io/');
  const parsed = parseHomepage(html);
  record('geeknews 홈 파싱', parsed.length > 0, `topic_row ${parsed.length}개 파싱`);
} catch (err) {
  record('geeknews 홈 파싱', false, err.message);
}

// ── 리포트 ──
console.log(`\n헬스체크 (UA: ${USER_AGENT})\n${'─'.repeat(72)}`);
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(28)} ${r.detail}`);
}
const failed = results.filter(r => !r.ok);
console.log('─'.repeat(72));
console.log(`${results.length - failed.length}/${results.length} 통과`);
if (failed.length > 0) {
  console.error(`\n실패 ${failed.length}건 — 폴백은 동작하나 §9 리스크 항목 점검 필요`);
  process.exit(1);
}
