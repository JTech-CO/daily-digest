-- 데이터 스키마 (기술 백서 §5)

CREATE TABLE IF NOT EXISTS daily_picks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pick_date TEXT NOT NULL,          -- 배치 실행일(KST, 'YYYY-MM-DD')
  source TEXT NOT NULL,             -- hackernews | geeknews | arxiv | physorg | techxplore
  source_item_id TEXT NOT NULL,
  title_original TEXT NOT NULL,
  title_ko TEXT NOT NULL,
  summary_original TEXT,
  summary_ko TEXT,
  url TEXT NOT NULL,
  popularity_signal INTEGER,        -- points/upvotes 등 (없으면 NULL)
  published_at TEXT,
  selection_reason TEXT NOT NULL,   -- primary | redistributed
  is_translated INTEGER NOT NULL,   -- GeekNews 정제-only 항목은 0
  rank INTEGER NOT NULL,            -- 해당 날짜 내 노출 순번(1-based)
  -- 상세 뷰(제목/패널 클릭 시)용 사전 생성 콘텐츠. LLM 키 없으면 NULL.
  detail_translation TEXT,          -- 원문 번역본(제목+요약 기반)
  detail_summary TEXT,              -- 핵심 요약(한두 문단)
  detail_blog TEXT,                 -- 기술 블로그 초안(마크다운)
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source, source_item_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_picks_date ON daily_picks(pick_date);

CREATE TABLE IF NOT EXISTS dedup_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pick_date TEXT NOT NULL,
  kept_source TEXT NOT NULL,
  kept_item_id TEXT NOT NULL,
  dropped_source TEXT NOT NULL,
  dropped_title TEXT NOT NULL,
  method TEXT NOT NULL,             -- url | arxiv_id | jaccard | llm
  similarity_score REAL
);
