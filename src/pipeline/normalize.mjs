// 공통 Candidate 스키마 검증 (기술 백서 §3.1)
//
// 모든 소스 어댑터는 이 스키마로 정규화된 후보를 반환해야 한다.
// M0에서는 HN 어댑터의 변환 결과가 스키마에 맞는지 검증하는 용도로 쓰인다.

/**
 * @typedef {object} Candidate
 * @property {'hackernews'|'geeknews'|'arxiv'|'physorg'|'techxplore'} source
 * @property {string}      sourceItemId      소스 내 고유 ID
 * @property {string}      title             원문 제목
 * @property {string}      url               외부 원문 링크 또는 자체 기사·초록 URL
 * @property {string|null} summary           RSS description 또는 arXiv abstract
 * @property {string}      publishedAt       ISO 8601 UTC
 * @property {number|null} popularitySignal  points 등, 없으면 null
 * @property {boolean}     isPopularPick     §0 표 기준 인기 트랙 포함 여부
 */

export const SOURCES = ['hackernews', 'geeknews', 'arxiv', 'physorg', 'techxplore'];

/**
 * Candidate 1건을 검증하고 위반 사항 목록을 반환한다. 빈 배열이면 유효.
 * @param {unknown} c
 * @returns {string[]}
 */
export function validateCandidate(c) {
  const errors = [];
  if (typeof c !== 'object' || c === null) return ['candidate가 객체가 아님'];

  if (!SOURCES.includes(c.source)) errors.push(`source 값 불명: ${c.source}`);
  if (typeof c.sourceItemId !== 'string' || c.sourceItemId.length === 0) {
    errors.push('sourceItemId는 비어 있지 않은 문자열이어야 함');
  }
  if (typeof c.title !== 'string' || c.title.trim().length === 0) {
    errors.push('title은 비어 있지 않은 문자열이어야 함');
  }
  if (typeof c.url !== 'string' || !/^https?:\/\//.test(c.url)) {
    errors.push(`url이 http(s) URL이 아님: ${c.url}`);
  }
  if (c.summary !== null && typeof c.summary !== 'string') {
    errors.push('summary는 문자열 또는 null이어야 함');
  }
  if (typeof c.publishedAt !== 'string' || Number.isNaN(Date.parse(c.publishedAt))) {
    errors.push(`publishedAt이 유효한 ISO 8601 문자열이 아님: ${c.publishedAt}`);
  }
  if (c.popularitySignal !== null && typeof c.popularitySignal !== 'number') {
    errors.push('popularitySignal은 숫자 또는 null이어야 함');
  }
  if (typeof c.isPopularPick !== 'boolean') {
    errors.push('isPopularPick은 boolean이어야 함');
  }
  return errors;
}

/**
 * 후보 목록 전체를 검증한다. 하나라도 위반이 있으면 상세와 함께 throw.
 * @param {unknown[]} candidates
 * @returns {Candidate[]} 검증을 통과한 동일 배열
 */
export function assertCandidates(candidates) {
  const problems = [];
  for (const [i, c] of candidates.entries()) {
    const errors = validateCandidate(c);
    if (errors.length > 0) {
      problems.push(`[${i}] ${c?.title ?? '(제목 없음)'}: ${errors.join(', ')}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`공통 스키마 검증 실패 ${problems.length}건:\n${problems.join('\n')}`);
  }
  return candidates;
}
