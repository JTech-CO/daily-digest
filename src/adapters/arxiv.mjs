// arXiv 어댑터 — 공식 Atom API(최신) + Hugging Face Daily Papers(인기) (기술 백서 §2.4)
//
// 최신 트랙: export.arxiv.org Atom API, AI/엔지니어링 카테고리, submittedDate 내림차순.
//   §9: 간헐적 429 → 지수 백오프 재시도(fetchText retries).
//
// 인기 트랙: HF Daily Papers — 업보트 주석이 아니라 **후보 자체**로 사용한다.
//   운영 33일 실측(2026-07~08): arXiv API의 submittedDate 신선분은 주 3일(수·목·금 실행)만
//   24h 창에 들어오고 나머지 날은 최신 논문이 31~106시간 전이라 창이 통째로 비었다.
//   반면 HF Daily Papers는 월~금 매일 17~40건을 큐레이션한다(토·일은 0건).
//   HF 등재 자체가 "오늘의 신선·인기" 신호이므로 HF 후보에는 24h 창 필터를 적용하지 않는다
//   (논문 publishedAt은 며칠 전일 수 있음). 토·일 0건은 재분배 규칙(§0)이 흡수한다.

import Parser from 'rss-parser';
import { fetchText, fetchJson } from './http.mjs';

export const SOURCE = 'arxiv';

const CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.RO', 'cs.CV'];
const API_URL = 'http://export.arxiv.org/api/query'
  + `?search_query=${CATEGORIES.map(c => `cat:${c}`).join('+OR+')}`
  + '&sortBy=submittedDate&sortOrder=descending&max_results=50';
const HF_URL = 'https://huggingface.co/api/daily_papers?limit=50';

export async function fetchCandidates({ windowHours = 24, limit = 30, fetchImpl = fetch } = {}) {
  const sinceMs = Date.now() - windowHours * 3600 * 1000;

  const xml = await fetchText(SOURCE, API_URL, { fetchImpl, retries: 2, retryDelayMs: 3000 });
  const feed = await new Parser({
    customFields: { item: [['summary', 'summary']] },
  }).parseString(xml);

  const latest = (feed.items ?? [])
    .map(item => {
      const absUrl = item.link ?? item.id ?? '';
      return {
        source: SOURCE,
        sourceItemId: extractArxivId(absUrl) ?? absUrl,
        title: (item.title ?? '').replaceAll(/\s+/g, ' ').trim(),
        url: absUrl,
        summary: (item.summary ?? item.contentSnippet ?? '').replaceAll(/\s+/g, ' ').trim() || null,
        publishedAt: new Date(item.pubDate ?? item.isoDate).toISOString(),
        popularitySignal: null,
        isPopularPick: false,
      };
    })
    .filter(c => Date.parse(c.publishedAt) >= sinceMs);

  // 인기 트랙 — HF Daily Papers를 후보로 사용(실패 시 최신순만으로 폴백, §9)
  let popular = [];
  let upvotesById = new Map();
  try {
    const papers = await fetchJson(SOURCE, HF_URL, { fetchImpl });
    const entries = Array.isArray(papers) ? papers : [];
    // 업보트 조인용 맵은 후보 변환 성공 여부와 무관하게 원본에서 만든다
    upvotesById = new Map(entries
      .filter(e => e?.paper?.id)
      .map(e => [String(e.paper.id), e.paper.upvotes ?? 0]));
    popular = entries.map(toCandidateFromHf).filter(Boolean);
  } catch (err) {
    console.warn(`${err.message} — HF 인기 신호 없이 최신순만 사용`);
  }
  for (const c of latest) {
    if (upvotesById.has(baseId(c.sourceItemId))) {
      c.popularitySignal = upvotesById.get(baseId(c.sourceItemId));
      c.isPopularPick = true;
    }
  }

  // 병합: HF(업보트 내림차순) 먼저, 나머지 최신순. base ID로 중복 제거.
  const seen = new Set();
  return [
    ...popular.sort((a, b) => (b.popularitySignal ?? 0) - (a.popularitySignal ?? 0)),
    ...latest.sort((a, b) => {
      if (a.isPopularPick !== b.isPopularPick) return a.isPopularPick ? -1 : 1;
      if (a.isPopularPick) return (b.popularitySignal ?? 0) - (a.popularitySignal ?? 0);
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    }),
  ]
    .filter(c => {
      const id = baseId(c.sourceItemId);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);
}

/** HF Daily Papers 항목 → 공통 Candidate. 필수 필드가 없으면 null. */
function toCandidateFromHf(entry) {
  const p = entry?.paper;
  const id = p?.id;
  const title = (p?.title ?? '').replaceAll(/\s+/g, ' ').trim();
  if (!id || !title) return null;
  const published = p.publishedAt ?? entry.publishedAt;
  return {
    source: SOURCE,
    sourceItemId: String(id),
    title,
    url: `https://arxiv.org/abs/${id}`,
    summary: (p.summary ?? '').replaceAll(/\s+/g, ' ').trim() || null,
    publishedAt: published && !Number.isNaN(Date.parse(published))
      ? new Date(published).toISOString()
      : new Date().toISOString(),
    popularitySignal: typeof p.upvotes === 'number' ? p.upvotes : 0,
    isPopularPick: true, // HF Daily Papers 등재 = 큐레이션된 인기 픽
  };
}

/** 'https://arxiv.org/abs/2607.02514v1' → '2607.02514v1' */
export function extractArxivId(url) {
  return url.match(/arxiv\.org\/abs\/([\w.-]+)/)?.[1] ?? null;
}

/** '2607.02514v1' → '2607.02514' (HF ID에는 버전이 없다) */
function baseId(id) {
  return id.replace(/v\d+$/, '');
}
