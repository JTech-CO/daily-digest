// 엔드포인트 헬스체크 (기술 백서 §9, §10 M6 "리스크 항목 실측 재확인")
//
// 각 소스의 실 엔드포인트와 어댑터를 점검한다:
//  - 각 어댑터가 후보를 1건 이상 반환하는가(arXiv 주말 0건은 정상으로 표시)
//  - Spotlight 슬러그(/rss-feed/breaking/)가 여전히 유효한가(§9 정기 재확인)
//  - GeekNews 홈 파싱 셀렉터가 여전히 유효한가
// 실패 항목은 비-0 종료 코드로 알려 CI에서 감지할 수 있게 한다.

import { ADAPTERS } from './pipeline/collect.mjs';
import { parseHomepage } from './adapters/geeknews.mjs';
import { fetchText, USER_AGENT } from './adapters/http.mjs';

const WINDOW_HOURS = 24;
const results = [];
// warnOnly: 실패해도 자동 폴백이 있어 서비스가 계속 동작하는 점검(종료 코드에 반영하지 않음)
const record = (name, ok, detail, warnOnly = false) => results.push({ name, ok, detail, warnOnly });

// 1) 어댑터별 수집 — arXiv는 주말 무발표로 0건이 정상(§2.4)이라 실패로 보지 않는다
const ZERO_OK = new Set(['arxiv']);
for (const mod of ADAPTERS) {
  const name = mod.SOURCE;
  const zeroOk = ZERO_OK.has(name);
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
//    일시적 네트워크 오류로 주간 헬스체크가 오탐 실패하지 않도록 재시도를 준다
//    (구조 변경으로 슬러그가 실제로 깨졌다면 재시도해도 계속 실패한다).
const CHECK_RETRIES = { retries: 2, retryDelayMs: 2000 };
for (const [name, base] of [['physorg', 'https://phys.org'], ['techxplore', 'https://techxplore.com']]) {
  const url = `${base}/rss-feed/breaking/`;
  try {
    const xml = await fetchText(`${name}-spotlight`, url, CHECK_RETRIES);
    const itemCount = (xml.match(/<item>/g) ?? []).length;
    record(`${name} spotlight 슬러그`, itemCount > 0, `${itemCount}개 항목 @ ${url}`);
  } catch (err) {
    record(`${name} spotlight 슬러그`, false, err.message);
  }
}

// 3) GeekNews 홈 파싱 셀렉터 유효성 (§9)
//    홈이 막히거나 마크업이 바뀌어도 공식 RSS로 자동 폴백하므로 경고로만 다룬다.
//    (2026-09 기준 news.hada.io가 봇 User-Agent에 403을 반환한다 — RSS는 정상.
//     UA를 브라우저로 위장하지 않고 사이트가 공식 제공하는 RSS를 쓴다.
//     이 경우 투표 기반 인기 순위 대신 RSS 게시 순서가 쓰인다.)
try {
  const html = await fetchText('geeknews-home', 'https://news.hada.io/', CHECK_RETRIES);
  const parsed = parseHomepage(html);
  record('geeknews 홈 파싱', parsed.length > 0, `topic_row ${parsed.length}개 파싱`, true);
} catch (err) {
  record('geeknews 홈 파싱', false, `${err.message} — RSS 폴백으로 계속 동작`, true);
}

// ── 리포트 ──
console.log(`\n헬스체크 (UA: ${USER_AGENT})\n${'─'.repeat(72)}`);
for (const r of results) {
  const mark = r.ok ? '✓' : (r.warnOnly ? '!' : '✗');
  console.log(`${mark} ${r.name.padEnd(28)} ${r.detail}`);
}
const failed = results.filter(r => !r.ok && !r.warnOnly);
const warned = results.filter(r => !r.ok && r.warnOnly);
console.log('─'.repeat(72));
console.log(`${results.filter(r => r.ok).length}/${results.length} 통과`
  + (warned.length ? ` (경고 ${warned.length}건 — 폴백 동작 중)` : ''));
if (failed.length > 0) {
  console.error(`\n실패 ${failed.length}건 — 폴백 없는 항목이 깨졌습니다. §9 리스크 점검 필요`);
  process.exit(1);
}
