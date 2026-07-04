// arXiv 어댑터 — 공식 Atom API + Hugging Face Daily Papers 인기 신호 (기술 백서 §2.4)
//
// 최신: export.arxiv.org Atom API, AI/엔지니어링 카테고리, submittedDate 내림차순.
//   §9: 간헐적 429 → 지수 백오프 재시도(fetchText retries).
// 인기: HF Daily Papers 업보트(비공식이지만 huggingface.co/papers가 실제 쓰는 API).
//   HF 목록에 있는 논문을 업보트순으로 앞에, 나머지는 최신순으로 뒤에 배치한다.
//   HF 조회 실패 시 최신순만으로 폴백(§9 — HF는 보조 신호일 뿐).
//
// arXiv는 미국 동부시간 일~목요일만 신규 발표 — 금·토(KST 토·일 부근)엔
// 후보 0건이 정상이며 재분배 규칙(§0)이 흡수한다.

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

  // 인기 보정 — HF Daily Papers 업보트를 arXiv ID로 조인
  let upvotesById = new Map();
  try {
    const papers = await fetchJson(SOURCE, HF_URL, { fetchImpl });
    upvotesById = new Map(papers.map(p => [p.paper?.id, p.paper?.upvotes ?? 0]));
  } catch (err) {
    console.warn(`${err.message} — HF 인기 신호 없이 최신순만 사용`);
  }

  for (const c of latest) {
    if (upvotesById.has(baseId(c.sourceItemId))) {
      c.popularitySignal = upvotesById.get(baseId(c.sourceItemId));
      c.isPopularPick = true;
    }
  }

  // HF 등재 논문(업보트 내림차순) 먼저, 나머지는 최신순 그대로
  return latest
    .sort((a, b) => {
      if (a.isPopularPick !== b.isPopularPick) return a.isPopularPick ? -1 : 1;
      if (a.isPopularPick) return (b.popularitySignal ?? 0) - (a.popularitySignal ?? 0);
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    })
    .slice(0, limit);
}

/** 'https://arxiv.org/abs/2607.02514v1' → '2607.02514v1' */
export function extractArxivId(url) {
  return url.match(/arxiv\.org\/abs\/([\w.-]+)/)?.[1] ?? null;
}

/** '2607.02514v1' → '2607.02514' (HF ID에는 버전이 없다) */
function baseId(id) {
  return id.replace(/v\d+$/, '');
}
