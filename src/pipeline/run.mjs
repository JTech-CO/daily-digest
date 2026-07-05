// 파이프라인 오케스트레이션 (기술 백서 §1, §6)
//
// 수집 → 중복제거 → 선별/재분배 → 번역 → SQLite 적재.
// index.mjs(콘솔)와 스케줄 워크플로가 공유하는 단일 진입 함수.

import { collectAll } from './collect.mjs';
import { selectDaily } from './select.mjs';
import { translateAll } from './translate.mjs';
import { generateDetailsAll } from './detail.mjs';
import { makeLlmPairClassifier, activeProviderInfo } from './llm.mjs';
import { openDb, savePicks, kstDateString } from '../db/index.mjs';

/**
 * @param {object} [options]
 * @param {number} [options.windowHours=24]
 * @param {string} [options.dbPath='daily-digest.db']  null이면 저장 생략(드라이런)
 * @param {(msg: string) => void} [options.log=console.log]
 * @returns {Promise<{ pickDate, items, dedupLog, stats, failures, deficits, unfilled, saved }>}
 */
export async function runPipeline({ windowHours = 24, dbPath = 'daily-digest.db', log = console.log } = {}) {
  const pickDate = kstDateString();
  log(`[pipeline] ${pickDate} 시작 — 수집 창 ${windowHours}h`);

  const { candidatesBySource, failures } = await collectAll({ windowHours });
  for (const [source, list] of Object.entries(candidatesBySource)) {
    log(`  ${source.padEnd(12)} ${String(list.length).padStart(3)}건`);
  }
  for (const f of failures) log(`  ✗ ${f}`);

  const llm = activeProviderInfo();
  log(`  LLM: ${llm ? `${llm.name} (${llm.model})` : 'OFF — 키 없음, 번역/4차dedup 비활성'}`);

  const classifyPair = makeLlmPairClassifier();
  const { order, deficits, unfilled, dedupLog } = await selectDaily(candidatesBySource, { classifyPair });
  log(`  선별 ${order.length}건 (결손 ${deficits.length}, 미충족 ${unfilled}, 중복제거 ${dedupLog.length})`);

  const { items: translated, stats } = await translateAll(order);
  log(`  번역 ${stats.translated} / 정제 ${stats.refined} / 실패 ${stats.failed} (실패율 ${(stats.failureRate * 100).toFixed(1)}%)`);

  // 상세 뷰(제목/패널 클릭)용 3구성 생성 — 기사 전문 기반(원문 번역본·요약·블로그 초안)
  const { items, stats: detailStats } = await generateDetailsAll(translated);
  log(`  상세 생성 ${detailStats.generated}/${detailStats.total} (전문 ${detailStats.fullText}, 실패 ${detailStats.failed})`);

  let saved = null;
  if (dbPath) {
    const db = openDb(dbPath);
    try {
      saved = savePicks(db, { pickDate, items, dedupLog });
      log(`  저장 — 신규 ${saved.inserted} / 갱신 ${saved.updated} / dedup_log ${saved.dedupRows}`);
    } finally {
      db.close();
    }
  }

  return { pickDate, items, dedupLog, stats, detailStats, failures, deficits, unfilled, saved };
}
