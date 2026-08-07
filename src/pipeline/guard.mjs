// 파이프라인 인베리언트 가드 — 무증상 실패 감지
//
// 배경: 워크플로 종료 코드만으로는 "돌긴 돌았는데 결과가 비었다"를 잡지 못한다.
// 실제로 33일간 매일 success였지만 LLM 키가 없어 번역·상세가 0건이었고,
// 사이트는 영어 제목을 그대로 내보내고 있었다. 그런 상태를 실패로 만든다.
//
// 각 검사는 { level: 'error'|'warn', message } 를 낸다. error가 하나라도 있으면
// 호출부(index.mjs)가 비-0으로 종료해 CI가 붉어진다.

const pct = x => `${(x * 100).toFixed(0)}%`;

/**
 * @param {object} result runPipeline 반환값
 * @param {object} [options]
 * @param {number} [options.minItems=4]           하루 최소 게시 건수
 * @param {number} [options.maxTranslateFailRate=0.2]
 * @param {number} [options.maxDetailFailRate=0.3]
 * @param {boolean} [options.llmConfigured]       LLM 키 설정 여부(미지정 시 stats로 추정하지 않음)
 * @returns {Array<{level: 'error'|'warn', message: string}>}
 */
export function checkInvariants(result, {
  minItems = 4,
  maxTranslateFailRate = 0.2,
  maxDetailFailRate = 0.3,
  llmConfigured = false,
} = {}) {
  const issues = [];
  const { items = [], stats = {}, detailStats = {}, failures = [], deficits = [] } = result ?? {};

  // 1) 게시 건수 — 재분배까지 하고도 너무 적으면 수집 자체가 무너진 것
  if (items.length < minItems) {
    issues.push({ level: 'error', message: `게시 건수 ${items.length}건 (최소 ${minItems}건)` });
  }

  // 2) 키가 있는데 한 건도 번역되지 않음 — 오늘 실제로 겪은 무증상 실패
  if (llmConfigured) {
    const needTranslation = items.filter(i => i.source !== 'geeknews').length;
    if (needTranslation > 0 && (stats.translated ?? 0) === 0) {
      issues.push({ level: 'error', message: `LLM 키가 설정됐는데 번역 0건 (대상 ${needTranslation}건)` });
    }
    if ((detailStats.total ?? 0) > 0 && (detailStats.generated ?? 0) === 0) {
      issues.push({ level: 'error', message: `LLM 키가 설정됐는데 상세 생성 0건 (대상 ${detailStats.total}건)` });
    }
  }

  // 3) 실패율
  const tFail = stats.failureRate ?? 0;
  if (tFail > maxTranslateFailRate) {
    issues.push({ level: 'error', message: `번역 실패율 ${pct(tFail)} (허용 ${pct(maxTranslateFailRate)})` });
  }
  const dTotal = detailStats.total ?? 0;
  const dFail = dTotal > 0 ? (detailStats.failed ?? 0) / dTotal : 0;
  if (dFail > maxDetailFailRate) {
    issues.push({ level: 'error', message: `상세 생성 실패율 ${pct(dFail)} (허용 ${pct(maxDetailFailRate)})` });
  }

  // 4) 수집 실패 소스 — 재분배로 건수는 채워지므로 경고로 남기되 눈에 띄게
  for (const f of failures) issues.push({ level: 'warn', message: `소스 수집 실패 — ${f}` });

  // 5) 결손 소스(후보 0건). 정상 범위(주말 arXiv 등)라 경고.
  if (deficits.length > 0) {
    issues.push({ level: 'warn', message: `후보 0건 소스: ${deficits.join(', ')}` });
  }

  return issues;
}

/**
 * 최근 N일 연속으로 한 소스가 게시되지 않았는지 검사한다(어댑터 파손 조기 감지).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string[]} sources
 * @param {number} [days=3]
 */
export function checkSourceStreaks(db, sources, days = 3) {
  const issues = [];
  const recent = db.prepare(
    'SELECT DISTINCT pick_date d FROM daily_picks ORDER BY d DESC LIMIT ?',
  ).all(days).map(r => r.d);
  if (recent.length < days) return issues; // 이력이 아직 짧음

  for (const source of sources) {
    const n = db.prepare(
      `SELECT COUNT(*) n FROM daily_picks WHERE source = ? AND pick_date IN (${recent.map(() => '?').join(',')})`,
    ).get(source, ...recent).n;
    if (n === 0) {
      issues.push({ level: 'warn', message: `${source}: 최근 ${days}일 연속 게시 없음 (어댑터 점검 필요)` });
    }
  }
  return issues;
}
