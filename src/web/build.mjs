// 정적 사이트 빌드 — DB → public/ (기술 백서 §6 "정적 사이트 재빌드")
//
// web/의 정적 자산을 public/으로 복사하고, SQLite에서 전체 날짜·선별 결과를
// public/data.json으로 내보낸다. 프론트엔드는 data.json만 fetch한다.

import { readdirSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, listDates, getPicksByDate } from '../db/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = join(ROOT, 'web');
const PUBLIC_DIR = join(ROOT, 'public');
const DB_PATH = join(ROOT, 'daily-digest.db');

// 프론트엔드가 쓰는 컬럼만 노출(원문/번역 병기, 표기 판단용 필드)
const PICK_FIELDS = [
  'rank', 'source', 'source_item_id', 'title_original', 'title_ko',
  'summary_original', 'summary_ko', 'url', 'popularity_signal',
  'published_at', 'selection_reason', 'is_translated',
];

function buildData() {
  const db = openDb(DB_PATH);
  try {
    const dates = listDates(db).map(({ date, count }) => ({ date, count }));
    const picks = {};
    for (const { date } of dates) {
      picks[date] = getPicksByDate(db, date).map(row =>
        Object.fromEntries(PICK_FIELDS.map(f => [f, row[f]])));
    }
    // 순수 함수로 유지하기 위해 생성 시각은 호출부에서 주입받는 대신 여기서 스탬프
    return { generatedAt: new Date().toISOString(), dates, picks };
  } finally {
    db.close();
  }
}

function copyStatic() {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  for (const name of readdirSync(WEB_DIR)) {
    copyFileSync(join(WEB_DIR, name), join(PUBLIC_DIR, name));
  }
}

copyStatic();
const data = buildData();
writeFileSync(join(PUBLIC_DIR, 'data.json'), JSON.stringify(data));
console.log(`[build] public/ 생성 — ${data.dates.length}일치, `
  + `${Object.values(data.picks).reduce((n, p) => n + p.length, 0)}건`);
