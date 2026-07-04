// Hacker News 어댑터 — Algolia HN Search API (기술 백서 §2.2)
//
// `search`(관련도순) 엔드포인트에 query 없이 tags + numericFilters만 넣으면
// 사실상 points+댓글 가중 랭킹이 되므로, "최신(수집 창 내) + 인기(상위)"가
// 단 한 번의 호출로 해결된다. 인증 불필요.

const API_BASE = 'https://hn.algolia.com/api/v1';

export const SOURCE = 'hackernews';

/**
 * 수집 창(기본 직전 24시간) 내 인기순 스토리를 공통 Candidate 스키마로 반환한다.
 *
 * @param {object} [options]
 * @param {number} [options.windowHours=24]  수집 창 크기(시간) — 백서 §0 "rolling 24h"
 * @param {number} [options.limit=30]        후보 최대 개수
 * @param {typeof fetch} [options.fetchImpl] 테스트용 fetch 주입
 * @returns {Promise<import('../pipeline/normalize.mjs').Candidate[]>}
 */
export async function fetchCandidates({ windowHours = 24, limit = 30, fetchImpl = fetch } = {}) {
  const since = Math.floor((Date.now() - windowHours * 3600 * 1000) / 1000);
  const url = `${API_BASE}/search?tags=story&numericFilters=created_at_i>${since}&hitsPerPage=${limit}`;

  // 에러에 소스·URL 컨텍스트를 항상 포함한다 — M1에서 어댑터 5개가 병렬로 돌 때
  // 어느 소스의 어느 요청이 죽었는지 로그만으로 식별 가능해야 한다.
  let res;
  try {
    res = await fetchImpl(url);
  } catch (cause) {
    throw new Error(`[${SOURCE}] 요청 실패: ${url}`, { cause });
  }
  if (!res.ok) {
    throw new Error(`[${SOURCE}] API 응답 오류 ${res.status} ${res.statusText}: ${url}`);
  }

  let body;
  try {
    body = await res.json();
  } catch (cause) {
    // 200이지만 비-JSON(프록시/CDN 장애 페이지 등)인 경우
    throw new Error(`[${SOURCE}] JSON 파싱 실패(비-JSON 응답): ${url}`, { cause });
  }
  const { hits } = body;
  if (!Array.isArray(hits)) {
    throw new Error(`[${SOURCE}] 응답에 hits 배열이 없음: ${url}`);
  }

  return hits.map(toCandidate);
}

/**
 * Algolia hit 1건을 공통 Candidate 스키마(백서 §3.1)로 변환한다.
 */
export function toCandidate(hit) {
  return {
    source: SOURCE,
    sourceItemId: String(hit.objectID),
    title: hit.title ?? '',
    // Ask HN / Show HN 등 외부 링크가 없는 스토리는 HN 아이템 페이지로 대체
    url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    // HN 스토리에는 요약이 없다 — 셀프포스트의 본문(story_text)이 있으면 사용
    summary: hit.story_text ?? null,
    publishedAt: new Date(hit.created_at_i * 1000).toISOString(),
    // §0: HN 인기 신호는 points + 댓글수(Algolia relevance). 대표값으로 points 저장
    popularitySignal: hit.points ?? null,
    // relevance 검색 자체가 인기 트랙이므로 HN 후보는 전부 인기 픽
    isPopularPick: true,
  };
}
